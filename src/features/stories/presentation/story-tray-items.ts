import type { StoryTray } from '@/features/stories/domain/story';

export type StoryTrayItem =
  | { key: 'self'; tray: StoryTray | null }
  | { key: string; tray: StoryTray };

// The local "Tu historia" tile is always first, even without a server self tray (it is
// UI, never a fabricated StoryTray). The server's self tray, when present, only feeds
// that tile, so the owner never appears twice.
export function buildStoryTrayItems(trays: readonly StoryTray[]): StoryTrayItem[] {
  return [
    { key: 'self', tray: trays.find((tray) => tray.isSelf) ?? null },
    ...trays.filter((tray) => !tray.isSelf).map((tray) => ({ key: tray.author.id, tray })),
  ];
}
