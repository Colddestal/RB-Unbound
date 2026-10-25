import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const temp = await mkdtemp(join(tmpdir(), 'rb-match-'));
const base = 'http://127.0.0.1:3001';
const server = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, RB_UNBOUND_ACCOUNT_PATH: join(temp, 'accounts.json'), RB_UNBOUND_STATE_PATH: join(temp, 'rooms.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stderr.on('data', chunk => { serverOutput += String(chunk); });
server.stdout.on('data', chunk => { serverOutput += String(chunk); });
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function next(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${event}`)); }, 5000);
    const listen = value => { if (predicate(value)) { cleanup(); resolve(value); } };
    const error = value => { cleanup(); reject(new Error(value.message ?? 'Room error')); };
    const cleanup = () => { clearTimeout(timer); socket.off(event, listen); if (event !== 'room:error') socket.off('room:error', error); };
    socket.on(event, listen);
    if (event !== 'room:error') socket.on('room:error', error);
  });
}
async function account(username) {
  const response = await fetch(`${base}/api/account/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `test-password-${username}` }),
  });
  assert.equal(response.status, 201);
  const { token } = await response.json();
  const decks = await fetch(`${base}/api/decks`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  return { token, deckId: decks.decks.find(item => item.deck.moduleId === 'frontier-skirmish').id };
}
async function connect(token) {
  const socket = io(base, { transports: ['websocket'], auth: { accountToken: token }, reconnection: false });
  sockets.push(socket);
  await next(socket, 'connect');
  return socket;
}
async function updateAfter(socket, action, phase, predicate = () => true) {
  const update = next(socket, 'match:update', value => value.phase === phase && predicate(value));
  action();
  return update;
}

try {
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { healthy = (await fetch(`${base}/healthz`)).ok; } catch { /* waiting for startup */ }
    if (healthy) break;
    await delay(100);
  }
  if (!healthy) throw new Error(`Server did not start: ${serverOutput}`);

  const a = await account('seat_one_test');
  const b = await account('seat_two_test');
  const wrong = await fetch(`${base}/api/decks/${a.deckId}`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal(wrong.status, 404);
  const one = await connect(a.token);
  const two = await connect(b.token);
  const created = next(one, 'room:created');
  one.emit('room:create', { displayName: 'One', format: '1v1', isPublic: true, moduleId: 'frontier-skirmish', moduleVersion: '1.0.0' });
  const { code } = await created;
  const identity = next(two, 'room:identity');
  two.emit('room:join-seat', { code, seat: 2, displayName: 'Two' });
  await identity;
  const readyOne = next(one, 'room:update', value => value.seats[0].ready);
  one.emit('room:ready', { ready: true });
  await readyOne;
  const readyTwo = next(one, 'room:update', value => value.seats[1].ready);
  two.emit('room:ready', { ready: true });
  await readyTwo;
  const selecting = await updateAfter(one, () => one.emit('room:start'), 'select-deck');
  assert.equal(selecting.table.cards.length, 0);
  const first = await updateAfter(one, () => one.emit('match:select-deck', { deckId: a.deckId }), 'select-deck', value => value.selectedSeats.includes(1));
  assert.deepEqual(first.selectedSeats, [1]);
  const seatOneBattlefield = next(one, 'match:update', value => value.phase === 'battlefield');
  const otherSelected = await updateAfter(two, () => two.emit('match:select-deck', { deckId: b.deckId }), 'battlefield');
  assert.equal(otherSelected.table.cards.filter(card => card.zone === 'hand' && card.owner === 2).length, 3);
  const ownFields = otherSelected.table.cards.filter(card => card.zone === 'hand' && card.owner === 2);
  assert(ownFields.every(card => card.faceUp && card.definitionId?.startsWith('battlefield-')));
  const seatOneView = await seatOneBattlefield;
  const ownField = seatOneView.table.cards.find(card => card.zone === 'hand' && card.owner === 1);
  const onePicked = await updateAfter(one, () => one.emit('match:pick-battlefield', { cardId: ownField.id }), 'battlefield', value => value.pickedSeats.includes(1));
  assert.equal(onePicked.table.cards.find(card => card.zone === 'objective-a')?.id, ownField.id);
  const seatOneDrawn = next(one, 'match:update', value => value.phase === 'mulligan');
  const mulligan = await updateAfter(two, () => two.emit('match:pick-battlefield', { cardId: ownFields[0].id }), 'mulligan');
  assert.equal(mulligan.table.cards.filter(card => card.zone === 'hand' && card.owner === 2).length, 4);
  assert.equal(mulligan.table.cards.find(card => card.zone === 'objective-b')?.id, ownFields[0].id);
  const hand = mulligan.table.cards.filter(card => card.zone === 'hand' && card.owner === 2).map(card => card.id);
  const locked = await updateAfter(two, () => two.emit('match:mulligan', { cardIds: hand.slice(0, 2) }), 'mulligan', value => value.mulliganSeats.includes(2));
  const replaced = locked.table.cards.filter(card => card.zone === 'hand' && card.owner === 2).map(card => card.id);
  assert.equal(replaced.length, 4);
  assert(!replaced.includes(hand[0]) && !replaced.includes(hand[1]));
  const seatOneOpening = await seatOneDrawn;
  const playing = await updateAfter(one, () => one.emit('match:mulligan', { cardIds: [] }), 'playing');
  assert.equal(playing.table.cards.filter(card => card.zone === 'hand' && card.owner === 1).length, 4);
  assert.equal(seatOneOpening.table.cards.filter(card => card.zone === 'hand' && card.owner === 1).length, 4);
  console.log('Account isolation and ready → decks → Battlefields A/B → draw four → mulligan → play passed.');
} finally {
  sockets.forEach(socket => socket.disconnect());
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
  await rm(temp, { recursive: true, force: true });
}
