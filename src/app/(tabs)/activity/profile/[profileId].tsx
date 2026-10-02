import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { ProfileViewScreen } from '@/features/profile-view/presentation/screens/profile-view-screen';
import { useTheme } from '@/hooks/use-theme';

export default function ActivityProfileRoute() {
  const { profileId } = useLocalSearchParams<{
    profileId?: string | string[];
  }>();
  const normalizedProfileId =
    typeof profileId === 'string' ? profileId.trim() : '';

  if (!normalizedProfileId) {
    return <InvalidProfileRoute />;
  }

  return <ProfileViewScreen profileId={normalizedProfileId} />;
}

function InvalidProfileRoute() {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text style={[styles.message, { color: theme.text }]}>Perfil no válido.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  message: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
});
