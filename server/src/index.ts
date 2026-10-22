import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  addSpectator,
  appendChat,
  createRoom,
  leaveRoom,
  occupySeat,
  requiredSeats,
  setReady,
  setRoomSettings,
  startRoom,
  type MatchFormat,
  type RoomSettings,
  type RoomState,
  type SeatNumber,
} from '@rb-unbound/lobby';
import {
  applyAction,
  createInitialTable,
  isClientTableAction,
  projectTable,
  type ClientTableAction,
  type PlayerId,
  type TableAction,
  type TableState,
} from '@rb-unbound/tabletop';

type Session = {
  token: string;
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

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'RB Unbound multiplayer', status: 'development' }));
});

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 20_000,
  serveClient: false,
});

const rooms = new Map<string, RoomState>();
const matches = new Map<string, MatchRecord>();
const sessions = new Map<string, Session>();
const socketSession = new Map<string, string>();

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

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 32 ? name : null;
}

function safeFormat(value: unknown): MatchFormat | undefined {
  return value === '1v1' || value === '2v2' || value === 'ffa4' ? value : undefined;
}

function currentSession(socket: Socket): Session | undefined {
  const token = socketSession.get(socket.id);
  return token ? sessions.get(token) : undefined;
}

function socketForMember(memberId: string): Socket | undefined {
  const session = [...sessions.values()].find(item => item.memberId === memberId);
  return session?.connectedSocketId ? io.sockets.sockets.get(session.connectedSocketId) : undefined;
}

