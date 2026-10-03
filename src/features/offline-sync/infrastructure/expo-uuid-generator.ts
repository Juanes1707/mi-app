import { uuid } from 'expo-modules-core';

import type { UuidGenerator } from '@/features/offline-sync/application/post-comment-use-cases';

// Expo's native, synchronous v4 generator (Android: java.util.UUID.randomUUID, backed
// by SecureRandom). Part of the Expo SDK runtime: no extra dependency, no Math.random.
export const expoUuidGenerator: UuidGenerator = {
  generate: () => uuid.v4(),
};
