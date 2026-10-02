import type {
  AuthRepository,
  SignInCredentials,
} from '@/features/auth/domain/repositories/auth-repository';

export class SignInWithEmailAndPassword {
  constructor(private readonly authRepository: AuthRepository) {}

  execute({ email, password }: SignInCredentials): Promise<void> {
    return this.authRepository.signInWithEmailAndPassword({
      email: email.trim(),
      password,
    });
  }
}
