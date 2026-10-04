import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import type {
  ProfileConnection, ProfileConnectionKind,
} from '@/features/profile-connections/domain/profile-connection';
import type { ProfileConnectionsError } from '@/features/profile-connections/domain/profile-connections-error';
import { useProfileConnections } from '@/features/profile-connections/presentation/hooks/use-profile-connections';
import { useTheme } from '@/hooks/use-theme';
import { normalizeUuid } from '@/shared/domain/uuid';

export function ProfileConnectionsScreen({
  targetUserId,
  kind,
}: {
  targetUserId: string | null;
  kind: ProfileConnectionKind;
}) {
  const { user } = useAuth();
  const target = normalizeUuid(targetUserId);
  const owner = normalizeUuid(user?.id);
  if (target === null) return <Feedback message="Perfil no disponible." />;
  if (owner === null) return <Feedback message="Tu sesión no está disponible." />;
  return <LoadedProfileConnections ownerUserId={owner} targetUserId={target} kind={kind} />;
}

function LoadedProfileConnections({
  ownerUserId,
  targetUserId,
  kind,
}: {
  ownerUserId: string;
  targetUserId: string;
  kind: ProfileConnectionKind;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { state, refresh, retry, onEndReached, retryLoadMore } =
    useProfileConnections(ownerUserId, targetUserId, kind);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const openProfile = useCallback((profileId: string) => {
    router.push({ pathname: '/profile/view/[profileId]', params: { profileId } });
  }, [router]);
  const renderItem: ListRenderItem<ProfileConnection> = useCallback(({ item }) => (
    <ConnectionRow connection={item} onPress={openProfile} />
  ), [openProfile]);

  if (state.status === 'loading') return <Feedback loading message="Cargando conexiones..." />;
  if (state.status === 'error') {
    const unavailable = state.error?.code === 'profile-not-found';
    return <Feedback message={unavailable ? 'Perfil no disponible.' : errorMessage(state.error)}
      onRetry={unavailable ? undefined : retry} />;
  }
  return (
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <FlatList
        contentContainerStyle={styles.list}
        data={state.page.connections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={<Feedback message={kind === 'followers'
          ? 'Aún no hay seguidores.' : 'Aún no sigue a nadie.'} />}
        ListHeaderComponent={state.refreshError
          ? <Feedback message="No pudimos actualizar la lista." onRetry={refresh} /> : null}
        ListFooterComponent={state.operation === 'loading-more'
          ? <Feedback loading message="Cargando más perfiles..." />
          : state.loadMoreError
            ? <Feedback message="No pudimos cargar más perfiles." onRetry={retryLoadMore} />
            : null}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        onRefresh={() => { void refresh(); }}
        refreshing={state.operation === 'refreshing'}
      />
    </SafeAreaView>
  );
}

function ConnectionRow({ connection, onPress }: {
  connection: ProfileConnection;
  onPress: (profileId: string) => void;
}) {
  const theme = useTheme();
  const displayName = connection.displayName?.trim();
  const username = connection.username?.trim();
  const name = displayName || username || 'Usuario';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Ver perfil de ${name}`}
      onPress={() => onPress(connection.id)}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.backgroundElement },
        pressed ? styles.pressed : undefined]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <Text style={[styles.avatarText, { color: theme.text }]}>
          {Array.from(name)[0]?.toUpperCase() ?? '?'}
        </Text>
      </View>
      <View style={styles.identity}>
        <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>{name}</Text>
        {username ? <Text style={[styles.username, { color: theme.textSecondary }]}>@{username}</Text> : null}
        {connection.isPrivate
          ? <Text style={[styles.privateLabel, { color: theme.textSecondary }]}>Cuenta privada</Text>
          : null}
      </View>
    </Pressable>
  );
}

function errorMessage(error: ProfileConnectionsError | null): string {
  if (error?.code === 'authentication-required' || error?.code === 'owner-session-mismatch') {
    return 'Tu sesión no está disponible.';
  }
  if (error?.code === 'profile-not-ready') return 'Tu perfil todavía no está disponible.';
  if (error?.code === 'invalid-response') return 'No pudimos interpretar la lista recibida.';
  return 'No pudimos cargar esta lista. Revisa tu conexión e inténtalo de nuevo.';
}

function Feedback({ message, onRetry, loading = false }: {
  message: string;
  onRetry?: () => void | Promise<unknown>;
  loading?: boolean;
}) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={styles.feedback}>
      {loading ? <ActivityIndicator color={theme.text} /> : null}
      <Text style={[styles.feedbackText, { color: theme.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={() => { void onRetry(); }}
          style={[styles.retry, { backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: theme.text }}>Reintentar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { alignSelf: 'center', flexGrow: 1, maxWidth: MaxContentWidth, width: '100%' },
  row: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', gap: Spacing.three, minHeight: 76, padding: Spacing.three },
  avatar: { alignItems: 'center', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
  avatarText: { fontSize: 19, fontWeight: '700' },
  identity: { flex: 1, gap: Spacing.half, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  username: { fontSize: 14, lineHeight: 20 },
  privateLabel: { fontSize: 12, lineHeight: 18 },
  feedback: { alignItems: 'center', flexGrow: 1, gap: Spacing.three,
    justifyContent: 'center', padding: Spacing.four },
  feedbackText: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  retry: { borderRadius: 10, justifyContent: 'center', minHeight: 44,
    paddingHorizontal: Spacing.four },
  pressed: { opacity: 0.7 },
});
