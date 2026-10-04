import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

// One segment per loaded active Story: earlier ones full, the current one driven by
// the shared progress value (UI thread), later ones empty.
export function StoryProgressBars({ count, index, progress }: {
  count: number;
  index: number;
  progress: SharedValue<number>;
}) {
  return (
    <View accessibilityLabel={`Historia ${Math.min(index + 1, count)} de ${count}`} style={styles.row}>
      {Array.from({ length: count }, (_, position) => (
        <View key={position} style={styles.track}>
          {position < index ? <View style={[styles.fill, styles.full]} /> : null}
          {position === index ? <CurrentFill progress={progress} /> : null}
        </View>
      ))}
    </View>
  );
}

function CurrentFill({ progress }: { progress: SharedValue<number> }) {
  const animated = useAnimatedStyle(() => ({
    width: `${Math.min(1, Math.max(0, progress.value)) * 100}%`,
  }));
  return <Animated.View style={[styles.fill, animated]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  track: { backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2, flex: 1, height: 3, overflow: 'hidden' },
  fill: { backgroundColor: '#fff', height: '100%' },
  full: { width: '100%' },
});
