import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/features/feed/presentation/components/post-card';
import { usePostDetail } from '@/features/post-detail/presentation/hooks/use-post-detail';
import { usePostMediaMemoryPressure } from '@/features/post-media/presentation/hooks/use-post-media-memory-pressure';
import { sharePost as sharePostLink } from '@/features/post-sharing/post-sharing-container';
import { useTheme } from '@/hooks/use-theme';
import { normalizeUuid } from '@/shared/domain/uuid';

type PostDetailScreenProps = { postId: string | null };
const NOOP = () => undefined;

export function PostDetailScreen({ postId }: PostDetailScreenProps) {
  const normalizedPostId = normalizeUuid(postId);
  if (normalizedPostId === null) return <CenteredFeedback message="Publicación no válida." />;
  return <ValidPostDetail postId={normalizedPostId} />;
}

function ValidPostDetail({ postId }: { postId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { state, retry, refresh } = usePostDetail(postId);
  const [isFocused, setIsFocused] = useState(false);
  usePostMediaMemoryPressure();
  useFocusEffect(useCallback(() => {
    setIsFocused(true);
    return () => setIsFocused(false);
  }, []));

  const openAuthor = useCallback((profileId: string) => {
    router.push({ pathname: '/home/profile/[profileId]', params: { profileId } });
  }, [router]);
  const openComments = useCallback((targetPostId: string) => {
    router.push({ pathname: '/post/[postId]/comments', params: { postId: targetPostId } });
  }, [router]);
  const sharePost = useCallback((targetPostId: string) => {
    void sharePostLink(targetPostId).catch(() => {
      Alert.alert('No pudimos compartir', 'Inténtalo de nuevo.');
    });
  }, []);

  if (state.status === 'loading') {
    return (
      <SafeAreaView edges={['bottom']} style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} size="large" />
        <Text style={[styles.message, { color: theme.textSecondary }]}>Cargando publicación...</Text>
      </SafeAreaView>
    );
  }
  if (state.status === 'not-found') {
    return <CenteredFeedback message="Esta publicación ya no está disponible." />;
  }
  if (state.status === 'profile-not-ready') {
    return <CenteredFeedback message="Tu perfil todavía no está listo." onRetry={retry} />;
  }
  if (state.status === 'error') {
    return <CenteredFeedback message="No pudimos cargar la publicación." onRetry={retry} />;
  }

  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={state.isRefreshing} onRefresh={refresh} />}>
        {state.refreshError ? (
          <Feedback message="No pudimos actualizar la publicación." onRetry={refresh} />
        ) : null}
        <PostCard
          post={state.post}
          isMediaVisible={isFocused}
          isLiked={state.post.isLiked}
          likesCount={state.post.likesCount}
          isLikeEnabled={false}
          likeSaveFailed={false}
          onToggleLike={NOOP}
          onOpenAuthor={openAuthor}
          onOpenComments={openComments}
          onSharePost={sharePost}
        />
      </ScrollView>
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
      <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
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
  content: { alignSelf: 'center', paddingBottom: 24, width: '100%', maxWidth: 640 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  feedback: { alignItems: 'center', gap: 12, padding: 20 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
