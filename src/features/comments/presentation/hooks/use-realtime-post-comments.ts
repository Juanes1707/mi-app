import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getPostComment, postCommentRealtimeSource } from '@/features/comments/comments-container';
import type {
  PostCommentRealtimeStatus,
  PostCommentRealtimeSubscription,
} from '@/features/comments/domain/post-comment-realtime';
import { PostCommentsError } from '@/features/comments/domain/post-comments-error';
import type { CommentTree } from '@/features/comments/presentation/comment-tree';
import {
  addRealtimeComment, EMPTY_REALTIME_OVERLAY, pruneRealtimePaginated, type RealtimeCommentOverlay,
} from '@/features/comments/presentation/realtime-comment-overlay';

type RealtimeState = {
  owner: string | null;
  postId: string;
  comments: RealtimeCommentOverlay;
  status: PostCommentRealtimeStatus | null;
};

function initialStateFor(owner: string | null, postId: string): RealtimeState {
  return { owner, postId, comments: EMPTY_REALTIME_OVERLAY, status: null };
}

type Options = {
  ownerUserId: string | null;
  postId: string;
  // The paginated tree: ids it already holds need no live read.
  tree: CommentTree;
  // The authorized read says the post is gone or hidden for this user.
  onPostUnavailable: (postId: string) => void;
};

// Live comments of one post: one receive-only subscription per (owner, post). Every
// hint is re-read through the authorized GET /post-comment before it is shown; the
// hint itself is never content. Realtime is an enhancement: if it fails, browsing and
// offline comments keep working, and pagination/refresh remain the source of truth.
// No retry timers: reconnection is the Supabase client's job.
export function useRealtimePostComments({ ownerUserId, postId, tree, onPostUnavailable }: Options) {
  const [state, setState] = useState<RealtimeState>(() => initialStateFor(ownerUserId, postId));
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  // Bumped on owner/post change and unmount: late events, reads and statuses are dropped.
  const generationRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());
  const treeRef = useRef(tree);
  const subscriptionRef = useRef<{ generation: number; subscription: PostCommentRealtimeSubscription } | null>(null);
  const onPostUnavailableRef = useRef(onPostUnavailable);

  useEffect(() => {
    onPostUnavailableRef.current = onPostUnavailable;
  }, [onPostUnavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const commit = useCallback((update: (current: RealtimeState) => RealtimeState) => {
    if (!mountedRef.current) return;
    const next = update(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const isCurrent = useCallback(
    (generation: number) => mountedRef.current && generationRef.current === generation,
    [],
  );

  const closeSubscription = useCallback((generation: number) => {
    const current = subscriptionRef.current;
    if (current === null || current.generation !== generation) return;
    subscriptionRef.current = null;
    void current.subscription.unsubscribe();
  }, []);

  // One authorized read per new id: duplicates (in flight, already live, already
  // paginated) cost nothing.
  const readComment = useCallback((generation: number, owner: string, targetPostId: string, commentId: string) => {
    const inFlight = inFlightRef.current;
    if (inFlight.has(commentId) || stateRef.current.comments.has(commentId) ||
      treeRef.current.nodes.has(commentId)) {
      return;
    }
    inFlight.add(commentId);
    getPostComment.execute({ expectedOwnerUserId: owner, postId: targetPostId, commentId }).then(
      (comment) => {
        inFlight.delete(commentId);
        if (!isCurrent(generation) || comment.postId !== targetPostId || comment.id !== commentId) return;
        if (treeRef.current.nodes.has(comment.id)) return;
        commit((current) => {
          const comments = addRealtimeComment(current.comments, comment);
          return comments === current.comments ? current : { ...current, comments };
        });
      },
      (error: unknown) => {
        inFlight.delete(commentId);
        if (!isCurrent(generation)) return;
        // The authorized read is the access check: no access anymore (or the post is
        // gone) closes the live channel and shows the post as unavailable. Anything
        // else (comment not found, profile, network) changes nothing and is not retried.
        if (error instanceof PostCommentsError && error.code === 'post-not-found') {
          closeSubscription(generation);
          onPostUnavailableRef.current(targetPostId);
        }
      },
    );
  }, [closeSubscription, commit, isCurrent]);

  // Subscribe for this owner and post; resubscribe from scratch on any change.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    inFlightRef.current = new Set();
    commit(() => initialStateFor(ownerUserId, postId));
    if (ownerUserId === null) return undefined;
    const owner = ownerUserId;
    let disposed = false;

    postCommentRealtimeSource.subscribe({
      expectedOwnerUserId: owner,
      postId,
      onCommentCreated: (event) => {
        if (disposed || !isCurrent(generation) || event.postId !== postId) return;
        readComment(generation, owner, postId, event.commentId);
      },
      onStatus: (status) => {
        if (disposed || !isCurrent(generation)) return;
        commit((current) => (current.status === status ? current : { ...current, status }));
      },
    }).then(
      (subscription) => {
        if (disposed || !isCurrent(generation)) {
          void subscription.unsubscribe();
          return;
        }
        subscriptionRef.current = { generation, subscription };
      },
      () => {
        // Not joined (owner/session mismatch, signed out, transport error): the screen
        // works without live updates. A later owner/post change subscribes again.
      },
    );

    return () => {
      disposed = true;
      closeSubscription(generation);
    };
  }, [ownerUserId, postId, closeSubscription, commit, isCurrent, readComment]);

  // Normal pagination reached a live comment: the paginated row is used from now on.
  useEffect(() => {
    treeRef.current = tree;
    commit((current) => {
      const comments = pruneRealtimePaginated(current.comments, tree.nodes);
      return comments === current.comments ? current : { ...current, comments };
    });
  }, [tree, commit]);

  // Another owner's or post's live comments are never exposed, not even for the frame
  // before the reset effect runs.
  const visible = useMemo(
    () => (state.owner === ownerUserId && state.postId === postId ? state : initialStateFor(ownerUserId, postId)),
    [state, ownerUserId, postId],
  );

  return { comments: visible.comments, status: visible.status };
}
