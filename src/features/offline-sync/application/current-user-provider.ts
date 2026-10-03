// The user of the current authenticated session, or null when signed out.
export interface CurrentUserProvider {
  getCurrentUserId(): Promise<string | null>;
}
