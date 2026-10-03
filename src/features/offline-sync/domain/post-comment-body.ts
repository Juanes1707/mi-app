// POST /post-comments limit: PostgreSQL char_length, i.e. Unicode code points.
export const MAX_POST_COMMENT_BODY_CODE_POINTS = 500;

// Unicode code points, the unit of the 500 limit (an emoji counts once; a lone
// surrogate counts once too, although it is not a valid body).
export function countCodePoints(text: string): number {
  let codePoints = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index += 1;
    codePoints += 1;
  }
  return codePoints;
}

// A body the backend can accept. Checked before it is persisted, because a queued
// comment the backend can never store would block the whole FIFO queue behind it.
// - not whitespace-only (trim is used only to test this; the body is kept as is);
// - at most 500 code points (an emoji counts once, not as two UTF-16 units);
// - well-formed UTF-16 and no U+0000: PostgreSQL text can store neither a lone
//   surrogate nor NUL, so such a body would fail on every replay.
export function isValidPostCommentBody(body: unknown): body is string {
  if (typeof body !== 'string' || body.trim() === '') return false;
  let codePoints = 0;
  for (let index = 0; index < body.length; index += 1) {
    const unit = body.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = body.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
    codePoints += 1;
    if (codePoints > MAX_POST_COMMENT_BODY_CODE_POINTS) return false;
  }
  return true;
}
