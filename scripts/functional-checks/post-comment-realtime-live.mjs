import { randomUUID } from 'node:crypto';

import {
  createAdminClient,
  edgeRequest,
  listAllAuthUsers,
  loadConfig,
  readManifest,
  requireFixtureUsername,
  signInFixture,
} from '../demo-fixtures/shared.mjs';

const COMMENT_CREATED_EVENT = 'comment-created';
const TOPIC_PREFIX = 'post-comments:';
const TIMEOUT_MS = 12_000;

function waitForSubscription(channel) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timed out.')), TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}.`));
      }
    });
  });
}

function waitForComment(channel, postId, commentId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Did not receive the created-comment broadcast.')), TIMEOUT_MS);
    channel.on('broadcast', { event: COMMENT_CREATED_EVENT }, (message) => {
      const payload = message?.payload;
      if (payload?.postId?.toLowerCase() !== postId || payload?.commentId?.toLowerCase() !== commentId) return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function resolveFixture(admin, config, username, users) {
  const definition = requireFixtureUsername(username);
  const user = users.find((candidate) => candidate.email?.toLowerCase() === definition.email);
  if (!user) throw new Error(`Fixture ${username} does not exist. Run seed.mjs first.`);
  return signInFixture(config, { ...definition, id: user.id });
}

async function main() {
  const config = loadConfig();
  const manifest = await readManifest();
  const postId = manifest.posts?.['demo_alba:0']?.postId;
  if (typeof postId !== 'string') throw new Error('Fixture post demo_alba:0 is missing. Run seed.mjs first.');

  const admin = createAdminClient(config);
  const users = await listAllAuthUsers(admin);
  const receiver = await resolveFixture(admin, config, 'demo_alba', users);
  const sender = await resolveFixture(admin, config, 'demo_bruno', users);
  const commentId = randomUUID().toLowerCase();
  const topic = `${TOPIC_PREFIX}${postId}`;

  await receiver.client.realtime.setAuth(receiver.token);
  const channel = receiver.client.channel(topic, { config: { private: true } });
  try {
    const received = waitForComment(channel, postId, commentId);
    await waitForSubscription(channel);
    await edgeRequest(config, sender.token, '/post-comments', {
      method: 'POST',
      body: {
        commentId,
        postId,
        parentCommentId: null,
        body: 'Comprobación automática de comentarios en tiempo real.',
      },
    });
    await received;
    const comment = await edgeRequest(
      config,
      receiver.token,
      `/post-comment?postId=${postId}&commentId=${commentId}`,
    );
    if (comment?.comment?.id?.toLowerCase() !== commentId) {
      throw new Error('The receiver could not read the broadcast comment through the authorized endpoint.');
    }
    console.log('PASS: receiver got the broadcast and its authorized comment read.');
  } finally {
    await receiver.client.removeChannel(channel);
    receiver.client.realtime.disconnect();
    sender.client.realtime.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Realtime probe failed.');
  process.exitCode = 1;
});
