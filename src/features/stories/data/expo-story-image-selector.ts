import { launchImageLibraryAsync } from 'expo-image-picker';

import { validateStoryImage } from '@/features/stories/application/story-use-cases';
import type { LocalStoryImage } from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';
import type { StoryImageSelector } from '@/features/stories/domain/stories-repository';
import { inspectLocalImageFile, sniffLocalImageContentType } from '@/shared/infrastructure/local-image-file';

// Static images only, exactly one, no video, no multi-selection. The format must be
// JPEG/PNG/WebP both by the reported MIME and by the file's own signature.
export class ExpoStoryImageSelector implements StoryImageSelector {
  async select(): Promise<LocalStoryImage | null> {
    let result: Awaited<ReturnType<typeof launchImageLibraryAsync>>;
    try {
      result = await launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false,
        quality: 0.85, exif: false, base64: false,
      });
    } catch {
      throw new StoriesError('unavailable');
    }
    if (result.canceled) return null;
    const asset = result.assets.length === 1 ? result.assets[0] : undefined;
    if (!asset || !asset.uri || (asset.type && asset.type !== 'image')) throw new StoriesError('invalid-image');
    const file = inspectLocalImageFile(asset.uri, asset.mimeType);
    if (file === null || sniffLocalImageContentType(asset.uri) !== file.contentType) {
      throw new StoriesError('invalid-image');
    }
    const image: LocalStoryImage = { uri: file.uri, contentType: file.contentType, sizeBytes: file.sizeBytes };
    validateStoryImage(image);
    return image;
  }
}
