import { File } from 'expo-file-system';

import type { PostMediaDownloader } from './post-image-loader';

function cancelledError(): Error {
  return new Error('Post media download was cancelled.');
}

// Modern expo-file-system task API. Aborting `signal` makes the task call its
// native `cancel()`; a non-2xx response rejects without producing a final file.
export class ExpoPostMediaDownloader implements PostMediaDownloader {
  async download(url: string, destinationUri: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw cancelledError();
    const task = File.createDownloadTask(url, new File(destinationUri), {
      // iOS: do not keep transferring feed images after the app is suspended.
      // Android ignores this option.
      sessionType: 'foreground',
      signal,
    });
    const downloading = task.downloadAsync();
    // The losing side of the race below must not surface as an unhandled rejection.
    downloading.catch(() => undefined);

    // Android (expo-file-system 57.0.7): a cancel observed between two reads returns
    // from the copy loop without settling the native promise, so `downloadAsync()`
    // may never settle after an abort. Settle on the abort ourselves so the caller
    // always reaches its `.part` cleanup.
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(cancelledError());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const file = await Promise.race([downloading, aborted]);
      if (file === null) throw new Error('Post media download did not complete.');
    } finally {
      signal.removeEventListener('abort', onAbort);
      task.release();
    }
  }
}
