import { launchImageLibraryAsync } from 'expo-image-picker';
import type {
  LocalPostImageInspector, PostImageSelectionMode, PostImageSelector,
} from '@/features/post-create/domain/ports';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';

export class ExpoPostImageSelector implements PostImageSelector {
  constructor(private readonly inspector: LocalPostImageInspector) {}
  async select(mode: PostImageSelectionMode) {
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: false,
        allowsEditing: mode === 'crop-square',
        ...(mode === 'crop-square' ? { aspect: [1, 1] as [number, number] } : {}),
        quality: 0.85, exif: false, base64: false,
      });
      if (result.canceled) return null;
      const asset = result.assets[0];
      if (!asset || !asset.uri || (asset.type && asset.type !== 'image')) {
        throw new PostCreateError('invalid-image');
      }
      return this.inspector.inspect(asset.uri, asset.mimeType);
    } catch (error: unknown) {
      throw error instanceof PostCreateError ? error : new PostCreateError('invalid-image');
    }
  }
}
