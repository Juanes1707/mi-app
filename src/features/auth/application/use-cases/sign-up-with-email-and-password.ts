import type {
  AuthRepository,
  SignUpCredentials,
  SignUpResult,
} from '@/features/auth/domain/repositories/auth-repository';

export class SignUpWithEmailAndPassword {
  constructor(private readonly authRepository: AuthRepository) {}

  execute({ email, password }: SignUpCredentials): Promise<SignUpResult> {
    return this.authRepository.signUpWithEmailAndPassword({
      email: email.trim(),
      password,
    });
  }
}
