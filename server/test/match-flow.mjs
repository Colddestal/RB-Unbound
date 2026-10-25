import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const temp = await mkdtemp(join(tmpdir(), 'rb-match-'));
const reserved = createServer();
reserved.listen(0, '127.0.0.1');
await once(reserved, 'listening');
const testPort = reserved.address().port;
await new Promise((resolve, reject) => reserved.close(error => error ? reject(error) : resolve()));
const base = `http://127.0.0.1:${testPort}`;
let serverOutput = '';
function startServer() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    env: { ...process.env, RB_UNBOUND_PORT: String(testPort), RB_UNBOUND_ACCOUNT_PATH: join(temp, 'accounts.json'), RB_UNBOUND_STATE_PATH: join(temp, 'rooms.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', chunk => { serverOutput += String(chunk); });
  child.stdout.on('data', chunk => { serverOutput += String(chunk); });
  return child;
}
let server = startServer();
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
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* waiting for startup */ }
    await delay(100);
  }
  throw new Error(`Server did not start: ${serverOutput}`);
}
async function stopServer() {
  if (server.exitCode !== null) return;
  const stopped = once(server, 'exit');
  server.kill('SIGTERM');
  await stopped;
}

try {
  await waitForServer();

  const invalidOrigin = await fetch(`${base}/api/account/register`, { method: 'POST', headers: { Origin: '%broken' } });
  assert.equal(invalidOrigin.status, 403);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);

  const a = await account('seat_one_test');
  const b = await account('seat_two_test');
  const createdDeck = await fetch(`${base}/api/decks`, { method: 'POST', headers: {
    Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ moduleId: 'frontier-skirmish' }) });
  assert.equal(createdDeck.status, 201);
  const saved = await createdDeck.json();
  saved.deck.name = 'Account-bound test deck';
  const updatedDeck = await fetch(`${base}/api/decks/${saved.id}`, { method: 'PUT', headers: {
    Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ deck: saved.deck }) });
  assert.equal(updatedDeck.status, 200);
  a.deckId = saved.id;
  const wrong = await fetch(`${base}/api/decks/${a.deckId}`, { headers: { Authorization: `Bearer ${b.token}` } });
  assert.equal(wrong.status, 404);
  const one = await connect(a.token);
  const two = await connect(b.token);
  const warning = next(one, 'abuse:warning');
  one.emit('room:create', null);
  assert.equal((await warning).reason, 'invalid-payload');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const created = next(one, 'room:created');
  const initialRoom = next(one, 'room:update');
  const firstSession = next(one, 'session:issued');
  one.emit('room:create', { displayName: 'One', format: '1v1', isPublic: true, moduleId: 'frontier-skirmish', moduleVersion: '1.0.0' });
  const { code } = await created;
  const originalPackage = (await initialRoom).modulePackage;
  const roomToken = (await firstSession).token;
  const identity = next(two, 'room:identity');
  const secondSession = next(two, 'session:issued');
  two.emit('room:join-seat', { code, seat: 2, displayName: 'Two' });
  await identity;
  await secondSession;
  const custom = structuredClone(originalPackage);
  custom.module.id = 'audit-custom';
  for (const card of custom.cards) card.moduleId = 'audit-custom';
  const changedModule = next(one, 'room:update', value => value.settings.moduleId === 'audit-custom');
  one.emit('room:settings', { moduleId: 'audit-custom', moduleVersion: custom.module.version, modulePackage: custom });
  await changedModule;
  const conflict = structuredClone(custom);
  conflict.cards[0].name = 'Changed after registration';
  const rejected = next(one, 'room:error');
  one.emit('room:settings', { moduleId: 'audit-custom', moduleVersion: custom.module.version, modulePackage: conflict });
  assert.match((await rejected).message, /Invalid or unsupported module package/);
  const restoredModule = next(one, 'room:update', value => value.settings.moduleId === 'frontier-skirmish');
  one.emit('room:settings', { moduleId: 'frontier-skirmish', moduleVersion: '1.0.0' });
  await restoredModule;
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
  const alreadyLocked = next(one, 'room:error');
  one.emit('match:select-deck', { deckId: a.deckId });
  assert.match((await alreadyLocked).message, /already locked/);
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
  const playedCard = playing.table.cards.find(card => card.zone === 'hand' && card.owner === 1);
  const dropped = await updateAfter(one, () => one.emit('match:action', {
    sequence: 1, action: { type: 'to-zone', id: playedCard.id, zone: 'field', x: 631, y: 299 },
  }), 'playing', value => value.table.cards.find(card => card.id === playedCard.id)?.zone === 'field');
  assert.deepEqual([dropped.table.cards.find(card => card.id === playedCard.id).x,
    dropped.table.cards.find(card => card.id === playedCard.id).y], [631, 299]);
  const movedToBase = await updateAfter(one, () => one.emit('match:action', {
    sequence: 2, action: { type: 'to-zone', id: playedCard.id, zone: 'base', x: 500, y: 391 },
  }), 'playing', value => value.table.cards.find(card => card.id === playedCard.id)?.zone === 'base');
  assert.deepEqual([movedToBase.table.cards.find(card => card.id === playedCard.id).x,
    movedToBase.table.cards.find(card => card.id === playedCard.id).y], [500, 391]);
  sockets.forEach(socket => socket.disconnect());
  await stopServer();
  serverOutput = '';
  server = startServer();
  await waitForServer();
  const restoredDecks = await fetch(`${base}/api/decks`, { headers: { Authorization: `Bearer ${a.token}` } }).then(response => response.json());
  assert.equal(restoredDecks.decks.find(item => item.id === a.deckId)?.deck.name, 'Account-bound test deck');
  const resumedSocket = await connect(a.token);
  const resumed = next(resumedSocket, 'match:update', value => value.phase === 'playing');
  resumedSocket.emit('session:resume', { token: roomToken });
  const restoredMatch = await resumed;
  assert.equal(restoredMatch.table.cards.find(card => card.zone === 'objective-a')?.id, ownField.id);
  const restoredCard = restoredMatch.table.cards.find(card => card.id === playedCard.id);
  assert.deepEqual([restoredCard.zone, restoredCard.x, restoredCard.y], ['base', 500, 391]);
  console.log('Account CRUD, isolation, setup, exact card drops, and restart recovery passed.');
} finally {
  sockets.forEach(socket => socket.disconnect());
  await stopServer();
  await rm(temp, { recursive: true, force: true });
}
