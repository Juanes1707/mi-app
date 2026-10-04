export interface UuidGenerator {
  // A random (v4) UUID in canonical lowercase form, produced synchronously.
  generate(): string;
}