function publicRoom(room: RoomState) {
  return {
    code: room.code,
    status: room.status,
    settingsLocked: room.settingsLocked,
    settings: room.settings,
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

function emitMatchViews(room: RoomState): void {
  const match = matches.get(room.code);
  if (!match) return;

  for (const seat of room.seats) {
    if (!seat.memberId) continue;
    socketForMember(seat.memberId)?.emit('match:update', {
      seat: seat.seat,
      spectator: false,
      revision: match.revision,
      table: projectTable(match.table, seat.seat),
    });
  }

  for (const spectator of room.spectators) {
    socketForMember(spectator.memberId)?.emit('match:update', {
      spectator: true,
      revision: match.revision,
      table: projectTable(match.table),
    });
  }
}

function toServerAction(table: TableState, seat: PlayerId, action: ClientTableAction): TableAction | null {
  if (action.type === 'draw') return { type: 'draw', player: seat };
  if (action.type === 'shuffle') {
    const ids = table.cards
      .filter(card => card.owner === seat && card.zone === 'deck')
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    return { type: 'shuffle', player: seat, orderedIds: shuffleIds(ids) };
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
  const session: Session = {
    token,
    memberId,
    displayName,
    roomCode: room.code,
    seat,
    spectator,
    connectedSocketId: socket.id,
  };
  sessions.set(token, session);
  socketSession.set(socket.id, token);
  socket.join(room.code);
  socket.emit('session:issued', { token, roomCode: room.code, seat, spectator });
  socket.emit('room:identity', { code: room.code, seat, spectator });
  return session;
}

function expireSession(token: string): void {
  const session = sessions.get(token);
  if (!session || session.connectedSocketId) return;
  if (!session.disconnectedAt || Date.now() - session.disconnectedAt < SESSION_TTL_MS) return;

  const room = rooms.get(session.roomCode);
  if (room?.status === 'lobby') {
    const updated = leaveRoom(room, session.memberId);
    rooms.set(room.code, updated);
    emitRoom(updated);
  }
  sessions.delete(token);
}

function markDisconnected(socket: Socket): void {
  const token = socketSession.get(socket.id);
  socketSession.delete(socket.id);
  if (!token) return;

  const session = sessions.get(token);
  if (!session || session.connectedSocketId !== socket.id) return;
  session.connectedSocketId = undefined;
  session.disconnectedAt = Date.now();

  const room = rooms.get(session.roomCode);
  if (room) emitRoom(room);

  const timeout = setTimeout(() => expireSession(token), SESSION_TTL_MS + 1000);
  timeout.unref();
}

io.on('connection', socket => {
  socket.emit('status', { message: 'Connected to RB Unbound development multiplayer server.' });

  socket.on('session:resume', (payload: { token?: unknown } = {}) => {
    if (typeof payload.token !== 'string' || payload.token.length > 100) return fail(socket, 'Invalid session token.');
    const session = sessions.get(payload.token);
    if (!session) return socket.emit('session:invalid');

    const room = rooms.get(session.roomCode);
    if (!room) {
      sessions.delete(payload.token);
      return socket.emit('session:invalid');
    }

    if (session.connectedSocketId && session.connectedSocketId !== socket.id) {
      io.sockets.sockets.get(session.connectedSocketId)?.disconnect(true);
    }

    session.connectedSocketId = socket.id;
    session.disconnectedAt = undefined;
    socketSession.set(socket.id, session.token);
    socket.join(room.code);

    socket.emit('session:resumed', {
      token: session.token,
      roomCode: room.code,
      seat: session.seat,
      spectator: session.spectator,
    });
    socket.emit('room:identity', { code: room.code, seat: session.seat, spectator: session.spectator });
    socket.emit('room:update', publicRoom(room));
    if (room.status === 'active') emitMatchViews(room);
    emitRoom(room);
  });

  socket.on('room:create', (payload: { displayName?: unknown; roomName?: unknown; format?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Choose a display name between 1 and 32 characters.');

    const memberId = randomUUID();
    const format = safeFormat(payload.format) ?? '1v1';
    const roomName = typeof payload.roomName === 'string' ? payload.roomName.trim().slice(0, 60) : '';
    const room = createRoom(code(), memberId, displayName, { format, ...(roomName ? { roomName } : {}) });

    rooms.set(room.code, room);
    establishSession(socket, room, displayName, memberId, 1, false);
    socket.emit('room:created', { code: room.code });
    emitRoom(room);
  });

  socket.on('room:join-seat', (payload: { code?: unknown; displayName?: unknown; seat?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    const seat = payload.seat;
    if (!displayName || !(seat === 1 || seat === 2 || seat === 3 || seat === 4)) return fail(socket, 'Invalid join request.');

    const room = rooms.get(roomCode);
    if (!room || room.status !== 'lobby') return fail(socket, 'Room not found or already started.');

    const memberId = randomUUID();
    const updated = occupySeat(room, memberId, displayName, seat as SeatNumber);
    if (updated === room) return fail(socket, 'That seat is unavailable.');

    rooms.set(roomCode, updated);
    establishSession(socket, updated, displayName, memberId, seat as PlayerId, false);
    emitRoom(updated);
  });

  socket.on('room:join-spectator', (payload: { code?: unknown; displayName?: unknown } = {}) => {
    if (currentSession(socket)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Invalid spectator name.');

    const room = rooms.get(roomCode);
    if (!room) return fail(socket, 'Room not found.');

    const memberId = randomUUID();
    const updated = addSpectator(room, memberId, displayName);
    if (updated === room) return fail(socket, 'Spectators are disabled or you are already in this room.');

    rooms.set(roomCode, updated);
    establishSession(socket, updated, displayName, memberId, undefined, true);
    emitRoom(updated);
    if (updated.status === 'active') emitMatchViews(updated);
  });

  socket.on('room:ready', (payload: { ready?: unknown } = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room || typeof payload.ready !== 'boolean') return fail(socket, 'You are not in a lobby.');

    const updated = setReady(room, session.memberId, payload.ready);
    rooms.set(room.code, updated);
    emitRoom(updated);
  });

  socket.on('room:settings', (payload: Partial<RoomSettings> = {}) => {
    const session = currentSession(socket);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (!session || !room) return fail(socket, 'You are not in a room.');

    const safePatch: Partial<RoomSettings> = {};
    if (typeof payload.roomName === 'string') safePatch.roomName = payload.roomName.trim().slice(0, 60);
    if (safeFormat(payload.format)) safePatch.format = safeFormat(payload.format);
    if (payload.ruleset === 'standard' || payload.ruleset === 'unrestricted' || payload.ruleset === 'custom') safePatch.ruleset = payload.ruleset;
    if (typeof payload.isPublic === 'boolean') safePatch.isPublic = payload.isPublic;
    if (typeof payload.allowSpectators === 'boolean') safePatch.allowSpectators = payload.allowSpectators;
    if (typeof payload.readyCheck === 'boolean') safePatch.readyCheck = payload.readyCheck;
    if (payload.turnTimerSeconds === null || (
      typeof payload.turnTimerSeconds === 'number' &&
      Number.isInteger(payload.turnTimerSeconds) &&
      payload.turnTimerSeconds >= 15 &&
      payload.turnTimerSeconds <= 3600
    )) safePatch.turnTimerSeconds = payload.turnTimerSeconds;

    const updated = setRoomSettings(room, session.memberId, safePatch);
    if (updated === room) return fail(socket, 'Only the room owner can change unlocked lobby settings.');
    rooms.set(room.code, updated);
    emitRoom(updated);
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

    rooms.set(room.code, updated);
    matches.set(room.code, {
      revision: 0,
      table: createInitialTable(requiredSeats(room.settings.format)),
      lastActionSequence: new Map(),
    });
    emitRoom(updated);
    io.to(room.code).emit('room:started', { code: room.code, format: room.settings.format, ruleset: room.settings.ruleset });
    emitMatchViews(updated);
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

    const action = toServerAction(match.table, session.seat, payload.action);
    if (!action) return fail(socket, 'Unsupported match action.');

    const updated = applyAction(match.table, action);
    if (updated === match.table) {
      socket.emit('match:action-rejected', { reason: 'not-allowed', sequence, lastSequence, revision: match.revision });
      return;
    }

    match.table = updated;
    match.revision += 1;
    match.lastActionSequence.set(session.memberId, sequence);
    emitMatchViews(room);
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
    sessions.delete(session.token);
    socketSession.delete(socket.id);
    socket.leave(session.roomCode);
    socket.emit('session:cleared');
  });

  socket.on('disconnect', () => markDisconnected(socket));
});

httpServer.listen(3001, '127.0.0.1', () => {
  console.log('RB Unbound development multiplayer server on http://127.0.0.1:3001');
});
