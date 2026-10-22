export type MatchFormat = '1v1' | '2v2' | 'ffa4';
export type RulesetPreset = 'standard' | 'unrestricted' | 'custom';
export type RoomStatus = 'lobby' | 'active' | 'closed';
export type SeatNumber = 1 | 2 | 3 | 4;
export type TeamNumber = 1 | 2 | 3 | 4;

export type RoomSettings = {
  roomName: string;
  format: MatchFormat;
  ruleset: RulesetPreset;
  isPublic: boolean;
  allowSpectators: boolean;
  readyCheck: boolean;
  shareTeamHands: boolean;
  turnTimerSeconds: number | null;
  customRules: Record<string, boolean | number | string>;
};

export type Seat = {
  seat: SeatNumber;
  memberId?: string;
  displayName?: string;
  team: TeamNumber;
  ready: boolean;
};

export type ChatMessage = {
  id: string;
  memberId: string;
  displayName: string;
  body: string;
  sentAt: string;
  system?: boolean;
};

export type RoomState = {
  code: string;
  ownerMemberId: string;
  status: RoomStatus;
  settingsLocked: boolean;
  settings: RoomSettings;
  seats: Seat[];
  spectators: { memberId: string; displayName: string }[];
  chat: ChatMessage[];
  /** Server-only hash used to authorize joins to private rooms. Never expose in public room snapshots. */
  inviteCodeHash?: string;
};

const teamFor = (format: MatchFormat, seat: SeatNumber): TeamNumber => {
  if (format === '2v2') return seat === 1 || seat === 3 ? 1 : 2;
  if (format === '1v1') return seat;
  return seat;
};

export const requiredSeats = (format: MatchFormat): SeatNumber[] =>
  format === '1v1' ? [1, 2] : [1, 2, 3, 4];

export function createRoom(code: string, ownerMemberId: string, ownerName: string, settings?: Partial<RoomSettings>): RoomState {
  const format = settings?.format ?? '1v1';
  const defaults: RoomSettings = {
    roomName: `${ownerName}'s room`,
    format,
    ruleset: 'standard',
    isPublic: false,
    allowSpectators: true,
    readyCheck: true,
    shareTeamHands: false,
    turnTimerSeconds: null,
    customRules: {},
  };
  const merged = { ...defaults, ...settings, format };
  const seats: Seat[] = ([1, 2, 3, 4] as SeatNumber[]).map(seat => ({
    seat,
    team: teamFor(format, seat),
    ready: false,
    ...(seat === 1 ? { memberId: ownerMemberId, displayName: ownerName } : {}),
  }));
  return { code, ownerMemberId, status: 'lobby', settingsLocked: false, settings: merged, seats, spectators: [], chat: [] };
}

export function setRoomSettings(room: RoomState, actor: string, patch: Partial<RoomSettings>): RoomState {
  if (actor !== room.ownerMemberId || room.status !== 'lobby' || room.settingsLocked) return room;
  const format = patch.format ?? room.settings.format;
  const allowedSeats = requiredSeats(format);
  if (room.seats.some(seat => seat.memberId && !allowedSeats.includes(seat.seat))) return room;

  const settings = {
    ...room.settings,
    ...patch,
    format,
    shareTeamHands: format === '2v2' ? (patch.shareTeamHands ?? room.settings.shareTeamHands) : false,
  };
  return {
    ...room,
    settings,
    seats: room.seats.map(seat => ({ ...seat, team: teamFor(format, seat.seat), ready: false })),
  };
}

export function occupySeat(room: RoomState, memberId: string, displayName: string, seatNumber: SeatNumber): RoomState {
  if (room.status !== 'lobby' || !requiredSeats(room.settings.format).includes(seatNumber)) return room;
  if (room.seats.some(seat => seat.memberId === memberId)) return room;
  const seat = room.seats.find(item => item.seat === seatNumber);
  if (!seat || seat.memberId) return room;
  return {
    ...room,
    seats: room.seats.map(item => item.seat === seatNumber ? { ...item, memberId, displayName, ready: false } : item),
  };
}

export function leaveRoom(room: RoomState, memberId: string): RoomState {
  if (room.status !== 'lobby') return room;
  const seats = room.seats.map(seat => seat.memberId === memberId
    ? { ...seat, memberId: undefined, displayName: undefined, ready: false }
    : seat);
  const spectators = room.spectators.filter(s => s.memberId !== memberId);
  const remaining = seats.find(seat => seat.memberId);
  return {
    ...room,
    ownerMemberId: room.ownerMemberId === memberId && remaining?.memberId ? remaining.memberId : room.ownerMemberId,
    seats,
    spectators,
  };
}

export function setReady(room: RoomState, memberId: string, ready: boolean): RoomState {
  if (room.status !== 'lobby') return room;
  return { ...room, seats: room.seats.map(seat => seat.memberId === memberId ? { ...seat, ready } : seat) };
}

export function addSpectator(room: RoomState, memberId: string, displayName: string): RoomState {
  if (!room.settings.allowSpectators || room.status === 'closed') return room;
  if (room.seats.some(seat => seat.memberId === memberId) || room.spectators.some(s => s.memberId === memberId)) return room;
  return { ...room, spectators: [...room.spectators, { memberId, displayName }] };
}

export function allRequiredSeatsOccupied(room: RoomState): boolean {
  return requiredSeats(room.settings.format).every(number => room.seats.find(seat => seat.seat === number)?.memberId);
}

export function canStart(room: RoomState): boolean {
  if (room.status !== 'lobby' || !allRequiredSeatsOccupied(room)) return false;
  if (!room.settings.readyCheck) return true;
  return requiredSeats(room.settings.format).every(number => room.seats.find(seat => seat.seat === number)?.ready);
}

export function canForceStart(room: RoomState, actor: string): boolean {
  return room.status === 'lobby' && actor === room.ownerMemberId && allRequiredSeatsOccupied(room);
}

export function startRoom(room: RoomState, actor: string, force = false): RoomState {
  if (force ? !canForceStart(room, actor) : !(actor === room.ownerMemberId && canStart(room))) return room;
  return { ...room, status: 'active', settingsLocked: true };
}

export function appendChat(room: RoomState, message: ChatMessage): RoomState {
  const body = message.body.trim();
  if (!body || body.length > 500 || room.status === 'closed') return room;
  const allowed = room.seats.some(seat => seat.memberId === message.memberId) ||
    room.spectators.some(s => s.memberId === message.memberId);
  if (!allowed) return room;
  return { ...room, chat: [...room.chat, { ...message, body }].slice(-200) };
}
