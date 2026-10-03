import type {
  PostComment,
  PostCommentsCursor,
  PostCommentsPage,
} from '@/features/comments/domain/post-comment';
import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';

// Branch of the post's root comments. Never a UUID, so it cannot collide with
// the comment ids that key every other branch.
export const ROOT_BRANCH = 'root';

// One sibling set loaded page by page. A branch missing from the tree was never
// requested ("idle").
export type CommentBranch = {
  // Server order, (createdAt, id) ascending, exactly as the pages arrived.
  ids: readonly string[];
  // At least one page merged. Tells "first page failed" from "later page failed".
  loaded: boolean;
  nextCursor: PostCommentsCursor | null;
  status: 'loading' | 'ready' | 'loading-more' | 'error';
  error: PostCommentsErrorCode | null;
};

// Partially loaded comment tree of one post. Immutable: every step returns a new
// tree (or the same one when nothing changes) so React sees the update.
export type CommentTree = {
  postId: string;
  nodes: ReadonlyMap<string, PostComment>;
  branches: ReadonlyMap<string, CommentBranch>;
  // Comments whose replies are shown. Collapsing never drops a loaded branch.
  expanded: ReadonlySet<string>;
};

export type BranchRequest = {
  branchKey: string;
  parentCommentId: string | null;
  cursor: PostCommentsCursor | null;
};

export type BranchStart = { tree: CommentTree; request: BranchRequest };

export type BranchRowStatus = 'loading' | 'loading-more' | 'more' | 'error' | 'corrupt';

// The tree flattened into what one FlatList renders.
export type VisibleCommentRow =
  | { kind: 'comment'; key: string; comment: PostComment; depth: number; isExpanded: boolean }
  | {
      kind: 'branch-status';
      key: string;
      branchKey: string;
      depth: number;
      status: BranchRowStatus;
      error: PostCommentsErrorCode | null;
    };

export function createCommentTree(postId: string): CommentTree {
  return { postId, nodes: new Map(), branches: new Map(), expanded: new Set() };
}

// First page of a branch: only if it was never requested or its first page failed.
// A branch that is loading or already loaded returns null: no duplicate request.
export function startFirstPage(tree: CommentTree, branchKey: string): BranchStart | null {
  const branch = tree.branches.get(branchKey);
  if (branch !== undefined && !(branch.status === 'error' && !branch.loaded)) return null;
  if (branchKey !== ROOT_BRANCH && !tree.nodes.has(branchKey)) return null;

  return {
    tree: withBranch(tree, branchKey, {
      ids: [], loaded: false, nextCursor: null, status: 'loading', error: null,
    }),
    request: { branchKey, parentCommentId: parentOf(branchKey), cursor: null },
  };
}

// Next page from the branch's own cursor. `retry` also restarts a failed page;
// without it (e.g. onEndReached firing again) a failed page waits for the user.
export function startNextPage(
  tree: CommentTree,
  branchKey: string,
  retry: boolean,
): BranchStart | null {
  const branch = tree.branches.get(branchKey);
  if (branch === undefined || !branch.loaded || branch.nextCursor === null) return null;
  if (branch.status !== 'ready' && !(retry && branch.status === 'error')) return null;

  return {
    tree: withBranch(tree, branchKey, { ...branch, status: 'loading-more', error: null }),
    request: { branchKey, parentCommentId: parentOf(branchKey), cursor: branch.nextCursor },
  };
}

// Merges a validated page into ITS branch only. The page is applied atomically:
// if any row contradicts what the tree already holds, nothing is merged and the
// branch reports an error instead of silently overwriting data.
export function applyBranchPage(
  tree: CommentTree,
  request: BranchRequest,
  page: PostCommentsPage,
): CommentTree {
  const branch = tree.branches.get(request.branchKey);
  if (branch === undefined || !isAwaiting(branch, request)) return tree;

  const nodes = new Map(tree.nodes);
  const ids = [...branch.ids];
  const branchIds = new Set(branch.ids);
  for (const comment of page.comments) {
    const existing = nodes.get(comment.id);
    const consistent =
      comment.postId === tree.postId &&
      comment.parentCommentId === request.parentCommentId &&
      (existing === undefined || (isSameComment(existing, comment) && branchIds.has(comment.id)));
    if (!consistent) {
      return withBranch(tree, request.branchKey, {
        ...branch, status: 'error', error: 'invalid-response',
      });
    }
    // The exact same row again: shown once.
    if (existing !== undefined) continue;
    nodes.set(comment.id, comment);
    ids.push(comment.id);
    branchIds.add(comment.id);
  }

  return withBranch({ ...tree, nodes }, request.branchKey, {
    ids, loaded: true, nextCursor: page.nextCursor, status: 'ready', error: null,
  });
}

