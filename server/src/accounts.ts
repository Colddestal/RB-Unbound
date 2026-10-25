import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  builtInModulePackages, deckWarnings, isDeckDefinition, starterDeckForModule,
  type DeckDefinition,
} from '@rb-unbound/tabletop';

const scrypt = promisify(scryptCallback);
const path = resolve(process.env.RB_UNBOUND_ACCOUNT_PATH ?? '.data/accounts.json');
const TOKEN_LIFETIME = 30 * 24 * 60 * 60 * 1000;

type AccountDeck = { id: string; deck: DeckDefinition; isPrivate?: boolean };
type Account = { id: string; username: string; salt: string; passwordHash: string; decks: AccountDeck[] };
type Login = { tokenHash: string; accountId: string; expiresAt: number };
type Store = { version: 1; accounts: Account[]; logins: Login[] };
const store: Store = { version: 1, accounts: [], logins: [] };
let pendingSave = Promise.resolve();

export function flushAccounts(): Promise<void> { return pendingSave; }

export async function loadAccounts(): Promise<void> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<Store>;
    if (value.version !== 1 || !Array.isArray(value.accounts) || !Array.isArray(value.logins)) throw new Error('Invalid account file');
    store.accounts = value.accounts;
    store.logins = value.logins.filter(item => item.expiresAt > Date.now());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function save(): Promise<void> {
  pendingSave = pendingSave.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
    await rename(`${path}.tmp`, path);
  });
  return pendingSave;
}

function hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function normalize(value: unknown): string { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validPassword(value: unknown): value is string { return typeof value === 'string' && value.length >= 12 && value.length <= 128; }

export function accountForToken(token: unknown): Account | undefined {
  if (typeof token !== 'string' || token.length > 150) return undefined;
  const login = store.logins.find(item => item.tokenHash === hash(token) && item.expiresAt > Date.now());
  return store.accounts.find(item => item.id === login?.accountId);
}

function newLogin(account: Account): string {
  const token = randomBytes(32).toString('base64url');
  store.logins.push({ tokenHash: hash(token), accountId: account.id, expiresAt: Date.now() + TOKEN_LIFETIME });
  return token;
}

export async function register(usernameInput: unknown, password: unknown): Promise<{ token: string; username: string } | null> {
  const username = normalize(usernameInput);
  if (!/^[a-z0-9_]{3,24}$/.test(username) || !validPassword(password) || store.accounts.some(item => item.username === username)) return null;
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString('hex');
  if (store.accounts.some(item => item.username === username)) return null;
  const starter = builtInModulePackages.map(bundle => ({ id: randomUUID(), deck: starterDeckForModule(bundle.module, bundle.cards), isPrivate: true }));
  const account: Account = { id: randomUUID(), username, salt, passwordHash, decks: starter };
  store.accounts.push(account);
  const token = newLogin(account);
  await save();
  return { token, username };
}

export async function login(usernameInput: unknown, password: unknown): Promise<{ token: string; username: string } | null> {
  const account = store.accounts.find(item => item.username === normalize(usernameInput));
  if (!account || typeof password !== 'string' || password.length > 128) return null;
  const actual = await scrypt(password, account.salt, 64) as Buffer;
  if (!timingSafeEqual(Buffer.from(account.passwordHash, 'hex'), actual)) return null;
  const token = newLogin(account);
  await save();
  return { token, username: account.username };
}

export async function logout(token: string): Promise<void> {
  store.logins = store.logins.filter(item => item.tokenHash !== hash(token));
  await save();
}

export function listDecks(account: Account): AccountDeck[] { return account.decks; }
export function discoverDecks(query: string, moduleId: string, page: number) {
  const search = query.trim().toLowerCase();
  const publicDecks = store.accounts.flatMap(owner => owner.decks
    .filter(item => item.isPrivate === false &&
      (!moduleId || item.deck.moduleId === moduleId) &&
      (!search || item.deck.name.toLowerCase().includes(search) || owner.username.includes(search)))
    .map(item => ({ id: item.id, name: item.deck.name, author: owner.username,
      moduleId: item.deck.moduleId, moduleVersion: item.deck.moduleVersion,
      cardCount: item.deck.cards.length })));
  const start = page * 24;
  return { decks: publicDecks.slice(start, start + 24), total: publicDecks.length, page };
}
export function publicDeck(id: string) {
  for (const owner of store.accounts) {
    const item = owner.decks.find(entry => entry.id === id && entry.isPrivate === false);
    if (item) return { id: item.id, author: owner.username, deck: item.deck };
  }
  return null;
}
export function accountDeck(account: Account, id: string): DeckDefinition | undefined {
  return account.decks.find(item => item.id === id)?.deck;
}
export async function createAccountDeck(account: Account, moduleId: string): Promise<AccountDeck | null> {
  const bundle = builtInModulePackages.find(item => item.module.id === moduleId);
  if (!bundle || account.decks.length >= 100) return null;
  const deck = { ...starterDeckForModule(bundle.module, bundle.cards), name: `New ${bundle.module.name} deck` };
  const item = { id: randomUUID(), deck, isPrivate: false };
  account.decks.push(item);
  await save();
  return item;
}
export async function saveAccountDeck(account: Account, id: string, value: unknown, isPrivate?: unknown): Promise<boolean> {
  const item = account.decks.find(entry => entry.id === id);
  if (!item || !value || typeof value !== 'object') return false;
  const candidate = value as DeckDefinition;
  const bundle = builtInModulePackages.find(bundle => bundle.module.id === candidate.moduleId && bundle.module.version === candidate.moduleVersion);
  if (!bundle || !isDeckDefinition(candidate, bundle.module, bundle.cards)) return false;
  if (JSON.stringify(candidate).length > 30_000) return false;
  if (isPrivate !== undefined && typeof isPrivate !== 'boolean') return false;
  item.deck = candidate;
  if (typeof isPrivate === 'boolean') item.isPrivate = isPrivate;
  await save();
  return true;
}
export async function copyPublicDeck(account: Account, id: string): Promise<AccountDeck | null> {
  const source = publicDeck(id);
  if (!source || account.decks.length >= 100) return null;
  const bundle = builtInModulePackages.find(item => item.module.id === source.deck.moduleId && item.module.version === source.deck.moduleVersion);
  if (!bundle || !isDeckDefinition(source.deck, bundle.module, bundle.cards)) return null;
  const item: AccountDeck = { id: randomUUID(), deck: structuredClone(source.deck), isPrivate: false };
  account.decks.push(item);
  await save();
  return item;
}
export async function deleteAccountDeck(account: Account, id: string): Promise<boolean> {
  const length = account.decks.length;
  account.decks = account.decks.filter(item => item.id !== id);
  if (account.decks.length === length) return false;
  await save();
  return true;
}
export function playableAccountDeck(account: Account, id: string): DeckDefinition | undefined {
  const deck = accountDeck(account, id);
  const bundle = builtInModulePackages.find(bundle => bundle.module.id === deck?.moduleId && bundle.module.version === deck.moduleVersion);
  return deck && bundle && isDeckDefinition(deck, bundle.module, bundle.cards) && deckWarnings(deck, bundle.cards).length === 0
    ? structuredClone(deck) : undefined;
}

const attempts = new Map<string, { count: number; since: number }>();
function mayAttempt(key: string): boolean {
  const now = Date.now();
  if (attempts.size > 10_000) {
    for (const [entry, value] of attempts) if (now - value.since > 10 * 60_000) attempts.delete(entry);
    if (attempts.size > 10_000) attempts.delete(attempts.keys().next().value!);
  }
  const current = attempts.get(key);
  const next = !current || now - current.since > 10 * 60_000 ? { count: 1, since: now } : { ...current, count: current.count + 1 };
  attempts.set(key, next);
  return next.count <= 12;
}
function respond(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 60_000) throw new Error('Request too large');
    text += String(chunk);
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON');
  return parsed as Record<string, unknown>;
}

