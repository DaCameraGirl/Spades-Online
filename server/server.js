const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

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

const { SUITS, sortHand, pickBotCard, determineWinner, teamForSeat } = require('./spades');

const STAKES = [250, 500, 1000];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BOT_NAMES = ['Buster', 'Lena', 'Drew'];
const BOT_DELAY_MS = Number(process.env.SPADES_BOT_DELAY_MS || 700);
const TRICK_PAUSE_MS = Number(process.env.SPADES_TRICK_PAUSE_MS || 1400);
const NEXT_HAND_MS = Number(process.env.SPADES_NEXT_HAND_MS || 4000);
const rooms = new Map();

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
    status: 'lobby',
    hostSocketId: null,
    players: Array(4).fill(null),
    game: null,
  };
  rooms.set(room.id, room);
  return room;
}

function seatPlayer(room, socketId, name) {
  const seat = room.players.findIndex((player) => !player);
  if (seat === -1) return false;

  room.players[seat] = {
    id: `${seat}-${Date.now()}`,
    socketId,
    name: name || `Player ${seat + 1}`,
    seat,
    hand: [],
    bid: null,
    connected: true,
    ready: false,
    isBot: false,
  };
  return true;
}

function isBotPlayer(player) {
  return Boolean(player && player.isBot);
}

function addBotPlayer(room, seat, name) {
  room.players[seat] = {
    id: `bot-${seat}-${Date.now()}`,
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
}

function getRoomByCode(code) {
  return [...rooms.values()].find((room) => room.code === code);
}

function getPlayerInRoom(room, socketId) {
  return room.players.find((player) => player && player.socketId === socketId) || null;
}

function scoreTeam(teamBid, tricksWon) {
  if (tricksWon >= teamBid) {
    return teamBid * 10 + (tricksWon - teamBid);
  }
  return -teamBid * 10;
}

function finishHand(room) {
  if (!room.game) return;

  const team0Bid = (room.game.bids[0] || 0) + (room.game.bids[2] || 0);
  const team1Bid = (room.game.bids[1] || 0) + (room.game.bids[3] || 0);
  const team0Tricks = room.game.tricksWon[0] || 0;
  const team1Tricks = room.game.tricksWon[1] || 0;

  const team0Score = scoreTeam(team0Bid, team0Tricks);
  const team1Score = scoreTeam(team1Bid, team1Tricks);

  room.game.totalScores[0] = (room.game.totalScores[0] || 0) + team0Score;
  room.game.totalScores[1] = (room.game.totalScores[1] || 0) + team1Score;

  room.game.phase = 'finished';
  room.game.resolving = false;
  room.game.message = `Hand complete — Team 1: ${room.game.totalScores[0]} | Team 2: ${room.game.totalScores[1]}. Dealing the next hand...`;
  room.game.currentSeat = room.game.dealerSeat;
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

function pickBotBid(hand) {
  const spades = hand.filter((card) => card.suit === 'Spades').length;
  const nonSpades = hand.filter((card) => card.suit !== 'Spades').length;

  if (spades >= 4 && nonSpades <= 5) return Math.min(7, spades);
  if (spades >= 3) return Math.min(5, spades);
  if (spades >= 2) return 2;
  if (spades === 1 && nonSpades <= 4) return 1;
  return 0;
}

function continueTurn(room) {
  if (!room || !room.game || room.game.resolving) return;
  if (isBotPlayer(room.players[room.game.currentSeat])) {
    queueBotTurn(room);
  }
}

function queueBotTurn(room) {
  if (!room || !room.game || room.game.resolving) return;
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    handleBotTurn(room);
  }, BOT_DELAY_MS);
}

