import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(path.join(root, 'src', `${specifier.slice(2)}.ts`)).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// authenticated-backend-api-client.ts pulls in backend-api-client.ts, which builds a
// singleton at import time.
process.env.EXPO_PUBLIC_BACKEND_BASE_URL ??= 'https://backend.invalid';

const realtime = await import(pathToFileURL(path.join(
  root, 'src/features/direct-messages/data/supabase-direct-message-realtime-source.ts',
)).href);
const comments = await import(pathToFileURL(path.join(
  root, 'src/features/comments/data/supabase-post-comment-realtime-source.ts',
)).href);
const overlay = await import(pathToFileURL(path.join(
  root, 'src/features/direct-messages/presentation/receipt-overlay.ts',
)).href);

const conversation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sender = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const message1 = '11111111-1111-4111-8111-111111111111';
const message2 = '22222222-2222-4222-8222-222222222222';
const t1 = '2026-10-04T12:00:00.000001Z';
const t2 = '2026-10-04T12:00:01.000001Z';

const created = (payload) => ({ event: 'message-created', payload });

test('a message-created hint is accepted only with exactly its ids and order key', () => {
  const valid = { conversationId: conversation, messageId: message1, senderId: sender, createdAt: t1 };
  assert.deepEqual(realtime.parseMessageCreatedMessage(created(valid), conversation), valid);
  // The inbox topic may name any conversation of the owner.
  assert.deepEqual(realtime.parseMessageCreatedMessage(created(valid), null), valid);
  // Another conversation on this topic, a smuggled body, or a wrong event: dropped.
  assert.equal(realtime.parseMessageCreatedMessage(created(valid), other), null);
  assert.equal(realtime.parseMessageCreatedMessage(created({ ...valid, body: 'forged' }), conversation), null);
  assert.equal(realtime.parseMessageCreatedMessage({ event: 'typing', payload: valid }, conversation), null);
  assert.equal(realtime.parseMessageCreatedMessage(created({ ...valid, messageId: 'x' }), conversation), null);
});

// Exactly what the hosted project delivered (live probe): Supabase Realtime adds the
// realtime.messages row id to every broadcast sent with realtime.send.
const realtimeId = 'ee3d826c-040e-4ae8-8b85-01b507ca4fe4';

test('database broadcasts carrying the Realtime row id are accepted; other extras are not', () => {
  const valid = { conversationId: conversation, messageId: message1, senderId: sender, createdAt: t1 };
  assert.deepEqual(realtime.parseMessageCreatedMessage(created({ id: realtimeId, ...valid }), conversation), valid);
  assert.deepEqual(realtime.parseMessageCreatedMessage(created({ id: realtimeId, ...valid }), null), valid);
  assert.equal(realtime.parseMessageCreatedMessage(created({ ...valid, id: 'not-a-uuid' }), conversation), null);
  assert.equal(realtime.parseMessageCreatedMessage(created({ ...valid, id: realtimeId, body: 'forged' }), conversation), null);
  const receipt = {
    id: realtimeId, conversationId: conversation, messageSenderId: sender, throughMessageId: message1,
    throughCreatedAt: t1, kind: 'read', at: t2,
  };
  assert.equal(realtime.parseReceiptMessage({ event: 'message-receipt', payload: receipt }, conversation).kind, 'read');
  assert.equal(comments.parseCommentCreatedMessage(
    { event: 'comment-created', payload: { id: realtimeId, postId: conversation, commentId: message1 } }, conversation,
  ).commentId, message1);
  assert.equal(comments.parseCommentCreatedMessage(
    { event: 'comment-created', payload: { id: realtimeId, postId: conversation, commentId: message1, body: 'x' } }, conversation,
  ), null);
});

test('typing and receipt hints are validated against the subscribed conversation', () => {
  assert.deepEqual(
    realtime.parseTypingMessage({ event: 'typing', payload: { conversationId: conversation, isTyping: true } }, conversation),
    { conversationId: conversation, isTyping: true },
  );
  assert.equal(
    realtime.parseTypingMessage({ event: 'typing', payload: { conversationId: other, isTyping: true } }, conversation),
    null,
  );
  assert.equal(
    realtime.parseTypingMessage({ event: 'typing', payload: { conversationId: conversation, isTyping: 'yes' } }, conversation),
    null,
  );
  const receipt = {
    conversationId: conversation, messageSenderId: sender, throughMessageId: message1,
    throughCreatedAt: t1, kind: 'read', at: t2,
  };
  assert.equal(realtime.parseReceiptMessage({ event: 'message-receipt', payload: receipt }, conversation).kind, 'read');
  assert.equal(realtime.parseReceiptMessage({ event: 'message-receipt', payload: { ...receipt, kind: 'seen' } }, conversation), null);
});

test('receipts only move forward and read implies delivered', () => {
  const own = (id, createdAt) => ({ id, createdAt, deliveredAt: null, readAt: null });
  let state = overlay.EMPTY_RECEIPT_OVERLAY;
  assert.equal(overlay.receiptLabel(overlay.ownMessageReceiptStatus(own(message1, t1), state)), 'Enviado');

  state = overlay.advanceReceiptOverlay(state, { kind: 'delivered', throughMessageId: message2, throughCreatedAt: t2, at: t2 });
  assert.equal(overlay.receiptLabel(overlay.ownMessageReceiptStatus(own(message1, t1), state)), 'Entregado');

  // A late, older watermark changes nothing.
  assert.equal(overlay.advanceReceiptOverlay(state, { kind: 'delivered', throughMessageId: message1, throughCreatedAt: t1, at: t2 }), state);

  state = overlay.advanceReceiptOverlay(state, { kind: 'read', throughMessageId: message1, throughCreatedAt: t1, at: t2 });
  assert.equal(overlay.receiptLabel(overlay.ownMessageReceiptStatus(own(message1, t1), state)), 'Visto');
  // Read through message1 does not cover the newer message2, which stays delivered.
  assert.equal(overlay.receiptLabel(overlay.ownMessageReceiptStatus(own(message2, t2), state)), 'Entregado');
});
