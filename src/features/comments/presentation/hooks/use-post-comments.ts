import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { POST_COMMENTS_PAGE_SIZE } from '@/features/comments/application/get-post-comments-page';
import { getPostCommentsPage } from '@/features/comments/comments-container';
import type { PostCommentsPage } from '@/features/comments/domain/post-comment';
import {
  PostCommentsError,
  type PostCommentsErrorCode,
} from '@/features/comments/domain/post-comments-error';
import {
  abortCatchUp,
  applyBranchPage,
  type BranchRequest,
  type BranchStart,
  collapseComment,
  createCommentTree,
  expandComment,
  failBranchLoad,
  ROOT_BRANCH,
  startCatchUp,
  startFirstPage,
  startNextPage,
  type CommentTree,
} from '@/features/comments/presentation/comment-tree';

type PostCommentsState = {
  // Identifies one tree. A response started for another generation is dropped.
  generation: number;
  tree: CommentTree;
  isRefreshing: boolean;
  refreshError: PostCommentsErrorCode | null;
};

function createState(postId: string, generation: number): PostCommentsState {
  return { generation, tree: createCommentTree(postId), isRefreshing: false, refreshError: null };
}

function toErrorCode(error: unknown): PostCommentsErrorCode {
  return error instanceof PostCommentsError ? error.code : 'unavailable';
}

function requestPage(postId: string, request: BranchRequest): Promise<PostCommentsPage> {
  return getPostCommentsPage.execute({
    postId,
    parentCommentId: request.parentCommentId,
    cursor: request.cursor,
    limit: POST_COMMENTS_PAGE_SIZE,
  });
}

