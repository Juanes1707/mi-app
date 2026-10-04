import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { createClient } from '@supabase/supabase-js';

export const PROJECT_REF = 'nkhrypgiagaofovulnnq';
export const EXPECTED_URL = `https://${PROJECT_REF}.supabase.co`;
export const EXPECTED_BACKEND_URL = `${EXPECTED_URL}/functions/v1`;
export const MANIFEST_PATH = resolve('scripts/demo-fixtures/fixtures.local.json');

export const FIXTURES = [
  { username: 'demo_alba', key: 'alba', email: 'instagram.demo.alba@example.com', displayName: 'Alba Romero', bio: 'Viajes y café.', isPrivate: false, color: [224, 90, 110] },
  { username: 'demo_bruno', key: 'bruno', email: 'instagram.demo.bruno@example.com', displayName: 'Bruno Silva', bio: 'Fotografía urbana.', isPrivate: false, color: [52, 120, 210] },
  { username: 'demo_camila', key: 'camila', email: 'instagram.demo.camila@example.com', displayName: 'Camila Torres', bio: 'Cuenta privada de prueba.', isPrivate: true, color: [151, 93, 201] },
  { username: 'demo_diego', key: 'diego', email: 'instagram.demo.diego@example.com', displayName: 'Diego Herrera', bio: 'Música y universidad.', isPrivate: false, color: [241, 147, 55] },
  { username: 'demo_elena', key: 'elena', email: 'instagram.demo.elena@example.com', displayName: 'Elena Cruz', bio: 'Perfil privado demo.', isPrivate: true, color: [32, 157, 139] },
  { username: 'demo_felipe', key: 'felipe', email: 'instagram.demo.felipe@example.com', displayName: 'Felipe Morales', bio: 'Naturaleza y deporte.', isPrivate: false, color: [94, 168, 73] },
];

export const FIXTURE_BY_USERNAME = new Map(FIXTURES.map((fixture) => [fixture.username, fixture]));
export const FIXTURE_EMAILS = new Set(FIXTURES.map((fixture) => fixture.email));

export class EdgeRequestError extends Error {
  constructor(path, status, code) {
    super(`Edge request ${path} failed (${status}${code ? `, ${code}` : ''}).`);
    this.name = 'EdgeRequestError';
    this.path = path;
    this.status = status;
    this.code = code;
  }
}

export function loadConfig() {
  const config = {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim(),
    publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
    backendUrl: process.env.EXPO_PUBLIC_BACKEND_BASE_URL?.trim().replace(/\/+$/, ''),
    secretKey: process.env.DEMO_SUPABASE_SECRET_KEY?.trim(),
    password: process.env.DEMO_FIXTURE_PASSWORD,
    ownerEmail: process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase() || null,
    confirmed: process.env.DEMO_SEED_CONFIRM === 'YES',
  };
  if (config.url !== EXPECTED_URL) {
    throw new Error(`Safety lock refused: EXPO_PUBLIC_SUPABASE_URL must target ${PROJECT_REF}.`);
  }
  if (config.backendUrl !== EXPECTED_BACKEND_URL) {
    throw new Error(`Safety lock refused: EXPO_PUBLIC_BACKEND_BASE_URL must target ${PROJECT_REF}.`);
  }
  if (!config.confirmed) throw new Error('Safety lock refused: DEMO_SEED_CONFIRM must be exactly YES.');
  if (!config.publishableKey) throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required.');
  if (!config.secretKey) {
    throw new Error('Configura DEMO_SUPABASE_SECRET_KEY localmente en .env.seed.local usando la Secret key del proyecto Supabase. No la pegues en el chat.');
  }
  if (!config.password || config.password.length < 8) {
    throw new Error('DEMO_FIXTURE_PASSWORD must contain at least 8 characters.');
  }
  return config;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function timedFetch(input, init = {}) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
}

const clientOptions = {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { fetch: timedFetch },
};

export function createAdminClient(config) {
  return createClient(config.url, config.secretKey, clientOptions);
}

export function createPublicClient(config) {
  return createClient(config.url, config.publishableKey, clientOptions);
}

