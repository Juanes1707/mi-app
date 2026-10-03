import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PostComment } from '@/features/comments/domain/post-comment';
import { parseCommentTimestamp } from '@/features/comments/domain/post-comment-values';
import { useTheme } from '@/hooks/use-theme';

// Logical depth is unbounded. Only the indentation stops growing, so a deep
// thread keeps a readable width on a phone.
const MAX_VISUAL_DEPTH = 3;
const INDENT_PER_LEVEL = 16;
const BASE_PADDING = 16;
const REPLIES_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

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

type CommentRowProps = {
  comment: PostComment;
  depth: number;
  isExpanded: boolean;
  onExpandReplies: (commentId: string) => void;
  onCollapseReplies: (commentId: string) => void;
};

export const CommentRow = memo(function CommentRow({
  comment, depth, isExpanded, onExpandReplies, onCollapseReplies,
}: CommentRowProps) {
  const theme = useTheme();
  const { username } = comment.author;
  const displayName = comment.author.displayName?.trim() ? comment.author.displayName : null;
  const name = displayName ?? (username === null ? 'Usuario' : `@${username}`);
  const handle = displayName !== null && username !== null ? `@${username}` : null;
  const initial = (Array.from(displayName?.trim() || username || '?')[0] ?? '?').toUpperCase();

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
          <Text style={[styles.body, { color: theme.text }]}>{comment.body}</Text>
          <Text style={[styles.date, { color: theme.textSecondary }]}>
            {formatCommentTimestamp(comment.createdAt)}
          </Text>
          {comment.directRepliesCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              hitSlop={REPLIES_HIT_SLOP}
              onPress={() => (isExpanded ? onCollapseReplies(comment.id) : onExpandReplies(comment.id))}
              style={({ pressed }) => [styles.repliesButton, pressed ? styles.pressed : undefined]}>
              <Text style={[styles.repliesText, { color: theme.textSecondary }]}>
                {isExpanded ? 'Ocultar respuestas' : repliesLabel(comment.directRepliesCount)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
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
  repliesButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  repliesText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
