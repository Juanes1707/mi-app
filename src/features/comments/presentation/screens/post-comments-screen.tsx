import { useCallback } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { isUuid } from '@/features/comments/domain/post-comment-values';
import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';
import type { VisibleCommentRow } from '@/features/comments/presentation/comment-tree';
import { CommentBranchStatusRow } from '@/features/comments/presentation/components/comment-branch-status-row';
import { CommentRow } from '@/features/comments/presentation/components/comment-row';
import { usePostComments } from '@/features/comments/presentation/hooks/use-post-comments';
import { useTheme } from '@/hooks/use-theme';

const ROOT_ERROR_MESSAGES: Record<PostCommentsErrorCode, string> = {
  'post-not-found': 'Esta publicación ya no está disponible.',
  'profile-not-ready': 'Tu perfil todavía no está listo.',
  'authentication-required': 'Tu sesión no está disponible.',
  'parent-not-found': 'No pudimos cargar los comentarios.',
  'invalid-request': 'No pudimos cargar los comentarios.',
  'invalid-response': 'No pudimos cargar los comentarios.',
  unavailable: 'No pudimos cargar los comentarios.',
};
const REFRESH_ERROR_MESSAGES: Record<PostCommentsErrorCode, string> = {
  ...ROOT_ERROR_MESSAGES,
  'parent-not-found': 'No pudimos actualizar los comentarios.',
  'invalid-request': 'No pudimos actualizar los comentarios.',
  'invalid-response': 'No pudimos actualizar los comentarios.',
  unavailable: 'No pudimos actualizar los comentarios.',
};
const getRowKey = (row: VisibleCommentRow) => row.key;

type PostCommentsScreenProps = {
  // Raw route param: untrusted until validated here.
  postId: string | null;
};

// An invalid id renders a safe state and never reaches the network.
export function PostCommentsScreen({ postId }: PostCommentsScreenProps) {
  if (postId === null || !isUuid(postId)) {
    return <CenteredFeedback message="Publicación no válida." />;
  }
  return <PostComments postId={postId.toLowerCase()} />;
}

function PostComments({ postId }: { postId: string }) {
  const theme = useTheme();
  const {
    root, rows, isRefreshing, refreshError,
    expandReplies, collapseReplies, continueReplies, loadMoreRoots, retryRoots, refresh,
  } = usePostComments(postId);

  // Rows carry their comment, so this callback only changes if the actions do.
  const renderRow: ListRenderItem<VisibleCommentRow> = useCallback(({ item }) => (
    item.kind === 'comment' ? (
      <CommentRow
        comment={item.comment}
        depth={item.depth}
        isExpanded={item.isExpanded}
        onExpandReplies={expandReplies}
        onCollapseReplies={collapseReplies}
      />
    ) : (
      <CommentBranchStatusRow
        branchKey={item.branchKey}
        depth={item.depth}
        status={item.status}
        error={item.error}
        onContinue={continueReplies}
      />
    )
  ), [expandReplies, collapseReplies, continueReplies]);

  if (root === null || (!root.loaded && root.status === 'loading')) {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} size="large" />
        <Feedback message="Cargando comentarios..." />
      </SafeAreaView>
    );
  }
  if (!root.loaded) {
    const error = root.error ?? 'unavailable';
    return (
      <CenteredFeedback
        message={ROOT_ERROR_MESSAGES[error]}
        onRetry={error === 'post-not-found' ? undefined : retryRoots}
      />
    );
  }

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* One virtualized list for the whole tree: replies are rows, not nested lists. */}
      <FlatList
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={getRowKey}
        renderItem={renderRow}
        ListHeaderComponent={refreshError !== null ? (
          <Feedback message={REFRESH_ERROR_MESSAGES[refreshError]} onRetry={refresh} />
        ) : null}
        ListEmptyComponent={root.nextCursor === null
          ? <Feedback message="Todavía no hay comentarios." />
          : null}
        ListFooterComponent={root.status === 'loading-more' ? (
          <View style={styles.feedback}>
            <ActivityIndicator color={theme.text} />
            <Text style={[styles.statusText, { color: theme.textSecondary }]}>
              Cargando más comentarios...
            </Text>
          </View>
        ) : root.status === 'error' ? (
          <Feedback message="No pudimos cargar más comentarios." onRetry={retryRoots} />
        ) : null}
        onEndReached={loadMoreRoots}
        onEndReachedThreshold={0.5}
        onRefresh={refresh}
        refreshing={isRefreshing}
      />
    </SafeAreaView>
  );
}

function CenteredFeedback({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={[styles.centered, { backgroundColor: theme.background }]}>
      <Feedback message={message} onRetry={onRetry} />
    </SafeAreaView>
  );
}

function Feedback({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.feedback}>
      <Text style={[styles.statusText, { color: theme.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, { backgroundColor: theme.backgroundElement },
            pressed ? styles.pressed : undefined]}>
          <Text style={[styles.retryText, { color: theme.text }]}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: {
    alignSelf: 'center', paddingBottom: BottomTabInset + 24, width: '100%', maxWidth: 640,
  },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  feedback: { alignItems: 'center', gap: 12, padding: 20 },
  statusText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
