require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const openSockets = new Set();

function waitFor(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload) => {
      let matches = false;
      try {
        matches = predicate(payload);
      } catch {
        matches = false;
      }
      if (!matches) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

function waitState(getState, predicate, timeout = 5000, label = 'state') {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      let state;
      let matches = false;
      try {
        state = getState();
        matches = state != null && predicate(state);
      } catch {
        matches = false;
      }
      if (matches) return resolve(state);
      if (Date.now() - started > timeout) {
        return reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`));
      }
      setTimeout(check, 10);
    };
    check();
  });
}

function randomPort(base) {
  return base + Math.floor(Math.random() * 200);
}

async function startServer(dataFile, port, extraEnv = {}) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SPADES_DATA_FILE: dataFile,
      SPADES_RECONNECT_GRACE_MS: '1500',
      SPADES_BOT_DELAY_MS: '20',
      SPADES_TRICK_PAUSE_MS: '20',
      SPADES_NEXT_HAND_MS: '100',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Spades server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}`));
    });
  });
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGKILL');
  });
}

async function connect(port, token) {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { sessionToken: token },
  });
  openSockets.add(socket);
  await waitFor(socket, 'connect');
  return socket;
}

function closeSocket(socket) {
  if (!socket) return;
  openSockets.delete(socket);
  socket.close();
}

function createState(socket) {
  let latest = null;
  socket.on('roomState', (state) => { latest = state; });
  return () => latest;
}

function createLobbyState(socket) {
  let latest = null;
  socket.on('lobbyState', (state) => { latest = state; });
  return () => latest;
}

function playableCard(hand, game) {
  if (!hand || !hand.length) return null;
  if (!game.trick.length) {
    const nonSpade = hand.find((card) => card.suit !== 'Spades');
    return game.spadesBroken || !nonSpade ? hand[0] : nonSpade;
  }
  const follow = hand.find((card) => card.suit === game.leadSuit);
  return follow || hand[0];
}

// Seats four humans into a brand new room in join order, so seat index
// always matches tokens/sockets index (0 = host). Returns live per-socket
// state getters — reading "my seat/hand" must always go through the
// getter for THAT socket, never through another client's last payload,
// since `isYou` is only meaningful relative to whichever socket received it.
async function seatFourHumans(port, tokens) {
  const sockets = [];
  const states = [];

  const host = await connect(port, tokens[0]);
  sockets.push(host);
  states.push(createState(host));
  host.emit('createRoom', { name: 'Host', stake: 250, rankMode: 'ace' });
  const created = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  const roomCode = created.roomCode;

  for (let index = 1; index < tokens.length; index += 1) {
    const client = await connect(port, tokens[index]);
    sockets.push(client);
    states.push(createState(client));
    client.emit('joinRoom', { code: roomCode, name: `Player ${index + 1}` });
    await waitFor(client, 'roomState', (payload) => payload.players.filter(Boolean).length === index + 1);
  }

  return { sockets, states, roomCode };
}

// Drives a freshly-seated 4-human room from lobby through bidding into the
// 'playing' phase, with every seat bidding 2. Relies on seat === join index,
// which only holds for a room nobody has left/reconnected out of order.
async function startAndBid(sockets, states, roomCode) {
  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  for (let bids = 0; bids < 4; bids += 1) {
    const bidState = await waitState(states[0], (state) => state.game.phase === 'bidding');
    const seat = bidState.game.currentSeat;
    sockets[seat].emit('submitBid', { roomCode, bid: 2 });
    await waitState(states[0], (state) => state.players[seat] && state.players[seat].bid === 2);
  }
  return waitState(states[0], (state) => state.game.phase === 'playing');
}

let sharedServer;
let sharedPort;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-shared-'));
  sharedPort = randomPort(4000);
  sharedServer = await startServer(path.join(dataDir, 'rooms.json'), sharedPort);
});

after(async () => {
  for (const socket of [...openSockets]) closeSocket(socket);
  if (sharedServer) await stopServer(sharedServer);
  const { pool } = require('./db');
  await pool.end();
});

