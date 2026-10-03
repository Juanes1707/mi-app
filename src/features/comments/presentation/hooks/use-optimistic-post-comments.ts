import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyResolutions, canReplyToLocal, discardLocal, isCanonicalMatch, markLocalDurable, markLocalSaveError,
  markLocalSaving, mergePendingProjection, pruneCanonicalResolved, type CommentOverlay, type CommentResolution,
  type LocalComment,
} from '@/features/comments/presentation/comment-overlay';
import type { PostComment } from '@/features/comments/domain/post-comment';
import { ROOT_BRANCH, type CommentTree } from '@/features/comments/presentation/comment-tree';
import {
  countCodePoints, isValidPostCommentBody, MAX_POST_COMMENT_BODY_CODE_POINTS,
} from '@/features/offline-sync/domain/post-comment-body';
import type { PendingPostComment } from '@/features/offline-sync/domain/post-comment-projection';
import {
  createPostCommentId, getPendingPostCommentProjection, offlineMutationResolutions, offlineSyncOrchestrator,
  offlineSyncReconciliation, queueCreatePostComment,
} from '@/features/offline-sync/offline-sync-container';

// Whether the owner's durable pending comments are known. Sending and replying are
// accepted only when 'ready': a read that is still running could otherwise land after
// a new intention and present a stale picture of the queue.
export type LocalCommentsStatus = 'no-owner' | 'loading' | 'ready' | 'error';

// What the composer answers. Only the id is persisted; the label is display text.
export type ReplyTarget = { commentId: string; label: string; source: 'server' | 'local' };

export type ComposerBodyIssue = 'too-long' | 'invalid' | null;

type OverlayState = {
  owner: string | null;
  postId: string;
  status: LocalCommentsStatus;
  entries: readonly LocalComment[];
};

const NO_ENTRIES: readonly LocalComment[] = [];

function initialStateFor(owner: string | null, postId: string): OverlayState {
  return { owner, postId, status: owner === null ? 'no-owner' : 'loading', entries: NO_ENTRIES };
}

type Options = {
  ownerUserId: string | null;
  postId: string;
  // The server tree on screen: used to recognise canonical rows, never modified here.
  tree: CommentTree;
  // Canonical comments that arrived live (re-read over HTTP) but are not paginated yet.
  liveComments?: ReadonlyMap<string, PostComment>;
  // Some of the user's comments left the sync queue; their branches may show them now.
  onCommentsSynced: (postId: string, branchKeys: string[]) => void;
  onReplyCreated: (parentCommentId: string) => void;
};

