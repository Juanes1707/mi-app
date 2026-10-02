import type { AuthUser } from '@/features/auth/domain/entities/auth-user';

export type AuthStateListener = (user: AuthUser | null) => void;
export type AuthStateErrorListener = (error: Error) => void;
export type SignInCredentials = {
  email: string;
  password: string;
};
export type SignUpCredentials = {
  email: string;
  password: string;
};
export type SignUpResult =
  | { status: 'signed-in' }
  | { status: 'email-confirmation-required' };

export interface AuthRepository {
  getCurrentUser(): Promise<AuthUser | null>;
  signInWithEmailAndPassword(credentials: SignInCredentials): Promise<void>;
  signUpWithEmailAndPassword(credentials: SignUpCredentials): Promise<SignUpResult>;
  subscribeToAuthChanges(
    listener: AuthStateListener,
    onError: AuthStateErrorListener,
  ): () => void;
}
