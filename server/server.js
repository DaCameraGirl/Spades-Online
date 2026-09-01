const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const STAKES = [250, 500, 1000];
const SUITS = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const BOT_NAMES = ['Buster', 'Lena', 'Drew'];
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

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitDiff = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_VALUES[a.rank] - RANK_VALUES[b.rank];
  });
}

function teamForSeat(seat) {
  return seat % 2 === 0 ? 0 : 1;
}

function nextSeat(seat) {
  return (seat + 1) % 4;
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
      addBotPlayer(room, seat, BOT_NAMES[seat - 1] || `Bot ${seat + 1}`);
    }
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
  room.game.message = `Hand complete — Team 1: ${room.game.totalScores[0]} | Team 2: ${room.game.totalScores[1]}`;
  room.game.currentSeat = room.game.dealerSeat;
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

function pickBotCard(hand, leadSuit, spadesBroken) {
  const playable = leadSuit ? hand.filter((card) => card.suit === leadSuit) : hand;
  if (playable.length > 0) {
    return [...playable].sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank])[0];
  }

  if (!spadesBroken && hand.some((card) => card.suit !== 'Spades')) {
    const nonSpades = hand.filter((card) => card.suit !== 'Spades');
    return [...nonSpades].sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank])[0];
  }

  return [...hand].sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank])[0];
}

function handleBotTurn(room) {
  if (!room || !room.game) return false;

  while (room && room.game && room.players[room.game.currentSeat] && isBotPlayer(room.players[room.game.currentSeat])) {
    const current = room.players[room.game.currentSeat];

    if (room.game.phase === 'bidding') {
      const bid = pickBotBid(current.hand);
      current.bid = bid;
      room.game.bids[current.seat] = bid;

      const remaining = room.players.filter(Boolean).filter((player) => player.bid === null);
      if (remaining.length === 0) {
        room.game.phase = 'playing';
        room.game.currentSeat = 0;
        room.game.leadSuit = null;
        room.game.trick = [];
        room.game.spadesBroken = false;
        room.game.message = 'Bidding complete. Lead with your first card.';
      } else {
        room.game.currentSeat = nextSeat(current.seat);
        room.game.message = `Waiting for bids. ${remaining.length} seat(s) left.`;
      }

      broadcastRoom(room);
      continue;
    }

    if (room.game.phase === 'playing') {
      const card = pickBotCard(current.hand, room.game.leadSuit, room.game.spadesBroken);
      const cardIndex = current.hand.findIndex((entry) => entry.code === card.code);
      if (cardIndex === -1) return false;
      current.hand.splice(cardIndex, 1);

      room.game.trick.push({ seat: current.seat, card });
      if (!room.game.leadSuit) room.game.leadSuit = card.suit;
      if (card.suit === 'Spades') room.game.spadesBroken = true;

      if (room.game.trick.length < 4) {
        room.game.currentSeat = nextSeat(current.seat);
        room.game.message = `Seat ${room.game.currentSeat + 1} is up next.`;
        broadcastRoom(room);
        continue;
      }

      const winningSeat = determineWinner(room.game.trick, room.game.leadSuit);
      const winningTeam = teamForSeat(winningSeat);
      room.game.tricksWon[winningTeam] = (room.game.tricksWon[winningTeam] || 0) + 1;
      room.game.currentSeat = winningSeat;
      room.game.message = `Seat ${winningSeat + 1} wins the trick.`;
      room.game.trick = [];
      room.game.leadSuit = null;

      const cardsLeft = room.players.reduce((sum, seatedPlayer) => sum + (seatedPlayer ? seatedPlayer.hand.length : 0), 0);
      if (cardsLeft === 0) {
        finishHand(room);
        broadcastRoom(room);
        return true;
      }

      broadcastRoom(room);
      continue;
    }

    break;
  }

  return true;
}

