import type { AuthUser } from '@/features/auth/domain/entities/auth-user';
import type { AuthRepository } from '@/features/auth/domain/repositories/auth-repository';

export class GetCurrentAuthUser {
  constructor(private readonly repository: AuthRepository) {}

  execute(): Promise<AuthUser | null> {
    return this.repository.getCurrentUser();
  }
}
