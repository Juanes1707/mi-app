let version = 0;

export function invalidateFeed(): void {
  version += 1;
}

export function getFeedInvalidationVersion(): number {
  return version;
}
