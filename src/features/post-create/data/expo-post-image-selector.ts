import { launchImageLibraryAsync } from 'expo-image-picker';
import type { LocalPostImageInspector, PostImageSelector } from '@/features/post-create/domain/ports';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';

export class ExpoPostImageSelector implements PostImageSelector {
  constructor(private readonly inspector: LocalPostImageInspector) {}
  async select() {
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85,
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
