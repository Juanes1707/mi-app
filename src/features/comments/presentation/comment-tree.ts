import type {
  PostComment,
  PostCommentsCursor,
  PostCommentsPage,
} from '@/features/comments/domain/post-comment';
import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';
import {
  EMPTY_OVERLAY, isCanonicalMatch, type CommentOverlay, type LocalComment,
} from '@/features/comments/presentation/comment-overlay';

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
  // Background check for a just-synced comment; its failure is silent.
  catchUp?: boolean;
};

export type BranchStart = { tree: CommentTree; request: BranchRequest };

export type BranchRowStatus = 'loading' | 'loading-more' | 'more' | 'error' | 'corrupt';

// The tree (server rows) and the local overlay flattened into what one FlatList renders.
// `localRepliesCount` counts the user's own not-yet-canonical direct replies; it is
// shown next to, never added to, the server's directRepliesCount.
export type VisibleCommentRow =
  | {
      kind: 'comment';
      key: string;
      comment: PostComment;
      depth: number;
      isExpanded: boolean;
      localRepliesCount: number;
    }
  | {
      kind: 'local';
      key: string;
      local: LocalComment;
      depth: number;
      isExpanded: boolean;
      localRepliesCount: number;
      // Reply whose parent is not in the loaded tree (e.g. after a refresh or restart).
      isOrphan: boolean;
    }
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

// A comment of the user just left the sync queue. Only a branch that was loaded to its
// end can reveal it without skipping pages: ask for rows strictly after its last
// canonical row (or its first page again if it was empty). A partially loaded branch
// is left alone: normal pagination reaches the new row in order, and a local cursor
// is never invented from a client id.
export function startCatchUp(tree: CommentTree, branchKey: string): BranchStart | null {
  const branch = tree.branches.get(branchKey);
  if (branch === undefined || !branch.loaded || branch.status !== 'ready' || branch.nextCursor !== null) {
    return null;
  }
  const parentCommentId = parentOf(branchKey);
  const lastId = branch.ids[branch.ids.length - 1];
  if (lastId === undefined) {
    return {
      tree: withBranch(tree, branchKey, { ...branch, status: 'loading' }),
      request: { branchKey, parentCommentId, cursor: null, catchUp: true },
    };
  }
  const last = tree.nodes.get(lastId);
  if (last === undefined) return null;
  const cursor = { createdAt: last.createdAt, commentId: last.id };
  return {
    tree: withBranch(tree, branchKey, { ...branch, status: 'loading-more', nextCursor: cursor }),
    request: { branchKey, parentCommentId, cursor, catchUp: true },
  };
}

// A failed catch-up restores the exhausted branch as it was: the user never asked for
// it, and the comment stays visible as a local 'sent' row anyway.
export function abortCatchUp(tree: CommentTree, request: BranchRequest): CommentTree {
  const branch = tree.branches.get(request.branchKey);
  if (request.catchUp !== true || branch === undefined || !isAwaiting(branch, request)) return tree;
  return withBranch(tree, request.branchKey, {
    ...branch, status: 'ready', nextCursor: null, error: null,
  });
}

// Any id can be expanded, also a local comment that only has local replies; whether a
// server page is needed is decided by the caller.
export function expandComment(tree: CommentTree, commentId: string): CommentTree {
  if (tree.expanded.has(commentId)) return tree;
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

// The overlay grouped by the branch it belongs to (parent id or ROOT_BRANCH). Entries
// of another post, and entries a server page already contains (canonical), are left
// out: the server row is shown instead, so no comment appears twice.
type LocalIndex = {
  byBranch: ReadonlyMap<string, readonly LocalComment[]>;
  orphans: readonly LocalComment[];
};

function indexOverlay(tree: CommentTree, overlay: CommentOverlay): LocalIndex {
  const visible = overlay.entries.filter((entry) =>
    entry.postId === tree.postId &&
    !isCanonicalMatch(entry, tree.nodes.get(entry.commentId), overlay.ownerUserId));
  const localIds = new Set(visible.map((entry) => entry.commentId));
  const byBranch = new Map<string, LocalComment[]>();
  const orphans: LocalComment[] = [];
  for (const entry of visible) {
    const parent = entry.parentCommentId;
    if (parent !== null && !tree.nodes.has(parent) && !localIds.has(parent)) {
      orphans.push(entry);
      continue;
    }
    const key = parent ?? ROOT_BRANCH;
    const siblings = byBranch.get(key);
    if (siblings === undefined) byBranch.set(key, [entry]);
    else siblings.push(entry);
  }
  return { byBranch, orphans };
}

// Depth-first walk of the visible part of the tree. For every branch: its canonical
// server rows (server order), then its status row, then the user's local intentions
// (local order). Local rows are never interleaved into the server order: with
// createdAt ASC pages, unloaded rows may still sit between them.
// Logical depth is unbounded. `visited` guarantees termination even on a corrupted
// in-memory tree; a branch that would revisit a comment is cut there and reported.
export function flattenVisibleRows(
  tree: CommentTree,
  overlay: CommentOverlay = EMPTY_OVERLAY,
): VisibleCommentRow[] {
  const rows: VisibleCommentRow[] = [];
  const local = indexOverlay(tree, overlay);
  const visited = new Set<string>();
  const root = tree.branches.get(ROOT_BRANCH);
  if (root !== undefined && root.loaded && !appendServerRows(tree, local, root, 0, rows, visited)) {
    rows.push(statusRow(ROOT_BRANCH, 0, 'corrupt', null));
  }
  appendLocalRows(tree, local, local.byBranch.get(ROOT_BRANCH) ?? [], 0, false, rows, visited);
  appendLocalRows(tree, local, local.orphans, 0, true, rows, visited);
  return rows;
}

function appendServerRows(
  tree: CommentTree,
  local: LocalIndex,
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
    rows.push({
      kind: 'comment', key: id, comment, depth, isExpanded,
      localRepliesCount: local.byBranch.get(id)?.length ?? 0,
    });
    if (isExpanded) appendReplies(tree, local, id, depth + 1, rows, visited);
  }
  return true;
}

function appendReplies(
  tree: CommentTree,
  local: LocalIndex,
  parentId: string,
  depth: number,
  rows: VisibleCommentRow[],
  visited: Set<string>,
): void {
  const replies = tree.branches.get(parentId);
  if (replies !== undefined) {
    const intact = !replies.loaded || appendServerRows(tree, local, replies, depth, rows, visited);
    const status = intact ? branchRowStatus(replies) : 'corrupt';
    if (status !== null) rows.push(statusRow(parentId, depth, status, replies.error));
  }
  appendLocalRows(tree, local, local.byBranch.get(parentId) ?? [], depth, false, rows, visited);
}

function appendLocalRows(
  tree: CommentTree,
  local: LocalIndex,
  entries: readonly LocalComment[],
  depth: number,
  isOrphan: boolean,
  rows: VisibleCommentRow[],
  visited: Set<string>,
): void {
  for (const entry of entries) {
    // Local keys live in their own namespace: an id that is also a (mismatching)
    // server row still renders once per source, never with a duplicate key.
    const key = `local:${entry.commentId}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const isExpanded = tree.expanded.has(entry.commentId);
    rows.push({
      kind: 'local', key, local: entry, depth, isExpanded, isOrphan,
      localRepliesCount: local.byBranch.get(entry.commentId)?.length ?? 0,
    });
    if (isExpanded) appendReplies(tree, local, entry.commentId, depth + 1, rows, visited);
  }
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