test('lobby: host creates room, three humans join in order, a fifth is rejected once full', async (t) => {
  const tokens = ['lobby-host', 'lobby-p2', 'lobby-p3', 'lobby-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  assert.equal(states[3]().players.filter(Boolean).length, 4);
  tokens.forEach((_token, index) => {
    const mine = states[index]().players.find((player) => player && player.isYou);
    assert.equal(mine.seat, index);
  });

  const fifth = await connect(sharedPort, 'lobby-fifth');
  t.after(() => closeSocket(fifth));
  const fifthError = waitFor(fifth, 'errorMessage');
  fifth.emit('joinRoom', { code: roomCode, name: 'Fifth' });
  assert.equal(await fifthError, 'That table is full.');
});

test('host can start with empty seats and bots fill the rest', async (t) => {
  const host = await connect(sharedPort, 'solo-host');
  t.after(() => closeSocket(host));
  const hostState = createState(host);

  host.emit('createRoom', { name: 'Solo Host', stake: 250, rankMode: 'ace' });
  const created = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  host.emit('startGame', { roomCode: created.roomCode });

  const state = await waitState(hostState, (payload) => payload.game && payload.game.phase === 'bidding');
  assert.equal(state.players.filter(Boolean).length, 4);
  assert.equal(state.players.filter((player) => player.isBot).length, 3);
  const me = state.players.find((player) => player.isYou);
  assert.equal(me.hand.length, 13);
});

test('four humans: private hands, bid sync, and card-play sync', async (t) => {
  const tokens = ['sync-host', 'sync-p2', 'sync-p3', 'sync-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const playingState = await startAndBid(sockets, states, roomCode);

  states.forEach((getState) => {
    getState().players.forEach((player) => {
      if (!player) return;
      assert.equal(player.hand.length, player.isYou ? 13 : 0);
    });
  });

  const expectedBids = { 0: 2, 1: 2, 2: 2, 3: 2 };
  states.forEach((getState) => assert.deepEqual(getState().game.bids, expectedBids));

  const seat = playingState.game.currentSeat;
  const me = states[seat]().players.find((player) => player.isYou);
  const card = playableCard(me.hand, playingState.game);
  sockets[seat].emit('playCard', { roomCode, cardCode: card.code });

  await Promise.all(states.map((getState) => waitState(getState, (state) => state.game.trick.length === 1)));
  states.forEach((getState) => {
    const trick = getState().game.trick;
    assert.equal(trick[0].seat, seat);
    assert.equal(trick[0].card.code, card.code);
  });
});

test('lastTrick: a completed trick is preserved for review after the pile clears', async (t) => {
  const tokens = ['lasttrick-host', 'lasttrick-p2', 'lasttrick-p3', 'lasttrick-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const playingState = await startAndBid(sockets, states, roomCode);
  let state = playingState;
  for (let played = 0; played < 4; played += 1) {
    const seat = state.game.currentSeat;
    const me = states[seat]().players.find((player) => player.isYou);
    const card = playableCard(me.hand, state.game);
    sockets[seat].emit('playCard', { roomCode, cardCode: card.code });
    state = await waitState(states[0], (payload) => payload.game && (
      (payload.game.trick || []).length !== (state.game.trick || []).length
      || Boolean(payload.game.resolving) !== Boolean(state.game.resolving)
    ), 5000, 'card played');
  }

  const settled = await waitState(states[0], (payload) => payload.game && payload.game.trick.length === 0 && payload.game.lastTrick, 5000, 'trick cleared with lastTrick recorded');
  assert.equal(settled.game.lastTrick.cards.length, 4);
  assert.equal(typeof settled.game.lastTrick.winnerSeat, 'number');
});

test('disconnect during bidding is observable, and reconnecting within the grace period restores seat, hand, and identity', async (t) => {
  const tokens = ['bid-recon-host', 'bid-recon-p2', 'bid-recon-p3', 'bid-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');

  const targetSeat = 1;
  const handBefore = states[targetSeat]().players.find((player) => player.isYou).hand;
  const teamBefore = states[targetSeat]().players[targetSeat].team;

  sockets[targetSeat].disconnect();
  await waitState(states[0], (state) => state.players[targetSeat]?.connected === false, 5000, 'disconnect observed by another client');
  assert.ok(states[0]().players[targetSeat], 'seat is retained (not removed) during the grace period');

  const reconnected = await connect(sharedPort, tokens[targetSeat]);
  sockets[targetSeat] = reconnected;
  states[targetSeat] = createState(reconnected);
  const recovered = await waitFor(reconnected, 'roomState', (payload) => payload.game);

  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, targetSeat);
  assert.deepEqual(me.hand, handBefore);
  assert.equal(me.team, teamBefore);
  assert.equal(recovered.game.phase, 'bidding');
  assert.equal(recovered.players[targetSeat].connected, true);
});

test('reconnect during an active trick preserves the trick, and the player retains bid, tricks, and team', async (t) => {
  const tokens = ['trick-recon-host', 'trick-recon-p2', 'trick-recon-p3', 'trick-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const playingState = await startAndBid(sockets, states, roomCode);
  const leaderSeat = playingState.game.currentSeat;
  const leaderHand = states[leaderSeat]().players.find((player) => player.isYou).hand;
  const leaderCard = playableCard(leaderHand, playingState.game);
  sockets[leaderSeat].emit('playCard', { roomCode, cardCode: leaderCard.code });
  const trickState = await waitState(states[0], (state) => state.game.trick.length === 1);

  const targetSeat = (leaderSeat + 1) % 4;
  const beforeBid = trickState.players[targetSeat].bid;
  const beforeTeam = trickState.players[targetSeat].team;
  const beforeTricks = trickState.players[targetSeat].tricks;

  sockets[targetSeat].disconnect();
  await waitState(states[0], (state) => state.players[targetSeat]?.connected === false);

  const reconnected = await connect(sharedPort, tokens[targetSeat]);
  sockets[targetSeat] = reconnected;
  states[targetSeat] = createState(reconnected);
  const recovered = await waitFor(reconnected, 'roomState', (payload) => payload.game && payload.game.trick.length === 1);

  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, targetSeat);
  assert.equal(me.bid, beforeBid);
  assert.equal(me.team, beforeTeam);
  assert.equal(me.tricks, beforeTricks);
  assert.deepEqual(recovered.game.trick, trickState.game.trick);
});

test('host reconnect restores host status and seat', async (t) => {
  const tokens = ['host-recon-host', 'host-recon-p2', 'host-recon-p3', 'host-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  assert.equal(states[0]().isHost, true);

  sockets[0].disconnect();
  await waitState(states[1], (state) => state.players[0]?.connected === false);
  assert.equal(states[1]().isHost, false, 'no one holds host while the host is disconnected');

  const reconnectedHost = await connect(sharedPort, tokens[0]);
  sockets[0] = reconnectedHost;
  states[0] = createState(reconnectedHost);
  const recovered = await waitFor(reconnectedHost, 'roomState', (payload) => payload.isHost);

  assert.equal(recovered.players.find((player) => player.isYou).seat, 0);
  assert.equal(recovered.isHost, true);
});

test('a stolen or fabricated session token cannot hijack an occupied seat', async (t) => {
  const tokens = ['hijack-host', 'hijack-p2', 'hijack-p3', 'hijack-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const stranger = await connect(sharedPort, 'hijack-fabricated-token');
  t.after(() => closeSocket(stranger));
  const strangerError = waitFor(stranger, 'errorMessage');
  stranger.emit('joinRoom', { code: roomCode, name: 'Stranger' });
  assert.equal(await strangerError, 'That table is full.', 'an unrecognized token cannot displace a seated player');

  const impersonator = await connect(sharedPort, tokens[1]);
  t.after(() => closeSocket(impersonator));
  const impersonatorError = await waitFor(impersonator, 'errorMessage');
  assert.equal(impersonatorError, 'That session is already connected.');

  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');

  const bidBefore = states[0]().players[1].bid;
  const impersonatorBidError = waitFor(impersonator, 'errorMessage');
  impersonator.emit('submitBid', { roomCode, bid: 9 });
  assert.equal(await impersonatorBidError, 'You are not seated at this table.');
  assert.equal(states[0]().players[1].bid, bidBefore, 'the impersonating socket cannot act on the real seat');
});

test('grace-period expiry converts an abandoned seat to a bot so the hand can continue', async (t) => {
  const tokens = ['expiry-host', 'expiry-p2', 'expiry-p3', 'expiry-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  await startAndBid(sockets, states, roomCode);
  const targetSeat = 2;
  const nameBefore = states[targetSeat]().players[targetSeat].name;

  sockets[targetSeat].disconnect();

  const converted = await waitState(
    states[0],
    (state) => state.players[targetSeat]?.isBot === true,
    5000,
    'grace-period expiry converting the seat to a bot'
  );
  assert.equal(converted.players[targetSeat].connected, true);
  assert.equal(converted.players[targetSeat].name, nameBefore);
  assert.ok(converted.game, 'the room keeps broadcasting normally after the takeover');
});

test('restarting the server recovers room state and host identity, without exposing hands prematurely', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-restart-'));
  const dataFile = path.join(dataDir, 'rooms.json');
  const port = randomPort(4300);
  let server = await startServer(dataFile, port);

  const tokens = ['restart-host', 'restart-p2', 'restart-p3', 'restart-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(port, tokens);
  t.after(async () => {
    sockets.forEach(closeSocket);
    await stopServer(server);
  });

  await startAndBid(sockets, states, roomCode);
  const hostHandBefore = states[0]().players.find((player) => player.isYou).hand;

  sockets.forEach(closeSocket);
  await stopServer(server);
  server = await startServer(dataFile, port);

  const restartedHost = await connect(port, tokens[0]);
  sockets[0] = restartedHost;
  states[0] = createState(restartedHost);
  const recovered = await waitFor(restartedHost, 'roomState', (payload) => payload.roomCode === roomCode);

  assert.equal(recovered.game.phase, 'playing');
  assert.equal(recovered.isHost, true);
  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, 0);
  assert.deepEqual(me.hand, hostHandBefore);

  const notYetReconnected = recovered.players.find((player) => player && !player.isYou && !player.isBot);
  assert.ok(notYetReconnected, 'the other human seats survive the restart as disconnected, not removed');
  assert.equal(notYetReconnected.connected, false);
  assert.equal(notYetReconnected.hand.length, 0, 'a recovered hand is never sent to anyone but its owner');
});

test('lobby: joining players see each other in the room roster', async (t) => {
  const alice = await connect(sharedPort, 'lobby-roster-alice');
  const aliceLobby = createLobbyState(alice);
  t.after(() => closeSocket(alice));
  alice.emit('joinLobby', { lobbyRoomId: 'beginner', name: 'Alice' });
  await waitState(aliceLobby, (state) => state.roster.includes('Alice'));

  const bob = await connect(sharedPort, 'lobby-roster-bob');
  const bobLobby = createLobbyState(bob);
  t.after(() => closeSocket(bob));
  bob.emit('joinLobby', { lobbyRoomId: 'beginner', name: 'Bob' });

  await waitState(aliceLobby, (state) => state.roster.includes('Bob'));
  await waitState(bobLobby, (state) => state.roster.includes('Alice') && state.roster.includes('Bob'));
});

test('lobby: chat broadcasts within a room and stays isolated from other rooms', async (t) => {
  const beginnerA = await connect(sharedPort, 'chat-beg-a');
  const beginnerB = await connect(sharedPort, 'chat-beg-b');
  const expertC = await connect(sharedPort, 'chat-exp-c');
  t.after(() => [beginnerA, beginnerB, expertC].forEach(closeSocket));

  const beginnerALobby = createLobbyState(beginnerA);
  const beginnerBLobby = createLobbyState(beginnerB);
  const expertCLobby = createLobbyState(expertC);
  beginnerA.emit('joinLobby', { lobbyRoomId: 'beginner', name: 'A' });
  beginnerB.emit('joinLobby', { lobbyRoomId: 'beginner', name: 'B' });
  expertC.emit('joinLobby', { lobbyRoomId: 'expert', name: 'C' });
  await waitState(beginnerALobby, (state) => state.roster.includes('A') && state.roster.includes('B'));
  await waitState(beginnerBLobby, (state) => state.roster.includes('A') && state.roster.includes('B'));
  await waitState(expertCLobby, (state) => state.roster.includes('C'));

  const gotChat = waitFor(beginnerB, 'lobbyChatMessage', (message) => message.text === 'hello beginners');
  const expertHeardNothing = waitFor(expertC, 'lobbyChatMessage', () => true, 400)
    .then(() => true)
    .catch(() => false);

  beginnerA.emit('sendLobbyChat', { lobbyRoomId: 'beginner', text: 'hello beginners' });

  const message = await gotChat;
  assert.equal(message.name, 'A');
  assert.equal(await expertHeardNothing, false, 'a room outside the sender never receives the message');
});

test('lobby table: joining a numbered table seats the player and updates occupancy for lobby watchers', async (t) => {
  const watcher = await connect(sharedPort, 'table-watch');
  const watcherLobby = createLobbyState(watcher);
  t.after(() => closeSocket(watcher));
  watcher.emit('joinLobby', { lobbyRoomId: 'advance', name: 'Watcher' });
  await waitState(watcherLobby, (state) => Array.isArray(state.tables) && state.tables.length === 25);

  const player = await connect(sharedPort, 'table-player');
  const playerState = createState(player);
  t.after(() => closeSocket(player));
  player.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 12, name: 'Solo' });
  await waitState(playerState, (state) => state.players.some((seat) => seat && seat.isYou));

  const updated = await waitState(watcherLobby, (state) => state.tables[11].seatedCount === 1);
  assert.equal(updated.tables[11].tableNumber, 12);
  assert.deepEqual(updated.tables[11].seats, ['Solo', null, null, null]);
});

test('lobby table: a fifth arrival at a full table becomes a spectator instead of being rejected', async (t) => {
  const tokens = ['spec-p1', 'spec-p2', 'spec-p3', 'spec-p4'];
  const sockets = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    seatSocket.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 18, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await Promise.all(sockets.map((seatSocket) => waitFor(seatSocket, 'roomState', (payload) => payload.players.filter(Boolean).length === 4)));

  const watcher = await connect(sharedPort, 'spec-watcher');
  const watcherState = createState(watcher);
  t.after(() => closeSocket(watcher));
  watcher.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 18, name: 'Watcher' });
  const seen = await waitState(watcherState, (state) => state.isSpectator === true);
  assert.equal(seen.players.filter(Boolean).length, 4);
  seen.players.forEach((seat) => assert.equal(seat.hand.length, 0, 'a spectator never receives anyone\'s hand'));
});

