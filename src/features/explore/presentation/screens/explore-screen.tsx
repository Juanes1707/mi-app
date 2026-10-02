import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { DiscoveredProfile } from '@/features/explore/domain/entities/discovered-profile';
import {
  ProfileSearchError,
  type ProfileSearchErrorCode,
} from '@/features/explore/domain/errors/profile-search-error';
import { searchProfiles } from '@/features/explore/explore-container';
import { useTheme } from '@/hooks/use-theme';

type ExploreState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; profiles: DiscoveredProfile[] }
  | { status: 'error'; error: ProfileSearchError };

const errorMessages: Record<ProfileSearchErrorCode, string> = {
  'authentication-required': 'Tu sesión no está disponible.',
  'invalid-query': 'La búsqueda no es válida.',
  'invalid-response': 'No pudimos interpretar los resultados.',
  unavailable: 'No pudimos buscar perfiles. Revisa tu conexión e inténtalo de nuevo.',
};

const getProfileKey = (profile: DiscoveredProfile) => profile.id;

export function ExploreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<ExploreState>({ status: 'idle' });
  const [retryVersion, setRetryVersion] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;

    if (query.trim() === '') {
      setState({ status: 'idle' });
      return () => {
        active = false;
      };
    }

    setState({ status: 'loading' });

    const timer = setTimeout(() => {
      if (!active || generation !== generationRef.current) {
        return;
      }

      void (async () => {
        try {
          const profiles = await searchProfiles.execute(query);

          if (active && generation === generationRef.current) {
            setState({ status: 'success', profiles });
          }
        } catch (error: unknown) {
          if (active && generation === generationRef.current) {
            setState({
              status: 'error',
              error: error instanceof ProfileSearchError
                ? error
                : new ProfileSearchError('unavailable'),
            });
          }
        }
      })();
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, retryVersion]);

  const changeQuery = useCallback((text: string) => {
    if (text === query) {
      return;
    }

    // Invalidate in-flight work immediately, before the next effect runs.
    generationRef.current += 1;
    setQuery(text);
    setState(text.trim() === '' ? { status: 'idle' } : { status: 'loading' });
  }, [query]);

  const retry = useCallback(() => {
    generationRef.current += 1;
    setState(query.trim() === '' ? { status: 'idle' } : { status: 'loading' });
    setRetryVersion((version) => version + 1);
  }, [query]);

  const openProfile = useCallback((profileId: string) => {
    router.push({
      pathname: '/explore/profile/[profileId]',
      params: { profileId },
    });
  }, [router]);

  const renderProfile: ListRenderItem<DiscoveredProfile> = useCallback(
    ({ item }) => <ProfileSearchRow profile={item} onOpenProfile={openProfile} />,
    [openProfile],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            Explore
          </Text>
          <TextInput
            accessibilityLabel="Buscar personas"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={50}
            onChangeText={changeQuery}
            placeholder="Buscar personas"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="search"
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            value={query}
          />
        </View>

        {state.status === 'success' ? (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={state.profiles}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            keyExtractor={getProfileKey}
            ListEmptyComponent={
              <Text style={[styles.message, { color: theme.textSecondary }]}>
                No encontramos perfiles.
              </Text>
            }
            renderItem={renderProfile}
            style={styles.list}
          />
        ) : (
          <View accessibilityLiveRegion="polite" style={styles.feedback}>
            {state.status === 'loading' ? (
              <>
                <ActivityIndicator color={theme.text} />
                <Text style={[styles.message, { color: theme.textSecondary }]}>
                  Buscando perfiles...
                </Text>
              </>
            ) : state.status === 'error' ? (
              <>
                <Text style={[styles.message, { color: theme.textSecondary }]}>
                  {errorMessages[state.error.code]}
                </Text>
                {state.error.code !== 'invalid-query' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={retry}
                    style={({ pressed }) => [
                      styles.retry,
                      { backgroundColor: theme.backgroundElement },
                      pressed ? styles.pressed : undefined,
                    ]}>
                    <Text style={[styles.retryText, { color: theme.text }]}>Reintentar</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Text style={[styles.message, { color: theme.textSecondary }]}>
                Busca personas por nombre o usuario.
              </Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const ProfileSearchRow = memo(function ProfileSearchRow({
  profile,
  onOpenProfile,
}: {
  profile: DiscoveredProfile;
  onOpenProfile: (profileId: string) => void;
}) {
  const theme = useTheme();
  const displayName = profile.displayName?.trim();
  const username = profile.username?.trim();
  const visibleName = displayName || username || 'Usuario';
  const initial = [...(displayName || username || '?')][0].toUpperCase();

  return (
    <Pressable
      accessibilityLabel={`Ver perfil de ${visibleName}`}
      accessibilityRole="button"
      onPress={() => onOpenProfile(profile.id)}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: theme.backgroundElement } : undefined,
      ]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <Text style={[styles.initial, { color: theme.text }]}>{initial}</Text>
      </View>
      <View style={styles.identity}>
        <Text style={[styles.name, { color: theme.text }]}>{visibleName}</Text>
        {username ? (
          <Text style={[styles.username, { color: theme.textSecondary }]}>@{username}</Text>
        ) : null}
        {profile.isPrivate ? (
          <Text style={[styles.privateLabel, { color: theme.textSecondary }]}>
            Cuenta privada
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  header: { gap: Spacing.three, padding: Spacing.four },
  title: { fontSize: 28, fontWeight: '700', lineHeight: 36 },
  input: {
    borderRadius: 12,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  feedback: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  message: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  retry: {
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  retryText: { fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  row: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  initial: { fontSize: 20, fontWeight: '700' },
  identity: { flex: 1, gap: Spacing.half, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  username: { fontSize: 14, lineHeight: 20 },
  privateLabel: { fontSize: 12, lineHeight: 18 },
});
