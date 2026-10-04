import { File, FileMode, type FileHandle } from 'expo-file-system';

export type LocalImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type LocalImageFile = { uri: string; contentType: LocalImageContentType; sizeBytes: number };

export function isLocalImageContentType(value: unknown): value is LocalImageContentType {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

// A picked device image: local scheme only, an existing file, and a MIME reported by
// the picker or the file system (not guessed from the extension). null for anything
// else; never throws.
export function inspectLocalImageFile(uri: string, mimeType?: string): LocalImageFile | null {
  try {
    if (!/^(file|content):\/\//i.test(uri)) return null;
    const file = new File(uri);
    if (!file.exists) return null;
    const contentType = mimeType || file.type;
    if (!isLocalImageContentType(contentType)) return null;
    return { uri, contentType, sizeBytes: file.size };
  } catch {
    return null;
  }
}

// The real format from the file's first bytes (JPEG / PNG / WebP signatures), so a
// renamed or mislabeled file is never accepted. null when unreadable or unknown.
export function sniffLocalImageContentType(uri: string): LocalImageContentType | null {
  let handle: FileHandle | null = null;
  try {
    handle = new File(uri).open(FileMode.ReadOnly);
    const head = handle.readBytes(12);
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => head[i] === byte)) {
      return 'image/png';
    }
    if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp';
    return null;
  } catch {
    return null;
  } finally {
    try { handle?.close(); } catch { /* already closed */ }
  }
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}
