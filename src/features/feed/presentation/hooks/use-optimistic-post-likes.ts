import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import {
  mergeDesiredLikes, type EphemeralLikeIntent,
} from '@/features/feed/presentation/optimistic-post-likes';
import type { OfflineMutationDrainResult } from '@/features/offline-sync/application/offline-mutation-processor';
import {
  projectPostLikeState, type PostLikeDisplayState,
} from '@/features/offline-sync/domain/post-like-projection';
import {
  getPendingPostLikeProjection, offlineMutationProcessor, queueSetPostLike,
} from '@/features/offline-sync/offline-sync-container';

// Whether the owner's durable pending state is known. Likes are accepted only when
// 'ready': before that a tap could invert the wrong state (e.g. server false while
// SQLite already holds a pending true) and record an intention the user never had.
export type PendingLikesStatus = 'no-owner' | 'loading' | 'ready' | 'error';

type LikesState = {
  // Owner this state belongs to: another owner's state is never rendered or used.
  owner: string | null;
  status: PendingLikesStatus;
  // Last pending desired state per post, as persisted in SQLite.
  durable: ReadonlyMap<string, boolean>;
  // Taps whose INSERT has not confirmed yet, in tap order.
  ephemeral: readonly EphemeralLikeIntent[];
  // Posts whose last tap could not be saved locally.
  failedPostIds: ReadonlySet<string>;
};

const NO_DESIRED: ReadonlyMap<string, boolean> = new Map();
const NO_FAILURES: ReadonlySet<string> = new Set();

function initialStateFor(owner: string | null): LikesState {
  return {
    owner,
    status: owner === null ? 'no-owner' : 'loading',
    durable: NO_DESIRED,
    ephemeral: [],
    failedPostIds: NO_FAILURES,
  };
}

function withDesired(map: ReadonlyMap<string, boolean>, postId: string, liked: boolean) {
  const next = new Map(map);
  next.set(postId, liked);
  return next;
}

function withFailure(set: ReadonlySet<string>, postId: string, failed: boolean) {
  if (set.has(postId) === failed) return set;
  const next = new Set(set);
  if (failed) next.add(postId); else next.delete(postId);
  return next;
}

