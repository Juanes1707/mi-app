import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ProfileConnectionsLinks({ userId }: { userId: string }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <View style={styles.links}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ver seguidores"
        onPress={() => router.push({ pathname: '/followers/[userId]', params: { userId } })}
        style={({ pressed }) => [styles.link, { backgroundColor: theme.backgroundElement },
          pressed ? styles.pressed : undefined]}>
        <Text style={[styles.text, { color: theme.text }]}>Seguidores</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Ver seguidos"
        onPress={() => router.push({ pathname: '/following/[userId]', params: { userId } })}
        style={({ pressed }) => [styles.link, { backgroundColor: theme.backgroundElement },
          pressed ? styles.pressed : undefined]}>
        <Text style={[styles.text, { color: theme.text }]}>Seguidos</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', gap: Spacing.two },
  link: { borderRadius: 10, justifyContent: 'center', minHeight: 44,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  text: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  pressed: { opacity: 0.72 },
});
