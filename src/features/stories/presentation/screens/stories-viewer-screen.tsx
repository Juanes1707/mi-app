import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View,
  type AccessibilityActionEvent,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { usePostMediaMemoryPressure } from '@/features/post-media/presentation/hooks/use-post-media-memory-pressure';
import { normalizeStoryUuid } from '@/features/stories/domain/story-values';
import { StoryAvatar, storyAuthorName } from '@/features/stories/presentation/components/story-avatar';
import { StoryProgressBars } from '@/features/stories/presentation/components/story-progress-bars';
import { useStoriesViewer } from '@/features/stories/presentation/hooks/use-stories-viewer';
import { useStoryGestures } from '@/features/stories/presentation/hooks/use-story-gestures';
import { useStoryPlayback } from '@/features/stories/presentation/hooks/use-story-playback';

const VIEWER_ACCESSIBILITY_ACTIONS = [
  { name: 'increment', label: 'Siguiente historia' },
  { name: 'decrement', label: 'Historia anterior' },
];

export function StoriesViewerScreen({ authorId }: { authorId: string | null }) {
  const router = useRouter();
  const { user } = useAuth();
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);
  const normalized = normalizeStoryUuid(authorId);
  // Invalid route: a message and nothing else (no request of any kind).
  if (normalized === null || user === null) {
    return <ViewerMessage message="Historias no disponibles." onClose={close} />;
  }
  return <ActiveStoriesViewer ownerUserId={user.id.toLowerCase()} authorId={normalized} onClose={close} />;
}

function ActiveStoriesViewer({ ownerUserId, authorId, onClose }: {
  ownerUserId: string;
  authorId: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const { state, controller } = useStoriesViewer(ownerUserId, authorId, onClose);
  usePostMediaMemoryPressure();
  const story = state.status === 'ready' ? state.story : null;
  const ready = story !== null && state.media.status === 'loaded' && state.displayedStoryId === story.id;
  const playback = useStoryPlayback(
    story === null ? null : state.playKey,
    ready,
    () => { void controller?.next(); },
    () => controller?.revalidate() ?? Promise.resolve(),
  );
  const gesture = useStoryGestures(width, {
    onPrevious: () => { void controller?.previous(); },
    onNext: () => { void controller?.next(); },
    onHoldStart: playback.holdStart,
    onHoldEnd: playback.holdEnd,
  });
  const onAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') void controller?.next();
    if (event.nativeEvent.actionName === 'decrement') void controller?.previous();
  }, [controller]);

  if (state.status === 'invalid' || state.status === 'unavailable') {
    return <ViewerMessage message="Historias no disponibles." onClose={onClose} />;
  }
  if (state.status === 'error') {
    return <ViewerMessage message="No se pudo cargar esta historia." onClose={onClose}
      onRetry={() => controller?.retryOpen()} />;
  }

  const media = state.media;
  const name = state.author ? storyAuthorName(state.author) : '';
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={story ? `Historia de ${name}` : 'Cargando historias'}
          accessibilityActions={VIEWER_ACCESSIBILITY_ACTIONS}
          onAccessibilityAction={onAccessibilityAction}
          style={styles.surface}>
          {story !== null && media.status === 'loaded' && media.storyId === story.id ? (
            // Decoded bitmap from the shared private cache; no URL reaches the view.
            <Image
              cachePolicy="none"
              contentFit="cover"
              recyclingKey={story.id}
              source={media.image}
              style={StyleSheet.absoluteFill}
              onDisplay={() => controller?.mediaDisplayed(story.id)}
            />
          ) : null}
        </View>
      </GestureDetector>
      {story === null || media.status === 'loading' || media.status === 'none' ? (
        <View pointerEvents="none" style={styles.center}><ActivityIndicator color="#fff" size="large" /></View>
      ) : null}
      {story !== null && media.status === 'failed' ? (
        // box-none: around the button, taps still reach the Story surface (skip is allowed).
        <View pointerEvents="box-none" style={styles.center}>
          <Text style={styles.message}>No se pudo cargar esta historia.</Text>
          <Pressable accessibilityRole="button" onPress={() => controller?.retryMedia()}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.overlay}>
        <StoryProgressBars count={state.stories.length} index={state.index} progress={playback.progress} />
        <View pointerEvents="box-none" style={styles.header}>
          {state.author ? <StoryAvatar name={name} ring="none" size={36} /> : null}
          <Text numberOfLines={1} style={styles.author}>{name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar historias" hitSlop={12} onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function ViewerMessage({ message, onClose, onRetry }: { message: string; onClose: () => void; onRetry?: () => void }) {
  return (
    <SafeAreaView style={[styles.root, styles.messageScreen]}>
      <StatusBar style="light" />
      <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Cerrar historias" onPress={onClose}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>Cerrar</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', flex: 1 },
  surface: { backgroundColor: '#000', flex: 1 },
  center: {
    alignItems: 'center', bottom: 0, gap: 14, justifyContent: 'center', left: 0, padding: 24,
    position: 'absolute', right: 0, top: 0,
  },
  overlay: { left: 0, position: 'absolute', right: 0, top: 0 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 10 },
  author: { color: '#fff', flex: 1, fontSize: 15, fontWeight: '700' },
  close: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  closeText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  messageScreen: { alignItems: 'center', gap: 14, justifyContent: 'center', padding: 24 },
  message: { color: '#fff', fontSize: 16, textAlign: 'center' },
  button: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 22 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
