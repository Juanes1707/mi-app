import { File } from 'expo-file-system';

import type { PostMediaDownloader } from './post-image-loader';

// Modern expo-file-system task API. Aborting `signal` makes the task call its
// native `cancel()`; a non-2xx response rejects without producing a final file.
export class ExpoPostMediaDownloader implements PostMediaDownloader {
  async download(url: string, destinationUri: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Post media download was cancelled.');
    const task = File.createDownloadTask(url, new File(destinationUri), {
      // iOS: do not keep transferring feed images after the app is suspended.
      sessionType: 'foreground',
      signal,
    });
    try {
      const file = await task.downloadAsync();
      if (file === null) throw new Error('Post media download did not complete.');
    } finally {
      task.release();
    }
  }
}
