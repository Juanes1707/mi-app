export interface AccessTokenProvider {
  getAccessToken(): Promise<string | null>;
}
