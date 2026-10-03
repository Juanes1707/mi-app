import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { isUuid } from '@/features/comments/domain/post-comment-values';
import type { PostCommentsErrorCode } from '@/features/comments/domain/post-comments-error';
import { flattenVisibleRows, type VisibleCommentRow } from '@/features/comments/presentation/comment-tree';
import { CommentBranchStatusRow } from '@/features/comments/presentation/components/comment-branch-status-row';
import { CommentComposer } from '@/features/comments/presentation/components/comment-composer';
import { CommentRow } from '@/features/comments/presentation/components/comment-row';
import { LocalCommentRow } from '@/features/comments/presentation/components/local-comment-row';
import { useOptimisticPostComments } from '@/features/comments/presentation/hooks/use-optimistic-post-comments';
import { usePostComments } from '@/features/comments/presentation/hooks/use-post-comments';
import { useRealtimePostComments } from '@/features/comments/presentation/hooks/use-realtime-post-comments';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';
import { useTheme } from '@/hooks/use-theme';

const ROOT_ERROR_MESSAGES: Record<PostCommentsErrorCode, string> = {
  'post-not-found': 'Esta publicación ya no está disponible.',
  'profile-not-ready': 'Tu perfil todavía no está listo.',
  'authentication-required': 'Tu sesión no está disponible.',
  'owner-session-mismatch': 'Tu sesión no está disponible.',
  'parent-not-found': 'No pudimos cargar los comentarios.',
  'comment-not-found': 'No pudimos cargar los comentarios.',
  'invalid-request': 'No pudimos cargar los comentarios.',
  'invalid-response': 'No pudimos cargar los comentarios.',
  unavailable: 'No pudimos cargar los comentarios.',
};
const REFRESH_ERROR_MESSAGES: Record<PostCommentsErrorCode, string> = {
  ...ROOT_ERROR_MESSAGES,
  'parent-not-found': 'No pudimos actualizar los comentarios.',
  'comment-not-found': 'No pudimos actualizar los comentarios.',
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
  // Owner from the in-memory auth state: no auth/network round trip per send.
  const { user } = useAuth();
  const ownerUserId = user === null ? null : normalizeUuid(user.id);
  const {
    tree, root, isRefreshing, refreshError,
    expandReplies, collapseReplies, continueReplies, loadMoreRoots, retryRoots, refresh, catchUpBranches,
    markPostUnavailable,
  } = usePostComments(postId);
  // Live hints → authorized GET → canonical comments kept outside the paginated tree.
  const realtime = useRealtimePostComments({ ownerUserId, postId, tree, onPostUnavailable: markPostUnavailable });
  const onReplyCreated = useCallback(
    (parentCommentId: string) => expandReplies(parentCommentId, { localChildren: true }),
    [expandReplies],
  );
  // Server browsing and the local projection load independently: comments can be
  // read (and the overlay shown) even while the other side is loading or failed.
  const local = useOptimisticPostComments({
    ownerUserId, postId, tree, liveComments: realtime.comments, onCommentsSynced: catchUpBranches, onReplyCreated,
  });
  const { startReply, retryLocal, discardLocal } = local;
  const canInteract = local.status === 'ready';

  // Paginated tree + live overlay + local overlay → one flat list for one FlatList.
  const rows = useMemo(
    () => flattenVisibleRows(tree, local.overlay, realtime.comments),
    [tree, local.overlay, realtime.comments],
  );

  const expand = useCallback(
    (commentId: string, hasLocalReplies: boolean) => expandReplies(commentId, { localChildren: hasLocalReplies }),
    [expandReplies],
  );
  const replyToServer = useCallback(
    (commentId: string, label: string) => startReply({ commentId, label, source: 'server' }),
    [startReply],
  );
  const replyToLocal = useCallback(
    (commentId: string, label: string) => startReply({ commentId, label, source: 'local' }),
    [startReply],
  );

  const renderRow: ListRenderItem<VisibleCommentRow> = useCallback(({ item }) => {
    switch (item.kind) {
      case 'comment':
        return (
          <CommentRow
            comment={item.comment}
            depth={item.depth}
            isExpanded={item.isExpanded}
            localRepliesCount={item.localRepliesCount}
            realtimeRepliesCount={item.realtimeRepliesCount}
            canReply={canInteract}
            onExpandReplies={expand}
            onCollapseReplies={collapseReplies}
            onReply={replyToServer}
          />
        );
      case 'local':
        return (
          <LocalCommentRow
            local={item.local}
            depth={item.depth}
            isExpanded={item.isExpanded}
            localRepliesCount={item.localRepliesCount}
            realtimeRepliesCount={item.realtimeRepliesCount}
            isOrphan={item.isOrphan}
            canInteract={canInteract}
            onExpandReplies={expand}
            onCollapseReplies={collapseReplies}
            onReply={replyToLocal}
            onRetry={retryLocal}
            onDiscard={discardLocal}
          />
        );
      case 'branch-status':
        return (
          <CommentBranchStatusRow
            branchKey={item.branchKey}
            depth={item.depth}
            status={item.status}
            error={item.error}
            onContinue={continueReplies}
          />
        );
    }
  }, [canInteract, expand, collapseReplies, replyToServer, replyToLocal, retryLocal, discardLocal, continueReplies]);

  // The post itself is gone or hidden: nothing of it (server or local) is shown.
  if (root !== null && !root.loaded && root.error === 'post-not-found') {
    return <CenteredFeedback message={ROOT_ERROR_MESSAGES['post-not-found']} />;
  }

  const rootLoaded = root?.loaded === true;
  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        {/* One virtualized list for the whole tree: replies are rows, not nested lists. */}
        <FlatList
          contentContainerStyle={styles.listContent}
          data={rows}
          keyboardShouldPersistTaps="handled"
          keyExtractor={getRowKey}
          renderItem={renderRow}
          ListHeaderComponent={(
            <>
              {local.status === 'error' ? (
                <Feedback
                  message="No pudimos cargar tus comentarios pendientes."
                  onRetry={local.retryPendingLoad}
                />
              ) : null}
              {refreshError !== null ? (
                <Feedback message={REFRESH_ERROR_MESSAGES[refreshError]} onRetry={refresh} />
              ) : null}
              {!rootLoaded && (root === null || root.status === 'loading') ? (
                <View style={styles.feedback}>
                  <ActivityIndicator color={theme.text} />
                  <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                    Cargando comentarios...
                  </Text>
                </View>
              ) : null}
              {!rootLoaded && root !== null && root.status === 'error' ? (
                <Feedback message={ROOT_ERROR_MESSAGES[root.error ?? 'unavailable']} onRetry={retryRoots} />
              ) : null}
            </>
          )}
          ListEmptyComponent={rootLoaded && root.nextCursor === null
            ? <Feedback message="Todavía no hay comentarios." />
            : null}
          ListFooterComponent={root?.status === 'loading-more' && rootLoaded ? (
            <View style={styles.feedback}>
              <ActivityIndicator color={theme.text} />
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                Cargando más comentarios...
              </Text>
            </View>
          ) : rootLoaded && root.status === 'error' ? (
            <Feedback message="No pudimos cargar más comentarios." onRetry={retryRoots} />
          ) : null}
          onEndReached={loadMoreRoots}
          onEndReachedThreshold={0.5}
          onRefresh={rootLoaded ? refresh : retryRoots}
          refreshing={isRefreshing}
        />
        <CommentComposer
          value={local.draft}
          onChangeText={local.setDraft}
          editable={canInteract}
          canSend={local.canSend}
          onSend={local.send}
          codePoints={local.codePoints}
          bodyIssue={local.bodyIssue}
          replyLabel={local.replyTarget?.label ?? null}
          onCancelReply={local.cancelReply}
        />
      </KeyboardAvoidingView>
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
  listContent: { alignSelf: 'center', paddingBottom: 24, width: '100%', maxWidth: 640 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  feedback: { alignItems: 'center', gap: 12, padding: 20 },
  statusText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
