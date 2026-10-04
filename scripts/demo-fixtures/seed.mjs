import {
  EdgeRequestError,
  FIXTURES,
  createAdminClient,
  createDemoPng,
  deterministicUuid,
  edgeRequest,
  ensureFixtureAuthUsers,
  findAuthUserByEmail,
  loadConfig,
  readManifest,
  signInFixture,
  uploadSigned,
  writeManifest,
} from './shared.mjs';

const CAPTIONS = [
  'Un café antes de empezar el día ☕',
  'Atardecer de hoy.',
  'Probando la cámara.',
  'Día de universidad.',
  'Un poco de naturaleza.',
  'Una pausa entre clases.',
  'Luces de la ciudad.',
  'Plan tranquilo para hoy.',
  'Guardando este momento.',
  'Caminata de la tarde.',
  'Música para concentrarse.',
  'Fin de semana al aire libre.',
];

const FOLLOW_GRAPH = [
  ['demo_alba', 'demo_bruno'], ['demo_alba', 'demo_camila'],
  ['demo_bruno', 'demo_alba'], ['demo_bruno', 'demo_diego'],
  ['demo_camila', 'demo_alba'], ['demo_diego', 'demo_alba'],
  ['demo_diego', 'demo_elena'], ['demo_elena', 'demo_bruno'],
  ['demo_felipe', 'demo_alba'], ['demo_felipe', 'demo_diego'],
];

const DM_PAIRS = [
  ['demo_alba', 'demo_bruno'],
  ['demo_camila', 'demo_diego'],
  ['demo_elena', 'demo_felipe'],
];

const DM_TEXTS = [
  '¿Viste la publicación nueva?',
  'Sí, quedó genial.',
  'Después te escribo.',
  'Perfecto, hablamos luego.',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stage(label, operation) {
  console.log(`Stage: ${label}`);
  return operation();
}

async function configureProfiles(config, sessions) {
  for (const user of sessions.values()) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await edgeRequest(config, user.token, '/profile-me', {
          method: 'PATCH',
          body: { username: user.username, displayName: user.displayName, bio: user.bio, isPrivate: user.isPrivate },
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof EdgeRequestError) || error.status !== 404) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (lastError) throw lastError;
  }
}

async function publishPost(config, user, manifest, slot, caption) {
  const key = `${user.username}:${slot}`;
  let entry = manifest.posts[key];
  if (entry?.ownerId !== user.id || typeof entry.imagePath !== 'string') entry = null;
  if (entry) {
    try {
      const replay = await edgeRequest(config, user.token, '/posts', {
        method: 'POST', body: { imagePath: entry.imagePath, caption },
      });
      manifest.posts[key] = { ownerId: user.id, imagePath: entry.imagePath, postId: replay.post.id };
      await writeManifest(manifest);
      return replay.post;
    } catch (error) {
      if (!(error instanceof EdgeRequestError) || error.code !== 'post_media_not_ready') throw error;
    }
  }
  const bytes = createDemoPng(user.color, slot + 1);
  const prepared = await edgeRequest(config, user.token, '/post-media-upload', {
    method: 'POST', body: { contentType: 'image/png', fileSize: bytes.length },
  });
  const ticket = prepared?.upload;
  assert(ticket?.bucket === 'post-media' && typeof ticket.path === 'string' && typeof ticket.token === 'string', 'Invalid post upload ticket.');
  manifest.posts[key] = { ownerId: user.id, imagePath: ticket.path, postId: null };
  await writeManifest(manifest);
  const uploaded = await uploadSigned(user.client, ticket, bytes);
  let published;
  try {
    published = await edgeRequest(config, user.token, '/posts', {
      method: 'POST', body: { imagePath: ticket.path, caption },
    });
  } catch (error) {
    if (!uploaded) throw new Error(`Unable to upload fixture post ${key}.`);
    throw error;
  }
  manifest.posts[key] = { ownerId: user.id, imagePath: ticket.path, postId: published.post.id };
  await writeManifest(manifest);
  return published.post;
}