function resolveCompletedTrick(room) {
  const winningSeat = determineWinner(room.game.trick, room.game.leadSuit);
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

function handleBotTurn(room) {
  if (!room || !room.game || room.game.resolving) return false;

  const current = room.players[room.game.currentSeat];
  if (!isBotPlayer(current)) return false;

  if (room.game.phase === 'bidding') {
    const bid = pickBotBid(current.hand);
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
      room.game.message = `${current.name} bids ${bid}. Waiting for ${remaining.length} more.`;
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
      room.game.bids
    ) || current.hand[0];
    const cardIndex = current.hand.findIndex((entry) => entry.code === card.code);
    if (cardIndex === -1) return false;
    current.hand.splice(cardIndex, 1);

    room.game.trick.push({ seat: current.seat, card });
    if (!room.game.leadSuit) room.game.leadSuit = card.suit;
    if (card.suit === 'Spades') room.game.spadesBroken = true;

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

  const deck = makeDeck();
  room.players.forEach((player, index) => {
    if (!player) return;
    player.bid = null;
    player.hand = sortHand(deck.splice(0, 13));
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
    message: 'Bidding is open. Choose a bid from 0 to 13.',
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
  if (!trick.length) {
    if (card.suit === 'Spades' && !room.game.spadesBroken) {
      const hasNonSpade = player.hand.some((entry) => entry.suit !== 'Spades');
      if (hasNonSpade) return false;
    }
    return true;
  }

  const leadSuit = room.game.leadSuit;
  const hasLeadSuit = player.hand.some((entry) => entry.suit === leadSuit);
  if (hasLeadSuit && card.suit !== leadSuit) return false;

  if (card.suit === 'Spades' && leadSuit !== 'Spades') {
    room.game.spadesBroken = true;
  }

  return true;
}

function buildPlayerPayload(room, socketId) {
  const players = room.players.map((player) => {
    if (!player) return null;
    return {
      id: player.id,
      socketId: player.socketId,
      name: player.name,
      seat: player.seat,
      connected: player.connected,
      ready: player.ready,
      bid: player.bid,
      hand: player.socketId === socketId ? sortHand(player.hand || []) : [],
      isYou: player.socketId === socketId,
      isBot: Boolean(player.isBot),
      tricks: room.game && room.game.tricksBySeat ? room.game.tricksBySeat[player.seat] || 0 : 0,
      team: teamForSeat(player.seat),
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
      }
    : null;

  return {
    roomCode: room.code,
    roomId: room.id,
    stake: room.stake,
    players,
    game,
    isHost: room.hostSocketId === socketId,
    status: room.status,
  };
}

function broadcastRoom(room) {
  room.players.forEach((player) => {
    if (!player || !player.socketId) return;
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('roomState', buildPlayerPayload(room, player.socketId));
    }
  });
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

app.use(express.static(path.join(__dirname, '../client/public')));

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, version: 'trump-v2' });
});

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, stake }) => {
    const room = createRoom();
    room.stake = STAKES.includes(Number(stake)) ? Number(stake) : STAKES[0];
    room.hostSocketId = socket.id;
    seatPlayer(room, socket.id, name || 'Host');
    socket.join(room.code);
    socket.data.roomCode = room.code;
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = getRoomByCode(code);
    if (!room) {
      socket.emit('errorMessage', 'Room not found.');
      return;
    }

    if (room.players.every(Boolean)) {
      socket.emit('errorMessage', 'That table is full.');
      return;
    }

    const existing = room.players.find((player) => player && player.socketId === socket.id);
    if (existing) {
      socket.emit('errorMessage', 'You are already in this room.');
      return;
    }

    const seated = seatPlayer(room, socket.id, name || 'Player');
    if (!seated) {
      socket.emit('errorMessage', 'Room is full.');
      return;
    }

    socket.join(room.code);
    socket.data.roomCode = room.code;
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
      room.game.message = `Waiting for bids. ${remainingPlayers.length} seat(s) left.`;
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
    if (!room.game.leadSuit) room.game.leadSuit = chosenCard.suit;
    if (chosenCard.suit === 'Spades') room.game.spadesBroken = true;

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
    for (const room of rooms.values()) {
      const index = room.players.findIndex((player) => player && player.socketId === socket.id);
      if (index === -1) continue;

      clearRoomTimers(room);
      room.players[index] = null;
      if (room.hostSocketId === socket.id) {
        const nextHost = room.players.find((player) => player && player.socketId !== socket.id);
        room.hostSocketId = nextHost ? nextHost.socketId : null;
      }

      if (room.players.every((player) => !player)) {
        rooms.delete(room.id);
      } else {
        broadcastRoom(room);
      }
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