// One aggregated tree per screen: rows never fetch on their own. Every request
// starts from a user action (or the initial roots load) and is single-flight per
// branch, because the tree marks the branch as loading before the request leaves.
export function usePostComments(postId: string) {
  const [state, setState] = useState(() => createState(postId, 0));
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);

  // Update the guard synchronously, before React's next render: two taps in the
  // same frame already see the branch as loading.
  const publish = useCallback((next: PostCommentsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const isCurrent = useCallback(
    (generation: number) => mountedRef.current && stateRef.current.generation === generation,
    [],
  );

  // The backend no longer shows this post to the user: drop everything that was
  // loaded and invalidate every pending branch request.
  const showPostUnavailable = useCallback((targetPostId: string) => {
    const started = startFirstPage(createCommentTree(targetPostId), ROOT_BRANCH);
    if (started === null) return;
    publish({
      generation: ++generationRef.current,
      tree: failBranchLoad(started.tree, started.request, 'post-not-found'),
      isRefreshing: false,
      refreshError: null,
    });
  }, [publish]);

  // Publishes a started branch, then sends its single request.
  const launch = useCallback((current: PostCommentsState, started: BranchStart | null) => {
    if (started === null) return false;
    const { generation } = current;
    const targetPostId = current.tree.postId;
    const { request } = started;
    publish({ ...current, tree: started.tree });

    void requestPage(targetPostId, request).then(
      (page) => {
        if (!isCurrent(generation)) return;
        const latest = stateRef.current;
        publish({ ...latest, tree: applyBranchPage(latest.tree, request, page) });
      },
      (error: unknown) => {
        if (!isCurrent(generation)) return;
        const code = toErrorCode(error);
        if (code === 'post-not-found') {
          showPostUnavailable(targetPostId);
          return;
        }
        const latest = stateRef.current;
        publish({
          ...latest,
          tree: request.catchUp === true
            ? abortCatchUp(latest.tree, request)
            : failBranchLoad(latest.tree, request, code),
        });
      },
    );
    return true;
  }, [isCurrent, publish, showPostUnavailable]);

  // Mount and post change: a brand new tree. Nothing of another post survives.
  useEffect(() => {
    mountedRef.current = true;
    const initial = createState(postId, ++generationRef.current);
    if (!launch(initial, startFirstPage(initial.tree, ROOT_BRANCH))) publish(initial);
    return () => {
      mountedRef.current = false;
    };
  }, [postId, launch, publish]);

  // `localChildren`: the user has local replies here (shown without any request).
  const expandReplies = useCallback((commentId: string, options?: { localChildren?: boolean }) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const comment = current.tree.nodes.get(commentId);
    // Server pages only on demand, and only where the server counted direct replies.
    const hasServerReplies = comment !== undefined && comment.directRepliesCount > 0;
    if (!hasServerReplies && options?.localChildren !== true) return;
    const tree = expandComment(current.tree, commentId);
    const expanded = { ...current, tree };
    // Never loaded (or first page failed): request it. Loading or loaded: reuse.
    const started = hasServerReplies ? startFirstPage(tree, commentId) : null;
    if (!launch(expanded, started) && tree !== current.tree) {
      publish(expanded);
    }
  }, [launch, publish]);

  // Called when some of the user's comments of this post left the sync queue: each
  // fully loaded branch they belong to checks its tail (see startCatchUp).
  const catchUpBranches = useCallback((targetPostId: string, branchKeys: readonly string[]) => {
    if (!mountedRef.current || stateRef.current.tree.postId !== targetPostId) return;
    for (const key of new Set(branchKeys)) {
      const current = stateRef.current;
      launch(current, startCatchUp(current.tree, key));
    }
  }, [launch]);

  const collapseReplies = useCallback((commentId: string) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const tree = collapseComment(current.tree, commentId);
    if (tree !== current.tree) publish({ ...current, tree });
  }, [publish]);

  // "Ver más respuestas" and the retry of a failed reply page.
  const continueReplies = useCallback((commentId: string) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const branch = current.tree.branches.get(commentId);
    launch(current, branch?.loaded
      ? startNextPage(current.tree, commentId, true)
      : startFirstPage(current.tree, commentId));
  }, [launch]);

  // onEndReached may fire repeatedly: the branch status makes it single-flight,
  // and a failed page is not retried until the user asks.
  const loadMoreRoots = useCallback(() => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    if (current.isRefreshing) return;
    launch(current, startNextPage(current.tree, ROOT_BRANCH, false));
  }, [launch]);

  const retryRoots = useCallback(() => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const root = current.tree.branches.get(ROOT_BRANCH);
    launch(current, root?.loaded
      ? startNextPage(current.tree, ROOT_BRANCH, true)
      : startFirstPage(current.tree, ROOT_BRANCH));
  }, [launch]);

  // Pull-to-refresh. The current tree stays visible until fresh roots arrive;
  // then it is replaced whole (collapsed, no reply branches), which also drops
  // every request still running for the old tree. There is no local overlay yet
  // (no optimistic comments), so nothing is lost by starting from scratch.
  const refresh = useCallback(() => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    if (current.isRefreshing || current.tree.branches.get(ROOT_BRANCH)?.loaded !== true) return;
    const targetPostId = current.tree.postId;
    const fresh = startFirstPage(createCommentTree(targetPostId), ROOT_BRANCH);
    if (fresh === null) return;
    const { generation } = current;
    publish({ ...current, isRefreshing: true, refreshError: null });

    void requestPage(targetPostId, fresh.request).then(
      (page) => {
        if (!isCurrent(generation)) return;
        publish({
          generation: ++generationRef.current,
          tree: applyBranchPage(fresh.tree, fresh.request, page),
          isRefreshing: false,
          refreshError: null,
        });
      },
      (error: unknown) => {
        if (!isCurrent(generation)) return;
        const code = toErrorCode(error);
        if (code === 'post-not-found') {
          showPostUnavailable(targetPostId);
          return;
        }
        publish({ ...stateRef.current, isRefreshing: false, refreshError: code });
      },
    );
  }, [isCurrent, publish, showPostUnavailable]);

  // Between a postId change and the effect that resets the tree, never expose
  // the previous post's comments.
  // The server tree only: the screen flattens it together with the local overlay.
  const isCurrentPost = state.tree.postId === postId;
  const tree = useMemo(
    () => (isCurrentPost ? state.tree : createCommentTree(postId)),
    [isCurrentPost, state.tree, postId],
  );

  return {
    tree,
    root: tree.branches.get(ROOT_BRANCH) ?? null,
    isRefreshing: isCurrentPost && state.isRefreshing,
    refreshError: isCurrentPost ? state.refreshError : null,
    expandReplies,
    collapseReplies,
    continueReplies,
    loadMoreRoots,
    retryRoots,
    refresh,
    catchUpBranches,
  };
}
