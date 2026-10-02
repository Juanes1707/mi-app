import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { FollowError, type FollowErrorCode } from '@/features/follow/domain/errors/follow-error';
import { requestFollow } from '@/features/follow/follow-container';
import type { ViewedProfile } from '@/features/profile-view/domain/entities/viewed-profile';
import {
  ProfileViewError,
  type ProfileViewErrorCode,
} from '@/features/profile-view/domain/errors/profile-view-error';
import { getProfileView } from '@/features/profile-view/profile-view-container';
import { useTheme } from '@/hooks/use-theme';

type ProfileViewScreenProps = {
  profileId: string;
};

type ProfileViewScreenState =
  | { status: 'loading' }
  | { status: 'success'; profile: ViewedProfile }
  | { status: 'error'; error: ProfileViewError };

export function ProfileViewScreen({ profileId }: ProfileViewScreenProps) {
  const theme = useTheme();
  const isMountedRef = useRef(true);
  const currentRouteProfileIdRef = useRef(profileId);
  const loadGenerationRef = useRef(0);
  const followGenerationRef = useRef(0);
  const followInFlightRef = useRef(false);
  const visibleProfileIdRef = useRef<string | null>(null);
  const [state, setState] = useState<ProfileViewScreenState>({ status: 'loading' });
  const [loadVersion, setLoadVersion] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followErrorMessage, setFollowErrorMessage] = useState<string | null>(null);

  currentRouteProfileIdRef.current = profileId;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      loadGenerationRef.current += 1;
      followGenerationRef.current += 1;
      followInFlightRef.current = false;
      visibleProfileIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;
    followGenerationRef.current += 1;
    followInFlightRef.current = false;
    visibleProfileIdRef.current = null;

    setState({ status: 'loading' });
    setIsFollowing(false);
    setFollowErrorMessage(null);

    void getProfileView
      .execute(profileId)
      .then((profile) => {
        if (
          !active ||
          !isMountedRef.current ||
          currentRouteProfileIdRef.current !== profileId ||
          loadGenerationRef.current !== loadGeneration
        ) {
          return;
        }

        visibleProfileIdRef.current = profile.id;
        setState({ status: 'success', profile });
      })
      .catch((error: unknown) => {
        if (
          !active ||
          !isMountedRef.current ||
          currentRouteProfileIdRef.current !== profileId ||
          loadGenerationRef.current !== loadGeneration
        ) {
          return;
        }

        setState({ status: 'error', error: normalizeProfileViewError(error) });
      });

    return () => {
      active = false;
    };
  }, [loadVersion, profileId]);

  const retry = () => {
    if (state.status === 'loading') {
      return;
    }

    setLoadVersion((current) => current + 1);
  };

  const handleFollow = async () => {
    if (
      state.status !== 'success' ||
      state.profile.isSelf ||
      state.profile.relationship.status !== 'none' ||
      followInFlightRef.current
    ) {
      return;
    }

    const targetProfileId = state.profile.id;
    const routeProfileId = profileId;
    const followGeneration = followGenerationRef.current + 1;
    followGenerationRef.current = followGeneration;
    followInFlightRef.current = true;
    setIsFollowing(true);
    setFollowErrorMessage(null);

    try {
      const result = await requestFollow.execute(targetProfileId);

      if (
        !isCurrentFollowTarget(
          followGeneration,
          targetProfileId,
          routeProfileId,
          isMountedRef,
          currentRouteProfileIdRef,
          followGenerationRef,
          visibleProfileIdRef,
        )
      ) {
        return;
      }

      setState((current) => {
        if (
          current.status !== 'success' ||
          current.profile.id !== targetProfileId
        ) {
          return current;
        }

        return {
          status: 'success',
          profile: {
            ...current.profile,
            relationship:
              result.status === 'following'
                ? { status: 'following' }
                : {
                    status: 'request-pending',
                    requestId: result.requestId,
                  },
          },
        };
      });
    } catch (error: unknown) {
      if (
        !isCurrentFollowTarget(
          followGeneration,
          targetProfileId,
          routeProfileId,
          isMountedRef,
          currentRouteProfileIdRef,
          followGenerationRef,
          visibleProfileIdRef,
        )
      ) {
        return;
      }

      const followError = normalizeFollowError(error);

      if (followError.code === 'profile-not-found') {
        visibleProfileIdRef.current = null;
        setState({
          status: 'error',
          error: new ProfileViewError('profile-not-found'),
        });
        return;
      }

      setFollowErrorMessage(getFollowErrorMessage(followError.code));
    } finally {
      if (followGenerationRef.current === followGeneration) {
        followInFlightRef.current = false;

        if (
          isMountedRef.current &&
          visibleProfileIdRef.current === targetProfileId
        ) {
          setIsFollowing(false);
        }
      }
    }
  };

  if (state.status === 'loading') {
    return (
      <ProfileViewStatusLayout>
        <ActivityIndicator
          accessibilityLabel="Cargando perfil"
          color={theme.text}
          size="large"
        />
        <Text style={[styles.statusTitle, { color: theme.text }]}>Cargando perfil...</Text>
      </ProfileViewStatusLayout>
    );
  }

  if (state.status === 'error') {
    const errorMessage = getLoadErrorMessage(state.error.code);

    return (
      <ProfileViewStatusLayout>
        <Text style={[styles.statusTitle, { color: theme.text }]}>{errorMessage}</Text>
        {canRetryLoadError(state.error.code) ? (
          <Pressable
            accessibilityRole="button"
            onPress={retry}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed ? styles.pressed : undefined,
            ]}>
            <Text style={styles.primaryButtonText}>Reintentar</Text>
          </Pressable>
        ) : null}
      </ProfileViewStatusLayout>
    );
  }

  const profile = state.profile;
  const visibleName = getVisibleName(profile);
  const username = getVisibleUsername(profile);
  const privacyLabel = profile.isPrivate ? 'Cuenta privada' : 'Cuenta pública';

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: theme.background }}>
        <View style={styles.profileContent}>
          <View
            accessibilityLabel={`Avatar de ${visibleName}`}
            accessibilityRole="image"
            style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <Text style={[styles.avatarInitial, { color: theme.text }]}>
              {getAvatarInitial(profile)}
            </Text>
          </View>

          <View style={styles.identity}>
            <Text style={[styles.displayName, { color: theme.text }]}>{visibleName}</Text>
            {username ? (
              <Text style={[styles.username, { color: theme.textSecondary }]}>{username}</Text>
            ) : null}
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
                {
                  backgroundColor: profile.isPrivate
                    ? theme.textSecondary
                    : '#208AEF',
                },
              ]}
            />
            <Text style={[styles.privacyText, { color: theme.text }]}>{privacyLabel}</Text>
          </View>

          <RelationshipControl
            isFollowing={isFollowing}
            onFollow={handleFollow}
            profile={profile}
            visibleName={visibleName}
          />

          {followErrorMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.actionError}>
              {followErrorMessage}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RelationshipControl({
  profile,
  visibleName,
  isFollowing,
  onFollow,
}: {
  profile: ViewedProfile;
  visibleName: string;
  isFollowing: boolean;
  onFollow: () => void;
}) {
  const theme = useTheme();

  if (profile.isSelf) {
    return (
      <View style={[styles.relationshipStatus, { backgroundColor: theme.backgroundElement }]}>
        <Text style={[styles.relationshipStatusText, { color: theme.text }]}>Este es tu perfil.</Text>
      </View>
    );
  }

  if (profile.relationship.status === 'none') {
    return (
      <Pressable
        accessibilityLabel={`Seguir a ${visibleName}`}
        accessibilityRole="button"
        disabled={isFollowing}
        onPress={onFollow}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && !isFollowing ? styles.pressed : undefined,
          isFollowing ? styles.disabled : undefined,
        ]}>
        {isFollowing ? (
          <View style={styles.followingContent}>
            <ActivityIndicator color="#FFFFFF" size="small" />
            <Text style={styles.primaryButtonText}>Siguiendo...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>Seguir</Text>
        )}
      </Pressable>
    );
  }

  const relationshipLabel =
    profile.relationship.status === 'following' ? 'Siguiendo' : 'Solicitado';

  return (
    <View style={[styles.relationshipStatus, { backgroundColor: theme.backgroundElement }]}>
      <Text style={[styles.relationshipStatusText, { color: theme.text }]}>
        {relationshipLabel}
      </Text>
    </View>
  );
}

function ProfileViewStatusLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.statusContent}>{children}</View>
    </SafeAreaView>
  );
}

function isCurrentFollowTarget(
  followGeneration: number,
  targetProfileId: string,
  routeProfileId: string,
  isMountedRef: React.RefObject<boolean>,
  currentRouteProfileIdRef: React.RefObject<string>,
  followGenerationRef: React.RefObject<number>,
  visibleProfileIdRef: React.RefObject<string | null>,
): boolean {
  return (
    isMountedRef.current &&
    currentRouteProfileIdRef.current === routeProfileId &&
    followGenerationRef.current === followGeneration &&
    visibleProfileIdRef.current === targetProfileId
  );
}

function normalizeProfileViewError(error: unknown): ProfileViewError {
  return error instanceof ProfileViewError
    ? error
    : new ProfileViewError('unavailable');
}

function normalizeFollowError(error: unknown): FollowError {
  return error instanceof FollowError ? error : new FollowError('unavailable');
}

function getLoadErrorMessage(code: ProfileViewErrorCode): string {
  if (code === 'authentication-required') {
    return 'Tu sesión no está disponible.';
  }

  if (code === 'profile-not-found') {
    return 'No encontramos este perfil.';
  }

  if (code === 'invalid-request') {
    return 'El perfil solicitado no es válido.';
  }

  if (code === 'invalid-response') {
    return 'No pudimos interpretar la información del perfil.';
  }

  return 'No pudimos cargar el perfil. Revisa tu conexión e inténtalo de nuevo.';
}

