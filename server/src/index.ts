import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { accountForToken, flushAccounts, handleAccountApi, loadAccounts, playableAccountDeck } from './accounts.js';
import { Server, type Socket } from 'socket.io';
import {
  addSpectator,
  appendChat,
  appendHistory,
  endTurn,
  initialTurn,
  createRoom,
  leaveRoom,
  occupySeat,
  requiredSeats,
  normalizeSpectatorLimit,
  setReady,
  setRoomSettings,
  startRoom,
  type MatchFormat,
  type RoomSettings,
  type RoomState,
  type SeriesBestOf,
  type SeatNumber,
  type TurnState,
} from '@rb-unbound/lobby';
import {
  applyAction,
  emptyCardTimeline,
  recordCardEdit,
  stepCardTimeline,
  builtInModulePackages,
  createInitialTableForModule,
  defaultGameModule,
  genericDuelModule,
  isModulePackage,
  modulePackageKey,
  isClientTableAction,
  migrateTableState,
  projectTable,
  type ClientTableAction,
  type CardTimeline,
  type GameModule,
  type ModulePackage,
  type PlayerId,
  type TableAction,
  type TableState,
  pileCapabilities,
  sectionCards,
  type DeckDefinition,
  zoneBehavior,
} from '@rb-unbound/tabletop';
import { approximatePayloadBytes, RateLimiter, type LimitRule } from './rate-limit.js';
import {
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  type PersistenceSnapshot,
  type MatchPhase,
} from './persistence.js';

type Session = {
  tokenHash: string;
  memberId: string;
  displayName: string;
  roomCode: string;
  seat?: PlayerId;
  spectator: boolean;
  connectedSocketId?: string;
  disconnectedAt?: number;
};

