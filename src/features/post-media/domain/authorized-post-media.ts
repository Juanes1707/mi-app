// A short-lived, backend-issued read capability for exactly one post image.
// It authorizes ONE acquisition: it is never cached, persisted or logged.
export type AuthorizedPostMedia = {
  imagePath: string;
  signedUrl: string;
  expiresInSeconds: number;
};
