export type FollowErrorCode =
  | 'authentication-required'
  | 'profile-not-found'
  | 'profile-not-ready'
  | 'cannot-follow-self'
  | 'invalid-request'
  | 'invalid-response'
  | 'unavailable';

export class FollowError extends Error {
  constructor(readonly code: FollowErrorCode) {
    super(getFollowErrorMessage(code));
    this.name = 'FollowError';
  }
}

function getFollowErrorMessage(code: FollowErrorCode): string {
  if (code === 'authentication-required') {
    return 'An authenticated session is required to follow a profile.';
  }

  if (code === 'profile-not-found') {
    return 'The target profile was not found.';
  }

  if (code === 'profile-not-ready') {
    return 'The authenticated profile is not ready.';
  }

  if (code === 'cannot-follow-self') {
    return 'A profile cannot follow itself.';
  }

  if (code === 'invalid-request') {
    return 'The follow request is invalid.';
  }

  if (code === 'invalid-response') {
    return 'The backend returned an invalid follow response.';
  }

  return 'The follow operation is currently unavailable.';
}
