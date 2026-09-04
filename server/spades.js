const SUITS = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
const RANK_VALUES = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function teamForSeat(seat) {
  return seat % 2 === 0 ? 0 : 1;
}

function isDeuces(mode) {
  return mode === 'deuces';
}

function isTrump(card, mode = 'ace') {
  if (!card) return false;
  if (card.suit === 'Spades') return true;
  return isDeuces(mode) && card.rank === '2' && card.suit === 'Diamonds';
}

function effectiveSuit(card, mode = 'ace') {
  return isTrump(card, mode) ? 'Spades' : card.suit;
}

function trumpPower(card, mode = 'ace') {
  if (!isTrump(card, mode)) return 0;
  if (isDeuces(mode)) {
    if (card.rank === '2' && card.suit === 'Spades') return 100;
    if (card.rank === '2' && card.suit === 'Diamonds') return 99;
  }
  return RANK_VALUES[card.rank];
}

function followPower(card, mode = 'ace') {
  if (isTrump(card, mode)) return 1000 + trumpPower(card, mode);
  return RANK_VALUES[card.rank];
}

function sortHand(hand, mode = 'ace') {
  return [...hand].sort((a, b) => {
    const trumpDiff = Number(isTrump(b, mode)) - Number(isTrump(a, mode));
    if (trumpDiff !== 0) return trumpDiff;
    if (isTrump(a, mode) && isTrump(b, mode)) {
      return trumpPower(b, mode) - trumpPower(a, mode);
    }
    const suitDiff = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_VALUES[b.rank] - RANK_VALUES[a.rank];
  });
}

function lowest(cards, mode = 'ace') {
  return [...cards].sort((a, b) => followPower(a, mode) - followPower(b, mode))[0];
}

function highest(cards, mode = 'ace') {
  return [...cards].sort((a, b) => followPower(b, mode) - followPower(a, mode))[0];
}

function pickLead(hand, spadesBroken, mode = 'ace') {
  const legal = !spadesBroken && hand.some((card) => !isTrump(card, mode))
    ? hand.filter((card) => !isTrump(card, mode))
    : hand;
  if (!legal.length) return lowest(hand, mode);

  const aces = legal.filter((card) => card.rank === 'A');
  if (aces.length) return aces[0];

  const honors = legal.filter((card) => RANK_VALUES[card.rank] >= 11);
  if (honors.length) return lowest(honors, mode);

  const tens = legal.filter((card) => RANK_VALUES[card.rank] >= 10);
  if (tens.length) return lowest(tens, mode);

  return highest(legal, mode);
}

function cardBeats(candidate, current, leadSuit, mode = 'ace') {
  if (!candidate || !current) return false;
  const candTrump = isTrump(candidate, mode);
  const currTrump = isTrump(current, mode);
  if (candTrump && !currTrump) return true;
  if (currTrump && !candTrump) return false;
  if (candTrump && currTrump) return trumpPower(candidate, mode) > trumpPower(current, mode);
  if (candidate.suit === current.suit) {
    return RANK_VALUES[candidate.rank] > RANK_VALUES[current.rank];
  }
  return candidate.suit === leadSuit && current.suit !== leadSuit && !currTrump;
}

function determineWinner(trickCards, leadSuit, mode = 'ace') {
  if (!trickCards.length) return null;

  let winner = trickCards[0];
  for (let i = 1; i < trickCards.length; i += 1) {
    if (cardBeats(trickCards[i].card, winner.card, leadSuit, mode)) {
      winner = trickCards[i];
    }
  }
  return winner.seat;
}

function pickBotCard(hand, leadSuit, spadesBroken, trick = [], seat = 0, mode = 'ace') {
  if (!hand.length) return null;

  const leading = !leadSuit || !trick.length;
  if (leading) {
    return pickLead(hand, spadesBroken, mode);
  }

  const follow = hand.filter((card) => effectiveSuit(card, mode) === leadSuit);
  const winnerSeat = determineWinner(trick, leadSuit, mode);
  const winnerEntry = trick.find((entry) => entry.seat === winnerSeat);
  const winnerCard = winnerEntry ? winnerEntry.card : null;
  const partnerWinning = winnerSeat != null
    && winnerSeat !== seat
    && teamForSeat(winnerSeat) === teamForSeat(seat);
  if (follow.length) {
    if (!partnerWinning && winnerCard) {
      const winners = follow.filter((card) => cardBeats(card, winnerCard, leadSuit, mode));
      if (winners.length) return lowest(winners, mode);
    }
    return lowest(follow, mode);
  }

  const trumps = hand.filter((card) => isTrump(card, mode));
  const shouldTrump = !partnerWinning && winnerCard && trumps.length;
  if (shouldTrump) {
    const winningTrumps = trumps.filter((card) => cardBeats(card, winnerCard, leadSuit, mode));
    if (winningTrumps.length) return lowest(winningTrumps, mode);
  }

  const dump = hand.filter((card) => !isTrump(card, mode));
  return lowest(dump.length ? dump : hand, mode);
}

module.exports = {
  SUITS,
  RANK_VALUES,
  sortHand,
  pickBotCard,
  determineWinner,
  teamForSeat,
  cardBeats,
  isTrump,
  effectiveSuit,
};
