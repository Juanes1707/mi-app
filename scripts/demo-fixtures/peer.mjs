import { randomUUID } from 'node:crypto';

import {
  createAdminClient,
  edgeRequest,
  findAuthUserByEmail,
  listAllAuthUsers,
  loadConfig,
  parseArguments,
  requireFixtureUsername,
  signInFixture,
} from './shared.mjs';

async function resolveFixture(admin, config, username) {
  const definition = requireFixtureUsername(username);
  const users = await listAllAuthUsers(admin);
  const authUser = users.find((user) => user.email?.toLowerCase() === definition.email);
  if (!authUser) throw new Error(`Fixture ${username} does not exist. Run seed.mjs first.`);
  return signInFixture(config, { ...definition, id: authUser.id });
}

async function conversationWith(config, fixture, recipientId) {
  const response = await edgeRequest(config, fixture.token, '/direct-conversations', {
    method: 'POST', body: { recipientUserId: recipientId },
  });
  return response.conversation;
}

async function sendMessage(config, fixture, recipient, text) {
  if (!text?.trim() || text.length > 2000) throw new Error('--text must contain 1 to 2000 characters.');
  const conversation = await conversationWith(config, fixture, recipient.id);
  await edgeRequest(config, fixture.token, '/direct-messages', {
    method: 'POST',
    body: { conversationId: conversation.id, messageId: randomUUID(), body: text },
  });
  console.log(`Message sent as ${fixture.username}.`);
}

async function sendTyping(config, fixture, recipient, secondsValue) {
  const seconds = Number(secondsValue ?? '3');
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new Error('--seconds must be an integer from 1 to 30.');
  const conversation = await conversationWith(config, fixture, recipient.id);
  await fixture.client.realtime.setAuth(fixture.token);
  const channel = fixture.client.channel(`direct-typing:${conversation.id}`, {
    config: { private: true, broadcast: { self: false, ack: false } },
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime subscription timed out.')), 10_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer); reject(new Error(`Realtime subscription failed: ${status}.`));
        }
      });
    });
    await channel.send({ type: 'broadcast', event: 'typing', payload: { conversationId: conversation.id, isTyping: true } });
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    await channel.send({ type: 'broadcast', event: 'typing', payload: { conversationId: conversation.id, isTyping: false } });
    console.log(`Typing event sent as ${fixture.username}.`);
  } finally {
    await fixture.client.removeChannel(channel);
    fixture.client.realtime.disconnect();
  }
}

async function main() {
  const config = loadConfig();
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!['message', 'typing', 'follow'].includes(command)) {
    throw new Error('Usage: peer.mjs <message|typing|follow> --from demo_alba --to-email user@example.com [...].');
  }
  if (!options.from || !options['to-email']) throw new Error('--from and --to-email are required.');
  const admin = createAdminClient(config);
  const fixture = await resolveFixture(admin, config, options.from);
  const recipient = await findAuthUserByEmail(admin, options['to-email']);
  if (!recipient) throw new Error('Recipient email was not found.');
  if (recipient.id === fixture.id) throw new Error('Fixture cannot target itself.');

  if (command === 'message') return sendMessage(config, fixture, recipient, options.text);
  if (command === 'typing') return sendTyping(config, fixture, recipient, options.seconds);
  const response = await edgeRequest(config, fixture.token, '/follow', {
    method: 'POST', body: { targetProfileId: recipient.id },
  });
  console.log(`Follow result as ${fixture.username}: ${response.status}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Peer command failed.');
  process.exitCode = 1;
});
