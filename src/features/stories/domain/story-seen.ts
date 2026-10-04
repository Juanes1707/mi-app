import type { StoryTray } from '@/features/stories/domain/story';
import { comparePostgresTimestamps, parsePostgresTimestamp } from '@/shared/domain/postgres-timestamp';

// "Seen" is a LOCAL, per-owner UX fact (never sent to the backend). expiresAtMs is the
// device clock ONLY for local housekeeping; the backend alone decides what is active.
export type StorySeenEntry = { storyId: string; authorId: string; expiresAtMs: number; seenAtMs: number };

// Written when the viewer has seen EVERY active Story of an author (no further page),
// so Home can tell a fully-seen ring without fetching each author's Stories.
export type StoryAuthorSeenSnapshot = {
  authorId: string;
  latestStoryCreatedAt: string;
  activeStoryCount: number;
  expiresAtMs: number;
  completedAtMs: number;
};

export type OwnerSeenState = { storyIds: string[]; snapshots: StoryAuthorSeenSnapshot[] };

export interface StorySeenStore {
  // Lazily prunes rows with expiresAtMs <= nowMs, then reads the owner's rows.
  load(ownerUserId: string, nowMs: number): Promise<OwnerSeenState>;
  // Idempotent: the same owner + Story is one row.
  markSeen(ownerUserId: string, entry: StorySeenEntry, nowMs: number): Promise<void>;
  saveSnapshot(ownerUserId: string, snapshot: StoryAuthorSeenSnapshot, nowMs: number): Promise<void>;
}

// Ring rule. Same newest Story and at least as many Stories as when completed: seen.
// The count may DROP (older Stories expire) without anything new to watch; a newer
// latest Story, or more Stories with the same latest instant, is unseen.
export function isTrayFullySeen(
  tray: Pick<StoryTray, 'latestStoryCreatedAt' | 'activeStoryCount'>,
  snapshot: StoryAuthorSeenSnapshot | undefined,
): boolean {
  if (snapshot === undefined) return false;
  const trayLatest = parsePostgresTimestamp(tray.latestStoryCreatedAt);
  const snapshotLatest = parsePostgresTimestamp(snapshot.latestStoryCreatedAt);
  return trayLatest !== null && snapshotLatest !== null &&
    comparePostgresTimestamps(trayLatest, snapshotLatest) === 0 &&
    snapshot.activeStoryCount >= tray.activeStoryCount;
}

// Local housekeeping instant for a server expiresAt (rounded up to the next ms).
export function toExpiresAtMs(expiresAt: string): number | null {
  const parsed = parsePostgresTimestamp(expiresAt);
  if (parsed === null) return null;
  return parsed.epochMilliseconds + (parsed.subMillisecondMicroseconds > 0 ? 1 : 0);
}
