import { Directory, File, Paths } from 'expo-file-system';

import type { DiskCacheFileSystem, DiskDirectoryEntry } from './disk-image-cache';

const TEMP_SUFFIX = '.tmp';

function assertEntryName(name: string): void {
  if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Cache entry names must be bare names inside the managed directory.');
  }
}

// Confined to `Paths.cache/<directoryName>`: the OS may purge it, and nothing
// outside it is ever listed, written or deleted.
export class ExpoDiskCacheFileSystem implements DiskCacheFileSystem {
  constructor(private readonly directoryName: string) {
    assertEntryName(directoryName);
  }

  ensureDirectory(): void {
    const directory = this.directory();
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  }

  resetDirectory(): void {
    const directory = this.directory();
    if (directory.exists) directory.delete();
    directory.create({ intermediates: true, idempotent: true });
  }

  listEntries(): DiskDirectoryEntry[] {
    return this.directory().list().map((entry) => ({
      name: entry.name,
      isDirectory: entry instanceof Directory,
    }));
  }

  deleteEntry(entry: DiskDirectoryEntry): void {
    assertEntryName(entry.name);
    const target = entry.isDirectory
      ? new Directory(this.directory(), entry.name)
      : new File(this.directory(), entry.name);
    if (target.exists) target.delete();
  }

  async readText(name: string): Promise<string | null> {
    const file = this.file(name);
    return file.exists ? file.text() : null;
  }

  async writeTextAtomically(name: string, content: string): Promise<void> {
    const temp = this.file(`${name}${TEMP_SUFFIX}`);
    temp.write(content);
    await temp.move(this.file(name), { overwrite: true });
  }

  fileSize(name: string): number | null {
    try {
      const file = this.file(name);
      if (!file.exists) return null;
      const size = file.size;
      return Number.isSafeInteger(size) ? size : null;
    } catch {
      return null;
    }
  }

  async moveReplacing(fromName: string, toName: string): Promise<void> {
    await this.file(fromName).move(this.file(toName), { overwrite: true });
  }

  deleteFile(name: string): void {
    try {
      const file = this.file(name);
      if (file.exists) file.delete();
    } catch {
      // A file we cannot delete now is unknown to the index and is removed on the next startup.
    }
  }

  uriOf(name: string): string {
    return this.file(name).uri;
  }

  private directory(): Directory {
    return new Directory(Paths.cache, this.directoryName);
  }

  private file(name: string): File {
    assertEntryName(name);
    return new File(this.directory(), name);
  }
}
