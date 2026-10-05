import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Same resolution Metro gives the app: @/ alias and extensionless TypeScript imports.
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

const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { handlePostLinkRequest } = await load('supabase/functions/post-link/index.ts');
const { buildPostDeepLink, buildPostShareLink } = await load('src/features/post-sharing/domain/post-reference.ts');
const { sharePostReference } = await load('src/features/post-sharing/application/share-post-reference.ts');

const BACKEND = 'https://nkhrypgiagaofovulnnq.supabase.co/functions/v1/';
const POST = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ENABLED = { expoGoRedirects: true };
const DISABLED = { expoGoRedirects: false };

// What the browser receives after the user taps the shared https link.
function open(link, options, method = 'GET') {
  return handlePostLinkRequest(new Request(link, { method, redirect: 'manual' }), options);
}

test('an installed app is opened through its own scheme', () => {
  const link = buildPostShareLink(BACKEND, POST, null);
  assert.equal(link, `https://nkhrypgiagaofovulnnq.supabase.co/functions/v1/post-link/${POST}`);
  for (const options of [ENABLED, DISABLED]) {
    const response = open(link, options);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `instagramclone://post/${POST}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(buildPostDeepLink(POST.toUpperCase()), `instagramclone://post/${POST}`);
});

test('Expo Go is opened on the current dev server (tunnel or LAN) when the server allows it', () => {
  for (const appUrl of [
    `exp://u-abc123.boltexpo.dev/--/post/${POST}`,
    `exp://192.168.1.20:8081/--/post/${POST}`,
    `exps://bjyacu4-anonymous-8081.exp.direct/--/post/${POST}`,
  ]) {
    const link = buildPostShareLink(BACKEND, POST, appUrl);
    assert.ok(link.startsWith(`https://nkhrypgiagaofovulnnq.supabase.co/functions/v1/post-link/${POST}?to=`));
    assert.equal(open(link, ENABLED).headers.get('location'), appUrl);
    // Without the server flag the same link still opens the installed app.
    assert.equal(open(link, DISABLED).headers.get('location'), `instagramclone://post/${POST}`);
  }
});

test('the bridge is never an open redirect: any other target falls back to the app scheme', () => {
  const targets = [
    `https://evil.example/--/post/${POST}`,
    `javascript:alert(1)//--/post/${POST}`,
    `exp://dev.example:8081/--/post/${OTHER}`,
    'exp://dev.example:8081/--/profile/someone',
    `exp://dev.example:8081/--/post/${POST}/comments`,
    `exp://user:secret@dev.example:8081/--/post/${POST}`,
    `exp://dev.example:8081/--/post/${POST}?next=https://evil.example`,
    `exp://dev.example:8081/--/post/${POST}#fragment`,
    `exp://dev.example:8081/${'a'.repeat(600)}/--/post/${POST}`,
    'not a url',
  ];
  for (const target of targets) {
    const link = `${BACKEND}post-link/${POST}?to=${encodeURIComponent(target)}`;
    const response = open(link, ENABLED);
    assert.equal(response.status, 302, target);
    assert.equal(response.headers.get('location'), `instagramclone://post/${POST}`, target);
  }
});

test('invalid links and methods are refused without redirecting', () => {
  for (const link of [`${BACKEND}post-link/not-a-uuid`, `${BACKEND}post-link/`, `${BACKEND}post-link/${POST}/x`]) {
    const response = open(link, ENABLED);
    assert.equal(response.status, 404, link);
    assert.equal(response.headers.get('location'), null);
  }
  const post = open(`${BACKEND}post-link/${POST}`, ENABLED, 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(open(`${BACKEND}post-link/${POST}`, ENABLED, 'HEAD').status, 302);
  // Upper-case ids are accepted and normalized.
  assert.equal(
    open(`${BACKEND}post-link/${POST.toUpperCase()}`, DISABLED).headers.get('location'),
    `instagramclone://post/${POST}`,
  );
});

test('sharing sends the https link through the native share sheet', async () => {
  const shared = [];
  await sharePostReference(POST, (id) => buildPostShareLink(BACKEND, id, null), async (content, options) => {
    shared.push({ content, options });
  });
  assert.equal(shared.length, 1);
  assert.match(shared[0].content.message, new RegExp(`https://\\S+/post-link/${POST}$`));
  assert.equal(shared[0].options.dialogTitle, 'Compartir publicación');

  await assert.rejects(sharePostReference('nope', (id) => buildPostShareLink(BACKEND, id, null), async () => {}));
  assert.equal(buildPostShareLink(BACKEND, 'nope', null), null);
});
