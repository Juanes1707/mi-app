import { useState } from 'react';

import type { SignInWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-in-with-email-and-password';
import type { SignUpWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-up-with-email-and-password';
import { SignInScreen } from '@/features/auth/presentation/screens/sign-in-screen';
import { SignUpScreen } from '@/features/auth/presentation/screens/sign-up-screen';

type AuthMode = 'sign-in' | 'sign-up';

type AuthEntryScreenProps = {
  signInWithEmailAndPassword: SignInWithEmailAndPassword;
  signUpWithEmailAndPassword: SignUpWithEmailAndPassword;
};

export function AuthEntryScreen({
  signInWithEmailAndPassword,
  signUpWithEmailAndPassword,
}: AuthEntryScreenProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');

  if (mode === 'sign-up') {
    return (
      <SignUpScreen
        onRequestSignIn={() => setMode('sign-in')}
        signUpWithEmailAndPassword={signUpWithEmailAndPassword}
      />
    );
  }

  return (
    <SignInScreen
      onRequestSignUp={() => setMode('sign-up')}
      signInWithEmailAndPassword={signInWithEmailAndPassword}
    />
  );
}
