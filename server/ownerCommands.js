const { SUITS, RANK_VALUES, sortHand } = require('./spades');

const RANKS = Object.keys(RANK_VALUES);

// Authorization is by immutable account UUID only, read server-side from
// an env var, never by screen name, client flag, or anything the client
// supplies. A missing env var means owner mode is off entirely.
function isOwner(accountPlayer) {
  const ownerId = process.env.SPADES_OWNER_PLAYER_ID;
  return Boolean(ownerId) && Boolean(accountPlayer) && accountPlayer.id === ownerId;
}

function findOwnerSeat(room, accountPlayer) {
  return room.players.findIndex((player) => player && player.accountPlayerId === accountPlayer.id);
}

// Any command that touches cards, dealing, hidden information, turns, bot
// strength, or scoring opportunity must permanently unrate the match, and
// the caller must be told plainly that just happened, this app never
// silently cheats inside what still looks like a rated match.
function tripCheats(room) {
  const wasAlreadyTripped = Boolean(room.game && room.game.cheatsUsed);
  if (room.game) room.game.cheatsUsed = true;
  room.cheatsUsed = true;
  return { justConverted: !wasAlreadyTripped };
}

function makeShuffledDeck() {
  const cards = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      cards.push({ suit, rank, code: `${rank}${suit[0]}` });
    });
  });
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cardStrength(card) {
  const spadeBonus = card.suit === 'Spades' ? 0.5 : 0;
  return RANK_VALUES[card.rank] + spadeBonus;
}

function cmdPeek(room, ownerSeat) {
  if (!room.game) return { ok: false, message: 'No hand in progress.' };
  const trip = tripCheats(room);
  const hands = {};
  room.players.forEach((player, seat) => {
    if (player) hands[seat] = player.hand || [];
  });
  return { ok: true, message: 'Peeked at all four hands.', hands, matchConverted: trip.justConverted };
}

function cmdRedeal(room, ownerSeat) {
  if (!room.game || room.game.phase !== 'bidding') {
    return { ok: false, message: 'Can only redeal before bidding starts.' };
  }
  const allBidsEmpty = room.players.every((player, seat) => !player || room.game.bids[seat] == null);
  if (!allBidsEmpty) {
    return { ok: false, message: 'Someone has already bid this hand, cannot redeal.' };
  }

  const trip = tripCheats(room);
  const deck = makeShuffledDeck();
  room.players.forEach((player, seat) => {
    if (!player) return;
    player.hand = sortHand(deck.splice(0, 13), room.rankMode);
    if (seat === ownerSeat) player.handRevealed = true;
  });
  return { ok: true, message: 'Redealt the hand.', matchConverted: trip.justConverted };
}

function cmdOops(room, ownerSeat) {
  if (!room.game || room.game.phase !== 'playing' || !room.game.trick.length) {
    return { ok: false, message: 'No card to undo right now.' };
  }
  const last = room.game.trick[room.game.trick.length - 1];
  if (last.seat !== ownerSeat) {
    return { ok: false, message: 'The next player has already acted, too late to undo.' };
  }

  const trip = tripCheats(room);
  room.game.trick.pop();
  const owner = room.players[ownerSeat];
  owner.hand = sortHand([...owner.hand, last.card], room.rankMode);
  room.game.currentSeat = ownerSeat;
  if (!room.game.trick.length) room.game.leadSuit = null;
  return { ok: true, message: 'Undid your last card.', matchConverted: trip.justConverted };
}

function cmdBlessMe(room, ownerSeat) {
  if (!room.game || room.game.phase !== 'bidding') {
    return { ok: false, message: 'Can only bless a hand before bidding starts.' };
  }

  const trip = tripCheats(room);
  const seats = room.players.map((player, seat) => ({ seat, player })).filter((entry) => entry.player);
  const pool = seats.flatMap((entry) => entry.player.hand);
  pool.sort((a, b) => cardStrength(b) - cardStrength(a));

  const ownerHand = pool.slice(0, 13);
  const rest = pool.slice(13);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  seats.forEach((entry) => {
    if (entry.seat === ownerSeat) {
      entry.player.hand = sortHand(ownerHand, room.rankMode);
      entry.player.handRevealed = true;
    } else {
      entry.player.hand = sortHand(rest.splice(0, entry.player.hand.length), room.rankMode);
    }
  });

  return { ok: true, message: 'Blessed your hand.', matchConverted: trip.justConverted };
}

function cmdNitemare(room) {
  const trip = tripCheats(room);
  room.nightmareMode = true;
  return {
    ok: true,
    message: 'Nightmare mode flagged for this table. Note: this build only has one bot skill level, this is a ready hook, not a real difficulty bump yet.',
    matchConverted: trip.justConverted,
  };
}

function cmdCrown(room, ownerSeat) {
  room.crownedSeat = ownerSeat;
  return { ok: true, message: 'Crowned.' };
}

function cmdConfetti() {
  return { ok: true, message: 'Confetti!', confetti: true };
}

const COMMANDS = {
  '/peek': { fn: cmdPeek, requiresSeat: true },
  '/redeal': { fn: cmdRedeal, requiresSeat: true },
  '/oops': { fn: cmdOops, requiresSeat: true },
  '/blessme': { fn: cmdBlessMe, requiresSeat: true },
  '/nitemare': { fn: cmdNitemare, requiresSeat: false },
  '/crown': { fn: cmdCrown, requiresSeat: true },
  '/confetti': { fn: cmdConfetti, requiresSeat: false },
};

module.exports = { isOwner, findOwnerSeat, COMMANDS, tripCheats };


