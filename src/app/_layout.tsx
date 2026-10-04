import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import {
  authEntryScreenDependencies,
  authProviderDependencies,
} from '@/features/auth/auth-container';
import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { AuthProvider } from '@/features/auth/presentation/providers/auth-provider';
import { AuthEntryScreen } from '@/features/auth/presentation/screens/auth-entry-screen';
import { OfflineSyncCoordinatorHost } from '@/features/offline-sync/presentation/offline-sync-coordinator-host';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

function AuthenticatedContent() {
  const { isLoading, user } = useAuth();
  const theme = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.background }]}>
        <ActivityIndicator accessibilityLabel="Comprobando sesión" color={theme.text} size="large" />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Comprobando sesión…</Text>
      </View>
    );
  }

  if (!user) {
    return <AuthEntryScreen {...authEntryScreenDependencies} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <AuthProvider {...authProviderDependencies}>
      <OfflineSyncCoordinatorHost />
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AuthenticatedContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
