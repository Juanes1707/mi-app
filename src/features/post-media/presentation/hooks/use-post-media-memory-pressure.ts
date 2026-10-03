import { useEffect } from 'react';

import { bindPostMediaMemoryPressure } from '@/features/post-media/post-media-container';

export function usePostMediaMemoryPressure(): void {
  useEffect(() => bindPostMediaMemoryPressure(), []);
}
