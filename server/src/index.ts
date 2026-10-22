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

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: 'RB Unbound multiplayer', status: 'development' }));
});

const io = new Server(httpServer, {
  cors: { origin: false },
  maxHttpBufferSize: 20_000,
  serveClient: false,
});

const rooms = new Map<string, RoomState>();
const matches = new Map<string, TableState>();
const socketRoom = new Map<string, string>();

function code(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (!rooms.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a room code');
}

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 32 ? name : null;
}

function safeFormat(value: unknown): MatchFormat | undefined {
  return value === '1v1' || value === '2v2' || value === 'ffa4' ? value : undefined;
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
      owner: seat.memberId === room.ownerMemberId,
    })),
    spectators: room.spectators.map(spectator => ({ displayName: spectator.displayName })),
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
  const table = matches.get(room.code);
  if (!table) return;

  for (const seat of room.seats) {
    if (!seat.memberId) continue;
    io.sockets.sockets.get(seat.memberId)?.emit('match:update', {
      seat: seat.seat,
      spectator: false,
      table: projectTable(table, seat.seat),
    });
  }

  for (const spectator of room.spectators) {
    io.sockets.sockets.get(spectator.memberId)?.emit('match:update', {
      spectator: true,
      table: projectTable(table),
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

function removeFromCurrentRoom(socket: Socket): void {
  const roomCode = socketRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  socketRoom.delete(socket.id);
  socket.leave(roomCode);
  if (!room) return;

  if (room.status === 'active') {
    emitRoom(room);
    return;
  }

  const updated = leaveRoom(room, socket.id);
  const hasMembers = updated.seats.some(seat => seat.memberId) || updated.spectators.length > 0;
  if (!hasMembers) {
    rooms.delete(roomCode);
    matches.delete(roomCode);
    return;
  }

  rooms.set(roomCode, updated);
  emitRoom(updated);
}

io.on('connection', socket => {
  socket.emit('status', { message: 'Connected to RB Unbound development multiplayer server.' });

  socket.on('room:create', (payload: { displayName?: unknown; roomName?: unknown; format?: unknown } = {}) => {
    if (socketRoom.has(socket.id)) return fail(socket, 'Leave your current room first.');
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Choose a display name between 1 and 32 characters.');

    const format = safeFormat(payload.format) ?? '1v1';
    const roomName = typeof payload.roomName === 'string' ? payload.roomName.trim().slice(0, 60) : '';
    const room = createRoom(code(), socket.id, displayName, {
      format,
      ...(roomName ? { roomName } : {}),
    });

    rooms.set(room.code, room);
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    socket.emit('room:created', { code: room.code });
    emitRoom(room);
  });

  socket.on('room:join-seat', (payload: { code?: unknown; displayName?: unknown; seat?: unknown } = {}) => {
    if (socketRoom.has(socket.id)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    const seat = payload.seat;
    if (!displayName || !(seat === 1 || seat === 2 || seat === 3 || seat === 4)) return fail(socket, 'Invalid join request.');

    const room = rooms.get(roomCode);
    if (!room || room.status !== 'lobby') return fail(socket, 'Room not found or already started.');
    const updated = occupySeat(room, socket.id, displayName, seat as SeatNumber);
    if (updated === room) return fail(socket, 'That seat is unavailable.');

    rooms.set(roomCode, updated);
    socketRoom.set(socket.id, roomCode);
    socket.join(roomCode);
    emitRoom(updated);
  });

  socket.on('room:join-spectator', (payload: { code?: unknown; displayName?: unknown } = {}) => {
    if (socketRoom.has(socket.id)) return fail(socket, 'Leave your current room first.');
    const roomCode = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const displayName = safeName(payload.displayName);
    if (!displayName) return fail(socket, 'Invalid spectator name.');

    const room = rooms.get(roomCode);
    if (!room) return fail(socket, 'Room not found.');
    const updated = addSpectator(room, socket.id, displayName);
    if (updated === room) return fail(socket, 'Spectators are disabled or you are already in this room.');

    rooms.set(roomCode, updated);
    socketRoom.set(socket.id, roomCode);
    socket.join(roomCode);
    emitRoom(updated);
    if (updated.status === 'active') emitMatchViews(updated);
  });

  socket.on('room:ready', (payload: { ready?: unknown } = {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room || typeof payload.ready !== 'boolean') return fail(socket, 'You are not in a lobby.');

    const updated = setReady(room, socket.id, payload.ready);
    rooms.set(room.code, updated);
    emitRoom(updated);
  });

  socket.on('room:settings', (payload: Partial<RoomSettings> = {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room) return fail(socket, 'You are not in a room.');

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

    const updated = setRoomSettings(room, socket.id, safePatch);
    if (updated === room) return fail(socket, 'Only the room owner can change unlocked lobby settings.');
    rooms.set(room.code, updated);
    emitRoom(updated);
  });

  socket.on('room:start', (payload: { force?: unknown } = {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room) return fail(socket, 'You are not in a room.');

    const force = payload.force === true;
    const updated = startRoom(room, socket.id, force);
    if (updated === room) {
      return fail(socket, force
        ? 'Force start requires the room owner and every required seat to be occupied.'
        : 'All required players must be ready before the owner can start.');
    }

    rooms.set(room.code, updated);
    matches.set(room.code, createInitialTable(requiredSeats(room.settings.format)));
    emitRoom(updated);
    io.to(room.code).emit('room:started', {
      code: room.code,
      format: room.settings.format,
      ruleset: room.settings.ruleset,
    });
    emitMatchViews(updated);
  });

  socket.on('match:action', (payload: unknown) => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    const table = roomCode ? matches.get(roomCode) : undefined;
    if (!room || room.status !== 'active' || !table) return fail(socket, 'No active match.');
    if (!isClientTableAction(payload)) return fail(socket, 'Invalid match action.');

    const seat = seatFor(room, socket.id);
    if (!seat) return fail(socket, 'Spectators cannot manipulate the table.');

    const action = toServerAction(table, seat, payload);
    if (!action) return fail(socket, 'Unsupported match action.');

    const updated = applyAction(table, action);
    if (updated === table) return fail(socket, 'That action is not allowed.');

    matches.set(room.code, updated);
    emitMatchViews(room);
  });

  socket.on('match:request-state', () => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (room?.status === 'active') emitMatchViews(room);
  });

  socket.on('chat:send', (payload: { body?: unknown } = {}) => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    if (!room || typeof payload.body !== 'string') return fail(socket, 'You are not in a room.');

    const participant = room.seats.find(seat => seat.memberId === socket.id) ??
      room.spectators.find(spectator => spectator.memberId === socket.id);
    if (!participant) return fail(socket, 'You are not a room participant.');

    const displayName = 'displayName' in participant && participant.displayName ? participant.displayName : 'Player';
    const updated = appendChat(room, {
      id: randomUUID(),
      memberId: socket.id,
      displayName,
      body: payload.body,
      sentAt: new Date().toISOString(),
    });
    if (updated === room) return fail(socket, 'Message must be between 1 and 500 characters.');

    rooms.set(room.code, updated);
    io.to(room.code).emit('chat:message', updated.chat.at(-1));
    emitRoom(updated);
  });

  socket.on('room:leave', () => removeFromCurrentRoom(socket));
  socket.on('disconnect', () => removeFromCurrentRoom(socket));
});

httpServer.listen(3001, '127.0.0.1', () => {
  console.log('RB Unbound development multiplayer server on http://127.0.0.1:3001');
});
