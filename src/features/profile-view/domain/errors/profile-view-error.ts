export type ProfileViewErrorCode =
  | 'authentication-required'
  | 'profile-not-found'
  | 'invalid-request'
  | 'invalid-response'
  | 'unavailable';

export class ProfileViewError extends Error {
  constructor(readonly code: ProfileViewErrorCode) {
    super(getProfileViewErrorMessage(code));
    this.name = 'ProfileViewError';
  }
}

function getProfileViewErrorMessage(code: ProfileViewErrorCode): string {
  if (code === 'authentication-required') {
    return 'An authenticated session is required to load the selected profile.';
  }

  if (code === 'profile-not-found') {
    return 'The selected profile was not found.';
  }

  if (code === 'invalid-request') {
    return 'The selected profile request is invalid.';
  }

  if (code === 'invalid-response') {
    return 'The backend returned an invalid selected profile response.';
  }

  return 'The selected profile is currently unavailable.';
}
