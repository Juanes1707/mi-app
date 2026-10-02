import { GetCurrentAuthUser } from '@/features/auth/application/use-cases/get-current-auth-user';
import { SignInWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-in-with-email-and-password';
import { SignUpWithEmailAndPassword } from '@/features/auth/application/use-cases/sign-up-with-email-and-password';
import { WatchAuthState } from '@/features/auth/application/use-cases/watch-auth-state';
import { SupabaseAuthRepository } from '@/features/auth/data/repositories/supabase-auth-repository';

const authRepository = new SupabaseAuthRepository();

export const authProviderDependencies = {
  getCurrentAuthUser: new GetCurrentAuthUser(authRepository),
  watchAuthState: new WatchAuthState(authRepository),
};

export const authEntryScreenDependencies = {
  signInWithEmailAndPassword: new SignInWithEmailAndPassword(authRepository),
  signUpWithEmailAndPassword: new SignUpWithEmailAndPassword(authRepository),
};
