import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View,
  type ListRenderItem, type ViewabilityConfig, type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset } from '@/constants/theme';
import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { getFeedInvalidationVersion } from '@/features/feed/application/feed-invalidation';
import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import type { FeedErrorCode } from '@/features/feed/domain/errors/feed-error';
import { PostCard } from '@/features/feed/presentation/components/post-card';
import { useFeed } from '@/features/feed/presentation/hooks/use-feed';
import { useOptimisticPostLikes } from '@/features/feed/presentation/hooks/use-optimistic-post-likes';
import { collectVisiblePostIds } from '@/features/feed/presentation/visible-post-ids';
import { usePostMediaMemoryPressure } from '@/features/post-media/presentation/hooks/use-post-media-memory-pressure';
import { useTheme } from '@/hooks/use-theme';

const messages: Record<FeedErrorCode, string> = {
  'authentication-required': 'Tu sesión no está disponible.',
  'invalid-request': 'No pudimos solicitar el feed.',
  'invalid-response': 'No pudimos interpretar las publicaciones.',
  unavailable: 'No pudimos cargar las publicaciones. Revisa tu conexión e inténtalo de nuevo.',
};
const getPostKey = (post: FeedPost) => post.id;
// Module-level, so FlatList sees the same object for its whole lifetime.
// minimumViewTime keeps cells crossed during a fast fling from starting downloads.
const MEDIA_VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 20,
  minimumViewTime: 100,
  waitForInteraction: false,
};
const NO_VISIBLE_POSTS: ReadonlySet<string> = new Set();

function CreatePostButton() {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/home/create')}
      style={[styles.retry, { backgroundColor: theme.backgroundElement }]}>
      <Text style={[styles.retryText, { color: theme.text }]}>Crear publicación</Text>
    </Pressable>
  );
}

function Feedback({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.feedback}>
      <Text style={[styles.statusText, { color: theme.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry}
          style={({ pressed }) => [styles.retry, { backgroundColor: theme.backgroundElement },
            pressed ? styles.pressed : undefined]}>
          <Text style={[styles.retryText, { color: theme.text }]}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FeedHeader() {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Inicio</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Momentos de tu comunidad</Text>
      <CreatePostButton />
    </View>
  );
}

function PostSeparator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.backgroundElement }]} />;
}

export function FeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, refresh, refreshAfterChange, retryInitial, onEndReached, retryLoadMore } = useFeed();
  // Owner comes from the in-memory auth state: no auth/network round trip per tap.
  const { user } = useAuth();
  const likes = useOptimisticPostLikes(user?.id ?? null, refreshAfterChange);
  const lastSeenInvalidation = useRef(getFeedInvalidationVersion());
  useFocusEffect(useCallback(() => {
    const version = getFeedInvalidationVersion();
    if (version === lastSeenInvalidation.current ||
      state.operation === 'initial' || state.operation === 'refreshing') return;
    lastSeenInvalidation.current = version;
    void refresh();
  }, [refresh, state.operation]));
  const openAuthor = useCallback((profileId: string) => {
    router.push({ pathname: '/home/profile/[profileId]', params: { profileId } });
  }, [router]);
  // Only the id travels: Comments loads its own authorized data.
  const openComments = useCallback((postId: string) => {
    router.push({ pathname: '/home/comments/[postId]', params: { postId } });
  }, [router]);
  usePostMediaMemoryPressure();
  const [visiblePostIds, setVisiblePostIds] = useState(NO_VISIBLE_POSTS);
  // FlatList does not support changing this callback on the fly: keep one identity.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<FeedPost>[] }) => {
      setVisiblePostIds((previous) => collectVisiblePostIds(viewableItems, previous));
    },
  ).current;
  const {
    desiredLikes, failedPostIds, pendingLikesStatus, getDisplayedLike, toggleLike, retryPendingLikesLoad,
  } = likes;
  // Likes are interactive only once the owner's durable pending state is known.
  const isLikeEnabled = pendingLikesStatus === 'ready';
  // Server posts (any page, any refresh) + pending local like state, derived at render.
  const renderPost: ListRenderItem<FeedPost> = useCallback(({ item }) => {
    const displayed = getDisplayedLike(item);
    return (
      <PostCard
        post={item}
        isMediaVisible={visiblePostIds.has(item.id)}
        isLiked={displayed.isLiked}
        likesCount={displayed.likesCount}
        isLikeEnabled={isLikeEnabled}
        likeSaveFailed={failedPostIds.has(item.id)}
        onToggleLike={toggleLike}
        onOpenAuthor={openAuthor}
        onOpenComments={openComments}
      />
    );
  }, [
    openAuthor, openComments, visiblePostIds, getDisplayedLike, isLikeEnabled, failedPostIds, toggleLike,
  ]);
  const listExtraData = useMemo(
    () => ({ visiblePostIds, desiredLikes, failedPostIds, isLikeEnabled }),
    [visiblePostIds, desiredLikes, failedPostIds, isLikeEnabled],
  );

  if (state.status === 'initial-loading') {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} size="large" />
        <Feedback message="Cargando publicaciones..." />
        <CreatePostButton />
      </SafeAreaView>
    );
  }
  if (state.status === 'initial-error') {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]}>
        <Feedback message={messages[state.error?.code ?? 'unavailable']} onRetry={retryInitial} />
        <CreatePostButton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={state.page.posts}
        extraData={listExtraData}
        ItemSeparatorComponent={PostSeparator}
        keyExtractor={getPostKey}
        ListHeaderComponent={
          <>
            <FeedHeader />
            {state.refreshError ? (
              <Feedback message={messages[state.refreshError.code]} onRetry={refresh} />
            ) : null}
            {pendingLikesStatus === 'error' ? (
              <Feedback
                message="No pudimos cargar tus acciones pendientes."
                onRetry={retryPendingLikesLoad}
              />
            ) : null}
          </>
        }
        ListEmptyComponent={
          state.page.nextCursor === null
            ? <Feedback message="Aún no hay publicaciones para mostrar." />
            : null
        }
        ListFooterComponent={
          state.operation === 'loading-more' ? (
            <View style={styles.feedback}>
              <ActivityIndicator color={theme.text} />
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                Cargando más publicaciones...
              </Text>
            </View>
          ) : state.loadMoreError ? (
            <Feedback message="No pudimos cargar más publicaciones." onRetry={retryLoadMore} />
          ) : null
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={onViewableItemsChanged}
        onRefresh={refresh}
        refreshing={state.operation === 'refreshing'}
        renderItem={renderPost}
        showsVerticalScrollIndicator={false}
        viewabilityConfig={MEDIA_VIEWABILITY_CONFIG}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: {
    alignSelf: 'center', paddingBottom: BottomTabInset + 24, width: '100%', maxWidth: 640,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 2, paddingBottom: 14,
    paddingHorizontal: 16, paddingTop: Platform.select({ web: 82, default: 10 }),
  },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6, lineHeight: 32 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  separator: { height: 8 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  feedback: { alignItems: 'center', gap: 12, padding: 20 },
  statusText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