async function publishStory(config, user, day, slot) {
  const storyId = deterministicUuid(`story:${day}:${user.username}:${slot}`);
  const imagePath = `${user.id}/${storyId}.png`;
  try {
    const replay = await edgeRequest(config, user.token, '/stories', {
      method: 'POST', body: { storyId, imagePath },
    });
    return replay.story;
  } catch (error) {
    if (!(error instanceof EdgeRequestError) || error.code !== 'story_media_not_ready') throw error;
  }
  const bytes = createDemoPng(user.color, slot + 5);
  let prepared;
  try {
    prepared = await edgeRequest(config, user.token, '/story-media', {
      method: 'POST', body: { storyId, contentType: 'image/png', sizeBytes: bytes.length },
    });
  } catch (error) {
    if (error instanceof EdgeRequestError && error.code === 'story_id_conflict') {
      const replay = await edgeRequest(config, user.token, '/stories', {
        method: 'POST', body: { storyId, imagePath },
      });
      return replay.story;
    }
    throw error;
  }
  const ticket = prepared?.upload;
  assert(ticket?.storyId === storyId && ticket.bucket === 'story-media' && ticket.path === imagePath, 'Invalid story upload ticket.');
  const uploaded = await uploadSigned(user.client, ticket, bytes);
  try {
    const result = await edgeRequest(config, user.token, '/stories', {
      method: 'POST', body: { storyId, imagePath },
    });
    return result.story;
  } catch (error) {
    if (!uploaded) throw new Error(`Unable to upload fixture Story ${user.username}:${slot}.`);
    throw error;
  }
}

async function follow(config, from, target) {
  return edgeRequest(config, from.token, '/follow', {
    method: 'POST', body: { targetProfileId: target.id },
  });
}

async function seedFollowGraph(config, sessions) {
  let accepted = 0;
  for (const [fromName, targetName] of FOLLOW_GRAPH) {
    const from = sessions.get(fromName);
    const target = sessions.get(targetName);
    const result = await follow(config, from, target);
    if (result.status === 'request_pending') {
      await edgeRequest(config, target.token, '/follow-requests', {
        method: 'PATCH', body: { requestId: result.requestId, decision: 'accept' },
      });
    }
    accepted += 1;
  }
  const pending = await follow(config, sessions.get('demo_felipe'), sessions.get('demo_elena'));
  return { accepted, pending: pending.status === 'request_pending' ? 1 : 0 };
}

async function seedLikes(config, sessions, posts) {
  let operations = 0;
  const users = [...sessions.values()];
  for (const post of posts.filter((item) => !item.author.isPrivate)) {
    const likers = users.filter((user) => user.id !== post.author.id).slice(0, 2);
    for (const liker of likers) {
      await edgeRequest(config, liker.token, '/post-likes', {
        method: 'PUT', body: { postId: post.id, liked: true },
      });
      operations += 1;
    }
  }
  for (const post of posts.filter((item) => item.author.username === 'demo_camila')) {
    await edgeRequest(config, sessions.get('demo_alba').token, '/post-likes', {
      method: 'PUT', body: { postId: post.id, liked: true },
    });
    operations += 1;
  }
  for (const post of posts.filter((item) => item.author.username === 'demo_elena')) {
    await edgeRequest(config, sessions.get('demo_diego').token, '/post-likes', {
      method: 'PUT', body: { postId: post.id, liked: true },
    });
    operations += 1;
  }
  return operations;
}

async function createComment(config, user, postId, commentId, parentCommentId, body) {
  return edgeRequest(config, user.token, '/post-comments', {
    method: 'POST', body: { commentId, postId, parentCommentId, body },
  });
}

