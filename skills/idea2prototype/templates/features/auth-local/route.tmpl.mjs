// Idea2Prototype feature: auth-local — username/password accounts with
// scrypt hashing and HMAC-signed session cookies. Zero dependencies.
// Compose into other routes: import { requireAuth } from './auth.mjs'
//   methods: { GET: requireAuth(async (ctx) => [200, { hello: ctx.user.username }]) }
import { createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const USERS_FILE = join(process.cwd(), 'data', 'users.json');
const SECRET_FILE = join(process.cwd(), 'data', '.auth-secret');
const COOKIE_NAME = 'i2p_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let usersCache = null;
let secretCache = null;

async function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = JSON.parse(await readFile(USERS_FILE, 'utf8'));
  } catch {
    usersCache = [];
  }
  return usersCache;
}

async function persistUsers() {
  await mkdir(join(process.cwd(), 'data'), { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(usersCache, null, 2));
}

async function getSecret() {
  if (secretCache) return secretCache;
  try {
    secretCache = (await readFile(SECRET_FILE, 'utf8')).trim();
  } catch {
    secretCache = randomUUID();
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(SECRET_FILE, secretCache, { mode: 0o600 });
  }
  return secretCache;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Call getSecret() before makeToken — the token signs with secretCache.
function makeToken(username) {
  const body = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const mac = createHmac('sha256', secretCache).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearedCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function readToken(req) {
  const cookies = req.headers.cookie ?? '';
  const match = cookies.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}

async function userFromToken(req) {
  const token = readToken(req);
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', await getSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.u || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return { username: payload.u };
  } catch {
    return null;
  }
}

// Wrap any handler so it only runs for logged-in users (ctx.user set, else 401).
export function requireAuth(handler) {
  return async (ctx) => {
    const user = await userFromToken(ctx.req);
    if (!user) return [401, { error: 'authentication required' }];
    ctx.user = user;
    return handler(ctx);
  };
}

const validUsername = (u) => typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

export default [
  {
    path: '/api/auth/register',
    methods: {
      POST: async ({ body }) => {
        if (!body || typeof body !== 'object') return [400, { error: 'JSON object body required' }];
        const { username, password } = body;
        if (!validUsername(username)) return [400, { error: 'username must be 3-32 chars: letters, digits, _ . -' }];
        if (!validPassword(password)) return [400, { error: 'password must be 8-200 chars' }];
        const users = await loadUsers();
        if (users.some((u) => u.username === username)) return [409, { error: 'username already taken' }];
        const salt = randomUUID();
        users.push({ username, salt, hash: hashPassword(password, salt), createdAt: new Date().toISOString() });
        await persistUsers();
        return [201, { username }];
      },
    },
  },
  {
    path: '/api/auth/login',
    methods: {
      POST: async ({ body }) => {
        const username = body?.username;
        const password = body?.password;
        const user = (await loadUsers()).find((u) => u.username === username);
        if (!user || !verifyPassword(password ?? '', user.salt, user.hash)) {
          return [401, { error: 'invalid credentials' }];
        }
        await getSecret();
        return [200, { username }, { 'set-cookie': sessionCookie(makeToken(username)) }];
      },
    },
  },
  {
    path: '/api/auth/me',
    methods: {
      GET: async ({ req }) => {
        const user = await userFromToken(req);
        return user ? [200, { username: user.username }] : [401, { error: 'not logged in' }];
      },
    },
  },
  {
    path: '/api/auth/logout',
    methods: {
      POST: async () => [200, { ok: true }, { 'set-cookie': clearedCookie() }],
    },
  },
];
