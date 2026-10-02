import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SignUpWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-up-with-email-and-password';
import { AuthenticationError } from '@/features/auth/domain/errors/authentication-error';
import { useTheme } from '@/hooks/use-theme';

type SignUpScreenProps = {
  signUpWithEmailAndPassword: SignUpWithEmailAndPassword;
  onRequestSignIn: () => void;
};

export function SignUpScreen({
  signUpWithEmailAndPassword,
  onRequestSignIn,
}: SignUpScreenProps) {
  const theme = useTheme();
  const isSubmittingRef = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  const handleSignUp = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    if (!email.trim() || !password || !confirmPassword) {
      setErrorMessage('Completa el correo, la contraseña y su confirmación.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await signUpWithEmailAndPassword.execute({ email, password });

      setPassword('');
      setConfirmPassword('');

      if (result.status === 'email-confirmation-required') {
        setConfirmationRequired(true);
      }
    } catch (error: unknown) {
      if (
        error instanceof AuthenticationError &&
        error.code === 'invalid-sign-up-credentials'
      ) {
        setErrorMessage(
          'Revisa el correo y usa una contraseña que cumpla los requisitos de seguridad.',
        );
      } else {
        setErrorMessage('No pudimos crear la cuenta. Inténtalo de nuevo.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (confirmationRequired) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
        <View style={styles.confirmationContent}>
          <View style={styles.confirmationIcon}>
            <Text style={styles.confirmationIconText}>✓</Text>
          </View>
          <Text style={[styles.title, styles.centeredText, { color: theme.text }]}>
            Revisa tu correo
          </Text>
          <Text style={[styles.subtitle, styles.centeredText, { color: theme.textSecondary }]}>
            Te enviamos un enlace de confirmación. Confirma tu cuenta y luego vuelve para iniciar
            sesión.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRequestSignIn}
            style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : undefined]}>
            <Text style={styles.buttonText}>Volver a iniciar sesión</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <View style={styles.heading}>
              <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>INSTAGRAM MÓVIL</Text>
              <Text style={[styles.title, { color: theme.text }]}>Crea tu cuenta</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Registra tu identidad con correo y contraseña.
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: theme.text }]}>Correo electrónico</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="correo@ejemplo.com"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="next"
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.backgroundSelected,
                      color: theme.text,
                    },
                  ]}
                  textContentType="emailAddress"
                  value={email}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: theme.text }]}>Contraseña</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={setPassword}
                  placeholder="Tu contraseña"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="next"
                  secureTextEntry
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.backgroundSelected,
                      color: theme.text,
                    },
                  ]}
                  textContentType="newPassword"
                  value={password}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: theme.text }]}>Confirmar contraseña</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={setConfirmPassword}
                  onSubmitEditing={() => void handleSignUp()}
                  placeholder="Repite tu contraseña"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                  secureTextEntry
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.backgroundSelected,
                      color: theme.text,
                    },
                  ]}
                  textContentType="newPassword"
                  value={confirmPassword}
                />
              </View>

              {errorMessage ? (
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  {errorMessage}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={() => void handleSignUp()}
                style={({ pressed }) => [
                  styles.button,
                  pressed && !isSubmitting ? styles.buttonPressed : undefined,
                  isSubmitting ? styles.buttonDisabled : undefined,
                ]}>
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>
                  {isSubmitting ? 'Creando cuenta…' : 'Crear cuenta'}
                </Text>
              </Pressable>

              <View style={styles.authSwitch}>
                <Text style={[styles.authSwitchText, { color: theme.textSecondary }]}>
                  ¿Ya tienes cuenta?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={onRequestSignIn}>
                  <Text style={styles.authSwitchAction}>Iniciar sesión</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignSelf: 'center',
    gap: 32,
    maxWidth: 420,
    width: '100%',
  },
  heading: {
    gap: 8,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.8,
    lineHeight: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
  },
  form: {
    gap: 18,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  errorText: {
    color: '#C62828',
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  authSwitch: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  authSwitchText: {
    fontSize: 14,
    lineHeight: 20,
  },
  authSwitchAction: {
    color: '#208AEF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  confirmationContent: {
    alignItems: 'center',
    alignSelf: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
  confirmationIcon: {
    alignItems: 'center',
    backgroundColor: '#E5F6EC',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    marginBottom: 6,
    width: 56,
  },
  confirmationIconText: {
    color: '#16813C',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
  },
  centeredText: {
    textAlign: 'center',
  },
});