test('leaveTable: leaving before a hand starts frees the seat for someone else', async (t) => {
  const solo = await connect(sharedPort, 'leave-solo');
  const soloState = createState(solo);
  t.after(() => closeSocket(solo));
  solo.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 23, name: 'Solo' });
  await waitState(soloState, (state) => state.players.some((seat) => seat && seat.isYou));

  solo.emit('leaveTable', { roomCode: soloState().roomCode });

  const other = await connect(sharedPort, 'leave-other');
  const otherState = createState(other);
  t.after(() => closeSocket(other));
  other.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 23, name: 'Other' });
  const seated = await waitState(otherState, (state) => state.players.filter(Boolean).length === 1);
  assert.equal(seated.players.find((seat) => seat && seat.isYou).name, 'Other', 'the freed seat is available again, not stuck occupied');
});

test('leaveTable: leaving mid-hand converts the seat to a bot so the hand continues', async (t) => {
  const tokens = ['leave-mid-1', 'leave-mid-2', 'leave-mid-3', 'leave-mid-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 21, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await waitState(states[3], (state) => state.game && state.game.phase === 'bidding');

  const roomCode = states[0]().roomCode;
  sockets[1].emit('leaveTable', { roomCode });

  const updated = await waitState(states[0], (state) => state.players[1] && state.players[1].isBot === true);
  assert.equal(updated.players[1].connected, true);
  assert.ok(updated.game, 'the table keeps broadcasting normally after the takeover');
});

test('leaveTable: a spectator can leave, freeing their spot in the room watchers count', async (t) => {
  const tokens = ['spec-leave-1', 'spec-leave-2', 'spec-leave-3', 'spec-leave-4'];
  const sockets = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    seatSocket.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 8, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await Promise.all(sockets.map((seatSocket) => waitFor(seatSocket, 'roomState', (payload) => payload.players.filter(Boolean).length === 4)));

  const watcher = await connect(sharedPort, 'spec-leave-watcher');
  const watcherState = createState(watcher);
  const watcherLobby = createLobbyState(watcher);
  t.after(() => closeSocket(watcher));
  watcher.emit('joinLobby', { lobbyRoomId: 'expert', name: 'Watcher' });
  watcher.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 8, name: 'Watcher' });
  await waitState(watcherState, (state) => state.isSpectator === true);
  await waitState(watcherLobby, (state) => state.tables[7].spectatorCount === 1);

  watcher.emit('leaveTable', { roomCode: watcherState().roomCode });
  await waitState(watcherLobby, (state) => state.tables[7].spectatorCount === 0);
});

