import type { AuthUser } from '@/features/auth/domain/entities/auth-user';
import { AuthenticationError } from '@/features/auth/domain/errors/authentication-error';
import type {
  AuthRepository,
  AuthStateErrorListener,
  AuthStateListener,
  SignInCredentials,
  SignUpCredentials,
  SignUpResult,
} from '@/features/auth/domain/repositories/auth-repository';
import { supabase } from '@/infrastructure/supabase/supabase-client';

export class SupabaseAuthRepository implements AuthRepository {
  getCurrentUser(): Promise<AuthUser | null> {
    return this.getAuthUserFromClaims();
  }

  async signInWithEmailAndPassword({ email, password }: SignInCredentials): Promise<void> {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (!error) {
        return;
      }

      if (error.code === 'invalid_credentials') {
        throw new AuthenticationError('invalid-credentials');
      }

      throw new AuthenticationError('unexpected');
    } catch (error: unknown) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError('unexpected');
    }
  }

  async signUpWithEmailAndPassword({
    email,
    password,
  }: SignUpCredentials): Promise<SignUpResult> {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        if (error.code === 'weak_password' || error.code === 'validation_failed') {
          throw new AuthenticationError('invalid-sign-up-credentials');
        }

        throw new AuthenticationError('unexpected');
      }

      return data.session
        ? { status: 'signed-in' }
        : { status: 'email-confirmation-required' };
    } catch (error: unknown) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError('unexpected');
    }
  }

  subscribeToAuthChanges(
    listener: AuthStateListener,
    onError: AuthStateErrorListener,
  ): () => void {
    let isSubscribed = true;
    let validationVersion = 0;

    const validateAndNotify = (accessToken: string) => {
      const currentVersion = ++validationVersion;

      void Promise.resolve()
        .then(() => this.getAuthUserFromClaims(accessToken))
        .then((user) => {
          if (isSubscribed && currentVersion === validationVersion) {
            listener(user);
          }
        })
        .catch((error: unknown) => {
          if (isSubscribed && currentVersion === validationVersion) {
            onError(this.normalizeError(error));
          }
        });
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isSubscribed) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        validationVersion += 1;
        listener(null);
        return;
      }

      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        event === 'PASSWORD_RECOVERY'
      ) {
        if (!session) {
          validationVersion += 1;
          listener(null);
          return;
        }

        validateAndNotify(session.access_token);
      }
    });

    return () => {
      isSubscribed = false;
      validationVersion += 1;
      data.subscription.unsubscribe();
    };
  }

  private async getAuthUserFromClaims(accessToken?: string): Promise<AuthUser | null> {
    const { data, error } = await supabase.auth.getClaims(accessToken);

    if (error) {
      throw new Error(`Unable to validate the authenticated user: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    const { email, sub } = data.claims;

    if (!sub) {
      throw new Error('The validated access token does not contain a user identifier.');
    }

    return {
      id: sub,
      email: typeof email === 'string' ? email : null,
    };
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    return new Error('An unexpected error occurred while validating authentication.');
  }
}