// Optimistic likes for the Feed. What the user sees is
//   server read model ← durable pending state (SQLite) ← ephemeral taps,
// derived at render time; the Feed read model itself is never mutated.
export function useOptimisticPostLikes(
  ownerUserId: string | null,
  refreshFeed: () => Promise<boolean>,
) {
  const [state, setState] = useState<LikesState>(() => initialStateFor(ownerUserId));
  const stateRef = useRef(state);
  const ownerRef = useRef(ownerUserId);
  // Bumped on owner change and unmount: late callbacks of older work are ignored.
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const nextLocalIdRef = useRef(0);
  const observedDrainRef = useRef<Promise<OfflineMutationDrainResult> | null>(null);
  const drainJoinedRef = useRef(false);
  const refreshFeedRef = useRef(refreshFeed);

  useEffect(() => {
    refreshFeedRef.current = refreshFeed;
  }, [refreshFeed]);

  const commit = useCallback((update: (current: LikesState) => LikesState) => {
    if (!mountedRef.current) return;
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  // Initial (or retried) load for an owner. Until it succeeds the effective like state
  // is unknown, so likes stay disabled; a failure (including corrupt-data or an
  // unsupported database version) shows no pending state and deletes nothing.
  const bootstrapProjection = useCallback(async (owner: string, generation: number) => {
    try {
      const durable = await getPendingPostLikeProjection.execute(owner);
      if (generation !== generationRef.current) return;
      commit((current) => ({ ...current, durable, status: 'ready' }));
    } catch {
      if (generation !== generationRef.current) return;
      commit((current) => ({ ...current, durable: NO_DESIRED, status: 'error' }));
    }
  }, [commit]);

  // Reload after a sync. A trustworthy projection already exists, so likes stay enabled
  // and the previous overlay is kept until the new one replaces it (or if reading fails).
  const reloadProjection = useCallback(async (owner: string, generation: number) => {
    try {
      const durable = await getPendingPostLikeProjection.execute(owner);
      if (generation !== generationRef.current) return;
      commit((current) => ({ ...current, durable }));
    } catch {
      // Keep the current overlay: dropping it could show a state the user did not choose.
    }
  }, [commit]);

  // One processor invocation per durable event. The processor shares an active run, so
  // only the first caller observes it: one reconciliation per run, never a refresh storm.
  const requestDrain = useCallback(() => {
    const owner = ownerRef.current;
    if (owner === null) return;
    const drain = offlineMutationProcessor.drainCurrentUser();
    if (drain === observedDrainRef.current) {
      drainJoinedRef.current = true;
      return;
    }
    observedDrainRef.current = drain;
    drainJoinedRef.current = false;
    const generation = generationRef.current;

    void drain.then(async (result) => {
      if (observedDrainRef.current !== drain) return;
      observedDrainRef.current = null;
      const joined = drainJoinedRef.current;
      drainJoinedRef.current = false;
      if (!mountedRef.current || generation !== generationRef.current) return;

      if (result.processedCount > 0) {
        // 1) authoritative read model first, 2) then the remaining pending rows. Until
        // both are in, the old overlay stays; over fresh data an already-applied desired
        // state has delta 0, so nothing snaps back.
        const refreshed = await refreshFeedRef.current();
        if (refreshed && mountedRef.current && generation === generationRef.current) {
          await reloadProjection(owner, generation);
        }
      }
      // A durable event that joined this run near its end may have missed its last
      // peek; a completed run is asked once more (no retry after a blocked run).
      if (joined && result.kind === 'drained' && mountedRef.current &&
        generation === generationRef.current) {
        requestDrain();
      }
    }, () => {
      if (observedDrainRef.current === drain) observedDrainRef.current = null;
    });
  }, [reloadProjection]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  // Owner change or logout: forget the previous owner's overlay (SQLite is untouched)
  // and rebuild the new owner's pending state from SQLite in one read.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    ownerRef.current = ownerUserId;
    observedDrainRef.current = null;
    drainJoinedRef.current = false;
    commit(() => initialStateFor(ownerUserId));
    if (ownerUserId !== null) void bootstrapProjection(ownerUserId, generation);
  }, [ownerUserId, commit, bootstrapProjection]);

  const retryPendingLikesLoad = useCallback(() => {
    const owner = ownerRef.current;
    const current = stateRef.current;
    if (owner === null || !mountedRef.current || current.owner !== owner || current.status !== 'error') {
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    commit((latest) => ({ ...latest, status: 'loading' }));
    void bootstrapProjection(owner, generation);
  }, [commit, bootstrapProjection]);

  const toggleLike = useCallback((post: FeedPost) => {
    const owner = ownerRef.current;
    const current = stateRef.current;
    // No intention is recorded while the owner's pending state is unknown.
    if (owner === null || !mountedRef.current || current.owner !== owner || current.status !== 'ready') {
      return;
    }

    const desired = mergeDesiredLikes(current.durable, current.ephemeral).get(post.id);
    const shown = projectPostLikeState({
      serverLiked: post.isLiked, serverLikesCount: post.likesCount, desiredLiked: desired,
    });
    nextLocalIdRef.current += 1;
    const intent: EphemeralLikeIntent = {
      localId: nextLocalIdRef.current, postId: post.id, desiredLiked: !shown.isLiked,
    };

    // Visible immediately: no await before this commit.
    commit((latest) => ({
      ...latest,
      ephemeral: [...latest.ephemeral, intent],
      failedPostIds: withFailure(latest.failedPostIds, post.id, false),
    }));

    const generation = generationRef.current;
    // Never cancelled: once tapped, the intention must finish becoming durable even if
    // the Feed unmounts. Only the React updates below are guarded.
    queueSetPostLike.execute({ ownerUserId: owner, postId: post.id, liked: intent.desiredLiked }).then(
      () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        // Durable now: same desired state, different layer, so nothing moves on screen.
        commit((latest) => ({
          ...latest,
          durable: withDesired(latest.durable, post.id, intent.desiredLiked),
          ephemeral: latest.ephemeral.filter((item) => item.localId !== intent.localId),
        }));
        requestDrain();
      },
      () => {
        if (!mountedRef.current || generation !== generationRef.current) return;
        // Only THIS intention is withdrawn; later taps keep applying. The error is shown
        // only if no later tap on the post superseded it (that one is still being saved).
        commit((latest) => {
          const superseded = latest.ephemeral.some(
            (item) => item.postId === post.id && item.localId > intent.localId,
          );
          return {
            ...latest,
            ephemeral: latest.ephemeral.filter((item) => item.localId !== intent.localId),
            failedPostIds: superseded ? latest.failedPostIds : withFailure(latest.failedPostIds, post.id, true),
          };
        });
      },
    );
  }, [commit, requestDrain]);

  // The previous owner's state is never rendered, not even for the frame before the
  // owner-change effect runs: a new owner starts as loading, without any overlay.
  const visible = useMemo(
    () => (state.owner === ownerUserId ? state : initialStateFor(ownerUserId)),
    [state, ownerUserId],
  );

  const desiredLikes = useMemo(
    () => mergeDesiredLikes(visible.durable, visible.ephemeral),
    [visible.durable, visible.ephemeral],
  );

  // O(1) per post at render time; no per-post queries or subscriptions.
  const getDisplayedLike = useCallback((post: FeedPost): PostLikeDisplayState => projectPostLikeState({
    serverLiked: post.isLiked, serverLikesCount: post.likesCount, desiredLiked: desiredLikes.get(post.id),
  }), [desiredLikes]);

  return {
    desiredLikes,
    failedPostIds: visible.failedPostIds,
    pendingLikesStatus: visible.status,
    getDisplayedLike,
    toggleLike,
    retryPendingLikesLoad,
  };
}
