import { describe, expect, it } from 'vitest';
import {
  addSpectator,
  createRoom,
  playerSeatCount,
  requiredSeats,
  setRoomSettings,
} from '@rb-unbound/lobby';

describe('format-aware player and spectator capacity', () => {
  it('uses two player seats for 1v1 and four for team/FFA formats', () => {
    expect(playerSeatCount('1v1')).toBe(2);
    expect(requiredSeats('1v1')).toEqual([1, 2]);
    expect(playerSeatCount('2v2')).toBe(4);
    expect(requiredSeats('2v2')).toEqual([1, 2, 3, 4]);
    expect(playerSeatCount('ffa4')).toBe(4);
  });

  it('defaults to four optional spectator slots and enforces the cap', () => {
    let room = createRoom('ABC123', 'owner', 'Host', { format: '1v1' });
    expect(room.settings.spectatorLimit).toBe(4);

    for (let index = 1; index <= 4; index += 1) {
      room = addSpectator(room, `spectator-${index}`, `Spectator ${index}`);
    }
    expect(room.spectators).toHaveLength(4);

    const full = addSpectator(room, 'spectator-5', 'Spectator 5');
    expect(full).toBe(room);
    expect(full.spectators).toHaveLength(4);
  });

  it('lets the host change spectator capacity but not below current occupancy', () => {
    let room = createRoom('ABC123', 'owner', 'Host', { spectatorLimit: 3 });
    room = addSpectator(room, 'watcher-1', 'Watcher 1');
    room = addSpectator(room, 'watcher-2', 'Watcher 2');

    const rejected = setRoomSettings(room, 'owner', { spectatorLimit: 1 });
    expect(rejected).toBe(room);

    const expanded = setRoomSettings(room, 'owner', { spectatorLimit: 4 });
    expect(expanded.settings.spectatorLimit).toBe(4);
  });

  it('treats a zero spectator limit as spectators disabled', () => {
    const room = createRoom('ABC123', 'owner', 'Host', { spectatorLimit: 0, allowSpectators: true });
    expect(room.settings.spectatorLimit).toBe(0);
    expect(room.settings.allowSpectators).toBe(false);
    expect(addSpectator(room, 'watcher', 'Watcher')).toBe(room);
  });
});
