import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { Profile } from '@/features/profile/domain/entities/profile';
import { ProfileError, type ProfileErrorCode } from '@/features/profile/domain/errors/profile-error';
import type { ProfileUpdate } from '@/features/profile/domain/models/profile-update';
import { getMyProfile, updateMyProfile } from '@/features/profile/profile-container';
import { useTheme } from '@/hooks/use-theme';

type EditProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile }
  | { status: 'error'; error: ProfileError };

type ProfileForm = {
  username: string;
  displayName: string;
  bio: string;
  isPrivate: boolean;
};

type ProfileFormErrors = {
  username?: string;
  displayName?: string;
  bio?: string;
};

type NormalizedProfileForm = {
  username: string;
  displayName: string | null;
  bio: string;
  isPrivate: boolean;
};

const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;
const MAX_DISPLAY_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 150;
const ERROR_COLOR = '#C62828';
const EMPTY_FORM: ProfileForm = {
  username: '',
  displayName: '',
  bio: '',
  isPrivate: false,
};

export function EditProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isMountedRef = useRef(true);
  const isSavingRef = useRef(false);
  const [state, setState] = useState<EditProfileState>({ status: 'loading' });
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ProfileFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    setState({ status: 'loading' });
    setFieldErrors({});
    setFormError(null);

    void getMyProfile
      .execute()
      .then((profile) => {
        if (!active) {
          return;
        }

        setForm({
          username: profile.username ?? '',
          displayName: profile.displayName ?? '',
          bio: profile.bio,
          isPrivate: profile.isPrivate,
        });
        setState({ status: 'ready', profile });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: 'error', error: normalizeProfileError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [requestVersion]);

  const normalizedForm = normalizeForm(form);
  const pendingUpdate =
    state.status === 'ready' ? buildProfileUpdate(state.profile, normalizedForm) : {};
  const hasChanges = hasProfileUpdate(pendingUpdate);

  const retry = () => {
    if (state.status === 'loading') {
      return;
    }

    setRequestVersion((current) => current + 1);
  };

  const handleSave = async () => {
    if (state.status !== 'ready' || isSavingRef.current) {
      return;
    }

    const nextNormalizedForm = normalizeForm(form);
    const nextFieldErrors = validateForm(nextNormalizedForm);

    setFieldErrors(nextFieldErrors);
    setFormError(null);

    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    const update = buildProfileUpdate(state.profile, nextNormalizedForm);

    if (!hasProfileUpdate(update)) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      await updateMyProfile.execute(update);
    } catch (error: unknown) {
      if (!isMountedRef.current) {
        return;
      }

      const profileError = normalizeProfileError(error);

      if (profileError.code === 'username-taken') {
        setFieldErrors({ username: 'Ese username ya está en uso.' });
      } else {
        setFormError(getSubmitErrorMessage(profileError.code));
      }

      return;
    } finally {
      isSavingRef.current = false;

      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }

    if (isMountedRef.current) {
      router.back();
    }
  };

  if (state.status === 'loading') {
    return (
      <EditProfileStatusLayout>
        <ActivityIndicator accessibilityLabel="Cargando perfil" color={theme.text} size="large" />
        <Text style={[styles.statusTitle, { color: theme.text }]}>Cargando perfil…</Text>
      </EditProfileStatusLayout>
    );
  }

  if (state.status === 'error') {
    return (
      <EditProfileStatusLayout>
        <Text style={[styles.statusTitle, { color: theme.text }]}>No pudimos cargar tu perfil</Text>
        <Text style={[styles.statusMessage, { color: theme.textSecondary }]}>
          {getLoadErrorMessage(state.error.code)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : undefined]}>
          <Text style={styles.primaryButtonText}>Reintentar</Text>
        </Pressable>
      </EditProfileStatusLayout>
    );
  }

  const saveDisabled = !hasChanges || isSaving;

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: theme.background }}>
          <View style={styles.form}>
            <Text style={[styles.intro, { color: theme.textSecondary }]}>
              Actualiza la información visible de tu perfil.
            </Text>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.text }]}>Username</Text>
              <TextInput
                accessibilityLabel="Username"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSaving}
                onChangeText={(username) => {
                  setForm((current) => ({ ...current, username }));
                  setFieldErrors((current) => ({ ...current, username: undefined }));
                  setFormError(null);
                }}
                placeholder="username"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: fieldErrors.username
                      ? ERROR_COLOR
                      : theme.backgroundSelected,
                    color: theme.text,
                  },
                ]}
                value={form.username}
              />
              {fieldErrors.username ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {fieldErrors.username}
                </Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.text }]}>Nombre</Text>
              <TextInput
                accessibilityLabel="Nombre"
                editable={!isSaving}
                onChangeText={(displayName) => {
                  setForm((current) => ({ ...current, displayName }));
                  setFieldErrors((current) => ({ ...current, displayName: undefined }));
                  setFormError(null);
                }}
                placeholder="Nombre visible"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: fieldErrors.displayName
                      ? ERROR_COLOR
                      : theme.backgroundSelected,
                    color: theme.text,
                  },
                ]}
                value={form.displayName}
              />
              {fieldErrors.displayName ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {fieldErrors.displayName}
                </Text>
              ) : null}
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.text }]}>Biografía</Text>
                <Text
                  style={[
                    styles.counter,
                    {
                      color:
                        normalizedForm.bio.length > MAX_BIO_LENGTH
                          ? ERROR_COLOR
                          : theme.textSecondary,
                    },
                  ]}>
                  {normalizedForm.bio.length} / {MAX_BIO_LENGTH}
                </Text>
              </View>
              <TextInput
                accessibilityLabel="Biografía"
                editable={!isSaving}
                multiline
                onChangeText={(bio) => {
                  setForm((current) => ({ ...current, bio }));
                  setFieldErrors((current) => ({ ...current, bio: undefined }));
                  setFormError(null);
                }}
                placeholder="Cuéntanos sobre ti"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  styles.bioInput,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: fieldErrors.bio
                      ? ERROR_COLOR
                      : theme.backgroundSelected,
                    color: theme.text,
                  },
                ]}
                textAlignVertical="top"
                value={form.bio}
              />
              {fieldErrors.bio ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {fieldErrors.bio}
                </Text>
              ) : null}
            </View>

            <View
              style={[
                styles.privacyCard,
                { backgroundColor: theme.backgroundElement },
              ]}>
              <View style={styles.privacyCopy}>
                <Text style={[styles.label, { color: theme.text }]}>Cuenta privada</Text>
                <Text style={[styles.helperText, { color: theme.textSecondary }]}>
                  Solo las personas aprobadas podrán ver tu contenido privado.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Cuenta privada"
                disabled={isSaving}
                onValueChange={(isPrivate) => {
                  setForm((current) => ({ ...current, isPrivate }));
                  setFormError(null);
                }}
                trackColor={{ false: theme.backgroundSelected, true: '#75BFFF' }}
                value={form.isPrivate}
              />
            </View>

            {formError ? (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {formError}
              </Text>
            ) : null}

            <Pressable
              accessibilityLabel="Guardar cambios"
              accessibilityRole="button"
              disabled={saveDisabled}
              onPress={() => void handleSave()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && !saveDisabled ? styles.pressed : undefined,
                saveDisabled ? styles.buttonDisabled : undefined,
              ]}>
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text style={styles.primaryButtonText}>
                {isSaving ? 'Guardando…' : 'Guardar'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EditProfileStatusLayout({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={styles.statusContent}>{children}</View>
    </SafeAreaView>
  );
}

function normalizeForm(form: ProfileForm): NormalizedProfileForm {
  const displayName = form.displayName.trim();

  return {
    username: form.username.trim().toLowerCase(),
    displayName: displayName || null,
    bio: form.bio.trim(),
    isPrivate: form.isPrivate,
  };
}

function buildProfileUpdate(
  profile: Profile,
  form: NormalizedProfileForm,
): ProfileUpdate {
  const update: ProfileUpdate = {};

  if (form.username !== normalizeUsername(profile.username)) {
    update.username = form.username;
  }

  if (form.displayName !== normalizeDisplayName(profile.displayName)) {
    update.displayName = form.displayName;
  }

  if (form.bio !== profile.bio.trim()) {
    update.bio = form.bio;
  }

  if (form.isPrivate !== profile.isPrivate) {
    update.isPrivate = form.isPrivate;
  }

  return update;
}

function validateForm(form: NormalizedProfileForm): ProfileFormErrors {
  const errors: ProfileFormErrors = {};

  if (!USERNAME_PATTERN.test(form.username)) {
    errors.username =
      'El username debe tener entre 3 y 30 caracteres y usar solo letras, números, punto o _.';
  }

  if (form.displayName !== null && form.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.displayName = 'El nombre debe tener máximo 50 caracteres.';
  }

  if (form.bio.length > MAX_BIO_LENGTH) {
    errors.bio = 'La biografía debe tener máximo 150 caracteres.';
  }

  return errors;
}

function hasProfileUpdate(update: ProfileUpdate): boolean {
  return Object.keys(update).length > 0;
}

function normalizeUsername(username: string | null): string {
  return (username ?? '').trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | null): string | null {
  return displayName?.trim() || null;
}

function normalizeProfileError(error: unknown): ProfileError {
  return error instanceof ProfileError ? error : new ProfileError('unavailable');
}

function getLoadErrorMessage(code: ProfileErrorCode): string {
  if (code === 'authentication-required') {
    return 'Tu sesión ya no está disponible.';
  }

  if (code === 'profile-not-found') {
    return 'No encontramos tu perfil.';
  }

  if (code === 'invalid-response') {
    return 'No pudimos interpretar la respuesta del servidor.';
  }

  return 'No pudimos cargar tu perfil. Revisa tu conexión e inténtalo de nuevo.';
}

function getSubmitErrorMessage(code: ProfileErrorCode): string {
  if (code === 'invalid-update') {
    return 'Revisa los datos ingresados.';
  }

  if (code === 'authentication-required') {
    return 'Tu sesión ya no está disponible.';
  }

  if (code === 'profile-not-found') {
    return 'No encontramos tu perfil.';
  }

  if (code === 'invalid-response') {
    return 'No pudimos interpretar la respuesta del servidor.';
  }

  return 'No pudimos guardar los cambios. Revisa tu conexión e inténtalo de nuevo.';
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardArea: {
    flex: 1,
  },
  scrollContent: {
    alignSelf: 'center',
    flexGrow: 1,
    padding: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  form: {
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 560,
    width: '100%',
  },
  intro: {
    fontSize: 15,
    lineHeight: 22,
  },
  field: {
    gap: Spacing.two,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  counter: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  bioInput: {
    minHeight: 120,
  },
  privacyCard: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: Spacing.three,
    justifyContent: 'space-between',
    padding: Spacing.three,
  },
  privacyCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  helperText: {
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: ERROR_COLOR,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: Spacing.four,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.82,
  },
  statusContent: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.three,
    justifyContent: 'center',
    padding: Spacing.four,
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
});
