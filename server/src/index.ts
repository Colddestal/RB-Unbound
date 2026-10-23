import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  addSpectator,
  appendChat,
  appendHistory,
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
} from '@rb-unbound/lobby';
import {
  applyAction,
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
  type GameModule,
  type ModulePackage,
  type PlayerId,
  type TableAction,
  type TableState,
  pileCapabilities,
  zoneBehavior,
} from '@rb-unbound/tabletop';
import { approximatePayloadBytes, RateLimiter, type LimitRule } from './rate-limit.js';
import {
  loadSnapshot,
  saveSnapshot,
  snapshotPath,
  type PersistenceSnapshot,
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
  lastActionSequence: Map<string, number>;
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
  'match:action': { capacity: 90, refillPerSecond: 30 },
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
  'match:action': 2048,
};

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'RB Unbound multiplayer', status: 'development' }));
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
      lastActionSequence: [...match.lastActionSequence.entries()],
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
      lastActionSequence: new Map(record.lastActionSequence),
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
      table: createInitialTableForModule(
        requiredSeats(room.settings.format),
        packageForRoom(started).module,
        packageForRoom(started).cards,
      ),
      lastActionSequence: new Map(),
    });
    emitRoom(started);
    io.to(room.code).emit('room:started', { code: room.code, format: room.settings.format, ruleset: room.settings.ruleset });
    emitMatchViews(started);
    scheduleSave();
  });

  socket.on('match:action', (payload: { sequence?: unknown; action?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    const match = session ? matches.get(session.roomCode) : undefined;
    if (!session || !room || room.status !== 'active' || !match) return fail(socket, 'No active match.');
    if (session.spectator || !session.seat) return fail(socket, 'Spectators cannot manipulate the table.');
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
  console.log(`${signal}: saving multiplayer state before shutdown...`);
  await flushSnapshot();
  process.exit(0);
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

await restoreState();

httpServer.listen(3001, '127.0.0.1', () => {
  console.log(`RB Unbound development multiplayer server on http://127.0.0.1:3001 (snapshot: ${snapshotPath()})`);
});
