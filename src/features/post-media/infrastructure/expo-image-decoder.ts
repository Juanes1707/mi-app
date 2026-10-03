import { Image, type ImageRef } from 'expo-image';

import { MAX_DECODED_EDGE_PX } from './post-media-cache-limits';
import type { PostImageDecoder } from './post-image-loader';

// expo-image is used only as a decoder: local file → native bitmap (ImageRef),
// downsampled so the longest edge never exceeds MAX_DECODED_EDGE_PX.
export class ExpoImageDecoder implements PostImageDecoder<ImageRef> {
  async decode(localFileUri: string): Promise<ImageRef> {
    if (!localFileUri.startsWith('file://')) {
      throw new Error('Only local cache files can be decoded.');
    }
    return Image.loadAsync(
      { uri: localFileUri },
      { maxWidth: MAX_DECODED_EDGE_PX, maxHeight: MAX_DECODED_EDGE_PX },
    );
  }
}