export function failBranchLoad(
  tree: CommentTree,
  request: BranchRequest,
  error: PostCommentsErrorCode,
): CommentTree {
  const branch = tree.branches.get(request.branchKey);
  if (branch === undefined || !isAwaiting(branch, request)) return tree;
  return withBranch(tree, request.branchKey, { ...branch, status: 'error', error });
}

export function expandComment(tree: CommentTree, commentId: string): CommentTree {
  if (!tree.nodes.has(commentId) || tree.expanded.has(commentId)) return tree;
  const expanded = new Set(tree.expanded);
  expanded.add(commentId);
  return { ...tree, expanded };
}

export function collapseComment(tree: CommentTree, commentId: string): CommentTree {
  if (!tree.expanded.has(commentId)) return tree;
  const expanded = new Set(tree.expanded);
  expanded.delete(commentId);
  return { ...tree, expanded };
}

// Depth-first walk of the visible part of the tree: a comment, then (if expanded)
// its loaded replies, then that branch's status row. Logical depth is unbounded.
// `visited` guarantees termination even on a corrupted in-memory tree; a branch
// that would revisit a comment is cut there and reported with a 'corrupt' row.
export function flattenVisibleRows(tree: CommentTree): VisibleCommentRow[] {
  const rows: VisibleCommentRow[] = [];
  const root = tree.branches.get(ROOT_BRANCH);
  if (root !== undefined && !appendBranch(tree, root, 0, rows, new Set())) {
    rows.push(statusRow(ROOT_BRANCH, 0, 'corrupt', null));
  }
  return rows;
}

function appendBranch(
  tree: CommentTree,
  branch: CommentBranch,
  depth: number,
  rows: VisibleCommentRow[],
  visited: Set<string>,
): boolean {
  for (const id of branch.ids) {
    const comment = tree.nodes.get(id);
    if (comment === undefined || visited.has(id)) return false;
    visited.add(id);

    const isExpanded = tree.expanded.has(id);
    rows.push({ kind: 'comment', key: id, comment, depth, isExpanded });
    const replies = isExpanded ? tree.branches.get(id) : undefined;
    if (replies === undefined) continue;

    const intact = !replies.loaded || appendBranch(tree, replies, depth + 1, rows, visited);
    const status = intact ? branchRowStatus(replies) : 'corrupt';
    if (status !== null) rows.push(statusRow(id, depth + 1, status, replies.error));
  }
  return true;
}

function branchRowStatus(branch: CommentBranch): BranchRowStatus | null {
  switch (branch.status) {
    case 'loading':
      return 'loading';
    case 'loading-more':
      return 'loading-more';
    case 'error':
      return 'error';
    case 'ready':
      return branch.nextCursor === null ? null : 'more';
  }
}

function statusRow(
  branchKey: string,
  depth: number,
  status: BranchRowStatus,
  error: PostCommentsErrorCode | null,
): VisibleCommentRow {
  return { kind: 'branch-status', key: `branch:${branchKey}`, branchKey, depth, status, error };
}

function parentOf(branchKey: string): string | null {
  return branchKey === ROOT_BRANCH ? null : branchKey;
}

// The branch is waiting for exactly this request: same page position.
function isAwaiting(branch: CommentBranch, request: BranchRequest): boolean {
  if (request.cursor === null) return branch.status === 'loading';
  return (
    branch.status === 'loading-more' &&
    branch.nextCursor !== null &&
    branch.nextCursor.createdAt === request.cursor.createdAt &&
    branch.nextCursor.commentId === request.cursor.commentId
  );
}

function withBranch(tree: CommentTree, key: string, branch: CommentBranch): CommentTree {
  const branches = new Map(tree.branches);
  branches.set(key, branch);
  return { ...tree, branches };
}

function isSameComment(left: PostComment, right: PostComment): boolean {
  return (
    left.id === right.id &&
    left.postId === right.postId &&
    left.parentCommentId === right.parentCommentId &&
    left.author.id === right.author.id &&
    left.author.username === right.author.username &&
    left.author.displayName === right.author.displayName &&
    left.body === right.body &&
    left.createdAt === right.createdAt &&
    left.directRepliesCount === right.directRepliesCount
  );
}