test('lobby table: the first human to sit becomes host and can start early with bots filling the rest', async (t) => {
  const solo = await connect(sharedPort, 'bot-start-solo');
  const soloState = createState(solo);
  t.after(() => closeSocket(solo));
  solo.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 14, name: 'Solo' });
  const seated = await waitState(soloState, (state) => state.players.some((seat) => seat && seat.isYou));
  assert.equal(seated.isHost, true, 'the first person to sit becomes host of an empty lobby table');

  solo.emit('startGame', { roomCode: seated.roomCode });
  const started = await waitState(soloState, (state) => state.game && state.game.phase === 'bidding');
  assert.equal(started.players.filter((seat) => seat && seat.isBot).length, 3, 'the empty seats fill with bots');
});

test('lobby table: locking blocks new public arrivals, but the table code still lets someone in', async (t) => {
  const host = await connect(sharedPort, 'lock-host');
  const hostState = createState(host);
  t.after(() => closeSocket(host));
  host.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 20, name: 'Host' });
  const seated = await waitState(hostState, (state) => state.players.some((seat) => seat && seat.isYou));
  const roomCode = seated.roomCode;

  host.emit('toggleTableLock', { roomCode });
  await waitState(hostState, (state) => state.locked === true);

  const stranger = await connect(sharedPort, 'lock-stranger');
  t.after(() => closeSocket(stranger));
  const strangerError = waitFor(stranger, 'errorMessage');
  stranger.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 20, name: 'Stranger' });
  assert.equal(await strangerError, 'This table is locked. Ask for the table code to join.');

  const friend = await connect(sharedPort, 'lock-friend');
  const friendState = createState(friend);
  t.after(() => closeSocket(friend));
  friend.emit('joinRoom', { code: roomCode, name: 'Friend' });
  const friendSeated = await waitState(friendState, (state) => state.players.filter(Boolean).length === 2);
  assert.ok(friendSeated.players.find((seat) => seat && seat.isYou), 'the friend gets seated via the direct code despite the lock');
});

