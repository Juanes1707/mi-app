export type AuthenticationErrorCode =
  | 'invalid-credentials'
  | 'invalid-sign-up-credentials'
  | 'unexpected';

export class AuthenticationError extends Error {
  constructor(readonly code: AuthenticationErrorCode) {
    super(getAuthenticationErrorMessage(code));
    this.name = 'AuthenticationError';
  }
}

function getAuthenticationErrorMessage(code: AuthenticationErrorCode): string {
  if (code === 'invalid-credentials') {
    return 'The email or password is incorrect.';
  }

  if (code === 'invalid-sign-up-credentials') {
    return 'The sign-up credentials do not satisfy the authentication requirements.';
  }

  return 'Authentication could not be completed.';
}
