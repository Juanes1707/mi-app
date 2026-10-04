import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type StoryRing = 'unseen' | 'seen' | 'none';

export const STORY_UNSEEN_RING_COLOR = '#E1306C';

// No avatar URL exists in the Stories read model: an initial in a circle, and a ring
// that is highlighted while something is unseen and neutral once fully seen.
export const StoryAvatar = memo(function StoryAvatar({ name, ring, size = 64 }: {
  name: string;
  ring: StoryRing;
  size?: number;
}) {
  const theme = useTheme();
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  const ringColor = ring === 'unseen' ? STORY_UNSEEN_RING_COLOR : ring === 'seen' ? theme.backgroundSelected : 'transparent';
  const inner = size - 8;
  return (
    <View style={[styles.ring, { borderColor: ringColor, borderRadius: size / 2, height: size, width: size }]}>
      <View style={[styles.circle, {
        backgroundColor: theme.backgroundElement, borderRadius: inner / 2, height: inner, width: inner,
      }]}>
        <Text style={[styles.initial, { color: theme.text, fontSize: inner * 0.4 }]}>{initial}</Text>
      </View>
    </View>
  );
});

export function storyAuthorName(author: { username: string | null; displayName: string | null }): string {
  return author.username?.trim() || author.displayName?.trim() || 'Usuario';
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', borderWidth: 2.5, justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
});
