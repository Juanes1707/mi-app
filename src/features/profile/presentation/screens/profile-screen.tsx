import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { Profile } from '@/features/profile/domain/entities/profile';
import { ProfileError, type ProfileErrorCode } from '@/features/profile/domain/errors/profile-error';
import { getMyProfile } from '@/features/profile/profile-container';
import { useTheme } from '@/hooks/use-theme';

type ProfileScreenState =
  | { status: 'loading' }
  | { status: 'success'; profile: Profile }
  | { status: 'error'; error: ProfileError };

const initialState: ProfileScreenState = { status: 'loading' };

export function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [state, setState] = useState<ProfileScreenState>(initialState);
  const [requestVersion, setRequestVersion] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      setState({ status: 'loading' });

      void getMyProfile
        .execute()
        .then((profile) => {
          if (active) {
            setState({ status: 'success', profile });
          }
        })
        .catch((error: unknown) => {
          if (active) {
            setState({ status: 'error', error: normalizeProfileError(error) });
          }
        });

      return () => {
        active = false;
      };
    }, [requestVersion]),
  );

  const retry = () => {
    if (state.status === 'loading') {
      return;
    }

    setState({ status: 'loading' });
    setRequestVersion((current) => current + 1);
  };

  if (state.status === 'loading') {
    return (
      <ProfileStatusLayout>
        <ActivityIndicator accessibilityLabel="Cargando perfil" color={theme.text} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>Cargando perfil…</Text>
      </ProfileStatusLayout>
    );
  }

  if (state.status === 'error') {
    const errorContent = getProfileErrorContent(state.error.code);

    return (
      <ProfileStatusLayout>
        <Text style={[styles.statusTitle, { color: theme.text }]}>{errorContent.title}</Text>
        <Text style={[styles.statusMessage, { color: theme.textSecondary }]}>
          {errorContent.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : undefined]}>
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </Pressable>
      </ProfileStatusLayout>
    );
  }

  return (
    <ProfileContent
      onEdit={() => {
        router.push('/profile/edit');
      }}
      profile={state.profile}
    />
  );
}

function ProfileContent({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const theme = useTheme();
  const displayName = getDisplayName(profile.displayName);
  const username = getUsername(profile.username);
  const privacyLabel = profile.isPrivate ? 'Cuenta privada' : 'Cuenta pública';

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={{ backgroundColor: theme.background }}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundElement }]}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Perfil</Text>
          <Pressable
            accessibilityLabel="Editar perfil"
            accessibilityRole="button"
            onPress={onEdit}
            style={({ pressed }) => [
              styles.editButton,
              { backgroundColor: theme.backgroundElement },
              pressed ? styles.pressed : undefined,
            ]}>
            <Text style={[styles.editButtonText, { color: theme.text }]}>Editar perfil</Text>
          </Pressable>
        </View>

        <View style={styles.profileContent}>
          <View
            accessibilityLabel={`Avatar de ${displayName}`}
            accessibilityRole="image"
            style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <Text style={[styles.avatarInitial, { color: theme.text }]}>
              {getAvatarInitial(profile)}
            </Text>
          </View>

          <View style={styles.identity}>
            <Text style={[styles.displayName, { color: theme.text }]}>{displayName}</Text>
            <Text style={[styles.username, { color: theme.textSecondary }]}>{username}</Text>
          </View>

          {profile.bio.trim() ? (
            <Text style={[styles.bio, { color: theme.text }]}>{profile.bio}</Text>
          ) : null}

          <View
            accessible
            accessibilityLabel={privacyLabel}
            accessibilityRole="text"
            style={[styles.privacyBadge, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.privacyIndicator,
                { backgroundColor: profile.isPrivate ? theme.textSecondary : '#208AEF' },
              ]}
            />
            <Text style={[styles.privacyText, { color: theme.text }]}>{privacyLabel}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileStatusLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.statusContent}>{children}</View>
    </SafeAreaView>
  );
}

function normalizeProfileError(error: unknown): ProfileError {
  return error instanceof ProfileError ? error : new ProfileError('unavailable');
}

function getProfileErrorContent(code: ProfileErrorCode): { title: string; message: string } {
  if (code === 'authentication-required') {
    return {
      title: 'Tu sesión no está disponible',
      message: 'No pudimos autenticar la solicitud del perfil.',
    };
  }

  if (code === 'profile-not-found') {
    return {
      title: 'No encontramos tu perfil',
      message: 'La configuración de tu perfil todavía no está disponible.',
    };
  }

  if (code === 'invalid-response') {
    return {
      title: 'No pudimos mostrar tu perfil',
      message: 'No pudimos interpretar la información recibida.',
    };
  }

  return {
    title: 'No pudimos cargar tu perfil',
    message: 'Revisa tu conexión e inténtalo de nuevo.',
  };
}

function getDisplayName(displayName: string | null): string {
  return displayName?.trim() || 'Nombre pendiente';
}

function getUsername(username: string | null): string {
  return username?.trim() ? `@${username.trim()}` : 'Username pendiente';
}

function getAvatarInitial(profile: Profile): string {
  const source = profile.displayName?.trim() || profile.username?.trim();
  return source ? Array.from(source)[0].toLocaleUpperCase() : '?';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignSelf: 'center',
    flexGrow: 1,
    paddingBottom: BottomTabInset + Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.select({ web: 82, default: 10 }),
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  editButton: {
    borderRadius: 10,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  profileContent: {
    alignItems: 'center',
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 52,
    height: 104,
    justifyContent: 'center',
    width: 104,
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 48,
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  displayName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 30,
    textAlign: 'center',
  },
  username: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  bio: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 520,
    textAlign: 'center',
  },
  privacyBadge: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  privacyIndicator: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  privacyText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  statusContent: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    paddingBottom: BottomTabInset,
    paddingHorizontal: Spacing.four,
    paddingTop: Platform.select({ web: 82, default: 0 }),
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    textAlign: 'center',
  },
  statusMessage: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 360,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#208AEF',
    borderRadius: 12,
    marginTop: Spacing.one,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.82,
  },
});