test('lobby table: a locked table is flagged in the room table grid', async (t) => {
  const host = await connect(sharedPort, 'lock-flag-host');
  const hostState = createState(host);
  const hostLobby = createLobbyState(host);
  t.after(() => closeSocket(host));
  host.emit('joinLobby', { lobbyRoomId: 'expert', name: 'Host' });
  host.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 22, name: 'Host' });
  const seated = await waitState(hostState, (state) => state.players.some((seat) => seat && seat.isYou));

  host.emit('toggleTableLock', { roomCode: seated.roomCode });
  await waitState(hostLobby, (state) => state.tables[21].locked === true);
});

test('lobby table: leaving an empty locked table resets the lock for the next arrivals', async (t) => {
  const host = await connect(sharedPort, 'lock-reset-host');
  const hostState = createState(host);
  t.after(() => closeSocket(host));
  host.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 19, name: 'Host' });
  const seated = await waitState(hostState, (state) => state.players.some((seat) => seat && seat.isYou));
  const roomCode = seated.roomCode;
  host.emit('toggleTableLock', { roomCode });
  await waitState(hostState, (state) => state.locked === true);

  host.emit('leaveTable', { roomCode });

  const newcomer = await connect(sharedPort, 'lock-reset-newcomer');
  const newcomerState = createState(newcomer);
  t.after(() => closeSocket(newcomer));
  newcomer.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 19, name: 'Newcomer' });
  const arrived = await waitState(newcomerState, (state) => state.players.some((seat) => seat && seat.isYou));
  assert.equal(arrived.locked, false, 'the lock resets once the table empties out');
});