async function seedComments(config, sessions, posts) {
  const publicPosts = posts.filter((post) => !post.author.isPrivate).slice(0, 8);
  const users = [...sessions.values()];
  let count = 0;
  for (let index = 0; index < publicPosts.length; index += 1) {
    const post = publicPosts[index];
    const authors = users.filter((user) => user.id !== post.author.id);
    const rootId = deterministicUuid(`comment:${post.id}:root`);
    await createComment(config, authors[0], post.id, rootId, null, index % 2 ? '¡Qué buena foto!' : 'Me gustó mucho este momento.');
    count += 1;
    if (index < 4) {
      const replyId = deterministicUuid(`comment:${post.id}:reply`);
      await createComment(config, authors[1], post.id, replyId, rootId, 'Totalmente de acuerdo 🙌');
      count += 1;
      if (index < 2) {
        await createComment(config, authors[2], post.id, deterministicUuid(`comment:${post.id}:reply-2`), replyId, 'Yo también quiero probarlo.');
        count += 1;
      }
    }
  }
  return { count, nestedPosts: 4 };
}

async function seedDirectMessages(config, sessions) {
  const conversations = [];
  let messageCount = 0;
  for (const [firstName, secondName] of DM_PAIRS) {
    const first = sessions.get(firstName);
    const second = sessions.get(secondName);
    const response = await edgeRequest(config, first.token, '/direct-conversations', {
      method: 'POST', body: { recipientUserId: second.id },
    });
    const conversation = response.conversation;
    conversations.push(conversation);
    for (let index = 0; index < DM_TEXTS.length; index += 1) {
      const sender = index % 2 === 0 ? first : second;
      await edgeRequest(config, sender.token, '/direct-messages', {
        method: 'POST',
        body: {
          conversationId: conversation.id,
          messageId: deterministicUuid(`dm:${firstName}:${secondName}:${index}`),
          body: DM_TEXTS[index],
        },
      });
      messageCount += 1;
    }
  }
  return { conversations, messageCount };
}

async function integrateOwner(config, admin, sessions) {
  if (!config.ownerEmail) return { status: 'skipped', reason: 'not-configured', conversations: [] };
  const owner = await findAuthUserByEmail(admin, config.ownerEmail);
  if (!owner) {
    console.log('Owner email not found; fixture ecosystem seeded without owner integration.');
    return { status: 'skipped', reason: 'not-found', conversations: [] };
  }
  if ([...sessions.values()].some((fixture) => fixture.id === owner.id)) {
    return { status: 'skipped', reason: 'owner-is-fixture', conversations: [] };
  }
  const conversations = [];
  for (const username of ['demo_alba', 'demo_bruno']) {
    const fixture = sessions.get(username);
    try { await follow(config, fixture, { id: owner.id }); } catch (error) {
      if (!(error instanceof EdgeRequestError) || error.code !== 'profile_not_found') throw error;
      return { status: 'skipped', reason: 'owner-profile-not-ready', conversations: [] };
    }
  }
  const messages = [
    ['demo_alba', '¡Hola! Soy Alba, una cuenta demo 👋'],
    ['demo_bruno', 'Este mensaje sirve para probar tu Inbox.'],
  ];
  for (const [username, body] of messages) {
    const fixture = sessions.get(username);
    const response = await edgeRequest(config, fixture.token, '/direct-conversations', {
      method: 'POST', body: { recipientUserId: owner.id },
    });
    conversations.push(response.conversation);
    await edgeRequest(config, fixture.token, '/direct-messages', {
      method: 'POST',
      body: {
        conversationId: response.conversation.id,
        messageId: deterministicUuid(`owner-dm:${owner.id}:${username}`),
        body,
      },
    });
  }
  return { status: 'integrated', ownerId: owner.id, conversations };
}

async function countRows(query, label) {
  const { count, error } = await query;
  if (error || typeof count !== 'number') throw new Error(`Unable to verify ${label}.`);
  return count;
}

