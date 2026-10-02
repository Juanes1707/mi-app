export type FollowRequestErrorCode =
  | 'authentication-required'
  | 'request-not-found'
  | 'already-resolved'
  | 'invalid-request'
  | 'invalid-response'
  | 'unavailable';

export class FollowRequestError extends Error {
  constructor(readonly code: FollowRequestErrorCode) {
    super(getFollowRequestErrorMessage(code));
    this.name = 'FollowRequestError';
  }
}

function getFollowRequestErrorMessage(code: FollowRequestErrorCode): string {
  if (code === 'authentication-required') {
    return 'An authenticated session is required to manage follow requests.';
  }

  if (code === 'request-not-found') {
    return 'The follow request was not found.';
  }

  if (code === 'already-resolved') {
    return 'The follow request has already been resolved.';
  }

  if (code === 'invalid-request') {
    return 'The follow request operation is invalid.';
  }

  if (code === 'invalid-response') {
    return 'The backend returned an invalid follow request response.';
  }

  return 'Follow requests are currently unavailable.';
}
