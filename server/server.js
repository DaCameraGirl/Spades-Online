require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const auth = require('./auth');
const { recordRatedMatch } = require('./matches');
const ownerCommands = require('./ownerCommands');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
});

const { SUITS, sortHand, pickBotCard, determineWinner, teamForSeat, isTrump, effectiveSuit, scoreTeamSeats, matchWinningTeam } = require('./spades');

const STAKES = [250, 500, 1000];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BOT_NAMES = ['Buster', 'Lena', 'Drew'];
const BOT_DELAY_MS = Number(process.env.SPADES_BOT_DELAY_MS || 700);
const TRICK_PAUSE_MS = Number(process.env.SPADES_TRICK_PAUSE_MS || 1400);
const NEXT_HAND_MS = Number(process.env.SPADES_NEXT_HAND_MS || 4000);
const RECONNECT_GRACE_MS = Number(process.env.SPADES_RECONNECT_GRACE_MS || 30000);
const ROOM_TTL_MS = Number(process.env.SPADES_ROOM_TTL_MS || 6 * 60 * 60 * 1000);
const ROOM_SWEEP_INTERVAL_MS = Number(process.env.SPADES_ROOM_SWEEP_INTERVAL_MS || 5 * 60 * 1000);
const DATA_FILE = process.env.SPADES_DATA_FILE || path.join(__dirname, 'rooms.json');
const rooms = new Map();

const LOBBY_ROOMS = [
  { id: 'beginner', label: 'Beginner Room', ratingLabel: '1500-1599' },
  { id: 'advance', label: 'Advanced Room', ratingLabel: '1600-1650' },
  { id: 'expert', label: 'Expert Room', ratingLabel: '1651+' },
];
const TABLES_PER_LOBBY = 25;
const CHAT_HISTORY_LIMIT = 50;
const lobbyMembers = new Map(LOBBY_ROOMS.map((lobbyRoom) => [lobbyRoom.id, new Map()]));
const lobbyChat = new Map(LOBBY_ROOMS.map((lobbyRoom) => [lobbyRoom.id, []]));

function lobbyChannel(lobbyRoomId) {
  return `lobby:${lobbyRoomId}`;
}

function lobbyTableId(lobbyRoomId, tableNumber) {
  return `lobby-${lobbyRoomId}-${tableNumber}`;
}

function getLobbyTable(lobbyRoomId, tableNumber) {
  return rooms.get(lobbyTableId(lobbyRoomId, Number(tableNumber)));
}

function seedLobbyTables() {
  LOBBY_ROOMS.forEach((lobbyRoom) => {
    for (let tableNumber = 1; tableNumber <= TABLES_PER_LOBBY; tableNumber += 1) {
      const id = lobbyTableId(lobbyRoom.id, tableNumber);
      if (rooms.has(id)) continue;
      rooms.set(id, {
        id,
        code: `${lobbyRoom.id[0].toUpperCase()}${String(tableNumber).padStart(2, '0')}`,
        lobbyRoomId: lobbyRoom.id,
        tableNumber,
        isPrivate: false,
        stake: STAKES[0],
        rankMode: 'ace',
        status: 'lobby',
        hostSocketId: null,
        hostSessionToken: null,
        players: Array(4).fill(null),
        spectators: [],
        locked: false,
        game: null,
        graceTimers: new Map(),
        lastActivityAt: Date.now(),
      });
    }
  });
}

function lobbyTableSummary(lobbyRoomId) {
  const list = [];
  for (let tableNumber = 1; tableNumber <= TABLES_PER_LOBBY; tableNumber += 1) {
    const table = getLobbyTable(lobbyRoomId, tableNumber);
    list.push({
      tableNumber,
      stake: table.stake,
      seatedCount: table.players.filter(Boolean).length,
      spectatorCount: (table.spectators || []).length,
      seats: table.players.map((player) => (player ? player.name : null)),
      inProgress: Boolean(table.game && table.game.phase !== 'finished'),
      locked: Boolean(table.locked),
    });
  }
  return list;
}

function lobbyRosterList(lobbyRoomId) {
  const members = lobbyMembers.get(lobbyRoomId);
  return members ? [...members.values()] : [];
}

// A lightweight, one-shot snapshot across all three rooms at once, for the
// opening lobby screen (before a player has picked a room to browse tables
// in). Unlike broadcastLobby this is never pushed, it is only computed on
// request, since the opening screen doesn't need a live-subscribed channel
// for three numbers per room.
function lobbyOverview() {
  return LOBBY_ROOMS.map((lobbyRoom) => {
    const tables = lobbyTableSummary(lobbyRoom.id);
    const seated = tables.reduce((sum, table) => sum + table.seatedCount, 0);
    const openTables = tables.filter((table) => table.seatedCount < 4 && !table.locked).length;
    const inPlay = tables.filter((table) => table.inProgress).length;
    return {
      id: lobbyRoom.id,
      label: lobbyRoom.label,
      ratingLabel: lobbyRoom.ratingLabel,
      online: (lobbyMembers.get(lobbyRoom.id) || new Map()).size,
      seated,
      openTables,
      totalTables: tables.length,
      inPlay,
    };
  });
}

function broadcastLobby(lobbyRoomId) {
  io.to(lobbyChannel(lobbyRoomId)).emit('lobbyState', {
    lobbyRoomId,
    tables: lobbyTableSummary(lobbyRoomId),
    roster: lobbyRosterList(lobbyRoomId),
  });
}

function leaveAllLobbies(socket) {
  const current = socket.data.lobbyRoomId;
  if (!current) return;
  socket.leave(lobbyChannel(current));
  const members = lobbyMembers.get(current);
  if (members) members.delete(socket.id);
  socket.data.lobbyRoomId = null;
  broadcastLobby(current);
}

