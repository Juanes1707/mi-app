export type ProfileSearchErrorCode =
  | 'authentication-required'
  | 'invalid-query'
  | 'invalid-response'
  | 'unavailable';

const messages: Record<ProfileSearchErrorCode, string> = {
  'authentication-required': 'An authenticated session is required to search profiles.',
  'invalid-query': 'The search query is invalid.',
  'invalid-response': 'The profile search response is invalid.',
  unavailable: 'Profile search is currently unavailable.',
};

export class ProfileSearchError extends Error {
  constructor(readonly code: ProfileSearchErrorCode) {
    super(messages[code]);
    this.name = 'ProfileSearchError';
  }
}
