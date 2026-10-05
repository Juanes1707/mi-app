import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createAdminClient,
  edgeRequest,
  listAllAuthUsers,
  loadConfig,
  requireFixtureUsername,
  signInFixture,
} from '../demo-fixtures/shared.mjs';

// Live probe against the hosted project: demo_bruno sends demo_alba a message and we
// check what actually arrives on alba's private conversation and inbox topics, and
// whether the app's own parsers and authorized read accept it.
// Run: node --env-file=.env --env-file=.env.seed.local --experimental-transform-types \
//   scripts/functional-checks/direct-message-realtime-live.mjs

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
const { parseMessageCreatedMessage } = await import(pathToFileURL(path.join(
  root, 'src/features/direct-messages/data/supabase-direct-message-realtime-source.ts',
)).href);

const TIMEOUT_MS = 12_000;

function join(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${channel.topic}: subscription timed out.`)), TIMEOUT_MS);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      } else if (status !== 'SUBSCRIBED' && status !== 'JOINING') {
        clearTimeout(timeout);
        reject(new Error(`${channel.topic}: ${status}${error ? ` (${error.message})` : ''}`));
      }
    });
  });
}

function nextBroadcast(channel, label) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), TIMEOUT_MS);
    channel.on('broadcast', { event: '*' }, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  }).then((message) => ({ label, message }));
}

async function fixture(admin, config, users, username) {
  const definition = requireFixtureUsername(username);
  const user = users.find((candidate) => candidate.email?.toLowerCase() === definition.email);
  if (!user) throw new Error(`Fixture ${username} does not exist. Run seed.mjs first.`);
  return signInFixture(config, { ...definition, id: user.id });
}

async function main() {
  const config = loadConfig();
  const admin = createAdminClient(config);
  const users = await listAllAuthUsers(admin);
  const receiver = await fixture(admin, config, users, 'demo_alba');
  const sender = await fixture(admin, config, users, 'demo_bruno');

  const { conversation } = await edgeRequest(config, sender.token, '/direct-conversations', {
    method: 'POST', body: { recipientUserId: receiver.id },
  });
  const conversationId = conversation.id.toLowerCase();
  const receiverId = receiver.id.toLowerCase();

  await receiver.client.realtime.setAuth(receiver.token);
  const chat = receiver.client.channel(`direct-conversation:${conversationId}`, { config: { private: true } });
  const inbox = receiver.client.channel(`direct-inbox:${receiverId}`, { config: { private: true } });
  try {
    const arrivals = [nextBroadcast(chat, 'conversation'), nextBroadcast(inbox, 'inbox')];
    await join(chat);
    await join(inbox);
    console.log('JOINED: conversation and inbox topics.');

    const messageId = randomUUID().toLowerCase();
    await edgeRequest(config, sender.token, '/direct-messages', {
      method: 'POST',
      body: { conversationId, messageId, body: 'Comprobación automática de mensajes en tiempo real.' },
    });

    let failed = false;
    for (const { label, message } of await Promise.all(arrivals)) {
      if (message === null) {
        console.log(`FAIL ${label}: no broadcast within ${TIMEOUT_MS} ms.`);
        failed = true;
        continue;
      }
      console.log(`RECEIVED ${label}: ${JSON.stringify({ event: message.event, payload: message.payload })}`);
      const parsed = parseMessageCreatedMessage(message, label === 'conversation' ? conversationId : null);
      console.log(`${parsed?.messageId === messageId ? 'PASS' : 'FAIL'} ${label}: app parser ${parsed ? 'accepted' : 'REJECTED'} it.`);
      if (parsed?.messageId !== messageId) failed = true;
    }

    const read = await edgeRequest(config, receiver.token,
      `/direct-message?${new URLSearchParams({ conversationId, messageId })}`);
    const readOk = read?.message?.id?.toLowerCase() === messageId;
    console.log(`${readOk ? 'PASS' : 'FAIL'} authorized read: ${JSON.stringify(Object.keys(read ?? {}))}`);
    if (failed || !readOk) process.exitCode = 1;
  } finally {
    await receiver.client.removeChannel(chat);
    await receiver.client.removeChannel(inbox);
    receiver.client.realtime.disconnect();
    sender.client.realtime.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Realtime probe failed.');
  process.exitCode = 1;
});
