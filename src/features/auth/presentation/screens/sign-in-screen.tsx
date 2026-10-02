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

import type { SignInWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-in-with-email-and-password';
import { AuthenticationError } from '@/features/auth/domain/errors/authentication-error';
import { useTheme } from '@/hooks/use-theme';

type SignInScreenProps = {
  signInWithEmailAndPassword: SignInWithEmailAndPassword;
  onRequestSignUp: () => void;
};

export function SignInScreen({
  signInWithEmailAndPassword,
  onRequestSignUp,
}: SignInScreenProps) {
  const theme = useTheme();
  const isSubmittingRef = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    if (!email.trim() || !password) {
      setErrorMessage('Ingresa tu correo y contraseña.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await signInWithEmailAndPassword.execute({ email, password });
    } catch (error: unknown) {
      if (error instanceof AuthenticationError && error.code === 'invalid-credentials') {
        setErrorMessage('Correo o contraseña incorrectos.');
      } else {
        setErrorMessage('No pudimos iniciar sesión. Inténtalo de nuevo.');
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

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
              <Text style={[styles.title, { color: theme.text }]}>Inicia sesión</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Accede con tu cuenta existente.
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
                  autoComplete="current-password"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={setPassword}
                  onSubmitEditing={() => void handleSignIn()}
                  placeholder="Tu contraseña"
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
                  textContentType="password"
                  value={password}
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
                onPress={() => void handleSignIn()}
                style={({ pressed }) => [
                  styles.button,
                  pressed && !isSubmitting ? styles.buttonPressed : undefined,
                  isSubmitting ? styles.buttonDisabled : undefined,
                ]}>
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.buttonText}>
                  {isSubmitting ? 'Iniciando sesión…' : 'Iniciar sesión'}
                </Text>
              </Pressable>

              <View style={styles.authSwitch}>
                <Text style={[styles.authSwitchText, { color: theme.textSecondary }]}>
                  ¿No tienes cuenta?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={onRequestSignUp}>
                  <Text style={styles.authSwitchAction}>Crear cuenta</Text>
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
    gap: 36,
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
});
