import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PostComment } from '@/features/comments/domain/post-comment';
import { parseCommentTimestamp } from '@/features/comments/domain/post-comment-values';
import { useTheme } from '@/hooks/use-theme';

// Logical depth is unbounded. Only the indentation stops growing, so a deep
// thread keeps a readable width on a phone.
const MAX_VISUAL_DEPTH = 3;
const INDENT_PER_LEVEL = 16;
const BASE_PADDING = 16;
const ACTION_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Short, absolute and in the device's time zone; no relative "hace X" text.
const timestampFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function commentIndent(depth: number): number {
  return BASE_PADDING + Math.min(depth, MAX_VISUAL_DEPTH) * INDENT_PER_LEVEL;
}

function formatCommentTimestamp(createdAt: string): string {
  const timestamp = parseCommentTimestamp(createdAt);
  return timestamp === null ? '' : timestampFormatter.format(new Date(timestamp.epochMilliseconds));
}

// The server's direct-replies count, not the number of replies loaded so far.
export function repliesLabel(count: number): string {
  return count === 1 ? 'Ver 1 respuesta' : `Ver ${count.toLocaleString('es-CO')} respuestas`;
}

// Collapsed label. Local and live replies are extra hints, never added to the server
// count: a pending reply may already be counted by the server after a crash and replay,
// and a live reply may already be part of the count read earlier.
export function collapsedRepliesLabel(serverCount: number, localCount: number, realtimeCount = 0): string {
  if (serverCount === 0) return 'Ver respuestas';
  const local = localCount === 0 ? '' : ` · +${localCount} ${localCount === 1 ? 'tuya' : 'tuyas'}`;
  const live = realtimeCount === 0 ? '' : ' · nuevas';
  return `${repliesLabel(serverCount)}${local}${live}`;
}

export function CommentAction({
  label, onPress, disabled = false, accessibilityLabel, expanded,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  expanded?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded }}
      disabled={disabled}
      hitSlop={ACTION_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [styles.action, disabled ? styles.disabled : undefined,
        pressed ? styles.pressed : undefined]}>
      <Text style={[styles.actionText, { color: theme.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

// Shared layout of server and local rows: indentation, thread line, avatar, texts.
export function CommentFrame({
  depth, initial, name, handle, body, meta, children,
}: {
  depth: number;
  initial: string;
  name: string;
  handle: string | null;
  body: string;
  meta: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { paddingLeft: commentIndent(depth) }]}>
      <View
        style={[
          styles.thread,
          depth > 0 ? [styles.reply, { borderLeftColor: theme.backgroundSelected }] : undefined,
        ]}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
          <Text style={[styles.initial, { color: theme.text }]}>{initial}</Text>
        </View>
        <View style={styles.content}>
          <View style={styles.meta}>
            <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{name}</Text>
            {handle !== null ? (
              <Text numberOfLines={1} style={[styles.handle, { color: theme.textSecondary }]}>
                {handle}
              </Text>
            ) : null}
          </View>
          {/* Rendered verbatim: no trim, line breaks and Unicode as stored. */}
          <Text style={[styles.body, { color: theme.text }]}>{body}</Text>
          {meta}
          <View style={styles.actions}>{children}</View>
        </View>
      </View>
    </View>
  );
}

type CommentRowProps = {
  comment: PostComment;
  depth: number;
  isExpanded: boolean;
  // The user's own replies to this comment that no server page contains yet.
  localRepliesCount: number;
  // Live replies (re-read over HTTP) that no loaded page contains yet.
  realtimeRepliesCount?: number;
  // False until the user's pending comments are known (see useOptimisticPostComments).
  canReply: boolean;
  onExpandReplies: (commentId: string, hasLocalReplies: boolean) => void;
  onCollapseReplies: (commentId: string) => void;
  onReply: (commentId: string, label: string) => void;
};

export const CommentRow = memo(function CommentRow({
  comment, depth, isExpanded, localRepliesCount, realtimeRepliesCount = 0, canReply, onExpandReplies,
  onCollapseReplies, onReply,
}: CommentRowProps) {
  const theme = useTheme();
  const { username } = comment.author;
  const displayName = comment.author.displayName?.trim() ? comment.author.displayName : null;
  const name = displayName ?? (username === null ? 'Usuario' : `@${username}`);
  const handle = displayName !== null && username !== null ? `@${username}` : null;
  const initial = (Array.from(displayName?.trim() || username || '?')[0] ?? '?').toUpperCase();
  const replyLabel = username !== null ? `@${username}` : displayName ?? 'un comentario';
  const overlayReplies = localRepliesCount + realtimeRepliesCount;
  const hasReplies = comment.directRepliesCount > 0 || overlayReplies > 0;

  return (
    <CommentFrame
      depth={depth}
      initial={initial}
      name={name}
      handle={handle}
      body={comment.body}
      meta={(
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {formatCommentTimestamp(comment.createdAt)}
        </Text>
      )}>
      <CommentAction
        label="Responder"
        accessibilityLabel={`Responder a ${replyLabel}`}
        disabled={!canReply}
        onPress={() => onReply(comment.id, replyLabel)}
      />
      {hasReplies ? (
        <CommentAction
          label={isExpanded
            ? 'Ocultar respuestas'
            : collapsedRepliesLabel(comment.directRepliesCount, localRepliesCount, realtimeRepliesCount)}
          expanded={isExpanded}
          onPress={() => (isExpanded
            ? onCollapseReplies(comment.id)
            : onExpandReplies(comment.id, overlayReplies > 0))}
        />
      ) : null}
    </CommentFrame>
  );
});

const styles = StyleSheet.create({
  row: { paddingRight: 16, paddingTop: 12 },
  thread: { flexDirection: 'row', gap: 10 },
  reply: { borderLeftWidth: 2, paddingLeft: 10 },
  avatar: { alignItems: 'center', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  initial: { fontSize: 14, fontWeight: '700' },
  content: { flex: 1, gap: 2, minWidth: 0 },
  meta: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  handle: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 20 },
  date: { fontSize: 12, lineHeight: 18 },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', columnGap: 18 },
  action: { justifyContent: 'center', minHeight: 44 },
  actionText: { fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