export async function edgeRequest(config, accessToken, path, { method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
    apikey: config.publishableKey,
    Authorization: `Bearer ${accessToken}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await timedFetch(`${config.backendUrl}/${path.replace(/^\/+/, '')}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      break;
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (response === null) throw new Error(`Edge request ${path} failed before receiving a response after 3 attempts.`);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { throw new EdgeRequestError(path, response.status, 'invalid_json'); }
  }
  if (!response.ok) {
    const code = payload && typeof payload === 'object' && typeof payload.code === 'string' ? payload.code : null;
    throw new EdgeRequestError(path, response.status, code);
  }
  return payload;
}

export async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (!result.error || (result.error.status !== 0 && result.error.status < 500)) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    const { data, error } = result;
    if (error) {
      const status = Number.isInteger(error.status) ? error.status : 'unknown';
      const code = typeof error.code === 'string' ? error.code : 'unknown';
      throw new Error(`Unable to list Auth users with the local admin credential (${status}, ${code}).`);
    }
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

export async function findAuthUserByEmail(admin, email) {
  const normalized = email.trim().toLowerCase();
  const users = await listAllAuthUsers(admin);
  return users.find((user) => user.email?.toLowerCase() === normalized) ?? null;
}

export async function ensureFixtureAuthUsers(admin, config) {
  const known = new Map((await listAllAuthUsers(admin))
    .filter((user) => user.email && FIXTURE_EMAILS.has(user.email.toLowerCase()))
    .map((user) => [user.email.toLowerCase(), user]));
  const users = [];
  for (const fixture of FIXTURES) {
    let user = known.get(fixture.email) ?? null;
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: fixture.email,
        password: config.password,
        email_confirm: true,
        user_metadata: { fixture: true, fixtureUsername: fixture.username },
      });
      if (error || !data.user) throw new Error(`Unable to create fixture Auth user ${fixture.username}.`);
      user = data.user;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(user.id, {
        password: config.password,
        email_confirm: true,
        user_metadata: { ...user.user_metadata, fixture: true, fixtureUsername: fixture.username },
      });
      if (error || !data.user) throw new Error(`Unable to refresh fixture Auth user ${fixture.username}.`);
      user = data.user;
    }
    users.push({ ...fixture, id: user.id });
  }
  return users;
}

export async function signInFixture(config, fixture) {
  const client = createPublicClient(config);
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: config.password,
  });
  if (error || !data.session?.access_token || data.user?.id !== fixture.id) {
    throw new Error(`Unable to sign in fixture ${fixture.username}.`);
  }
  return { ...fixture, client, token: data.session.access_token };
}

export function deterministicUuid(label) {
  const bytes = createHash('sha256').update(`instagram-mobile-demo:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function createDemoPng(baseColor, variation = 0, size = 512) {
  const color = baseColor.map((channel, index) => Math.max(0, Math.min(255, channel + variation * (index === 1 ? 9 : 13))));
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y += 1) {
    const offset = y * rowLength;
    raw[offset] = 0;
    for (let x = 0; x < size; x += 1) {
      const pixel = offset + 1 + x * 4;
      const stripe = (x + y + variation * 47) % 160 < 12 ? 24 : 0;
      raw[pixel] = Math.min(255, color[0] + stripe);
      raw[pixel + 1] = Math.min(255, color[1] + stripe);
      raw[pixel + 2] = Math.min(255, color[2] + stripe);
      raw[pixel + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function uploadSigned(client, ticket, bytes) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { data, error } = await client.storage.from(ticket.bucket).uploadToSignedUrl(
    ticket.path,
    ticket.token,
    arrayBuffer,
    { contentType: 'image/png' },
  );
  return error === null && data?.path === ticket.path && data?.fullPath === `${ticket.bucket}/${ticket.path}`;
}

export async function readManifest() {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (parsed?.version === 1 && parsed.projectRef === PROJECT_REF && parsed.posts && typeof parsed.posts === 'object') return parsed;
  } catch {}
  return { version: 1, projectRef: PROJECT_REF, posts: {} };
}

export async function writeManifest(manifest) {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  const temporary = `${MANIFEST_PATH}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, MANIFEST_PATH);
}

export async function removeManifest() {
  await rm(MANIFEST_PATH, { force: true });
}

export function requireFixtureUsername(username) {
  const fixture = FIXTURE_BY_USERNAME.get(username);
  if (!fixture) throw new Error(`Unknown fixture username: ${username}.`);
  return fixture;
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error('Arguments must use --name value pairs.');
    options[flag.slice(2)] = value;
  }
  return { command, options };
}
