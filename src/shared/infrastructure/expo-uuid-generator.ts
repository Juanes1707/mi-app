import { uuid } from 'expo-modules-core';

import type { UuidGenerator } from '@/shared/application/uuid-generator';

// Expo's native, synchronous v4 generator (Android: java.util.UUID.randomUUID, backed
// by SecureRandom). Part of the Expo SDK runtime: no extra dependency, no Math.random.
// The single generator of the app: offline comments and direct messages share it.
export const expoUuidGenerator: UuidGenerator = { generate: () => uuid.v4() };