async function verifyHosted(admin, fixtureUsers, posts, stories, dm) {
  const ids = fixtureUsers.map((user) => user.id);
  const postIds = posts.map((post) => post.id);
  const conversationIds = dm.conversations.map((conversation) => conversation.id);
  return {
    authUsers: fixtureUsers.length,
    profiles: await countRows(admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', ids), 'profiles'),
    posts: await countRows(admin.from('posts').select('id', { count: 'exact', head: true }).in('id', postIds), 'posts'),
    activeStories: await countRows(admin.from('stories').select('id', { count: 'exact', head: true }).in('id', stories.map((story) => story.id)).gt('created_at', new Date(Date.now() - 86_400_000).toISOString()), 'stories'),
    follows: await countRows(admin.from('follows').select('*', { count: 'exact', head: true }).in('follower_id', ids).in('followed_id', ids), 'follows'),
    pendingRequests: await countRows(admin.from('follow_requests').select('*', { count: 'exact', head: true }).in('requester_id', ids).in('target_id', ids).eq('status', 'pending'), 'follow requests'),
    likes: await countRows(admin.from('post_likes').select('*', { count: 'exact', head: true }).in('post_id', postIds), 'likes'),
    comments: await countRows(admin.from('post_comments').select('*', { count: 'exact', head: true }).in('post_id', postIds), 'comments'),
    conversations: await countRows(admin.from('direct_conversations').select('*', { count: 'exact', head: true }).in('id', conversationIds), 'conversations'),
    messages: await countRows(admin.from('direct_messages').select('*', { count: 'exact', head: true }).in('conversation_id', conversationIds), 'messages'),
  };
}

async function privacyAndReadSmokes(config, sessions, posts, stories, dm) {
  const alba = sessions.get('demo_alba');
  const felipe = sessions.get('demo_felipe');
  const camila = sessions.get('demo_camila');
  const albaProfile = await edgeRequest(config, alba.token, `/profiles?profileId=${alba.id}`);
  assert(albaProfile.profile?.username === alba.username && albaProfile.isSelf === true, 'Alba profile read is invalid.');
  const albaFeed = await edgeRequest(config, alba.token, '/feed');
  const outsiderFeed = await edgeRequest(config, felipe.token, '/feed');
  const camilaPostIds = new Set(posts.filter((post) => post.author.username === 'demo_camila').map((post) => post.id));
  assert(albaFeed.posts.some((post) => camilaPostIds.has(post.id)), 'Authorized follower cannot see Camila posts.');
  assert(!outsiderFeed.posts.some((post) => camilaPostIds.has(post.id)), 'Outsider can see Camila posts.');
  const camilaStories = await edgeRequest(config, alba.token, `/stories?authorId=${camila.id}&limit=50`);
  assert(camilaStories.stories.length >= 2, 'Authorized follower cannot see Camila Stories.');
  let outsiderStoryHidden = false;
  try { await edgeRequest(config, felipe.token, `/stories?authorId=${camila.id}&limit=50`); }
  catch (error) { outsiderStoryHidden = error instanceof EdgeRequestError && error.status === 404; }
  assert(outsiderStoryHidden, 'Outsider can see Camila Stories.');
  await edgeRequest(config, alba.token, `/profile-connections?userId=${camila.id}&kind=followers&limit=50`);
  let outsiderConnectionsHidden = false;
  try { await edgeRequest(config, felipe.token, `/profile-connections?userId=${camila.id}&kind=followers&limit=50`); }
  catch (error) { outsiderConnectionsHidden = error instanceof EdgeRequestError && error.status === 404; }
  assert(outsiderConnectionsHidden, 'Outsider can see Camila connections.');
  await edgeRequest(config, alba.token, `/profile-connections?userId=${alba.id}&kind=followers&limit=50`);
  await edgeRequest(config, alba.token, `/profile-connections?userId=${alba.id}&kind=following&limit=50`);
  const mediaPost = albaFeed.posts[0];
  const media = await edgeRequest(config, alba.token, `/post-media-read?imagePath=${encodeURIComponent(mediaPost.imagePath)}`);
  assert(media && typeof media === 'object', 'Post media authorization failed.');
  const trays = await edgeRequest(config, alba.token, '/story-trays?limit=50');
  assert(trays.trays?.some((tray) => tray.author?.id === camila.id), 'Alba Story tray does not include Camila.');
  const camilaStory = stories.find((story) => story.authorId === camila.id);
  await edgeRequest(config, alba.token, `/story-media?storyId=${camilaStory.id}`);
  const firstConversation = dm.conversations[0];
  const history = await edgeRequest(config, alba.token, `/direct-messages?conversationId=${firstConversation.id}&limit=50`);
  assert(history.messages.length >= 4, 'Fixture DM history is incomplete.');
  return {
    profileRead: true,
    feedPosts: albaFeed.posts.length,
    feedHasCounts: albaFeed.posts.some((post) => post.likesCount >= 2 && post.commentsCount >= 1),
    privatePostAuthorized: true,
    privatePostOutsiderHidden: true,
    privateStoryAuthorized: true,
    privateStoryOutsiderHidden: true,
    privateConnectionsOutsiderHidden: true,
    ownerConnectionLists: true,
    signedPostMedia: true,
    storyTray: true,
    signedStoryMedia: true,
    dmHistory: history.messages.length,
  };
}

async function main() {
  const config = loadConfig();
  const admin = createAdminClient(config);
  const fixtureUsers = await stage('auth-users', () => ensureFixtureAuthUsers(admin, config));
  const sessions = new Map();
  await stage('fixture-sessions', async () => {
    for (const fixture of fixtureUsers) sessions.set(fixture.username, await signInFixture(config, fixture));
  });
  await stage('profiles', () => configureProfiles(config, sessions));

  const manifest = await readManifest();
  const posts = [];
  let captionIndex = 0;
  await stage('posts', async () => {
    for (const user of sessions.values()) {
      for (let slot = 0; slot < 3; slot += 1) {
        const post = await publishPost(config, user, manifest, slot, CAPTIONS[captionIndex % CAPTIONS.length]);
        posts.push({ ...post, author: user });
        captionIndex += 1;
      }
    }
  });

  const utcDay = new Date().toISOString().slice(0, 10);
  const stories = [];
  await stage('stories', async () => {
    for (const user of sessions.values()) {
      for (let slot = 0; slot < 2; slot += 1) {
        const story = await publishStory(config, user, utcDay, slot);
        stories.push({ ...story, authorId: user.id });
      }
    }
  });

  const followSummary = await stage('follow-graph', () => seedFollowGraph(config, sessions));
  const likeOperations = await stage('likes', () => seedLikes(config, sessions, posts));
  const commentSummary = await stage('comments', () => seedComments(config, sessions, posts));
  const dm = await stage('direct-messages', () => seedDirectMessages(config, sessions));
  const owner = await stage('owner-integration', () => integrateOwner(config, admin, sessions));
  const counts = await stage('hosted-verification', () => verifyHosted(admin, fixtureUsers, posts, stories, dm));
  const smokes = await stage('read-smokes', () => privacyAndReadSmokes(config, sessions, posts, stories, dm));

  assert(counts.authUsers === 6 && counts.profiles === 6 && counts.posts === 18, 'Hosted fixture counts are incomplete.');
  assert(counts.activeStories >= 12 && counts.follows >= 10 && counts.pendingRequests >= 1, 'Hosted social fixture counts are incomplete.');
  assert(counts.likes >= 30 && counts.comments >= 14 && counts.conversations === 3 && counts.messages === 12, 'Hosted activity fixture counts are incomplete.');

  console.log('Seeded:');
  for (const fixture of FIXTURES) console.log(fixture.username);
  console.log(JSON.stringify({
    projectRef: 'nkhrypgiagaofovulnnq',
    counts,
    followGraph: followSummary,
    likeOperations,
    comments: commentSummary,
    ownerIntegration: { status: owner.status, reason: owner.reason ?? null },
    smokes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Demo seed failed.');
  process.exitCode = 1;
});
