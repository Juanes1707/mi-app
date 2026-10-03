// A tap whose intention is not durable yet (its SQLite INSERT has not confirmed).
export type EphemeralLikeIntent = {
  localId: number;
  postId: string;
  desiredLiked: boolean;
};

// Precedence: durable pending state (SQLite), then not-yet-durable taps in tap order.
// The last intention per post wins; posts without either keep the server state.
export function mergeDesiredLikes(
  durable: ReadonlyMap<string, boolean>,
  ephemeral: readonly EphemeralLikeIntent[],
): ReadonlyMap<string, boolean> {
  if (ephemeral.length === 0) return durable;
  const merged = new Map(durable);
  for (const intent of ephemeral) merged.set(intent.postId, intent.desiredLiked);
  return merged;
}
