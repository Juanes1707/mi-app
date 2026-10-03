type MemoryEntry<TImage> = { image: TImage; bytes: number };

export type DecodedImageDimensions = { width: number; height: number; scale: number };

// Conservative cost of a decoded bitmap: pixel width × pixel height × 4 bytes
// (32-bit RGBA/ARGB). The encoded file size says nothing about RAM usage.
export function estimateDecodedBitmapBytes(image: DecodedImageDimensions): number | null {
  const pixelWidth = image.width * image.scale;
  const pixelHeight = image.height * image.scale;
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) ||
    pixelWidth <= 0 || pixelHeight <= 0) {
    return null;
  }
  const bytes = Math.ceil(pixelWidth) * Math.ceil(pixelHeight) * 4;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

// Level 1: byte-budgeted LRU. A Map iterates in insertion order, so deleting and
// re-inserting on every hit keeps the least recently used entry first.
export class LruMemoryImageCache<TImage> {
  private readonly entries = new Map<string, MemoryEntry<TImage>>();
  private retainedBytes = 0;

  constructor(
    private readonly budgetBytes: number,
    private readonly estimateBytes: (image: TImage) => number | null,
  ) {}

  get totalBytes(): number {
    return this.retainedBytes;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  get(key: string): TImage | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.image;
  }

  // Returns false when the image is not retained (unknown cost or larger than
  // the whole budget). The caller may still render it; the cache just won't keep it.
  set(key: string, image: TImage): boolean {
    this.delete(key);
    const bytes = this.estimateBytes(image);
    if (bytes === null || bytes > this.budgetBytes) return false;
    this.entries.set(key, { image, bytes });
    this.retainedBytes += bytes;
    while (this.retainedBytes > this.budgetBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return true;
  }

  // Drops our only reference. We never call `release()` on the native image:
  // a visible cell may still be rendering it, so its lifetime is left to GC.
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.retainedBytes -= entry.bytes;
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }
}