function canRetryLoadError(code: ProfileViewErrorCode): boolean {
  return (
    code === 'authentication-required' ||
    code === 'invalid-response' ||
    code === 'unavailable'
  );
}

function getFollowErrorMessage(code: FollowErrorCode): string {
  if (code === 'authentication-required') {
    return 'Tu sesión no está disponible.';
  }

  if (code === 'profile-not-ready') {
    return 'Tu perfil todavía no está listo para realizar esta acción.';
  }

  if (code === 'cannot-follow-self') {
    return 'No puedes seguir tu propio perfil.';
  }

  if (code === 'invalid-request') {
    return 'No pudimos procesar la solicitud.';
  }

  if (code === 'invalid-response') {
    return 'Recibimos una respuesta inesperada del servidor.';
  }

  return 'No pudimos seguir este perfil. Revisa tu conexión e inténtalo de nuevo.';
}

function getVisibleName(profile: ViewedProfile): string {
  return profile.displayName?.trim() || profile.username?.trim() || 'Usuario';
}

function getVisibleUsername(profile: ViewedProfile): string | null {
  const username = profile.username?.trim();
  return username ? `@${username}` : null;
}

function getAvatarInitial(profile: ViewedProfile): string {
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
    maxWidth: MaxContentWidth,
    paddingBottom: Spacing.five,
    width: '100%',
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 136,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  followingContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  relationshipStatus: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 136,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  relationshipStatusText: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  actionError: {
    color: '#C62828',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 420,
    textAlign: 'center',
  },
  statusContent: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    maxWidth: 420,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.62,
  },
});
