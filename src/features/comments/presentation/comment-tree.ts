import type {
  PostComment,
  PostCommentsCursor,
  PostCommentsPage,
} from '@/features/comments/domain/post-comment';
import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';
import {
  EMPTY_OVERLAY, isCanonicalMatch, type CommentOverlay, type LocalComment,
} from '@/features/comments/presentation/comment-overlay';
import {
  EMPTY_REALTIME_OVERLAY, groupRealtimeByBranch, type RealtimeCommentOverlay,
} from '@/features/comments/presentation/realtime-comment-overlay';

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

// The tree (server rows), the live overlay and the local overlay flattened into what
// one FlatList renders. `localRepliesCount` counts the user's own not-yet-canonical
// direct replies and `realtimeRepliesCount` the live ones not yet paginated; both are
// shown next to, never added to, the server's directRepliesCount.
export type VisibleCommentRow =
  | {
      kind: 'comment';
      key: string;
      comment: PostComment;
      // 'page': part of the paginated tree. 'realtime': canonical (re-read over HTTP)
      // but outside branch ids/cursors until pagination reaches it.
      source: 'page' | 'realtime';
      depth: number;
      isExpanded: boolean;
      localRepliesCount: number;
      realtimeRepliesCount: number;
    }
  | {
      kind: 'local';
      key: string;
      local: LocalComment;
      depth: number;
      isExpanded: boolean;
      localRepliesCount: number;
      realtimeRepliesCount: number;
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

// Both overlays grouped by the branch they belong to (parent id or ROOT_BRANCH).
// Dedupe across layers, so no comment ever appears twice:
//   paginated server row > live (realtime) canonical row > local intention.
// A live comment already in a page is dropped; a local intention whose compatible
// canonical row exists (paginated or live) is hidden. Entries of another post are out.
type OverlayIndex = {
  localByBranch: ReadonlyMap<string, readonly LocalComment[]>;
  localOrphans: readonly LocalComment[];
  realtimeByBranch: ReadonlyMap<string, readonly PostComment[]>;
};

function indexOverlays(
  tree: CommentTree,
  overlay: CommentOverlay,
  realtime: RealtimeCommentOverlay,
): OverlayIndex {
  const realtimeByBranch = groupRealtimeByBranch(realtime, tree.postId, tree.nodes, ROOT_BRANCH);
  const realtimeIds = new Set<string>();
  for (const group of realtimeByBranch.values()) for (const comment of group) realtimeIds.add(comment.id);
  const canonical = (id: string) => tree.nodes.get(id) ?? (realtimeIds.has(id) ? realtime.get(id) : undefined);

  const visible = overlay.entries.filter((entry) =>
    entry.postId === tree.postId &&
    !isCanonicalMatch(entry, canonical(entry.commentId), overlay.ownerUserId));
  const localIds = new Set(visible.map((entry) => entry.commentId));
  const localByBranch = new Map<string, LocalComment[]>();
  const localOrphans: LocalComment[] = [];
  for (const entry of visible) {
    const parent = entry.parentCommentId;
    if (parent !== null && !tree.nodes.has(parent) && !realtimeIds.has(parent) && !localIds.has(parent)) {
      localOrphans.push(entry);
      continue;
    }
    const key = parent ?? ROOT_BRANCH;
    const siblings = localByBranch.get(key);
    if (siblings === undefined) localByBranch.set(key, [entry]);
    else siblings.push(entry);
  }
  return { localByBranch, localOrphans, realtimeByBranch };
}

function childCounts(index: OverlayIndex, id: string) {
  return {
    localRepliesCount: index.localByBranch.get(id)?.length ?? 0,
    realtimeRepliesCount: index.realtimeByBranch.get(id)?.length ?? 0,
  };
}

// Depth-first walk of the visible part of the tree. For every branch: its canonical
// paginated rows (server order), then its status row, then the live rows of that
// branch (server order of their DTOs), then the user's local intentions (local order).
// Overlay rows are never interleaved into the paginated order nor change its cursor:
// with createdAt ASC pages, unloaded rows may still sit between them.
// A live reply whose parent is not visible anywhere is kept in memory, never shown as
// a root. A LOCAL reply in that situation is shown at the end (it is the user's own
// pending intention and must not disappear).
// Logical depth is unbounded. `visited` guarantees termination even on a corrupted
// in-memory tree; a branch that would revisit a comment is cut there and reported.
export function flattenVisibleRows(
  tree: CommentTree,
  overlay: CommentOverlay = EMPTY_OVERLAY,
  realtime: RealtimeCommentOverlay = EMPTY_REALTIME_OVERLAY,
): VisibleCommentRow[] {
  const rows: VisibleCommentRow[] = [];
  const index = indexOverlays(tree, overlay, realtime);
  const visited = new Set<string>();
  const root = tree.branches.get(ROOT_BRANCH);
  if (root !== undefined && root.loaded && !appendServerRows(tree, index, root, 0, rows, visited)) {
    rows.push(statusRow(ROOT_BRANCH, 0, 'corrupt', null));
  }
  appendRealtimeRows(tree, index, index.realtimeByBranch.get(ROOT_BRANCH) ?? [], 0, rows, visited);
  appendLocalRows(tree, index, index.localByBranch.get(ROOT_BRANCH) ?? [], 0, false, rows, visited);
  appendLocalRows(tree, index, index.localOrphans, 0, true, rows, visited);
  return rows;
}

function appendServerRows(
  tree: CommentTree,
  index: OverlayIndex,
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
    rows.push({ kind: 'comment', key: id, comment, source: 'page', depth, isExpanded, ...childCounts(index, id) });
    if (isExpanded) appendReplies(tree, index, id, depth + 1, rows, visited);
  }
  return true;
}

function appendReplies(
  tree: CommentTree,
  index: OverlayIndex,
  parentId: string,
  depth: number,
  rows: VisibleCommentRow[],
  visited: Set<string>,
): void {
  const replies = tree.branches.get(parentId);
  if (replies !== undefined) {
    const intact = !replies.loaded || appendServerRows(tree, index, replies, depth, rows, visited);
    const status = intact ? branchRowStatus(replies) : 'corrupt';
    if (status !== null) rows.push(statusRow(parentId, depth, status, replies.error));
  }
  appendRealtimeRows(tree, index, index.realtimeByBranch.get(parentId) ?? [], depth, rows, visited);
  appendLocalRows(tree, index, index.localByBranch.get(parentId) ?? [], depth, false, rows, visited);
}

function appendRealtimeRows(
  tree: CommentTree,
  index: OverlayIndex,
  comments: readonly PostComment[],
  depth: number,
  rows: VisibleCommentRow[],
  visited: Set<string>,
): void {
  for (const comment of comments) {
    if (visited.has(comment.id)) continue;
    visited.add(comment.id);
    const isExpanded = tree.expanded.has(comment.id);
    rows.push({
      kind: 'comment', key: comment.id, comment, source: 'realtime', depth, isExpanded,
      ...childCounts(index, comment.id),
    });
    if (isExpanded) appendReplies(tree, index, comment.id, depth + 1, rows, visited);
  }
}

function appendLocalRows(
  tree: CommentTree,
  index: OverlayIndex,
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
      ...childCounts(index, entry.commentId),
    });
    if (isExpanded) appendReplies(tree, index, entry.commentId, depth + 1, rows, visited);
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