// Optimistic comments for one post. What the user sees is
//   server tree ← overlay (SQLite pending + in-memory intentions),
// where a new comment is shown on tap, persisted in SQLite, and synced only through
// the global queue → orchestrator → FIFO processor. Presentation never sends HTTP.
export function useOptimisticPostComments({
  ownerUserId, postId, tree, liveComments, onCommentsSynced, onReplyCreated,
}: Options) {
  const [state, setState] = useState<OverlayState>(() => initialStateFor(ownerUserId, postId));
  const [draft, setDraftState] = useState('');
  const [replyTarget, setReplyTargetState] = useState<ReplyTarget | null>(null);
  const stateRef = useRef(state);
  const draftRef = useRef('');
  const replyTargetRef = useRef<ReplyTarget | null>(null);
  const mountedRef = useRef(false);
  // Bumped on owner change, post change and unmount: late callbacks are ignored.
  const generationRef = useRef(0);
  // Every projection read gets a number; see LocalComment.durableSince.
  const projectionRequestRef = useRef(0);
  const nextLocalOrderRef = useRef(0);
  const runnerRef = useRef({ generation: -1, running: false, trailing: false });
  // Every canonical row on screen (paginated + live): what a local intention can match.
  const canonicalNodes = useMemo(
    () => (liveComments === undefined || liveComments.size === 0 ? tree.nodes : new Map([...tree.nodes, ...liveComments])),
    [tree.nodes, liveComments],
  );
  const canonicalRef = useRef(canonicalNodes);
  const callbacksRef = useRef({ onCommentsSynced, onReplyCreated });

  useEffect(() => {
    callbacksRef.current = { onCommentsSynced, onReplyCreated };
  }, [onCommentsSynced, onReplyCreated]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const commit = useCallback((update: (current: OverlayState) => OverlayState) => {
    if (!mountedRef.current) return;
    const next = update(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const commitEntries = useCallback(
    (update: (entries: readonly LocalComment[]) => readonly LocalComment[]) => {
      commit((current) => {
        const entries = update(current.entries);
        return entries === current.entries ? current : { ...current, entries };
      });
    },
    [commit],
  );

  // How the processor finished a comment of the CURRENT owner, if it is still in the
  // in-memory resolution window. Leaving the queue alone proves nothing.
  const resolveComment = useCallback((commentId: string): CommentResolution | null => {
    const owner = stateRef.current.owner;
    if (owner === null) return null;
    const event = offlineMutationResolutions.find(owner, 'create-post-comment', commentId);
    return event !== null && event.kind === 'create-post-comment' ? event.outcome : null;
  }, []);

  // Comments CONFIRMED just now may be revealed by their fully loaded branch.
  const catchUpSent = useCallback((sent: readonly LocalComment[]) => {
    const { owner, postId: target } = stateRef.current;
    const nodes = canonicalRef.current;
    const branchKeys = sent
      .filter((entry) => !isCanonicalMatch(entry, nodes.get(entry.commentId), owner))
      .map((entry) => entry.parentCommentId ?? ROOT_BRANCH);
    if (branchKeys.length > 0) callbacksRef.current.onCommentsSynced(target, branchKeys);
  }, []);

  const applyProjection = useCallback((pending: PendingPostComment[], requestId: number) => {
    let sent: LocalComment[] = [];
    commit((current) => {
      const merged = mergePendingProjection(
        current.entries, pending, requestId, () => ++nextLocalOrderRef.current, resolveComment,
      );
      sent = merged.sent;
      const entries = pruneCanonicalResolved(merged.entries, canonicalRef.current, current.owner);
      if (entries === current.entries && current.status === 'ready') return current;
      return { ...current, status: 'ready', entries };
    });
    catchUpSent(sent);
  }, [catchUpSent, commit, resolveComment]);

  // One read of the owner's queue at a time; reads requested meanwhile collapse into
  // one trailing read. A failure deletes nothing: a trustworthy overlay is kept as is,
  // and without one the composer stays disabled with a retry.
  const loadProjection = useCallback((generation: number) => {
    if (runnerRef.current.generation !== generation) {
      runnerRef.current = { generation, running: false, trailing: false };
    }
    const runner = runnerRef.current;
    if (runner.running) {
      runner.trailing = true;
      return;
    }
    runner.running = true;
    void (async () => {
      try {
        do {
          runner.trailing = false;
          const { owner, postId: target } = stateRef.current;
          if (owner === null || !mountedRef.current || generation !== generationRef.current) return;
          const requestId = ++projectionRequestRef.current;
          let pending: PendingPostComment[] | null;
          try {
            pending = await getPendingPostCommentProjection.execute(owner, target);
          } catch {
            pending = null;
          }
          if (!mountedRef.current || generation !== generationRef.current) return;
          if (pending === null) {
            commit((current) => (current.status === 'ready' ? current : { ...current, status: 'error' }));
          } else {
            applyProjection(pending, requestId);
          }
        } while (runner.trailing);
      } finally {
        runner.running = false;
      }
    })();
  }, [applyProjection, commit]);

  // Owner change, logout or another post: forget the previous overlay and draft
  // (SQLite is untouched) and rebuild from SQLite for this owner and post.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    draftRef.current = '';
    replyTargetRef.current = null;
    setDraftState('');
    setReplyTargetState(null);
    commit(() => initialStateFor(ownerUserId, postId));
    if (ownerUserId !== null) loadProjection(generation);
  }, [ownerUserId, postId, commit, loadProjection]);

  // A sync finished for this owner (it may have been a like): re-read the pending
  // comments. Those that left the queue take the outcome the processor recorded (the
  // orchestrator publishes resolutions BEFORE this signal; see mergePendingProjection).
  useEffect(() => {
    if (ownerUserId === null) return undefined;
    const generation = generationRef.current;
    let observedVersion = offlineSyncReconciliation.getVersion(ownerUserId);
    return offlineSyncReconciliation.subscribe(ownerUserId, (version) => {
      if (version <= observedVersion || generation !== generationRef.current) return;
      observedVersion = version;
      loadProjection(generation);
    });
  }, [ownerUserId, postId, loadProjection]);

  // Resolutions published after a read already saw a comment leave the queue
  // ('resolving'): settle it without reading SQLite again. Owner-scoped: another
  // owner's resolutions never reach this subscription.
  useEffect(() => {
    if (ownerUserId === null) return undefined;
    const generation = generationRef.current;
    return offlineMutationResolutions.subscribe(ownerUserId, () => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      let sent: LocalComment[] = [];
      commitEntries((entries) => {
        const resolved = applyResolutions(entries, resolveComment);
        sent = resolved.sent;
        return resolved.entries;
      });
      catchUpSent(sent);
    });
  }, [ownerUserId, postId, catchUpSent, commitEntries, resolveComment]);

  // A canonical row (a server page, or a live comment re-read over HTTP) now contains a
  // comment that left the queue: it replaces the local copy (also a terminal one: a
  // lost 201 followed by a 404 replay). A pending copy is only hidden (flatten).
  useEffect(() => {
    canonicalRef.current = canonicalNodes;
    commitEntries((entries) => pruneCanonicalResolved(entries, canonicalNodes, stateRef.current.owner));
  }, [canonicalNodes, commitEntries]);

  const retryPendingLoad = useCallback(() => {
    const current = stateRef.current;
    if (!mountedRef.current || current.owner === null || current.status !== 'error') return;
    commit((latest) => ({ ...latest, status: 'loading' }));
    loadProjection(generationRef.current);
  }, [commit, loadProjection]);

  // Never cancelled: once sent, the intention must finish becoming durable even if
  // the screen unmounts. Only the React updates are guarded.
  const persist = useCallback((owner: string, entry: LocalComment) => {
    const generation = generationRef.current;
    queueCreatePostComment.execute({
      ownerUserId: owner,
      commentId: entry.commentId,
      postId: entry.postId,
      parentCommentId: entry.parentCommentId,
      body: entry.body,
    }).then(
      (mutation) => {
        if (mountedRef.current && generation === generationRef.current) {
          // Durable now: same id, body, parent and order, so nothing moves on screen.
          commitEntries((entries) => markLocalDurable(
            entries, entry.commentId, mutation.sequence, projectionRequestRef.current,
          ));
        }
        // The durable event is global even if the screen unmounted meanwhile.
        void offlineSyncOrchestrator.requestDrain('enqueue');
      },
      () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        // Only this intention failed to persist; the others keep their state.
        commitEntries((entries) => markLocalSaveError(entries, entry.commentId));
      },
    );
  }, [commitEntries]);

  const setDraft = useCallback((text: string) => {
    draftRef.current = text;
    setDraftState(text);
  }, []);

  const startReply = useCallback((target: ReplyTarget) => {
    const current = stateRef.current;
    if (!mountedRef.current || current.status !== 'ready') return;
    if (target.source === 'local') {
      const parent = current.entries.find((entry) => entry.commentId === target.commentId);
      if (parent === undefined || !canReplyToLocal(parent)) return;
    }
    replyTargetRef.current = target;
    setReplyTargetState(target);
  }, []);

  // Leaves the draft untouched.
  const cancelReply = useCallback(() => {
    replyTargetRef.current = null;
    setReplyTargetState(null);
  }, []);

  // Tap → visible row with no await in between; SQLite starts afterwards.
  const send = useCallback((): boolean => {
    const current = stateRef.current;
    const owner = current.owner;
    if (!mountedRef.current || owner === null || current.status !== 'ready') return false;
    const body = draftRef.current;
    if (!isValidPostCommentBody(body)) return false;
    const target = replyTargetRef.current;
    if (target !== null && target.source === 'local') {
      const parent = current.entries.find((entry) => entry.commentId === target.commentId);
      if (parent === undefined || !canReplyToLocal(parent)) return false;
    }
    let commentId: string;
    try {
      commentId = createPostCommentId.execute();
    } catch {
      return false;
    }
    const entry: LocalComment = {
      commentId,
      postId: current.postId,
      parentCommentId: target?.commentId ?? null,
      // Exactly as typed: no trim, no normalization.
      body,
      status: 'saving',
      localOrder: ++nextLocalOrderRef.current,
      sequence: null,
      durableSince: null,
    };
    // Consumed synchronously: an immediate second tap finds nothing to send.
    draftRef.current = '';
    replyTargetRef.current = null;
    setDraftState('');
    setReplyTargetState(null);
    commitEntries((entries) => [...entries, entry]);
    if (entry.parentCommentId !== null) callbacksRef.current.onReplyCreated(entry.parentCommentId);
    persist(owner, entry);
    return true;
  }, [commitEntries, persist]);

  // Same commentId, post, parent and body: retrying never creates another comment.
  const retryLocal = useCallback((commentId: string) => {
    const current = stateRef.current;
    const entry = current.entries.find((item) => item.commentId === commentId);
    if (!mountedRef.current || current.owner === null || entry === undefined || entry.status !== 'save-error') {
      return;
    }
    commitEntries((entries) => markLocalSaving(entries, commentId));
    persist(current.owner, entry);
  }, [commitEntries, persist]);

  // Only the local copy of an intention that is not in SQLite (save-error, terminal);
  // nothing is sent to the backend and nothing is deleted from SQLite.
  const discardLocalComment = useCallback((commentId: string) => {
    commitEntries((entries) => discardLocal(entries, commentId));
  }, [commitEntries]);

  // Another owner's or post's overlay is never rendered, not even for the frame
  // before the reset effect runs.
  const visible = useMemo(
    () => (state.owner === ownerUserId && state.postId === postId
      ? state
      : initialStateFor(ownerUserId, postId)),
    [state, ownerUserId, postId],
  );
  const overlay = useMemo<CommentOverlay>(
    () => ({ ownerUserId: visible.owner, entries: visible.entries }),
    [visible.owner, visible.entries],
  );

  const isReady = visible.status === 'ready';
  const codePoints = countCodePoints(draft);
  const bodyIssue: ComposerBodyIssue = codePoints > MAX_POST_COMMENT_BODY_CODE_POINTS
    ? 'too-long'
    : draft.trim() !== '' && !isValidPostCommentBody(draft) ? 'invalid' : null;

  return {
    status: visible.status,
    overlay,
    retryPendingLoad,
    draft,
    setDraft,
    codePoints,
    bodyIssue,
    canSend: isReady && isValidPostCommentBody(draft),
    send,
    replyTarget: isReady ? replyTarget : null,
    startReply,
    cancelReply,
    retryLocal,
    discardLocal: discardLocalComment,
  };
}