function startGame(room) {
  if (!room || room.players.filter(Boolean).length === 0) return;

  fillBots(room);
  const deck = makeDeck();
  room.players.forEach((player, index) => {
    player.bid = null;
    player.hand = deck.splice(0, 13);
    player.hand = sortHand(player.hand);
    player.ready = true;
    player.seat = index;
  });

  room.game = {
    phase: 'bidding',
    round: 1,
    dealerSeat: 0,
    currentSeat: 0,
    leadSuit: null,
    trick: [],
    spadesBroken: false,
    bids: { 0: null, 1: null, 2: null, 3: null },
    tricksWon: { 0: 0, 1: 0 },
    totalScores: { 0: 0, 1: 0 },
    message: 'Bidding is open. Choose a bid from 0 to 13.',
  };

  room.status = 'playing';
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

function determineWinner(trickCards, leadSuit) {
  if (!trickCards.length) return null;

  let winner = trickCards[0];

  for (let i = 1; i < trickCards.length; i += 1) {
    const current = winner.card;
    const candidate = trickCards[i].card;

    const currentSuit = current.suit;
    const candidateSuit = candidate.suit;

    const currentWins =
      (currentSuit === leadSuit && candidateSuit !== leadSuit && candidateSuit !== 'Spades') ||
      (currentSuit === 'Spades' && candidateSuit !== 'Spades' && candidateSuit !== leadSuit) ||
      (currentSuit === candidateSuit && RANK_VALUES[current.rank] > RANK_VALUES[candidate.rank]);

    const candidateWins =
      (candidateSuit === leadSuit && currentSuit !== leadSuit && currentSuit !== 'Spades') ||
      (candidateSuit === 'Spades' && currentSuit !== 'Spades') ||
      (candidateSuit === currentSuit && RANK_VALUES[candidate.rank] > RANK_VALUES[current.rank]);

    if (candidateWins && !currentWins) {
      winner = trickCards[i];
    }
  }

  return winner.seat;
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
  res.json({ ok: true, rooms: rooms.size });
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

    startGame(room);
    if (isBotPlayer(room.players[room.game.currentSeat])) {
      handleBotTurn(room);
      return;
    }
    broadcastRoom(room);
  });

  socket.on('submitBid', ({ roomCode, bid }) => {
    const room = getRoomByCode(roomCode);
    if (!room || !room.game || room.game.phase !== 'bidding') return;

    const player = getPlayerInRoom(room, socket.id);
    if (!player) return;
    if (room.game.currentSeat !== player.seat) {
      socket.emit('errorMessage', 'It is not your turn to bid.');
      return;
    }

    const nextBid = Number(bid);
    if (Number.isNaN(nextBid) || nextBid < 0 || nextBid > 13) {
      socket.emit('errorMessage', 'Bid must be between 0 and 13.');
      return;
    }

    player.bid = nextBid;
    room.game.bids[player.seat] = nextBid;

    const remainingPlayers = room.players.filter(Boolean).filter((entry) => entry.bid === null);
    if (remainingPlayers.length === 0) {
      room.game.phase = 'playing';
      room.game.currentSeat = 0;
      room.game.leadSuit = null;
      room.game.trick = [];
      room.game.spadesBroken = false;
      room.game.tricksWon = { 0: 0, 1: 0 };
      room.game.message = 'Bidding complete. Lead with your first card.';
    } else {
      room.game.currentSeat = nextSeat(player.seat);
      room.game.message = `Waiting for bids. ${remainingPlayers.length} seat(s) left.`;
    }

    if (room.game.currentSeat !== null && isBotPlayer(room.players[room.game.currentSeat])) {
      handleBotTurn(room);
      return;
    }

    broadcastRoom(room);
  });

  socket.on('playCard', ({ roomCode, cardCode }) => {
    const room = getRoomByCode(roomCode);
    if (!room || !room.game || room.game.phase !== 'playing') return;

    const player = getPlayerInRoom(room, socket.id);
    if (!player) return;
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
      room.game.message = `Seat ${room.game.currentSeat + 1} is up next.`;
      if (isBotPlayer(room.players[room.game.currentSeat])) {
        handleBotTurn(room);
        return;
      }
      broadcastRoom(room);
      return;
    }

    const winningSeat = determineWinner(room.game.trick, room.game.leadSuit);
    const winningTeam = teamForSeat(winningSeat);
    room.game.tricksWon[winningTeam] = (room.game.tricksWon[winningTeam] || 0) + 1;
    room.game.currentSeat = winningSeat;
    room.game.message = `Seat ${winningSeat + 1} wins the trick.`;
    room.game.trick = [];
    room.game.leadSuit = null;

    const cardsLeft = room.players.reduce((sum, seatedPlayer) => sum + (seatedPlayer ? seatedPlayer.hand.length : 0), 0);
    if (cardsLeft === 0) {
      finishHand(room);
      broadcastRoom(room);
      return;
    }

    if (isBotPlayer(room.players[room.game.currentSeat])) {
      handleBotTurn(room);
      return;
    }

    broadcastRoom(room);
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

server.listen(PORT, () => {
  console.log(`Spades server running on http://localhost:${PORT}`);
});
