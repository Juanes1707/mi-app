export type ProfileErrorCode =
  | 'profile-not-found'
  | 'authentication-required'
  | 'username-taken'
  | 'invalid-update'
  | 'invalid-response'
  | 'unavailable';

export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode) {
    super(getProfileErrorMessage(code));
    this.name = 'ProfileError';
  }
}

function getProfileErrorMessage(code: ProfileErrorCode): string {
  if (code === 'profile-not-found') {
    return 'The authenticated user does not have a profile.';
  }

  if (code === 'authentication-required') {
    return 'An authenticated session is required to load the profile.';
  }

  if (code === 'username-taken') {
    return 'The selected username is already in use.';
  }

  if (code === 'invalid-update') {
    return 'The profile update is invalid.';
  }

  if (code === 'invalid-response') {
    return 'The backend returned an invalid profile response.';
  }

  return 'The profile is currently unavailable.';
}