function addSpectator(room, socketId, name, watchingSeat = null) {
  room.spectators = room.spectators || [];
  room.spectators.push({
    id: `spec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    socketId,
    name: name || 'Guest',
    watchingSeat: Number.isInteger(watchingSeat) ? watchingSeat : null,
  });
}

function removeSpectatorBySocket(room, socketId) {
  if (!room.spectators) return false;
  const before = room.spectators.length;
  room.spectators = room.spectators.filter((spectator) => spectator.socketId !== socketId);
  return room.spectators.length !== before;
}

// Frees a seat, or hands it to a bot mid-hand so the other seats aren't
// stalled waiting on a turn that will never come. The 150 lobby tables are
// permanent fixtures of their room and must never be deleted just because
// they emptied out, unlike a private code-based table which has no other
// reason to exist once nobody is left in it.
function vacateSeat(room, index) {
  const player = room.players[index];
  if (!player) return { deleted: false, gameInProgress: false };

  const gameInProgress = room.status === 'playing' && room.game && room.game.phase !== 'finished';
  if (gameInProgress) {
    room.players[index] = {
      ...player,
      sessionToken: null,
      socketId: `bot-${room.id}-${index}`,
      connected: true,
      isBot: true,
    };
  } else {
    room.players[index] = null;
  }

  if (room.hostSessionToken === player.sessionToken) {
    const successor = room.players.find((entry) => entry && entry.connected && !entry.isBot);
    room.hostSessionToken = successor ? successor.sessionToken : null;
    room.hostSocketId = successor ? successor.socketId : null;
  }

  const roomEmpty = room.players.every((entry) => !entry) && !(room.spectators || []).length;
  if (roomEmpty) {
    if (!room.lobbyRoomId) {
      rooms.delete(room.id);
      return { deleted: true, gameInProgress };
    }
    room.locked = false;
    room.chatLog = [];
  }
  return { deleted: false, gameInProgress };
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function persistRooms() {
  const snapshot = [...rooms.values()].map((room) => ({
    ...room,
    hostSocketId: null,
    players: room.players.map((player) => player && {
      ...player,
      socketId: null,
      connected: false,
    }),
    spectators: [],
    botTimer: undefined,
    trickTimer: undefined,
    nextHandTimer: undefined,
    graceTimers: undefined,
    kickVotes: undefined,
    turnTimer: undefined,
  }));
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
}

function loadRooms() {
  if (!fs.existsSync(DATA_FILE)) return;
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(saved)) return;
  saved.forEach((room) => {
    if (!room || !room.code || !Array.isArray(room.players)) return;
    room.hostSocketId = null;
    room.players = Array.from({ length: 4 }, (_, seat) => {
      const player = room.players[seat];
      if (!player) return null;
      return {
        ...player,
        seat,
        socketId: null,
        connected: false,
      };
    });
    room.spectators = [];
    room.locked = Boolean(room.locked);
    room.graceTimers = new Map();
    room.kickVotes = new Map();
    room.lastActivityAt = room.lastActivityAt || Date.now();
    rooms.set(room.id, room);
  });
}

function hasConnectedHuman(room) {
  return room.players.some((player) => player && player.connected && !player.isBot);
}

function sweepStaleRooms() {
  let removedAny = false;
  for (const room of rooms.values()) {
    if (room.lobbyRoomId) continue;
    if (hasConnectedHuman(room)) continue;
    const idleFor = Date.now() - (room.lastActivityAt || 0);
    if (idleFor > ROOM_TTL_MS) {
      rooms.delete(room.id);
      removedAny = true;
    }
  }
  if (removedAny) persistRooms();
}

loadRooms();
seedLobbyTables();
const sweepTimer = setInterval(sweepStaleRooms, ROOM_SWEEP_INTERVAL_MS);
sweepTimer.unref();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function shuffle(list) {
  const clone = [...list];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function makeDeck() {
  const cards = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      cards.push({ suit, rank, code: `${rank}${suit[0]}` });
    });
  });
  return shuffle(cards);
}

function nextSeat(seat) {
  const index = Number(seat);
  return ((Number.isInteger(index) ? index : 0) + 1) % 4;
}

function stillNeedsBid(player) {
  return Boolean(player) && !Number.isInteger(player.bid);
}

function createRoom() {
  const roomCode = makeCode();
  const room = {
    id: `${Date.now()}`,
    code: roomCode,
    stake: STAKES[0],
    rankMode: 'ace',
    status: 'lobby',
    hostSocketId: null,
    hostSessionToken: null,
    players: Array(4).fill(null),
    game: null,
    graceTimers: new Map(),
    lastActivityAt: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

function seatPlayer(room, socketId, name, sessionToken, accountPlayerId = null) {
  const seat = room.players.findIndex((player) => !player);
  if (seat === -1) return false;

  room.players[seat] = {
    id: `${seat}-${Date.now()}`,
    sessionToken,
    socketId,
    name: name || `Player ${seat + 1}`,
    seat,
    hand: [],
    bid: null,
    connected: true,
    ready: false,
    isBot: false,
    accountPlayerId,
  };
  if (room.kickVotes) room.kickVotes.delete(seat);
  return true;
}

// Resolves a client-supplied account bearer token to a verified player
// record via the sessions table, never trusts a client-supplied identity
// directly, only what the token actually proves. Used to attach a real
// player id to a seat so a completed match can award Elo to the right
// accounts, not just whatever display name the client happened to send.
async function resolveAccountPlayer(accountToken) {
  if (!accountToken) return null;
  try {
    return await auth.getPlayerBySession(accountToken);
  } catch {
    return null;
  }
}

function isBotPlayer(player) {
  return Boolean(player && player.isBot);
}

function addBotPlayer(room, seat, name) {
  room.players[seat] = {
    id: `bot-${seat}-${Date.now()}`,
    sessionToken: null,
    socketId: `bot-${room.id}-${seat}`,
    name: name || `Bot ${seat + 1}`,
    seat,
    hand: [],
    bid: null,
    connected: true,
    ready: false,
    isBot: true,
  };
}

function fillBots(room) {
  for (let seat = 0; seat < 4; seat += 1) {
    if (!room.players[seat]) {
      addBotPlayer(room, seat, BOT_NAMES[seat % BOT_NAMES.length] || `Bot ${seat + 1}`);
    }
  }
}

function clearRoomTimers(room) {
  if (!room) return;
  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }
  if (room.trickTimer) {
    clearTimeout(room.trickTimer);
    room.trickTimer = null;
  }
  if (room.nextHandTimer) {
    clearTimeout(room.nextHandTimer);
    room.nextHandTimer = null;
  }
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function clearTurnTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}

function armTurnTimer(room) {
  clearTurnTimer(room);
  if (!room.turnTimerSeconds || !room.game || room.game.resolving) return;

  const seatIndex = room.game.currentSeat;
  const player = room.players[seatIndex];
  if (!player || player.isBot) return;

  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    if (!room.game || room.game.resolving || room.game.currentSeat !== seatIndex) return;
    const current = room.players[seatIndex];
    if (!current || current.isBot) return;

    // A slow turn auto-plays once via the same bot logic, the seat and
    // session stay with the player (temporary AFK), it is never a
    // permanent demotion to spectator. continueTurn re-arms this timer
    // for their next turn, so repeated inactivity keeps auto-playing.
    const timedOutSocket = io.sockets.sockets.get(current.socketId);
    if (timedOutSocket) {
      timedOutSocket.emit('errorMessage', 'You timed out, your seat auto-played that turn.');
    }
    persistRooms();
    handleBotTurn(room, { forceSeat: seatIndex });
  }, room.turnTimerSeconds * 1000);
}

function getRoomByCode(code) {
  return [...rooms.values()].find((room) => room.code === code);
}

function getPlayerInRoom(room, socketId) {
  return room.players.find((player) => player && player.socketId === socketId) || null;
}

function getPlayerBySession(sessionToken) {
  if (!sessionToken) return null;
  for (const room of rooms.values()) {
    const player = room.players.find((entry) => entry && entry.sessionToken === sessionToken);
    if (player) return { room, player };
  }
  return null;
}

function sendTableChatHistory(socket, room) {
  socket.emit('tableChatHistory', room.chatLog || []);
}

function attachPlayer(room, player, socket) {
  const graceTimer = room.graceTimers && room.graceTimers.get(player.sessionToken);
  if (graceTimer) clearTimeout(graceTimer);
  if (!room.graceTimers) room.graceTimers = new Map();
  room.graceTimers.delete(player.sessionToken);
  player.socketId = socket.id;
  player.connected = true;
  if (room.hostSessionToken === player.sessionToken) room.hostSocketId = socket.id;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  sendTableChatHistory(socket, room);
  persistRooms();
  broadcastRoom(room);
}

// Best-effort side effect of a match ending: award Elo if all 4 seats are
// authenticated humans (no bots). Never blocks or throws into the game
// loop, a rating-service hiccup should not be able to disrupt gameplay.
function awardRatedMatch(room, winningTeam) {
  if (room.game.cheatsUsed) return;

  const teamASeats = [0, 2];
  const teamBSeats = [1, 3];
  const allSeated = [...teamASeats, ...teamBSeats].every((seat) => {
    const player = room.players[seat];
    return player && !player.isBot && player.accountPlayerId;
  });
  if (!allSeated) return;

  const teamAPlayerIds = teamASeats.map((seat) => room.players[seat].accountPlayerId);
  const teamBPlayerIds = teamBSeats.map((seat) => room.players[seat].accountPlayerId);

  recordRatedMatch({
    idempotencyKey: room.game.matchId,
    teamAPlayerIds,
    teamBPlayerIds,
    winningTeam: winningTeam === 0 ? 'A' : 'B',
  }).catch((error) => {
    console.error('Failed to record rated match', error);
  });
}

function finishHand(room) {
  if (!room.game) return;

  const tricksBySeat = room.game.tricksBySeat || { 0: 0, 1: 0, 2: 0, 3: 0 };
  const team0Score = scoreTeamSeats([0, 2], room.game.bids, tricksBySeat);
  const team1Score = scoreTeamSeats([1, 3], room.game.bids, tricksBySeat);

  room.game.totalScores[0] = (room.game.totalScores[0] || 0) + team0Score;
  room.game.totalScores[1] = (room.game.totalScores[1] || 0) + team1Score;

  room.game.phase = 'finished';
  room.game.resolving = false;
  room.game.currentSeat = room.game.dealerSeat;

  const winningTeam = matchWinningTeam(room.game.totalScores, room.stake);
  if (winningTeam !== null) {
    const losingTeam = winningTeam === 0 ? 1 : 0;
    room.game.matchOver = true;
    room.game.matchWinner = winningTeam;
    room.game.message = `Match over — Team ${winningTeam + 1} wins ${room.game.totalScores[winningTeam]} to ${room.game.totalScores[losingTeam]}!`;
    awardRatedMatch(room, winningTeam);
    return;
  }

  room.game.message = `Hand complete — Team 1: ${room.game.totalScores[0]} | Team 2: ${room.game.totalScores[1]}. Dealing the next hand...`;
  queueNextHand(room);
}

function queueNextHand(room) {
  if (!room) return;
  if (room.nextHandTimer) clearTimeout(room.nextHandTimer);
  room.nextHandTimer = setTimeout(() => {
    room.nextHandTimer = null;
    if (!room.game || room.game.phase !== 'finished') return;
    dealHand(room, { preserveScores: true });
    broadcastRoom(room);
    continueTurn(room);
  }, NEXT_HAND_MS);
}

function cardsRemaining(room) {
  return room.players.reduce((sum, seatedPlayer) => sum + (seatedPlayer && seatedPlayer.hand ? seatedPlayer.hand.length : 0), 0);
}

function pickBotBid(hand, mode = 'ace') {
  const spades = hand.filter((card) => isTrump(card, mode)).length;
  const nonSpades = hand.length - spades;

  if (spades >= 4 && nonSpades <= 5) return Math.min(7, spades);
  if (spades >= 3) return Math.min(5, spades);
  if (spades >= 2) return 2;
  if (spades === 1 && nonSpades <= 4) return 1;
  return 0;
}

function continueTurn(room) {
  if (!room || !room.game || room.game.resolving) {
    if (room) clearTurnTimer(room);
    return;
  }
  if (isBotPlayer(room.players[room.game.currentSeat])) {
    clearTurnTimer(room);
    queueBotTurn(room);
    return;
  }
  armTurnTimer(room);
}

function queueBotTurn(room) {
  if (!room || !room.game || room.game.resolving) return;
  if (room.botTimer) clearTimeout(room.botTimer);
  const jitter = BOT_DELAY_MS * (0.6 + Math.random() * 0.9);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    handleBotTurn(room);
  }, jitter);
}

function resolveCompletedTrick(room) {
  const winningSeat = determineWinner(room.game.trick, room.game.leadSuit, room.rankMode);
  room.game.lastTrick = {
    cards: room.game.trick.map((entry) => ({ seat: entry.seat, card: entry.card })),
    leadSuit: room.game.leadSuit,
    winnerSeat: winningSeat,
  };
  const winningTeam = teamForSeat(winningSeat);
  room.game.tricksWon[winningTeam] = (room.game.tricksWon[winningTeam] || 0) + 1;
  room.game.tricksBySeat[winningSeat] = (room.game.tricksBySeat[winningSeat] || 0) + 1;
  room.game.currentSeat = winningSeat;
  room.game.resolving = true;
  room.game.message = `${room.players[winningSeat].name} wins the trick.`;
  broadcastRoom(room);

  if (room.trickTimer) clearTimeout(room.trickTimer);
  room.trickTimer = setTimeout(() => {
    room.trickTimer = null;
    if (!room.game) return;

    room.game.trick = [];
    room.game.leadSuit = null;
    room.game.resolving = false;

    if (cardsRemaining(room) === 0) {
      finishHand(room);
      broadcastRoom(room);
      return;
    }

    room.game.message = `${room.players[room.game.currentSeat].name} leads the next trick.`;
    broadcastRoom(room);
    continueTurn(room);
  }, TRICK_PAUSE_MS);
}

function handleBotTurn(room, { forceSeat = null } = {}) {
  if (!room || !room.game || room.game.resolving) return false;

  const current = room.players[room.game.currentSeat];
  if (!current) return false;
  const forcing = forceSeat === room.game.currentSeat;
  if (!isBotPlayer(current) && !forcing) return false;

  if (room.game.phase === 'bidding') {
    const bid = pickBotBid(current.hand, room.rankMode);
    current.bid = bid;
    room.game.bids[current.seat] = bid;

    const remaining = room.players.filter(stillNeedsBid);
    if (remaining.length === 0) {
      room.game.phase = 'playing';
      room.game.currentSeat = nextSeat(room.game.dealerSeat);
      room.game.leadSuit = null;
      room.game.trick = [];
      room.game.spadesBroken = false;
      room.game.message = 'Bidding complete. Left of dealer leads.';
    } else {
      room.game.currentSeat = nextSeat(current.seat);
      room.game.message = bid === 0
        ? `${current.name} is going for Nil!`
        : `${current.name} bids ${bid}. Waiting for ${remaining.length} more.`;
    }

    broadcastRoom(room);
    continueTurn(room);
    return true;
  }

  if (room.game.phase === 'playing') {
    if (!current.hand.length) {
      if (cardsRemaining(room) === 0) {
        finishHand(room);
        broadcastRoom(room);
        return true;
      }
      return false;
    }

    const card = pickBotCard(
      current.hand,
      room.game.leadSuit,
      room.game.spadesBroken,
      room.game.trick,
      room.game.currentSeat,
      room.rankMode,
      room.game.bids
    ) || current.hand[0];
    const cardIndex = current.hand.findIndex((entry) => entry.code === card.code);
    if (cardIndex === -1) return false;
    current.hand.splice(cardIndex, 1);

    room.game.trick.push({ seat: current.seat, card });
    if (!room.game.leadSuit) room.game.leadSuit = effectiveSuit(card, room.rankMode);
    if (isTrump(card, room.rankMode)) room.game.spadesBroken = true;

    if (room.game.trick.length < 4) {
      room.game.currentSeat = nextSeat(current.seat);
      room.game.message = `${current.name} plays ${card.rank} of ${card.suit}.`;
      broadcastRoom(room);
      continueTurn(room);
      return true;
    }

    resolveCompletedTrick(room);
    return true;
  }

  return false;
}

function dealHand(room, { preserveScores = false } = {}) {
  if (!room || room.players.filter(Boolean).length === 0) return;

  clearRoomTimers(room);
  fillBots(room);

  const previousScores = preserveScores && room.game
    ? { 0: room.game.totalScores[0] || 0, 1: room.game.totalScores[1] || 0 }
    : { 0: 0, 1: 0 };
  const previousRound = preserveScores && room.game ? room.game.round || 1 : 0;
  const dealerSeat = preserveScores && room.game ? nextSeat(room.game.dealerSeat ?? 0) : 0;
  // One id per match (not per hand), so a completed match can be recorded
  // for Elo exactly once even though a match spans many hands.
  const matchId = preserveScores && room.game && room.game.matchId
    ? room.game.matchId
    : crypto.randomUUID();
  // Once an owner debug command touches a match it stays permanently
  // unrated for every remaining hand of that same match, a new match
  // (preserveScores: false) starts clean.
  const cheatsUsed = preserveScores && room.game ? Boolean(room.game.cheatsUsed) : false;

  const deck = makeDeck();
  room.players.forEach((player, index) => {
    if (!player) return;
    player.bid = null;
    player.hand = sortHand(deck.splice(0, 13), room.rankMode);
    player.ready = true;
    player.seat = index;
  });

  room.game = {
    phase: 'bidding',
    round: previousRound + 1,
    dealerSeat,
    currentSeat: nextSeat(dealerSeat),
    leadSuit: null,
    trick: [],
    spadesBroken: false,
    resolving: false,
    bids: { 0: null, 1: null, 2: null, 3: null },
    tricksWon: { 0: 0, 1: 0 },
    tricksBySeat: { 0: 0, 1: 0, 2: 0, 3: 0 },
    totalScores: previousScores,
    message: 'Bidding is open. Choose Nil or bid from 1 to 13.',
    lastTrick: null,
    matchId,
    cheatsUsed,
  };

  room.status = 'playing';
}

function startGame(room) {
  dealHand(room, { preserveScores: false });
}

function validCardPlay(player, card, room) {
  if (!room.game || room.game.phase !== 'playing') return false;
  if (!player || !player.hand || !player.hand.some((entry) => entry.code === card.code)) return false;

  const trick = room.game.trick || [];
  const mode = room.rankMode || 'ace';
  if (!trick.length) {
    if (isTrump(card, mode) && !room.game.spadesBroken) {
      const hasNonTrump = player.hand.some((entry) => !isTrump(entry, mode));
      if (hasNonTrump) return false;
    }
    return true;
  }

  const leadSuit = room.game.leadSuit;
  const hasLeadSuit = player.hand.some((entry) => effectiveSuit(entry, mode) === leadSuit);
  if (hasLeadSuit && effectiveSuit(card, mode) !== leadSuit) return false;

  if (isTrump(card, mode) && leadSuit !== 'Spades') {
    room.game.spadesBroken = true;
  }

  return true;
}

function buildPlayerPayload(room, socketId) {
  const players = room.players.map((player) => {
    if (!player) return null;
    return {
      id: player.id,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      ready: player.ready,
      bid: player.bid,
      hand: player.socketId === socketId ? sortHand(player.hand || [], room.rankMode) : [],
      isYou: player.socketId === socketId,
      isBot: Boolean(player.isBot),
      tricks: room.game && room.game.tricksBySeat ? room.game.tricksBySeat[player.seat] || 0 : 0,
      team: teamForSeat(player.seat),
      votesAgainst: room.kickVotes && room.kickVotes.get(player.seat) ? room.kickVotes.get(player.seat).size : 0,
      watchers: (room.spectators || [])
        .filter((spectator) => spectator.watchingSeat === player.seat)
        .map((spectator) => ({ id: spectator.id, name: spectator.name })),
      crowned: room.crownedSeat === player.seat,
    };
  });

  const game = room.game
    ? {
        phase: room.game.phase,
        currentSeat: room.game.currentSeat,
        dealerSeat: room.game.dealerSeat,
        trick: room.game.trick,
        leadSuit: room.game.leadSuit,
        bids: room.game.bids,
        scores: room.game.totalScores || { 0: 0, 1: 0 },
        round: room.game.round,
        message: room.game.message,
        tricksWon: room.game.tricksWon || { 0: 0, 1: 0 },
        resolving: Boolean(room.game.resolving),
        spadesBroken: Boolean(room.game.spadesBroken),
        matchOver: Boolean(room.game.matchOver),
        matchWinner: room.game.matchWinner ?? null,
        lastTrick: room.game.lastTrick || null,
        cheatsUsed: Boolean(room.game.cheatsUsed),
      }
    : null;

  return {
    roomCode: room.code,
    roomId: room.id,
    stake: room.stake,
    rankMode: room.rankMode || 'ace',
    players,
    game,
    isHost: room.hostSocketId === socketId,
    status: room.status,
    isPrivate: room.isPrivate !== false,
    lobbyRoomId: room.lobbyRoomId || null,
    tableNumber: room.tableNumber || null,
    isSpectator: Boolean((room.spectators || []).some((spectator) => spectator.socketId === socketId)),
    spectatorNames: (room.spectators || []).map((spectator) => spectator.name),
    locked: Boolean(room.locked),
    turnTimerSeconds: room.turnTimerSeconds || 0,
  };
}

function broadcastRoom(room) {
  room.lastActivityAt = Date.now();
  persistRooms();
  room.players.forEach((player) => {
    if (!player || !player.socketId) return;
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('roomState', buildPlayerPayload(room, player.socketId));
    }
  });
  (room.spectators || []).forEach((spectator) => {
    const socket = io.sockets.sockets.get(spectator.socketId);
    if (socket) {
      socket.emit('roomState', buildPlayerPayload(room, spectator.socketId));
    }
  });
  if (room.lobbyRoomId) broadcastLobby(room.lobbyRoomId);
}

function resetRoom(room) {
  clearRoomTimers(room);
  room.status = 'lobby';
  room.game = null;
  room.players.forEach((player) => {
    if (!player) return;
    player.bid = null;
    player.hand = [];
    player.ready = false;
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, version: 'trump-v4-hearts-boss' });
});

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

app.post('/api/signup', async (req, res) => {
  try {
    const { screenName, email, password, passwordConfirm } = req.body || {};
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: 'password_mismatch', message: 'Passwords do not match.' });
    }
    const player = await auth.createPlayer({ screenName, email, password });
    const token = await auth.createSession(player.id);
    res.json({ token, player });
  } catch (error) {
    if (error instanceof auth.AuthError) {
      return res.status(400).json({ error: error.code, message: error.message });
    }
    console.error('signup failed', error);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong creating your account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const player = await auth.authenticate({ email, password });
    const token = await auth.createSession(player.id);
    res.json({ token, player });
  } catch (error) {
    if (error instanceof auth.AuthError) {
      return res.status(401).json({ error: error.code, message: error.message });
    }
    console.error('login failed', error);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong logging in.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = bearerToken(req);
  if (token) await auth.deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const player = await auth.getPlayerBySession(bearerToken(req));
  if (!player) return res.status(401).json({ error: 'not_authenticated' });
  res.json({ player });
});

app.get('/api/leaderboard', async (req, res) => {
  const leaderboard = await auth.getLeaderboard(req.query.limit);
  res.json({ leaderboard });
});

io.on('connection', (socket) => {
  const sessionToken = String(socket.handshake.auth && socket.handshake.auth.sessionToken || newSessionToken());
  socket.data.sessionToken = sessionToken;
  const restored = getPlayerBySession(sessionToken);
  if (restored && !restored.player.connected) {
    attachPlayer(restored.room, restored.player, socket);
  } else if (restored && restored.player.connected) {
    socket.emit('errorMessage', 'That session is already connected.');
  }

  socket.on('getLobbyOverview', () => {
    socket.emit('lobbyOverview', lobbyOverview());
  });

  socket.on('joinLobby', ({ lobbyRoomId, name }) => {
    const lobbyRoom = LOBBY_ROOMS.find((entry) => entry.id === lobbyRoomId);
    if (!lobbyRoom) {
      socket.emit('errorMessage', 'Room not found.');
      return;
    }
    leaveAllLobbies(socket);
    socket.join(lobbyChannel(lobbyRoomId));
    socket.data.lobbyRoomId = lobbyRoomId;
    lobbyMembers.get(lobbyRoomId).set(socket.id, name || 'Guest');
    socket.emit('lobbyChatHistory', lobbyChat.get(lobbyRoomId));
    broadcastLobby(lobbyRoomId);
  });

  socket.on('leaveLobby', () => {
    leaveAllLobbies(socket);
  });

  socket.on('sendLobbyChat', ({ lobbyRoomId, text }) => {
    const lobbyRoom = LOBBY_ROOMS.find((entry) => entry.id === lobbyRoomId);
    if (!lobbyRoom) return;
    const trimmed = String(text || '').trim().slice(0, 200);
    if (!trimmed) return;
    const name = lobbyMembers.get(lobbyRoomId).get(socket.id) || 'Guest';
    const message = { name, text: trimmed, at: Date.now() };
    const log = lobbyChat.get(lobbyRoomId);
    log.push(message);
    if (log.length > CHAT_HISTORY_LIMIT) log.shift();
    io.to(lobbyChannel(lobbyRoomId)).emit('lobbyChatMessage', message);
  });

  socket.on('sendTableChat', ({ roomCode, text }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;

    const speaker = getPlayerInRoom(room, socket.id)
      || (room.spectators || []).find((spectator) => spectator.socketId === socket.id);
    if (!speaker) return;

    const trimmed = String(text || '').trim().slice(0, 200);
    if (!trimmed) return;

    const message = { name: speaker.name, text: trimmed, at: Date.now() };
    room.chatLog = room.chatLog || [];
    room.chatLog.push(message);
    if (room.chatLog.length > CHAT_HISTORY_LIMIT) room.chatLog.shift();
    io.to(room.code).emit('tableChatMessage', message);
  });

  socket.on('joinTable', async ({ lobbyRoomId, tableNumber, name, watchSeat, accountToken }) => {
    const table = getLobbyTable(lobbyRoomId, tableNumber);
    if (!table) {
      socket.emit('errorMessage', 'Table not found.');
      return;
    }

    const sessionPlayer = table.players.find((player) => player && player.sessionToken === sessionToken);
    if (sessionPlayer) {
      if (sessionPlayer.connected && sessionPlayer.socketId !== socket.id) {
        socket.emit('errorMessage', 'That session is already connected.');
        return;
      }
      attachPlayer(table, sessionPlayer, socket);
      return;
    }

    if (table.locked) {
      socket.emit('errorMessage', 'This table is locked. Ask for the table code to join.');
      return;
    }

    const seatedElsewhere = getPlayerBySession(sessionToken);
    if (seatedElsewhere && seatedElsewhere.room.id !== table.id) {
      socket.emit('errorMessage', 'This session is already seated at another table.');
      return;
    }

    const requestedWatchSeat = Number.isInteger(watchSeat) && table.players[watchSeat] ? watchSeat : null;
    if (requestedWatchSeat !== null) {
      socket.join(table.code);
      socket.data.roomCode = table.code;
      sendTableChatHistory(socket, table);
      addSpectator(table, socket.id, name || 'Guest', requestedWatchSeat);
      broadcastRoom(table);
      return;
    }

    const wasEmpty = table.players.every((player) => !player) && !(table.spectators || []).length;
    const accountPlayer = await resolveAccountPlayer(accountToken);
    const seated = seatPlayer(table, socket.id, accountPlayer ? accountPlayer.screenName : (name || 'Player'), sessionToken, accountPlayer ? accountPlayer.id : null);
    socket.join(table.code);
    socket.data.roomCode = table.code;
    sendTableChatHistory(socket, table);

    if (seated) {
      if (wasEmpty) {
        table.hostSessionToken = sessionToken;
        table.hostSocketId = socket.id;
      }
      if (table.players.filter(Boolean).length === 4 && !table.game) {
        startGame(table);
      }
      broadcastRoom(table);
      continueTurn(table);
      return;
    }

    addSpectator(table, socket.id, name || 'Guest');
    broadcastRoom(table);
  });

  socket.on('removeWatcher', ({ roomCode, watcherId }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    const requester = getPlayerInRoom(room, socket.id);
    if (!requester) return;

    const spectator = (room.spectators || []).find((entry) => entry.id === watcherId);
    if (!spectator || spectator.watchingSeat !== requester.seat) {
      socket.emit('errorMessage', 'You can only remove someone watching your own seat.');
      return;
    }

    const watcherSocket = io.sockets.sockets.get(spectator.socketId);
    removeSpectatorBySocket(room, spectator.socketId);
    if (watcherSocket) {
      watcherSocket.leave(room.code);
      watcherSocket.data.roomCode = null;
      watcherSocket.emit('errorMessage', 'The player you were watching removed you from the table.');
    }
    broadcastRoom(room);
  });

  socket.on('claimSeat', ({ roomCode, seat }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;

    const seatIndex = Number(seat);
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 3) return;

    const spectator = (room.spectators || []).find((entry) => entry.socketId === socket.id);
    if (!spectator) {
      socket.emit('errorMessage', 'You need to be watching this table to claim a seat.');
      return;
    }

    const target = room.players[seatIndex];
    if (target && !target.isBot) {
      socket.emit('errorMessage', 'That seat is already taken.');
      return;
    }

    removeSpectatorBySocket(room, socket.id);
    room.players[seatIndex] = {
      id: `${seatIndex}-${Date.now()}`,
      sessionToken,
      socketId: socket.id,
      name: spectator.name,
      seat: seatIndex,
      hand: target ? target.hand : [],
      bid: target ? target.bid : null,
      connected: true,
      ready: false,
      isBot: false,
    };
    if (room.kickVotes) room.kickVotes.delete(seatIndex);

    socket.join(room.code);
    socket.data.roomCode = room.code;
    persistRooms();
    broadcastRoom(room);
    if (room.game && room.status === 'playing' && !room.game.resolving) continueTurn(room);
  });

  // Owner-only debug/QA commands. Authorization is server-side, by the
  // account UUID a valid session token actually resolves to, never by
  // anything the client claims. An unauthorized attempt fails completely
  // silently, no error message, nothing distinguishing it from a typo, so
  // there is no signal to a non-owner that this even exists.
  socket.on('ownerCommand', async ({ roomCode, command, accountToken }) => {
    const accountPlayer = await resolveAccountPlayer(accountToken);
    if (!ownerCommands.isOwner(accountPlayer)) return;

    const room = getRoomByCode(roomCode);
    if (!room) return;

    const entry = ownerCommands.COMMANDS[command];
    if (!entry) return;

    const ownerSeat = ownerCommands.findOwnerSeat(room, accountPlayer);
    if (entry.requiresSeat && ownerSeat === -1) {
      socket.emit('ownerCommandResult', { command, ok: false, message: 'You are not seated at this table.' });
      return;
    }

    const result = entry.fn(room, ownerSeat);
    if (result.matchConverted) {
      socket.emit('ownerCommandResult', {
        command,
        ok: true,
        message: 'This match just converted to unranked test mode, gameplay-affecting owner commands permanently disable Elo for the rest of it.',
      });
    }
    if (result.hands) {
      socket.emit('ownerPeek', { hands: result.hands });
    }
    if (result.confetti) {
      io.to(room.code).emit('celebrate');
    }
    socket.emit('ownerCommandResult', { command, ok: result.ok, message: result.message });

    if (result.ok) {
      persistRooms();
      broadcastRoom(room);
      if (room.game && room.status === 'playing' && !room.game.resolving) continueTurn(room);
    }
  });

  socket.on('leaveTable', ({ roomCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;

    if (removeSpectatorBySocket(room, socket.id)) {
      socket.leave(room.code);
      socket.data.roomCode = null;
      broadcastRoom(room);
      return;
    }

    const index = room.players.findIndex((player) => player && player.socketId === socket.id);
    if (index === -1) return;

    socket.leave(room.code);
    socket.data.roomCode = null;
    const result = vacateSeat(room, index);
    persistRooms();
    if (!result.deleted) {
      broadcastRoom(room);
      if (result.gameInProgress) continueTurn(room);
    }
  });

  socket.on('voteKick', ({ roomCode, targetSeat }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;

    const voter = getPlayerInRoom(room, socket.id);
    if (!voter) {
      socket.emit('errorMessage', 'Only a seated player can vote to kick.');
      return;
    }

    const seatIndex = Number(targetSeat);
    if (seatIndex === voter.seat) {
      socket.emit('errorMessage', 'You cannot vote to kick yourself.');
      return;
    }

    const target = room.players[seatIndex];
    if (!target || target.isBot) {
      socket.emit('errorMessage', 'There is no one in that seat to kick.');
      return;
    }

    room.kickVotes = room.kickVotes || new Map();
    const votes = room.kickVotes.get(seatIndex) || new Set();
    votes.add(voter.sessionToken);
    room.kickVotes.set(seatIndex, votes);

    if (votes.size < 2) {
      broadcastRoom(room);
      return;
    }

    room.kickVotes.delete(seatIndex);
    const kickedSocket = io.sockets.sockets.get(target.socketId);
    const result = vacateSeat(room, seatIndex);
    persistRooms();
    if (kickedSocket) {
      kickedSocket.leave(room.code);
      kickedSocket.data.roomCode = null;
      kickedSocket.emit('errorMessage', 'You were voted off this table.');
    }
    if (!result.deleted) {
      broadcastRoom(room);
      if (result.gameInProgress) continueTurn(room);
    }
  });

  socket.on('setRankMode', ({ roomCode, rankMode }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can change the game style.');
      return;
    }
    if (room.game && room.game.phase !== 'finished') {
      socket.emit('errorMessage', 'Finish the current hand before changing the game style.');
      return;
    }
    room.rankMode = rankMode === 'deuces' ? 'deuces' : 'ace';
    broadcastRoom(room);
  });

  socket.on('setTurnTimer', ({ roomCode, seconds }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can set the turn timer.');
      return;
    }
    const value = Math.max(0, Math.min(300, Math.floor(Number(seconds) || 0)));
    room.turnTimerSeconds = value || null;
    broadcastRoom(room);
    armTurnTimer(room);
  });

  socket.on('toggleTableLock', ({ roomCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    const player = getPlayerInRoom(room, socket.id);
    if (!player) {
      socket.emit('errorMessage', 'Only a seated player can lock this table.');
      return;
    }
    room.locked = !room.locked;
    broadcastRoom(room);
  });

  socket.on('createRoom', async ({ name, stake, rankMode, accountToken }) => {
    if (getPlayerBySession(sessionToken)) {
      socket.emit('errorMessage', 'This session is already seated at a table.');
      return;
    }
    const room = createRoom();
    room.stake = STAKES.includes(Number(stake)) ? Number(stake) : STAKES[0];
    room.rankMode = rankMode === 'deuces' ? 'deuces' : 'ace';
    room.hostSessionToken = sessionToken;
    room.hostSocketId = socket.id;
    const accountPlayer = await resolveAccountPlayer(accountToken);
    seatPlayer(room, socket.id, accountPlayer ? accountPlayer.screenName : (name || 'Host'), sessionToken, accountPlayer ? accountPlayer.id : null);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    sendTableChatHistory(socket, room);
    broadcastRoom(room);
  });

  socket.on('joinRoom', async ({ code, name, accountToken }) => {
    const room = getRoomByCode(code);
    if (!room) {
      socket.emit('errorMessage', 'Room not found.');
      return;
    }

    const sessionPlayer = room.players.find((player) => player && player.sessionToken === sessionToken);
    if (sessionPlayer) {
      if (sessionPlayer.connected && sessionPlayer.socketId !== socket.id) {
        socket.emit('errorMessage', 'That session is already connected.');
        return;
      }
      attachPlayer(room, sessionPlayer, socket);
      return;
    }

    if (getPlayerBySession(sessionToken)) {
      socket.emit('errorMessage', 'This session is already seated at another table.');
      return;
    }

    if (room.players.every(Boolean)) {
      socket.emit('errorMessage', 'That table is full.');
      return;
    }

    const accountPlayer = await resolveAccountPlayer(accountToken);
    const seated = seatPlayer(room, socket.id, accountPlayer ? accountPlayer.screenName : (name || 'Player'), sessionToken, accountPlayer ? accountPlayer.id : null);
    if (!seated) {
      socket.emit('errorMessage', 'Room is full.');
      return;
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
    sendTableChatHistory(socket, room);
    broadcastRoom(room);
  });

  socket.on('startGame', ({ roomCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can start the table.');
      return;
    }
    if (room.players.filter(Boolean).length === 0) {
      socket.emit('errorMessage', 'Add at least one player before starting.');
      return;
    }
    if (room.game && room.game.phase !== 'finished') {
      socket.emit('errorMessage', 'The hand is already underway.');
      return;
    }

    startGame(room);
    broadcastRoom(room);
    continueTurn(room);
  });

  socket.on('nextHand', ({ roomCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('errorMessage', 'Only the host can deal the next hand.');
      return;
    }
    if (!room.game || room.game.phase !== 'finished') {
      socket.emit('errorMessage', 'Finish the current hand first.');
      return;
    }
    if (room.game.matchOver) {
      socket.emit('errorMessage', 'The match is over. Start a new game to keep playing.');
      return;
    }

    dealHand(room, { preserveScores: true });
    broadcastRoom(room);
    continueTurn(room);
  });

  socket.on('submitBid', ({ roomCode, bid }) => {
    const room = getRoomByCode(roomCode);
    if (!room || !room.game) {
      socket.emit('errorMessage', 'No hand is being bid yet.');
      return;
    }
    if (room.game.phase !== 'bidding') {
      socket.emit('errorMessage', 'Bidding is not open on this hand.');
      return;
    }

    const player = getPlayerInRoom(room, socket.id);
    if (!player) {
      socket.emit('errorMessage', 'You are not seated at this table.');
      return;
    }
    if (Number(room.game.currentSeat) !== Number(player.seat)) {
      const waiter = room.players[room.game.currentSeat];
      socket.emit('errorMessage', waiter ? `Wait — it is ${waiter.name}'s bid.` : 'It is not your turn to bid.');
      return;
    }

    const nextBid = Number(bid);
    if (Number.isNaN(nextBid) || nextBid < 0 || nextBid > 13) {
      socket.emit('errorMessage', 'Bid must be between 0 and 13.');
      return;
    }

    player.bid = nextBid;
    room.game.bids[player.seat] = nextBid;

    const remainingPlayers = room.players.filter(stillNeedsBid);
    if (remainingPlayers.length === 0) {
      room.game.phase = 'playing';
      room.game.currentSeat = nextSeat(room.game.dealerSeat);
      room.game.leadSuit = null;
      room.game.trick = [];
      room.game.spadesBroken = false;
      room.game.tricksWon = { 0: 0, 1: 0 };
      room.game.message = 'Bidding complete. Left of dealer leads.';
    } else {
      room.game.currentSeat = nextSeat(player.seat);
      room.game.message = nextBid === 0
        ? `${player.name} is going for Nil!`
        : `Waiting for bids. ${remainingPlayers.length} seat(s) left.`;
    }

    broadcastRoom(room);
    continueTurn(room);
  });

  socket.on('playCard', ({ roomCode, cardCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room || !room.game || room.game.phase !== 'playing') return;

    const player = getPlayerInRoom(room, socket.id);
    if (!player) return;
    if (room.game.resolving) {
      socket.emit('errorMessage', 'Wait for the trick to finish.');
      return;
    }
    if (room.game.currentSeat !== player.seat) {
      socket.emit('errorMessage', 'It is not your turn.');
      return;
    }

    const chosenCard = player.hand.find((card) => card.code === cardCode);
    if (!chosenCard) return;

    const testRoom = { ...room, game: { ...room.game, trick: [...room.game.trick] } };
    if (!validCardPlay(player, chosenCard, testRoom)) {
      socket.emit('errorMessage', 'You must follow the led suit when you can.');
      return;
    }

    const cardIndex = player.hand.findIndex((card) => card.code === cardCode);
    player.hand.splice(cardIndex, 1);

    room.game.trick.push({ seat: player.seat, card: chosenCard });
    if (!room.game.leadSuit) room.game.leadSuit = effectiveSuit(chosenCard, room.rankMode);
    if (isTrump(chosenCard, room.rankMode)) room.game.spadesBroken = true;

    if (room.game.trick.length < 4) {
      room.game.currentSeat = nextSeat(player.seat);
      room.game.message = `${player.name} plays ${chosenCard.rank} of ${chosenCard.suit}.`;
      broadcastRoom(room);
      continueTurn(room);
      return;
    }

    resolveCompletedTrick(room);
  });

  socket.on('resetRoom', ({ roomCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    resetRoom(room);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    leaveAllLobbies(socket);

    for (const room of rooms.values()) {
      if (removeSpectatorBySocket(room, socket.id)) {
        broadcastRoom(room);
      }
    }

    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player && player.socketId === socket.id);
      if (index === -1) continue;

      const player = room.players[index];
      player.connected = false;
      player.socketId = null;
      if (room.hostSocketId === socket.id) room.hostSocketId = null;
      if (!room.graceTimers) room.graceTimers = new Map();
      const timer = setTimeout(() => {
        room.graceTimers.delete(player.sessionToken);
        const stillSeated = room.players[index];
        if (!stillSeated || stillSeated.connected) return;

        const result = vacateSeat(room, index);
        persistRooms();
        if (!result.deleted) {
          broadcastRoom(room);
          if (result.gameInProgress) continueTurn(room);
        }
      }, RECONNECT_GRACE_MS);
      room.graceTimers.set(player.sessionToken, timer);
      broadcastRoom(room);
      break;
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Spades server running on http://localhost:${PORT}`);
});