type MatchRecord = {
  revision: number;
  table: TableState;
  turn: TurnState;
  lastActionSequence: Map<string, number>;
  phase: MatchPhase;
  selectedDecks: Map<PlayerId, DeckDefinition>;
  selectedAccounts: Map<PlayerId, string>;
  pickedBattlefields: Set<PlayerId>;
  mulliganLocked: Set<PlayerId>;
  cardTimelines: Map<PlayerId, CardTimeline>;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const limiter = new RateLimiter();
const violations = new Map<string, { count: number; windowStartedAt: number }>();

const DEFAULT_LIMIT: LimitRule = { capacity: 20, refillPerSecond: 5 };
const EVENT_LIMITS: Record<string, LimitRule> = {
  'session:resume': { capacity: 5, refillPerSecond: 0.5 },
  'room:create': { capacity: 3, refillPerSecond: 0.1 },
  'room:join-seat': { capacity: 6, refillPerSecond: 0.3 },
  'room:join-spectator': { capacity: 6, refillPerSecond: 0.3 },
  'room:ready': { capacity: 8, refillPerSecond: 1 },
  'room:settings': { capacity: 8, refillPerSecond: 0.5 },
  'room:start': { capacity: 4, refillPerSecond: 0.2 },
  'room:leave': { capacity: 3, refillPerSecond: 0.2 },
  'chat:send': { capacity: 5, refillPerSecond: 0.5 },
  'match:request-state': { capacity: 8, refillPerSecond: 1 },
  'match:end-turn': { capacity: 4, refillPerSecond: 0.5 },
  'match:select-deck': { capacity: 5, refillPerSecond: 0.2 },
  'match:pick-battlefield': { capacity: 4, refillPerSecond: 0.2 },
  'match:mulligan': { capacity: 4, refillPerSecond: 0.2 },
  'match:action': { capacity: 90, refillPerSecond: 30 },
  'match:undo': { capacity: 12, refillPerSecond: 3 },
  'match:redo': { capacity: 12, refillPerSecond: 3 },
};

const EVENT_MAX_BYTES: Record<string, number> = {
  'session:resume': 256,
  'room:create': 220_000,
  'room:join-seat': 512,
  'room:join-spectator': 512,
  'room:ready': 128,
  'room:settings': 220_000,
  'room:start': 128,
  'room:leave': 64,
  'chat:send': 1200,
  'match:request-state': 64,
  'match:end-turn': 128,
  'match:select-deck': 128,
  'match:pick-battlefield': 128,
  'match:mulligan': 512,
  'match:action': 2048,
  'match:undo': 64,
  'match:redo': 64,
};
const OBJECT_PAYLOAD_EVENTS = new Set(Object.keys(EVENT_MAX_BYTES).filter(event =>
  event !== 'room:leave' && event !== 'match:request-state' && event !== 'match:undo' && event !== 'match:redo'));

const siteRoot = resolve(process.cwd(), 'apps/web/dist');
const port = Number(process.env.RB_UNBOUND_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid RB_UNBOUND_PORT');
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const httpServer = createServer(async (req, res) => {
  if (await handleAccountApi(req, res)) return;
  if (req.url === '/healthz' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok', commit: process.env.RB_UNBOUND_RELEASE_SHA ?? 'development' }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(siteRoot, filename);
  const pathFromRoot = relative(siteRoot, filePath);
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || pathname.includes('\\') || filename.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': filename === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404).end();
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 250_000,
  serveClient: false,
});

const rooms = new Map<string, RoomState>();
const matches = new Map<string, MatchRecord>();
const modulePackages = new Map<string, ModulePackage>(
  builtInModulePackages.map(bundle => [modulePackageKey(bundle.module), bundle]),
);
const sessions = new Map<string, Session>();
const socketSession = new Map<string, string>();

let saveTimer: NodeJS.Timeout | undefined;
let saveChain = Promise.resolve();

function code(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (!rooms.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a room code');
}

function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function inviteHash(code: string): string {
  return createHash('sha256').update(`rb-unbound-invite:${code}`).digest('hex');
}

function validInvite(room: RoomState, value: unknown): boolean {
  if (room.settings.isPublic) return true;
  if (!room.inviteCodeHash || typeof value !== 'string') return false;
  const candidate = value.trim().toUpperCase();
  if (candidate.length !== 8) return false;
  const expected = Buffer.from(room.inviteCodeHash, 'hex');
  const actual = Buffer.from(inviteHash(candidate), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 32 ? name : null;
}

function safeFormat(value: unknown): MatchFormat | undefined {
  return value === '1v1' || value === '2v2' || value === 'ffa4' ? value : undefined;
}

function safeBestOf(value: unknown): SeriesBestOf | undefined {
  return value === 1 || value === 3 ? value : undefined;
}

function findPackage(moduleId: unknown, moduleVersion?: unknown): ModulePackage | undefined {
  if (typeof moduleId !== 'string') return undefined;
  for (const bundle of modulePackages.values()) {
    if (bundle.module.id === moduleId && (moduleVersion === undefined || bundle.module.version === moduleVersion)) return bundle;
  }
  return undefined;
}

function registerPackage(value: unknown): ModulePackage | undefined {
  if (!isModulePackage(value)) return undefined;
  const key = modulePackageKey(value.module);
  const builtIn = builtInModulePackages.find(bundle => modulePackageKey(bundle.module) === key);
  if (builtIn) return builtIn;
  const existing = modulePackages.get(key);
  if (existing) return isDeepStrictEqual(existing, value) ? existing : undefined;
  modulePackages.set(key, value);
  return value;
}

function packageForRoom(room: RoomState): ModulePackage {
  return findPackage(room.settings.moduleId, room.settings.moduleVersion) ?? builtInModulePackages[0];
}

function moduleForRoom(room: RoomState): GameModule {
  return packageForRoom(room).module;
}

function moduleSupportsFormat(module: GameModule, format: MatchFormat): boolean {
  return module.supportedFormats.includes(format);
}

function rateIdentity(socket: Socket): string {
  return currentSession(socket)?.memberId ?? `socket:${socket.id}`;
}

function recordViolation(socket: Socket, reason: string): void {
  const key = rateIdentity(socket);
  const now = Date.now();
  const existing = violations.get(key);
  const window = !existing || now - existing.windowStartedAt > 60_000
    ? { count: 0, windowStartedAt: now }
    : existing;
  window.count += 1;
  violations.set(key, window);

  socket.emit('abuse:warning', { reason, violations: window.count });
  if (window.count >= 12) socket.disconnect(true);
}

function currentSession(socket: Socket): Session | undefined {
  const tokenHash = socketSession.get(socket.id);
  return tokenHash ? sessions.get(tokenHash) : undefined;
}

function socketForMember(memberId: string): Socket | undefined {
  const session = [...sessions.values()].find(item => item.memberId === memberId);
  return session?.connectedSocketId ? io.sockets.sockets.get(session.connectedSocketId) : undefined;
}

function makeSnapshot(): PersistenceSnapshot {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    rooms: [...rooms.values()],
    matches: [...matches.entries()].map(([roomCode, match]) => ({
      roomCode,
      revision: match.revision,
      table: match.table,
      turn: match.turn,
      lastActionSequence: [...match.lastActionSequence.entries()],
      phase: match.phase,
      selectedDecks: [...match.selectedDecks.entries()],
      selectedAccounts: [...match.selectedAccounts.entries()],
      pickedBattlefields: [...match.pickedBattlefields],
      mulliganLocked: [...match.mulliganLocked],
      cardTimelines: [...match.cardTimelines.entries()],
    })),
    modules: [...modulePackages.values()],
    sessions: [...sessions.values()].map(session => ({
      tokenHash: session.tokenHash,
      memberId: session.memberId,
      displayName: session.displayName,
      roomCode: session.roomCode,
      seat: session.seat,
      spectator: session.spectator,
      ...(session.connectedSocketId ? {} : { disconnectedAt: session.disconnectedAt ?? Date.now() }),
    })),
  };
}

function flushSnapshot(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  const snapshot = makeSnapshot();
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => saveSnapshot(snapshot))
    .catch(error => console.error('Failed to persist multiplayer snapshot:', error));
  return saveChain;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushSnapshot(); }, 75);
  saveTimer.unref();
}

function publicRoom(room: RoomState) {
  return {
    code: room.code,
    status: room.status,
    settingsLocked: room.settingsLocked,
    settings: room.settings,
    modulePackage: packageForRoom(room),
    seats: room.seats.map(seat => ({
      seat: seat.seat,
      displayName: seat.displayName,
      team: seat.team,
      ready: seat.ready,
      occupied: Boolean(seat.memberId),
      connected: seat.memberId ? Boolean(socketForMember(seat.memberId)) : false,
      owner: seat.memberId === room.ownerMemberId,
    })),
    spectators: room.spectators.map(spectator => ({
      displayName: spectator.displayName,
      connected: Boolean(socketForMember(spectator.memberId)),
    })),
    chat: room.chat.map(({ memberId: _memberId, ...message }) => message),
    history: room.history,
    series: room.series,
  };
}

function emitRoom(room: RoomState): void {
  io.to(room.code).emit('room:update', publicRoom(room));
}

function fail(socket: Socket, message: string): void {
  socket.emit('room:error', { message });
}

function shuffleIds(ids: string[]): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function accountForSocket(socket: Socket) {
  return accountForToken((socket.handshake.auth as { accountToken?: unknown })?.accountToken);
}

function requiresDeckSelection(room: RoomState): boolean {
  return builtInModulePackages.some(bundle =>
    bundle.module.id === room.settings.moduleId && bundle.module.version === room.settings.moduleVersion);
}

function prepareOpeningDecks(table: TableState, players: readonly PlayerId[]): TableState {
  let cards = table.cards;
  for (const player of players) {
    const ids = shuffleIds(cards.filter(card => card.owner === player && card.zone === 'deck').map(card => card.id));
    const order = new Map(ids.map((id, index) => [id, index]));
    cards = cards.map(card => order.has(card.id) ? { ...card, order: order.get(card.id)! } : card);
  }
  return { ...table, cards };
}

function drawOpeningHands(match: MatchRecord, players: readonly PlayerId[]): void {
  for (const player of players) for (let index = 0; index < 4; index += 1) {
    match.table = applyAction(match.table, { type: 'draw', player, fromZone: 'deck', toZone: 'hand', faceUp: true });
  }
  match.phase = 'mulligan';
  match.revision += 1;
}

function seatFor(room: RoomState, memberId: string): PlayerId | undefined {
  const seat = room.seats.find(item => item.memberId === memberId)?.seat;
  return seat === 1 || seat === 2 || seat === 3 || seat === 4 ? seat : undefined;
}

function visibleHandsForSeat(room: RoomState, seatNumber: PlayerId): PlayerId[] {
  const visible: PlayerId[] = [seatNumber];
  if (room.settings.format !== '2v2' || !room.settings.shareTeamHands) return visible;
  const seat = room.seats.find(item => item.seat === seatNumber);
  if (!seat) return visible;
  for (const teammate of room.seats) {
    if (teammate.memberId && teammate.team === seat.team && teammate.seat !== seatNumber) {
      visible.push(teammate.seat as PlayerId);
    }
  }
  return visible;
}

function moduleZonePolicy(room: RoomState) {
  const module = moduleForRoom(room);
  return {
    module,
    allowedZones: module.zones.map(zone => zone.id),
    stackableZones: module.zones.filter(zone => zone.stackable).map(zone => zone.id),
    zoneGroups: new Map(module.zones.map(zone => [zone.id, zone.group ?? zone.id] as const)),
    publicZones: module.zones.filter(zone => zone.visibility === 'public').map(zone => zone.id),
    pileZones: module.zones.filter(zone => zoneBehavior(zone) === 'pile').map(zone => zone.id),
    publicCountZones: module.zones
      .filter(zone => zone.kind === 'deck' || zone.pile?.countPublic === true)
      .map(zone => zone.id),
    drawDestinations: new Map(module.zones.flatMap(zone => {
      const capabilities = pileCapabilities(module, zone);
      if (!capabilities.drawToZoneId) return [];
      const destination = module.zones.find(candidate => candidate.id === capabilities.drawToZoneId);
      const faceUp = destination ? (destination.visibility === 'public' || zoneBehavior(destination) === 'hand') : false;
      return [[zone.id, { toZone: capabilities.drawToZoneId, faceUp }] as const];
    })),
    shuffleZones: module.zones.filter(zone => pileCapabilities(module, zone).shuffle).map(zone => zone.id),
  };
}

function historyActorName(room: RoomState, seat: PlayerId): string {
  return room.seats.find(item => item.seat === seat)?.displayName ?? `Player ${seat}`;
}

function visibleHistoryCardLabel(room: RoomState, table: TableState, cardId: string): string | undefined {
  const card = table.cards.find(item => item.id === cardId);
  if (!card || !card.faceUp) return undefined;
  const publicZones = new Set(moduleZonePolicy(room).publicZones);
  return publicZones.has(card.zone) ? card.label : undefined;
}

function zoneHistoryLabel(room: RoomState, zoneId: string): string {
  const zone = moduleForRoom(room).zones.find(item => item.id === zoneId || item.kind === zoneId);
  return zone?.label ?? zoneId;
}

function matchHistoryEntry(
  room: RoomState,
  before: TableState,
  after: TableState,
  action: TableAction,
  seat: PlayerId,
): { text: string; kind: 'draw' | 'shuffle' | 'tap' | 'flip' | 'zone' | 'stack'; actorSeat: PlayerId } | null {
  if (action.type === 'move') return null;

  const actor = historyActorName(room, seat);
  if (action.type === 'draw') return { text: `${actor} drew a card.`, kind: 'draw', actorSeat: seat };
  if (action.type === 'shuffle') return { text: `${actor} shuffled their deck.`, kind: 'shuffle', actorSeat: seat };

  const afterCard = 'id' in action ? after.cards.find(card => card.id === action.id) : undefined;
  const beforeCard = 'id' in action ? before.cards.find(card => card.id === action.id) : undefined;
  const visibleLabel = afterCard
    ? visibleHistoryCardLabel(room, after, afterCard.id)
    : (beforeCard ? visibleHistoryCardLabel(room, before, beforeCard.id) : undefined);
  const subject = visibleLabel ?? 'a card';

  if (action.type === 'rotate') {
    return {
      text: `${actor} ${afterCard?.rotation === 90 ? 'tapped' : 'untapped'} ${subject}.`,
      kind: 'tap',
      actorSeat: seat,
    };
  }
  if (action.type === 'flip') {
    return {
      text: afterCard?.faceUp && visibleLabel
        ? `${actor} revealed ${visibleLabel}.`
        : `${actor} flipped a card face-down.`,
      kind: 'flip',
      actorSeat: seat,
    };
  }
  if (action.type === 'to-zone') {
    return {
      text: `${actor} moved ${subject} to ${zoneHistoryLabel(room, action.zone)}.`,
      kind: 'zone',
      actorSeat: seat,
    };
  }
  if (action.type === 'stack') {
    return { text: `${actor} stacked ${subject}.`, kind: 'stack', actorSeat: seat };
  }
  if (action.type === 'unstack') {
    return { text: `${actor} unstacked ${subject}.`, kind: 'stack', actorSeat: seat };
  }
  return null;
}

function appendMatchHistory(room: RoomState, entry: ReturnType<typeof matchHistoryEntry>): RoomState {
  if (!entry) return room;
  return appendHistory(room, {
    id: randomUUID(),
    text: entry.text,
    createdAt: new Date().toISOString(),
    kind: entry.kind,
    actorSeat: entry.actorSeat,
  });
}

function emitMatchViews(room: RoomState): void {
  const match = matches.get(room.code);
  if (!match) return;
  const policy = moduleZonePolicy(room);

  for (const seat of room.seats) {
    if (!seat.memberId) continue;
    socketForMember(seat.memberId)?.emit('match:update', {
      seat: seat.seat,
      spectator: false,
      revision: match.revision,
      turn: match.turn,
      phase: match.phase,
      selectedSeats: [...match.selectedDecks.keys()],
      pickedSeats: [...match.pickedBattlefields],
      mulliganSeats: [...match.mulliganLocked],
      canUndo: Boolean(match.cardTimelines.get(seat.seat as PlayerId)?.past.length),
      canRedo: Boolean(match.cardTimelines.get(seat.seat as PlayerId)?.future.length),
      table: projectTable(
        match.table,
        seat.seat as PlayerId,
        visibleHandsForSeat(room, seat.seat as PlayerId),
        policy.publicZones,
        policy.publicCountZones,
      ),
    });
  }

  for (const spectator of room.spectators) {
    socketForMember(spectator.memberId)?.emit('match:update', {
      spectator: true,
      revision: match.revision,
      turn: match.turn,
      phase: match.phase,
      selectedSeats: [...match.selectedDecks.keys()],
      pickedSeats: [...match.pickedBattlefields],
      mulliganSeats: [...match.mulliganLocked],
      canUndo: false,
      canRedo: false,
      table: projectTable(match.table, undefined, undefined, policy.publicZones, policy.publicCountZones),
    });
  }
}

function toServerAction(
  table: TableState,
  seat: PlayerId,
  action: ClientTableAction,
  drawDestinations: ReadonlyMap<string, { toZone: string; faceUp: boolean }>,
  shuffleZones: readonly string[],
): TableAction | null {
  if (action.type === 'draw') {
    const fromZone = action.fromZone ?? 'deck';
    const policy = drawDestinations.get(fromZone);
    if (!policy) return null;
    return { type: 'draw', player: seat, fromZone, toZone: policy.toZone, faceUp: policy.faceUp };
  }
  if (action.type === 'shuffle') {
    const zone = action.zone ?? 'deck';
    if (!shuffleZones.includes(zone)) return null;
    const ids = table.cards
      .filter(card => card.owner === seat && card.zone === zone)
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    return { type: 'shuffle', player: seat, zone, orderedIds: shuffleIds(ids) };
  }
  if (action.type === 'move') return { ...action, actor: seat };
  if (action.type === 'rotate') return { ...action, actor: seat };
  if (action.type === 'flip') return { ...action, actor: seat };
  if (action.type === 'to-zone') return { ...action, actor: seat };
  if (action.type === 'stack') return { ...action, actor: seat };
  if (action.type === 'unstack') return { ...action, actor: seat };
  return null;
}

function establishSession(socket: Socket, room: RoomState, displayName: string, memberId: string, seat?: PlayerId, spectator = false): Session {
  const token = newSessionToken();
  const tokenHash = hashToken(token);
  const session: Session = {
    tokenHash,
    memberId,
    displayName,
    roomCode: room.code,
    seat,
    spectator,
    connectedSocketId: socket.id,
  };
  sessions.set(tokenHash, session);
  socketSession.set(socket.id, tokenHash);
  socket.join(room.code);
  socket.emit('session:issued', { token, roomCode: room.code, seat, spectator });
  socket.emit('room:identity', { code: room.code, seat, spectator });
  scheduleSave();
  return session;
}

function expireSession(tokenHash: string): void {
  const session = sessions.get(tokenHash);
  if (!session || session.connectedSocketId) return;
  const room = rooms.get(session.roomCode);
  if (room?.status === 'active') return;
  if (!session.disconnectedAt || Date.now() - session.disconnectedAt < SESSION_TTL_MS) return;

  if (room?.status === 'lobby') {
    const updated = leaveRoom(room, session.memberId);
    rooms.set(room.code, updated);
    emitRoom(updated);
  }
  sessions.delete(tokenHash);
  scheduleSave();
}

function scheduleExpiry(tokenHash: string, disconnectedAt: number): void {
  const remaining = Math.max(1000, SESSION_TTL_MS - (Date.now() - disconnectedAt) + 1000);
  const timeout = setTimeout(() => expireSession(tokenHash), remaining);
  timeout.unref();
}

function markDisconnected(socket: Socket): void {
  const tokenHash = socketSession.get(socket.id);
  socketSession.delete(socket.id);
  if (!tokenHash) return;

  const session = sessions.get(tokenHash);
  if (!session || session.connectedSocketId !== socket.id) return;
  session.connectedSocketId = undefined;
  session.disconnectedAt = Date.now();

  const room = rooms.get(session.roomCode);
  if (room) emitRoom(room);

  if (room?.status !== 'active') scheduleExpiry(tokenHash, session.disconnectedAt);
  scheduleSave();
}

async function restoreState(): Promise<void> {
  const snapshot = await loadSnapshot();
  if (!snapshot) return;

  for (const bundle of snapshot.modules ?? []) registerPackage(bundle);

  for (const savedRoom of snapshot.rooms) {
    const restoredModule = findPackage(savedRoom.settings.moduleId, savedRoom.settings.moduleVersion)?.module ?? genericDuelModule;
    const room: RoomState = {
      ...savedRoom,
      history: Array.isArray(savedRoom.history) ? savedRoom.history : [],
      settings: {
        ...savedRoom.settings,
        bestOf: savedRoom.settings.bestOf === 3 ? 3 : 1,
        spectatorLimit: normalizeSpectatorLimit(savedRoom.settings.spectatorLimit, 4),
        allowSpectators: savedRoom.settings.allowSpectators !== false &&
          normalizeSpectatorLimit(savedRoom.settings.spectatorLimit, 4) > 0,
        moduleId: restoredModule.id,
        moduleVersion: restoredModule.version,
      },
    };
    rooms.set(room.code, room);
  }
  for (const record of snapshot.matches) {
    if (!rooms.has(record.roomCode)) continue;
    const table = migrateTableState(record.table);
    if (!table) continue;
    matches.set(record.roomCode, {
      revision: record.revision,
      table,
      turn: record.turn && Number.isSafeInteger(record.turn.number) && record.turn.number >= 1 &&
        requiredSeats(rooms.get(record.roomCode)!.settings.format).includes(record.turn.seat)
        ? record.turn : initialTurn(rooms.get(record.roomCode)!.settings.format),
      lastActionSequence: new Map(record.lastActionSequence),
      phase: record.phase ?? 'playing',
      selectedDecks: new Map(record.selectedDecks ?? []),
      selectedAccounts: new Map(record.selectedAccounts ?? []),
      pickedBattlefields: new Set(record.pickedBattlefields ?? []),
      mulliganLocked: new Set(record.mulliganLocked ?? []),
      cardTimelines: new Map(Array.isArray(record.cardTimelines) ? record.cardTimelines.filter(entry =>
        Array.isArray(entry) && [1, 2, 3, 4].includes(entry[0]) && Array.isArray(entry[1]?.past) && Array.isArray(entry[1]?.future)) : []),
    });
  }

  const now = Date.now();
  for (const saved of snapshot.sessions) {
    const room = rooms.get(saved.roomCode);
    if (!room) continue;
    const disconnectedAt = saved.disconnectedAt ?? now;
    const session: Session = { ...saved, disconnectedAt };
    sessions.set(saved.tokenHash, session);
    if (room.status !== 'active') scheduleExpiry(saved.tokenHash, disconnectedAt);
  }

  console.log(`Restored ${rooms.size} rooms, ${matches.size} matches and ${sessions.size} sessions from ${snapshotPath()}`);
}

io.on('connection', socket => {
  socket.use((packet, next) => {
    const [event, ...args] = packet;
    const eventName = typeof event === 'string' ? event : 'unknown';
    const rule = EVENT_LIMITS[eventName] ?? DEFAULT_LIMIT;
    const maxBytes = EVENT_MAX_BYTES[eventName] ?? 4096;
    const identity = rateIdentity(socket);

    if (OBJECT_PAYLOAD_EVENTS.has(eventName) && args.length > 0 &&
      (!args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]))) {
      recordViolation(socket, 'invalid-payload');
      return next(new Error('Invalid request.'));
    }

    if (approximatePayloadBytes(args) > maxBytes) {
      recordViolation(socket, 'payload-too-large');
      return next(new Error('Payload too large.'));
    }

    if (!limiter.allow(`${identity}:${eventName}`, rule)) {
      recordViolation(socket, 'rate-limited');
      return next(new Error('Too many requests.'));
    }

    next();
  });

  socket.emit('status', { message: 'Connected to RB Unbound development multiplayer server.' });

  socket.on('session:resume', (payload: { token?: unknown } = {}) => {
    if (typeof payload.token !== 'string' || payload.token.length > 100) return fail(socket, 'Invalid session token.');
    const tokenHash = hashToken(payload.token);
    const session = sessions.get(tokenHash);
    if (!session) return socket.emit('session:invalid');

    const room = rooms.get(session.roomCode);
    if (!room) {
      sessions.delete(tokenHash);
      scheduleSave();
      return socket.emit('session:invalid');
    }

    if (session.connectedSocketId && session.connectedSocketId !== socket.id) {
      io.sockets.sockets.get(session.connectedSocketId)?.disconnect(true);
    }

    session.connectedSocketId = socket.id;
    session.disconnectedAt = undefined;
    socketSession.set(socket.id, tokenHash);
    socket.join(room.code);

    const lastActionSequence = matches.get(room.code)?.lastActionSequence.get(session.memberId) ?? 0;
    socket.emit('session:resumed', {
      roomCode: room.code,
      seat: session.seat,
      spectator: session.spectator,
      lastActionSequence,
    });
    socket.emit('room:identity', { code: room.code, seat: session.seat, spectator: session.spectator });
    socket.emit('room:update', publicRoom(room));
    if (room.status === 'active') emitMatchViews(room);
    emitRoom(room);
    scheduleSave();
  });

  socket.on('room:create', (payload: { displayName?: unknown; roomName?: unknown; format?: unknown; bestOf?: unknown; isPublic?: unknown; spectatorLimit?: unknown; moduleId?: unknown; moduleVersion?: unknown; modulePackage?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Choose a display name between 1 and 32 characters.');

    const memberId = randomUUID();
    const format = safeFormat(payload.format) ?? '1v1';
    const bestOf = safeBestOf(payload.bestOf) ?? 1;
    const suppliedPackage = payload.modulePackage === undefined ? undefined : registerPackage(payload.modulePackage);
    if (payload.modulePackage !== undefined && !suppliedPackage) return fail(socket, 'Invalid or unsupported module package.');
    const requestedPackage = suppliedPackage ??
      (payload.moduleId === undefined
        ? builtInModulePackages.find(bundle => bundle.module.id === defaultGameModule.id) ?? builtInModulePackages[0]
        : findPackage(payload.moduleId, payload.moduleVersion));
    if (!requestedPackage) return fail(socket, 'That game module/version is not installed on the server.');
    const selectedModule = requestedPackage.module;
    if (!moduleSupportsFormat(selectedModule, format)) return fail(socket, 'That game module does not support this match format.');
    const roomName = typeof payload.roomName === 'string' ? payload.roomName.trim().slice(0, 60) : '';
    const isPublic = payload.isPublic === true;
    const spectatorLimit = normalizeSpectatorLimit(payload.spectatorLimit, 4);
    let room = createRoom(code(), memberId, displayName, {
      format,
      bestOf,
      spectatorLimit,
      allowSpectators: spectatorLimit > 0,
      moduleId: selectedModule.id,
      moduleVersion: selectedModule.version,
      isPublic,
      ...(roomName ? { roomName } : {}),
    });
    if (!isPublic) {
      const inviteCode = newInviteCode();
      room = { ...room, inviteCodeHash: inviteHash(inviteCode) };
      socket.emit('room:invite-code', { roomCode: room.code, inviteCode });
    }

    rooms.set(room.code, room);
    establishSession(socket, room, displayName, memberId, 1, false);
    socket.emit('room:created', { code: room.code });
    emitRoom(room);
    scheduleSave();
  });

  socket.on('room:join-seat', (payload: { code?: unknown; displayName?: unknown; seat?: unknown; inviteCode?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    const seat = payload.seat;
    if (!displayName || !(seat === 1 || seat === 2 || seat === 3 || seat === 4)) return fail(socket, 'Invalid join request.');

    const room = rooms.get(roomCode);
    if (!room || room.status !== 'lobby') return fail(socket, 'Room not found or already started.');
    if (!validInvite(room, payload.inviteCode)) return fail(socket, 'This private room requires a valid invite code.');

    const memberId = randomUUID();
    const updated = occupySeat(room, memberId, displayName, seat as SeatNumber);
    if (updated === room) return fail(socket, 'That seat is unavailable.');

    rooms.set(roomCode, updated);
    establishSession(socket, updated, displayName, memberId, seat as PlayerId, false);
    emitRoom(updated);
    scheduleSave();
  });

  socket.on('room:join-spectator', (payload: { code?: unknown; displayName?: unknown; inviteCode?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Invalid spectator name.');

    const room = rooms.get(roomCode);
    if (!room) return fail(socket, 'Room not found.');
    if (!validInvite(room, payload.inviteCode)) return fail(socket, 'This private room requires a valid invite code.');

    const memberId = randomUUID();
    const updated = addSpectator(room, memberId, displayName);
    if (updated === room) {
      if (!room.settings.allowSpectators || room.settings.spectatorLimit < 1) return fail(socket, 'Spectators are disabled for this room.');
      if (room.spectators.length >= room.settings.spectatorLimit) return fail(socket, 'All spectator slots are full.');
      return fail(socket, 'You are already in this room.');
    }

    rooms.set(roomCode, updated);
    establishSession(socket, updated, displayName, memberId, undefined, true);
    emitRoom(updated);
    if (updated.status === 'active') emitMatchViews(updated);
    scheduleSave();
  });

  socket.on('room:ready', (payload: { ready?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room || typeof payload.ready !== 'boolean') return fail(socket, 'You are not in a lobby.');

    const updated = setReady(room, session.memberId, payload.ready);
    rooms.set(room.code, updated);
    emitRoom(updated);
    scheduleSave();
  });

  socket.on('room:settings', (payload: Partial<RoomSettings> & { modulePackage?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room) return fail(socket, 'You are not in a room.');
    if (room.ownerMemberId !== session.memberId || room.status !== 'lobby' || room.settingsLocked)
      return fail(socket, 'Only the room owner can change unlocked lobby settings.');

    const safePatch: Partial<RoomSettings> = {};
    if (typeof payload.roomName === 'string') safePatch.roomName = payload.roomName.trim().slice(0, 60);
    const requestedFormat = safeFormat(payload.format) ?? room.settings.format;
    const suppliedPackage = payload.modulePackage === undefined ? undefined : registerPackage(payload.modulePackage);
    if (payload.modulePackage !== undefined && !suppliedPackage) return fail(socket, 'Invalid or unsupported module package.');
    const requestedPackage = suppliedPackage ??
      (payload.moduleId !== undefined ? findPackage(payload.moduleId, payload.moduleVersion) : packageForRoom(room));
    if (!requestedPackage) return fail(socket, 'That game module/version is not installed on the server.');
    const requestedModule = requestedPackage.module;
    if (!moduleSupportsFormat(requestedModule, requestedFormat)) return fail(socket, 'That game module does not support this match format.');
    if (safeFormat(payload.format)) safePatch.format = requestedFormat;
    if (payload.moduleId !== undefined) {
      safePatch.moduleId = requestedModule.id;
      safePatch.moduleVersion = requestedModule.version;
    }
    if (payload.ruleset === 'standard' || payload.ruleset === 'unrestricted' || payload.ruleset === 'custom') safePatch.ruleset = payload.ruleset;
    if (typeof payload.isPublic === 'boolean') safePatch.isPublic = payload.isPublic;
    if (typeof payload.allowSpectators === 'boolean') safePatch.allowSpectators = payload.allowSpectators;
    if (typeof payload.spectatorLimit === 'number' && Number.isInteger(payload.spectatorLimit) && payload.spectatorLimit >= 0 && payload.spectatorLimit <= 4) {
      if (payload.spectatorLimit < room.spectators.length) {
        return fail(socket, `Spectator limit cannot be lower than the ${room.spectators.length} currently connected spectator${room.spectators.length === 1 ? '' : 's'}.`);
      }
      safePatch.spectatorLimit = payload.spectatorLimit;
      if (payload.spectatorLimit === 0) safePatch.allowSpectators = false;
    }
    if (typeof payload.readyCheck === 'boolean') safePatch.readyCheck = payload.readyCheck;
    if (typeof payload.shareTeamHands === 'boolean') safePatch.shareTeamHands = payload.shareTeamHands;
    const requestedBestOf = safeBestOf(payload.bestOf);
    if (requestedBestOf) safePatch.bestOf = requestedBestOf;
    if (payload.turnTimerSeconds === null || (
      typeof payload.turnTimerSeconds === 'number' &&
      Number.isInteger(payload.turnTimerSeconds) &&
      payload.turnTimerSeconds >= 15 &&
      payload.turnTimerSeconds <= 3600
    )) safePatch.turnTimerSeconds = payload.turnTimerSeconds;

    let updated = setRoomSettings(room, session.memberId, safePatch);
    if (updated === room) return fail(socket, 'Only the room owner can change unlocked lobby settings.');

    if (safePatch.isPublic === true) {
      updated = { ...updated, inviteCodeHash: undefined };
    } else if (safePatch.isPublic === false && room.settings.isPublic) {
      const inviteCode = newInviteCode();
      updated = { ...updated, inviteCodeHash: inviteHash(inviteCode) };
      socket.emit('room:invite-code', { roomCode: room.code, inviteCode });
    }

    rooms.set(room.code, updated);
    emitRoom(updated);
    scheduleSave();
  });

  socket.on('room:start', (payload: { force?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room) return fail(socket, 'You are not in a room.');

    const force = payload.force === true;
    const updated = startRoom(room, session.memberId, force);
    if (updated === room) {
      return fail(socket, force
        ? 'Force start requires the room owner and every required seat to be occupied.'
        : 'All required players must be ready before the owner can start.');
    }

    const started = appendHistory(updated, {
      id: randomUUID(),
      text: `Match started · ${moduleForRoom(updated).name} · ${updated.settings.format.toUpperCase()} · BO${updated.settings.bestOf}.`,
      createdAt: new Date().toISOString(),
      kind: 'system',
    });
    rooms.set(room.code, started);
    matches.set(room.code, {
      revision: 0,
      turn: initialTurn(room.settings.format, started.series?.games.find(game => game.gameNumber === started.series?.currentGame)?.firstPlayerSeat),
      table: requiresDeckSelection(started) ? { version: 4, cards: [] } : createInitialTableForModule(
        requiredSeats(room.settings.format),
        packageForRoom(started).module,
        packageForRoom(started).cards,
      ),
      lastActionSequence: new Map(),
      phase: requiresDeckSelection(started) ? 'select-deck' : 'playing',
      selectedDecks: new Map(), selectedAccounts: new Map(),
      pickedBattlefields: new Set(), mulliganLocked: new Set(),
      cardTimelines: new Map(),
    });
    emitRoom(started);
    io.to(room.code).emit('room:started', { code: room.code, format: room.settings.format, ruleset: room.settings.ruleset });
    emitMatchViews(started);
    scheduleSave();
  });

  socket.on('match:select-deck', (payload: { deckId?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = room ? matches.get(room.code) : undefined;
    const account = accountForSocket(socket);
    if (!session?.seat || !room || !match || match.phase !== 'select-deck') return fail(socket, 'Deck selection is closed.');
    if (!account || typeof payload.deckId !== 'string') return fail(socket, 'Sign in and choose one of your decks.');
    if (match.selectedDecks.has(session.seat)) return fail(socket, 'Your deck is already locked.');
    const deck = playableAccountDeck(account, payload.deckId);
    if (!deck || deck.moduleId !== room.settings.moduleId || deck.moduleVersion !== room.settings.moduleVersion)
      return fail(socket, 'That deck is incomplete or does not belong to this game.');
    match.selectedDecks.set(session.seat, deck);
    match.selectedAccounts.set(session.seat, account.id);
    match.revision += 1;
    const players = requiredSeats(room.settings.format);
    if (players.every(player => match.selectedDecks.has(player))) {
      const packageForMatch = packageForRoom(room);
      match.table = prepareOpeningDecks(createInitialTableForModule(
        players, packageForMatch.module, packageForMatch.cards, match.selectedDecks,
        packageForMatch.module.id === 'frontier-skirmish' ? [1, 2] : [],
      ), players);
      if (packageForMatch.module.id === 'frontier-skirmish') match.phase = 'battlefield';
      else drawOpeningHands(match, players);
    }
    emitMatchViews(room); scheduleSave();
  });

  socket.on('match:pick-battlefield', (payload: { cardId?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = room ? matches.get(room.code) : undefined;
    if (!session?.seat || !room || !match || match.phase !== 'battlefield') return fail(socket, 'Battlefield selection is closed.');
    if (session.seat !== 1 && session.seat !== 2) return fail(socket, 'Your team captain chooses this Battlefield.');
    if (match.pickedBattlefields.has(session.seat)) return fail(socket, 'Your Battlefield is already locked.');
    const deck = match.selectedDecks.get(session.seat);
    const chosen = match.table.cards.find(card => card.id === payload.cardId && card.owner === session.seat && card.zone === 'hand' &&
      card.definitionId && deck && sectionCards(deck, 'battlefields').includes(card.definitionId));
    if (!chosen) return fail(socket, 'Choose one of the Battlefields in your hand.');
    const target = session.seat === 1 ? 'objective-a' : 'objective-b';
    match.table = { ...match.table, cards: match.table.cards
      .filter(card => card.owner !== session.seat || card.zone !== 'hand' || !card.definitionId ||
        !deck || !sectionCards(deck, 'battlefields').includes(card.definitionId) || card.id === chosen.id)
      .map(card => card.id === chosen.id ? { ...card, zone: target, faceUp: true, order: 0 } : card) };
    match.pickedBattlefields.add(session.seat);
    match.revision += 1;
    if (match.pickedBattlefields.has(1) && match.pickedBattlefields.has(2)) drawOpeningHands(match, requiredSeats(room.settings.format));
    emitMatchViews(room); scheduleSave();
  });

  socket.on('match:mulligan', (payload: { cardIds?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = room ? matches.get(room.code) : undefined;
    if (!session?.seat || !room || !match || match.phase !== 'mulligan') return fail(socket, 'Mulligan is closed.');
    if (match.mulliganLocked.has(session.seat)) return fail(socket, 'Your mulligan is already locked.');
    const ids = payload.cardIds;
    if (!Array.isArray(ids) || ids.length > 2 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !match.table.cards.some(card => card.id === id && card.owner === session.seat && card.zone === 'hand')))
      return fail(socket, 'Choose up to two cards from your opening hand.');
    const last = Math.max(-1, ...match.table.cards.filter(card => card.owner === session.seat && card.zone === 'deck').map(card => card.order));
    match.table = { ...match.table, cards: match.table.cards.map(card => ids.includes(card.id)
      ? { ...card, zone: 'deck', faceUp: false, order: last + 1 + ids.indexOf(card.id) } : card) };
    for (let index = 0; index < ids.length; index += 1)
      match.table = applyAction(match.table, { type: 'draw', player: session.seat, fromZone: 'deck', toZone: 'hand', faceUp: true });
    match.mulliganLocked.add(session.seat);
    match.revision += 1;
    if (requiredSeats(room.settings.format).every(player => match.mulliganLocked.has(player))) match.phase = 'playing';
    emitMatchViews(room); scheduleSave();
  });

  socket.on('match:end-turn', (payload: { expectedTurn?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = session ? matches.get(session.roomCode) : undefined;
    if (!session || !room || room.status !== 'active' || !match || match.phase !== 'playing') return fail(socket, 'Finish match setup first.');
    if (session.spectator || session.seat !== match.turn.seat) return fail(socket, 'It is not your turn.');
    if (payload.expectedTurn !== match.turn.number) return fail(socket, 'That turn has already ended.');

    match.turn = endTurn(match.turn, room.settings.format);
    match.revision += 1;
    const updated = appendHistory(room, {
      id: randomUUID(),
      text: `Seat ${session.seat} ended their turn. Seat ${match.turn.seat} is up.`,
      createdAt: new Date().toISOString(),
      kind: 'turn',
      actorSeat: session.seat,
    });
    rooms.set(room.code, updated);
    emitRoom(updated);
    emitMatchViews(updated);
    scheduleSave();
  });

  socket.on('match:action', (payload: { sequence?: unknown; action?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = session ? matches.get(session.roomCode) : undefined;
    if (!session || !room || room.status !== 'active' || !match || match.phase !== 'playing') return fail(socket, 'Finish match setup first.');
    if (session.spectator || !session.seat) return fail(socket, 'Spectators cannot manipulate the table.');
    if (session.seat !== match.turn.seat) return fail(socket, 'Wait for your turn to move cards.');
    if (!Number.isSafeInteger(payload.sequence) || Number(payload.sequence) < 1) return fail(socket, 'Invalid action sequence.');
    if (!isClientTableAction(payload.action)) return fail(socket, 'Invalid match action.');

    const sequence = Number(payload.sequence);
    const lastSequence = match.lastActionSequence.get(session.memberId) ?? 0;
    if (sequence <= lastSequence) {
      socket.emit('match:action-rejected', { reason: 'duplicate-or-out-of-order', sequence, lastSequence, revision: match.revision });
      return;
    }

    const policy = moduleZonePolicy(room);
    const action = toServerAction(match.table, session.seat, payload.action, policy.drawDestinations, policy.shuffleZones);
    if (!action) return fail(socket, 'Unsupported match action.');
    const before = match.table;
    const updated = applyAction(before, action, policy.allowedZones, policy.stackableZones, policy.zoneGroups);
    if (updated === before) {
      socket.emit('match:action-rejected', { reason: 'not-allowed', sequence, lastSequence, revision: match.revision });
      return;
    }

    match.table = updated;
    match.cardTimelines.set(session.seat, recordCardEdit(
      match.cardTimelines.get(session.seat) ?? emptyCardTimeline(), before, updated, action));
    match.revision += 1;
    match.lastActionSequence.set(session.memberId, sequence);

    const historyEntry = matchHistoryEntry(room, before, updated, action, session.seat);
    const updatedRoom = appendMatchHistory(room, historyEntry);
    if (updatedRoom !== room) {
      rooms.set(room.code, updatedRoom);
      emitRoom(updatedRoom);
    }

    emitMatchViews(updatedRoom);
    scheduleSave();
  });

  for (const direction of ['undo', 'redo'] as const) {
    socket.on(`match:${direction}`, () => {
      const session = currentSession(socket);
      const room = session ? rooms.get(session.roomCode) : undefined;
      const match = room ? matches.get(room.code) : undefined;
      if (!session?.seat || !room || room.status !== 'active' || !match || match.phase !== 'playing' ||
        session.spectator || match.turn.seat !== session.seat) return fail(socket, 'Wait for your turn to change cards.');
      const result = stepCardTimeline(match.table, match.cardTimelines.get(session.seat) ?? emptyCardTimeline(), session.seat, direction);
      if (!result) return fail(socket, `No ${direction} step is available for your cards.`);
      match.table = result.table;
      match.cardTimelines.set(session.seat, result.timeline);
      match.revision += 1;
      const updatedRoom = appendHistory(room, {
        id: randomUUID(), text: `Seat ${session.seat} used ${direction}.`, createdAt: new Date().toISOString(),
        kind: 'zone', actorSeat: session.seat,
      });
      rooms.set(room.code, updatedRoom);
      emitRoom(updatedRoom);
      emitMatchViews(updatedRoom);
      scheduleSave();
    });
  }

  socket.on('match:request-state', () => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (room?.status === 'active') emitMatchViews(room);
  });

  socket.on('chat:send', (payload: { body?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room || typeof payload.body !== 'string') return fail(socket, 'You are not in a room.');

    const updated = appendChat(room, {
      id: randomUUID(),
      memberId: session.memberId,
      displayName: session.displayName,
      body: payload.body,
      sentAt: new Date().toISOString(),
    });
    if (updated === room) return fail(socket, 'Message must be between 1 and 500 characters.');

    rooms.set(room.code, updated);
    io.to(room.code).emit('chat:message', updated.chat.at(-1));
    emitRoom(updated);
    scheduleSave();
  });

  socket.on('room:leave', () => {
    const session = currentSession(socket);
    if (!session) return;
    const room = rooms.get(session.roomCode);
    if (room?.status === 'lobby') {
      const updated = leaveRoom(room, session.memberId);
      rooms.set(room.code, updated);
      emitRoom(updated);
    }
    sessions.delete(session.tokenHash);
    socketSession.delete(socket.id);
    socket.leave(session.roomCode);
    socket.emit('session:cleared');
    scheduleSave();
  });

  socket.on('disconnect', () => {
    const identity = rateIdentity(socket);
    markDisconnected(socket);
    limiter.clearPrefix(`socket:${socket.id}:`);
    if (!identity.startsWith('socket:')) {
      const violation = violations.get(identity);
      if (violation && Date.now() - violation.windowStartedAt > 60_000) violations.delete(identity);
    }
  });
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: saving multiplayer and account state before shutdown...`);
  await Promise.all([flushSnapshot(), flushAccounts()]);
  process.exit(0);
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

await loadAccounts();
await restoreState();

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`RB Unbound site and multiplayer server on http://127.0.0.1:${port} (snapshot: ${snapshotPath()})`);
});