test('voteKick: two votes remove a seated human, converting the seat to a bot mid-hand', async (t) => {
  const tokens = ['kick-1', 'kick-2', 'kick-3', 'kick-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 24, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await waitState(states[3], (state) => state.game && state.game.phase === 'bidding');

  const roomCode = states[0]().roomCode;
  const targetSeat = 2;
  const targetErrorPromise = waitFor(sockets[targetSeat], 'errorMessage');

  sockets[0].emit('voteKick', { roomCode, targetSeat });
  await waitState(states[0], (state) => (state.players[targetSeat].votesAgainst || 0) === 1);
  assert.notEqual(states[0]().players[targetSeat].isBot, true, 'a single vote does not kick anyone');

  sockets[1].emit('voteKick', { roomCode, targetSeat });

  const updated = await waitState(states[0], (state) => state.players[targetSeat] && state.players[targetSeat].isBot === true);
  assert.equal(updated.players[targetSeat].connected, true, 'a bot takes over so the hand can continue');
  assert.equal(await targetErrorPromise, 'You were voted off this table.');
});

test('voteKick: you cannot vote to kick yourself', async (t) => {
  const tokens = ['selfkick-1', 'selfkick-2', 'selfkick-3', 'selfkick-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 25, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await waitState(states[3], (state) => state.players.filter(Boolean).length === 4);

  const roomCode = states[0]().roomCode;
  const selfError = waitFor(sockets[0], 'errorMessage');
  sockets[0].emit('voteKick', { roomCode, targetSeat: 0 });
  assert.equal(await selfError, 'You cannot vote to kick yourself.');
});

test('turn timer: a player who lets their turn expire has that turn auto-played, but keeps their seat', async (t) => {
  const tokens = ['timer-1', 'timer-2', 'timer-3', 'timer-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 19, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  const started = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  assert.equal(started.isHost, true, 'the first person to sit is host and may set the timer');

  sockets[0].emit('setTurnTimer', { roomCode: started.roomCode, seconds: 1 });
  await waitState(states[0], (state) => state.turnTimerSeconds === 1);

  const timedOutSeat = started.game.currentSeat;
  const timedOutError = waitFor(sockets[timedOutSeat], 'errorMessage');

  const updated = await waitState(states[0], (state) => state.players[timedOutSeat].bid !== null, 3000, 'auto-play after timeout');
  assert.equal(updated.players[timedOutSeat].isBot, false, 'the seat stays with the human, this is never a permanent demotion');
  assert.equal(updated.players[timedOutSeat].connected, true, 'the player keeps their seat');
  assert.equal(await timedOutError, 'You timed out, your seat auto-played that turn.');
  assert.equal(states[timedOutSeat]().isSpectator, false, 'the timed-out player is never converted to a spectator');
});

test('claimSeat: a spectator can take over a bot-occupied seat without leaving or rejoining', async (t) => {
  const tokens = ['claim-1', 'claim-2', 'claim-3', 'claim-4'];
  const sockets = [];
  const states = [];
  const tableNumber = 16;
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'expert', tableNumber, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  const started = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  const roomCode = started.roomCode;

  sockets[2].emit('leaveTable', { roomCode });
  await waitState(states[0], (state) => state.players[2].isBot === true, 3000, 'left seat becomes a bot so the hand continues');

  const spectator = await connect(sharedPort, 'claim-spectator');
  const spectatorState = createState(spectator);
  t.after(() => closeSocket(spectator));
  spectator.emit('joinTable', { lobbyRoomId: 'expert', tableNumber, name: 'Claimant' });
  await waitState(spectatorState, (state) => state.isSpectator === true, 3000, 'table looks full, the new arrival spectates');

  spectator.emit('claimSeat', { roomCode, seat: 2 });
  const seated = await waitState(spectatorState, (state) => !state.isSpectator, 3000, 'spectator becomes seated');
  const me = seated.players.find((player) => player.isYou);
  assert.equal(me.seat, 2);
  assert.equal(me.isBot, false);
  assert.equal(me.name, 'Claimant');

  await waitState(states[0], (state) => state.players[2].isBot === false && state.players[2].name === 'Claimant', 3000, 'other players see the reseated human');
});

test('claimSeat: two spectators racing the same seat, only one wins and the loser is told why', async (t) => {
  const tokens = ['race-1', 'race-2', 'race-3', 'race-4'];
  const sockets = [];
  const states = [];
  const tableNumber = 17;
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'expert', tableNumber, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  const started = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  const roomCode = started.roomCode;

  sockets[1].emit('leaveTable', { roomCode });
  await waitState(states[0], (state) => state.players[1].isBot === true, 3000, 'left seat becomes a bot');

  const specA = await connect(sharedPort, 'race-spec-a');
  const specB = await connect(sharedPort, 'race-spec-b');
  t.after(() => [specA, specB].forEach(closeSocket));
  const stateA = createState(specA);
  const stateB = createState(specB);
  const errorsA = [];
  const errorsB = [];
  specA.on('errorMessage', (message) => errorsA.push(message));
  specB.on('errorMessage', (message) => errorsB.push(message));
  specA.emit('joinTable', { lobbyRoomId: 'expert', tableNumber, name: 'RaceA' });
  specB.emit('joinTable', { lobbyRoomId: 'expert', tableNumber, name: 'RaceB' });
  await waitState(stateA, (state) => state.isSpectator === true, 3000);
  await waitState(stateB, (state) => state.isSpectator === true, 3000);

  specA.emit('claimSeat', { roomCode, seat: 1 });
  specB.emit('claimSeat', { roomCode, seat: 1 });

  await new Promise((resolve) => { setTimeout(resolve, 300); });

  const aSeated = !stateA().isSpectator;
  const bSeated = !stateB().isSpectator;
  assert.notEqual(aSeated, bSeated, 'exactly one of the two racing spectators gets seated, never both, never neither');
  const loserErrors = aSeated ? errorsB : errorsA;
  assert.ok(loserErrors.includes('That seat is already taken.'), 'the loser is told the seat was already taken');
});

test('watchSeat: a spectator can attach to a specific player, visible in that player\'s watcher list', async (t) => {
  const tokens = ['watch-1', 'watch-2', 'watch-3', 'watch-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 6, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await Promise.all(sockets.map((seatSocket) => waitFor(seatSocket, 'roomState', (payload) => payload.players.filter(Boolean).length === 4)));

  const watcher = await connect(sharedPort, 'watch-spectator');
  const watcherState = createState(watcher);
  t.after(() => closeSocket(watcher));
  watcher.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 6, name: 'Watcher', watchSeat: 1 });
  await waitState(watcherState, (state) => state.isSpectator === true);

  await waitState(states[1], (state) => state.players[1].watchers.some((watcherEntry) => watcherEntry.name === 'Watcher'));
});

test('watchSeat: only the watched player can remove their own watcher', async (t) => {
  const tokens = ['boot-1', 'boot-2', 'boot-3', 'boot-4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 6, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await Promise.all(sockets.map((seatSocket) => waitFor(seatSocket, 'roomState', (payload) => payload.players.filter(Boolean).length === 4)));

  const watcher = await connect(sharedPort, 'boot-spectator');
  const watcherState = createState(watcher);
  t.after(() => closeSocket(watcher));
  watcher.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 6, name: 'Watcher', watchSeat: 2 });
  await waitState(watcherState, (state) => state.isSpectator === true);

  const seat2State = await waitState(states[2], (state) => state.players[2].watchers.length === 1);
  const watcherId = seat2State.players[2].watchers[0].id;

  const wrongPlayerError = waitFor(sockets[0], 'errorMessage');
  sockets[0].emit('removeWatcher', { roomCode: seat2State.roomCode, watcherId });
  assert.equal(await wrongPlayerError, 'You can only remove someone watching your own seat.');

  const bootedError = waitFor(watcher, 'errorMessage');
  sockets[2].emit('removeWatcher', { roomCode: seat2State.roomCode, watcherId });
  assert.equal(await bootedError, 'The player you were watching removed you from the table.');
  await waitState(states[2], (state) => state.players[2].watchers.length === 0);
});

test('rankMode: a lobby table defaults to standard ace-high rules', async (t) => {
  const solo = await connect(sharedPort, 'rankmode-default-solo');
  const soloState = createState(solo);
  t.after(() => closeSocket(solo));
  solo.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 22, name: 'Solo' });
  const seated = await waitState(soloState, (state) => state.players.some((seat) => seat && seat.isYou));
  assert.equal(seated.rankMode, 'ace', 'tables default to standard rules unless the host opts into 2s high');
});