export async function handleAccountApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let url: URL;
  try { url = new URL(req.url ?? '/', 'http://localhost'); }
  catch { respond(res, 400, { error: 'Invalid request URL.' }); return true; }
  if (!url.pathname.startsWith('/api/')) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (origin !== 'http://localhost:5173' && origin !== 'http://127.0.0.1:5173' && new URL(origin).host !== req.headers.host) {
        respond(res, 403, { error: 'Wrong origin.' }); return true;
      }
    } catch { respond(res, 403, { error: 'Wrong origin.' }); return true; }
  }
  try {
    if (url.pathname === '/api/discover/decks' && req.method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').slice(0, 80);
      const moduleId = (url.searchParams.get('moduleId') ?? '').slice(0, 64);
      const page = Math.max(0, Math.min(1000, Number.parseInt(url.searchParams.get('page') ?? '0', 10) || 0));
      respond(res, 200, discoverDecks(query, moduleId, page)); return true;
    }
    const discoveryMatch = /^\/api\/discover\/decks\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (discoveryMatch && req.method === 'GET') {
      const found = publicDeck(discoveryMatch[1]);
      respond(res, found ? 200 : 404, found ?? { error: 'Deck is unavailable.' }); return true;
    }
    if (url.pathname === '/api/account/register' && req.method === 'POST') {
      const input = await body(req);
      if (!mayAttempt(`register:${req.socket.remoteAddress}`)) { respond(res, 429, { error: 'Try again later.' }); return true; }
      const result = await register(input.username, input.password);
      respond(res, result ? 201 : 400, result ?? { error: 'Choose a unique username (3–24 letters, numbers, or _) and a password of at least 12 characters.' });
      return true;
    }
    if (url.pathname === '/api/account/login' && req.method === 'POST') {
      const input = await body(req);
      const name = normalize(input.username);
      if (!/^[a-z0-9_]{3,24}$/.test(name)) { respond(res, 401, { error: 'Incorrect username or password.' }); return true; }
      if (!mayAttempt(`login:${name}`)) { respond(res, 429, { error: 'Try again later.' }); return true; }
      const result = await login(input.username, input.password);
      respond(res, result ? 200 : 401, result ?? { error: 'Incorrect username or password.' });
      return true;
    }
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const account = accountForToken(token);
    if (!account) { respond(res, 401, { error: 'Sign in first.' }); return true; }
    if (url.pathname === '/api/account/me' && req.method === 'GET') { respond(res, 200, { username: account.username }); return true; }
    if (url.pathname === '/api/account/logout' && req.method === 'POST') { await logout(token); respond(res, 200, { ok: true }); return true; }
    if (url.pathname === '/api/decks' && req.method === 'GET') { respond(res, 200, { decks: listDecks(account) }); return true; }
    if (url.pathname === '/api/decks' && req.method === 'POST') {
      const input = await body(req);
      const created = typeof input.moduleId === 'string' ? await createAccountDeck(account, input.moduleId) : null;
      respond(res, created ? 201 : 400, created ?? { error: 'Cannot create another deck.' }); return true;
    }
    const copyMatch = /^\/api\/decks\/([0-9a-f-]{36})\/copy$/.exec(url.pathname);
    if (copyMatch && req.method === 'POST') {
      const copied = await copyPublicDeck(account, copyMatch[1]);
      respond(res, copied ? 201 : 404, copied ?? { error: 'Public deck is unavailable or your library is full.' }); return true;
    }
    const match = /^\/api\/decks\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (match && req.method === 'PUT') {
      const input = await body(req);
      const ok = await saveAccountDeck(account, match[1], input.deck, input.isPrivate);
      respond(res, ok ? 200 : 400, ok ? { ok: true } : { error: 'Deck is invalid or no longer exists.' }); return true;
    }
    if (match && req.method === 'DELETE') {
      const ok = await deleteAccountDeck(account, match[1]);
      respond(res, ok ? 200 : 404, { ok }); return true;
    }
    respond(res, 404, { error: 'Not found.' }); return true;
  } catch {
    respond(res, 400, { error: 'Invalid request.' }); return true;
  }
}
