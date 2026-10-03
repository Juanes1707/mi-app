import { Image } from 'expo-image';
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePostMediaImage } from '@/features/post-media/presentation/hooks/use-post-media-image';
import { useTheme } from '@/hooks/use-theme';

type PostMediaImageProps = {
  imagePath: string;
  isVisible: boolean;
  accessibilityLabel: string;
};

export const PostMediaImage = memo(function PostMediaImage({
  imagePath, isVisible, accessibilityLabel,
}: PostMediaImageProps) {
  const theme = useTheme();
  const { state, retry } = usePostMediaImage(imagePath, isVisible);

  return (
    <View style={[styles.media, { backgroundColor: theme.backgroundElement }]}>
      {state.status === 'loaded' ? (
        // The source is the decoded native bitmap from OUR cache: no URL ever
        // reaches this component, and expo-image's own caches are disabled.
        <Image
          accessibilityLabel={accessibilityLabel}
          cachePolicy="none"
          contentFit="cover"
          recyclingKey={imagePath}
          source={state.image}
          style={styles.image}
        />
      ) : state.status === 'loading' ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : state.status === 'error' && state.reason === 'not-found' ? (
        <Text style={[styles.message, { color: theme.textSecondary }]}>Imagen no disponible.</Text>
      ) : state.status === 'error' ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <Text style={[styles.message, { color: theme.textSecondary }]}>
            No pudimos cargar la imagen.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={({ pressed }) => [styles.retry, { backgroundColor: theme.background },
              pressed ? styles.pressed : undefined]}>
            <Text style={[styles.retryText, { color: theme.text }]}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={{ color: theme.textSecondary }}>Imagen</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  media: { aspectRatio: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  image: { height: '100%', width: '100%' },
  error: { alignItems: 'center', gap: 12, padding: 16 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: { borderRadius: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24 },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