test('rankMode: the host can switch to 2s high before the hand starts, and a non-host cannot', async (t) => {
  const tokens = ['rankmode-host', 'rankmode-guest'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'advance', tableNumber: 22, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await waitState(states[1], (state) => state.players.filter(Boolean).length === 2);

  const guestError = waitFor(sockets[1], 'errorMessage');
  sockets[1].emit('setRankMode', { roomCode: states[0]().roomCode, rankMode: 'deuces' });
  assert.equal(await guestError, 'Only the host can change the game style.');

  sockets[0].emit('setRankMode', { roomCode: states[0]().roomCode, rankMode: 'deuces' });
  await waitState(states[0], (state) => state.rankMode === 'deuces');
});

test('match: the match ends once a team reaches the stake target, instead of dealing forever', async (t) => {
  const host = await connect(sharedPort, 'match-end-host');
  const hostState = createState(host);
  t.after(() => closeSocket(host));

  host.emit('createRoom', { name: 'Solo Host', stake: 250, rankMode: 'ace' });
  let state = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  const roomCode = state.roomCode;

  host.emit('startGame', { roomCode });
  state = await waitState(hostState, (payload) => payload.game && payload.game.phase === 'bidding', 5000, 'first hand dealt');

  let safety = 0;
  while (!state.game.matchOver && safety < 1200) {
    safety += 1;
    const me = state.players.find((player) => player.isYou);

    if (state.game.phase === 'bidding') {
      if (state.game.currentSeat === me.seat && me.bid == null) {
        host.emit('submitBid', { roomCode, bid: 3 });
      }
      state = await waitState(hostState, (payload) => payload.game && (
        payload.game.phase === 'playing' || payload.game.currentSeat !== state.game.currentSeat
      ), 5000, 'bid progress');
      continue;
    }

    if (state.game.phase === 'playing') {
      if (!state.game.resolving && state.game.currentSeat === me.seat) {
        const card = playableCard(me.hand, state.game);
        host.emit('playCard', { roomCode, cardCode: card.code });
      }
      state = await waitState(hostState, (payload) => payload.game && (
        payload.game.phase === 'finished'
        || payload.game.currentSeat !== state.game.currentSeat
        || Boolean(payload.game.resolving) !== Boolean(state.game.resolving)
      ), 5000, 'play progress');
      continue;
    }

    if (state.game.phase === 'finished') {
      state = await waitState(hostState, (payload) => payload.game && (
        payload.game.matchOver || payload.game.phase === 'bidding'
      ), 5000, 'next hand or match end');
    }
  }

  assert.equal(state.game.matchOver, true, 'the match ends once a team crosses the stake target');
  assert.equal(typeof state.game.matchWinner, 'number');
  const winnerScore = state.game.scores[state.game.matchWinner];
  assert.ok(winnerScore >= 250, `winning team's score (${winnerScore}) should be at least the stake target`);

  const dealError = waitFor(host, 'errorMessage');
  host.emit('nextHand', { roomCode });
  assert.equal(await dealError, 'The match is over. Start a new game to keep playing.');
});

test('rated match: a real match played to completion by 4 authenticated accounts awards Elo, a bot-filled match does not', async (t) => {
  const { query } = require('./db');
  const createdPlayerIds = [];
  t.after(async () => {
    if (createdPlayerIds.length) {
      await query('delete from rated_matches where team_a_player1 = any($1::uuid[]) or team_b_player1 = any($1::uuid[])', [createdPlayerIds]);
      await query('delete from players where id = any($1::uuid[])', [createdPlayerIds]);
    }
  });

  const httpBase = `http://127.0.0.1:${sharedPort}`;
  async function signup(prefix) {
    const suffix = crypto.randomBytes(4).toString('hex');
    const res = await fetch(`${httpBase}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screenName: `${prefix}${suffix}`,
        email: `${prefix}${suffix}@example.com`,
        password: 'correct-horse',
        passwordConfirm: 'correct-horse',
      }),
    });
    const json = await res.json();
    createdPlayerIds.push(json.player.id);
    return json;
  }

  const accounts = await Promise.all([
    signup('rated-a1-'), signup('rated-a2-'), signup('rated-b1-'), signup('rated-b2-'),
  ]);

  const sockets = await Promise.all(accounts.map((_, i) => connect(sharedPort, `rated-match-${i}`)));
  t.after(() => sockets.forEach(closeSocket));
  const states = sockets.map((socket) => createState(socket));

  sockets[0].emit('createRoom', { name: accounts[0].player.screenName, stake: 250, rankMode: 'ace', accountToken: accounts[0].token });
  const created = await waitFor(sockets[0], 'roomState', (payload) => payload.roomCode);
  const roomCode = created.roomCode;

  for (let i = 1; i < 4; i += 1) {
    sockets[i].emit('joinRoom', { code: roomCode, name: accounts[i].player.screenName, accountToken: accounts[i].token });
  }
  await Promise.all(states.map((getState) => waitState(getState, (state) => state.players.filter(Boolean).length === 4, 5000, 'all 4 accounts seated')));

  sockets[0].emit('startGame', { roomCode });
  await Promise.all(states.map((getState) => waitState(getState, (state) => state.game && state.game.phase === 'bidding', 5000, 'first hand dealt')));

  let matchOver = false;
  let safety = 0;
  while (!matchOver && safety < 2000) {
    safety += 1;
    for (let seat = 0; seat < 4; seat += 1) {
      const state = states[seat]();
      if (!state || !state.game) continue;
      if (state.game.matchOver) { matchOver = true; break; }
      const me = state.players.find((player) => player.isYou);
      if (!me) continue;

      if (state.game.phase === 'bidding' && state.game.currentSeat === me.seat && me.bid == null) {
        sockets[seat].emit('submitBid', { roomCode, bid: 3 });
      } else if (state.game.phase === 'playing' && !state.game.resolving && state.game.currentSeat === me.seat) {
        const card = playableCard(me.hand, state.game);
        if (card) sockets[seat].emit('playCard', { roomCode, cardCode: card.code });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  assert.equal(matchOver, true, 'the 4-account match reached completion within the safety bound');

  // The award is fire-and-forget from the server's point of view, poll for
  // the write instead of a fixed sleep, timing varies under full-suite load.
  let ratedRow = { rowCount: 0 };
  const pollDeadline = Date.now() + 8000;
  while (ratedRow.rowCount === 0 && Date.now() < pollDeadline) {
    ratedRow = await query(
      'select * from rated_matches where team_a_player1 = $1 or team_a_player2 = $1 or team_b_player1 = $1 or team_b_player2 = $1',
      [accounts[0].player.id],
    );
    if (ratedRow.rowCount === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ratedRow.rowCount, 1, 'exactly one rated_matches row was recorded for this match');

  const playersAfter = await query(
    'select id, elo_rating as "eloRating", wins, losses, games_played as "gamesPlayed" from players where id = any($1::uuid[])',
    [accounts.map((a) => a.player.id)],
  );
  playersAfter.rows.forEach((row) => {
    assert.equal(row.gamesPlayed, 1);
    assert.equal(row.wins + row.losses, 1);
    assert.notEqual(row.eloRating, 1500, 'rating actually moved from the 1500 starting point');
  });

  const totalDelta = playersAfter.rows.reduce((sum, row) => sum + (row.eloRating - 1500), 0);
  assert.equal(totalDelta, 0, 'the four accounts\' rating changes are zero-sum');
});

test('rated match: a match with a bot in one seat never awards Elo', async (t) => {
  const { query } = require('./db');
  const createdPlayerIds = [];
  t.after(async () => {
    if (createdPlayerIds.length) await query('delete from players where id = any($1::uuid[])', [createdPlayerIds]);
  });

  const httpBase = `http://127.0.0.1:${sharedPort}`;
  const suffix = crypto.randomBytes(4).toString('hex');
  const signupRes = await fetch(`${httpBase}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      screenName: `solo-rated-${suffix}`,
      email: `solo-rated-${suffix}@example.com`,
      password: 'correct-horse',
      passwordConfirm: 'correct-horse',
    }),
  });
  const account = await signupRes.json();
  createdPlayerIds.push(account.player.id);

  const host = await connect(sharedPort, `solo-rated-${suffix}`);
  const hostState = createState(host);
  t.after(() => closeSocket(host));

  host.emit('createRoom', { name: account.player.screenName, stake: 250, rankMode: 'ace', accountToken: account.token });
  const created = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  const roomCode = created.roomCode;

  host.emit('startGame', { roomCode });
  let state = await waitState(hostState, (payload) => payload.game && payload.game.phase === 'bidding', 5000, 'first hand dealt');

  let safety = 0;
  while (!state.game.matchOver && safety < 1200) {
    safety += 1;
    const me = state.players.find((player) => player.isYou);
    if (state.game.phase === 'bidding') {
      if (state.game.currentSeat === me.seat && me.bid == null) host.emit('submitBid', { roomCode, bid: 3 });
      state = await waitState(hostState, (payload) => payload.game && (payload.game.phase === 'playing' || payload.game.currentSeat !== state.game.currentSeat), 5000, 'bid progress');
      continue;
    }
    if (state.game.phase === 'playing') {
      if (!state.game.resolving && state.game.currentSeat === me.seat) {
        const card = playableCard(me.hand, state.game);
        host.emit('playCard', { roomCode, cardCode: card.code });
      }
      state = await waitState(hostState, (payload) => payload.game && (payload.game.phase === 'finished' || payload.game.currentSeat !== state.game.currentSeat || Boolean(payload.game.resolving) !== Boolean(state.game.resolving)), 5000, 'play progress');
      continue;
    }
    if (state.game.phase === 'finished') {
      state = await waitState(hostState, (payload) => payload.game && (payload.game.matchOver || payload.game.phase === 'bidding'), 5000, 'next hand or match end');
    }
  }

  assert.equal(state.game.matchOver, true);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const playerAfter = await query(
    'select elo_rating as "eloRating", games_played as "gamesPlayed" from players where id = $1',
    [account.player.id],
  );
  assert.equal(playerAfter.rows[0].eloRating, 1500, 'a match with 3 bot seats never touches Elo');
  assert.equal(playerAfter.rows[0].gamesPlayed, 0);
});

test('tableChat: a message broadcasts to everyone seated or spectating at that table', async (t) => {
  const host = await connect(sharedPort, 'tchat-host');
  t.after(() => closeSocket(host));
  host.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 10, name: 'Host' });
  const seated = await waitFor(host, 'roomState', (payload) => payload.players.some((seat) => seat && seat.isYou));
  const roomCode = seated.roomCode;

  const watcher = await connect(sharedPort, 'tchat-watcher');
  t.after(() => closeSocket(watcher));
  watcher.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 10, name: 'Watcher', watchSeat: 0 });
  await waitFor(watcher, 'roomState', (payload) => payload.isSpectator === true);

  const watcherGotMessage = waitFor(watcher, 'tableChatMessage', (message) => message.text === 'good luck all');
  host.emit('sendTableChat', { roomCode, text: 'good luck all' });
  const message = await watcherGotMessage;
  assert.equal(message.name, 'Host');
});

test('tableChat: a newcomer receives the existing chat history for that table', async (t) => {
  const host = await connect(sharedPort, 'tchat-hist-host');
  t.after(() => closeSocket(host));
  host.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 10, name: 'Host' });
  const seated = await waitFor(host, 'roomState', (payload) => payload.players.some((seat) => seat && seat.isYou));
  const roomCode = seated.roomCode;

  host.emit('sendTableChat', { roomCode, text: 'nice hand' });
  await waitFor(host, 'tableChatMessage', (message) => message.text === 'nice hand');

  const newcomer = await connect(sharedPort, 'tchat-hist-newcomer');
  t.after(() => closeSocket(newcomer));
  const historyPromise = waitFor(newcomer, 'tableChatHistory');
  newcomer.emit('joinTable', { lobbyRoomId: 'expert', tableNumber: 10, name: 'Newcomer' });
  const history = await historyPromise;
  assert.ok(history.some((message) => message.text === 'nice hand'), 'the newcomer sees chat that happened before they joined');
});

test('lobby table: the hand auto-starts once four humans are seated, no host action needed', async (t) => {
  const tokens = ['auto-p1', 'auto-p2', 'auto-p3', 'auto-p4'];
  const sockets = [];
  const states = [];
  for (const token of tokens) {
    const seatSocket = await connect(sharedPort, token);
    sockets.push(seatSocket);
    states.push(createState(seatSocket));
    seatSocket.emit('joinTable', { lobbyRoomId: 'beginner', tableNumber: 25, name: token });
  }
  t.after(() => sockets.forEach(closeSocket));
  await waitState(states[3], (state) => state.game && state.game.phase === 'bidding');
});
