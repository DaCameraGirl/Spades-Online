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

function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const suitDiff = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_VALUES[b.rank] - RANK_VALUES[a.rank];
  });
}

function lowest(cards) {
  return [...cards].sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank])[0];
}

function highest(cards) {
  return [...cards].sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank])[0];
}

function pickLead(hand, spadesBroken) {
  const legal = !spadesBroken && hand.some((card) => card.suit !== 'Spades')
    ? hand.filter((card) => card.suit !== 'Spades')
    : hand;
  if (!legal.length) return lowest(hand);

  const aces = legal.filter((card) => card.rank === 'A');
  if (aces.length) return aces[0];

  const honors = legal.filter((card) => RANK_VALUES[card.rank] >= 11);
  if (honors.length) return lowest(honors);

  const tens = legal.filter((card) => RANK_VALUES[card.rank] >= 10);
  if (tens.length) return lowest(tens);

  return highest(legal);
}

function cardBeats(candidate, current, leadSuit) {
  if (!candidate || !current) return false;
  if (candidate.suit === 'Spades' && current.suit !== 'Spades') return true;
  if (current.suit === 'Spades' && candidate.suit !== 'Spades') return false;
  if (candidate.suit === current.suit) {
    return RANK_VALUES[candidate.rank] > RANK_VALUES[current.rank];
  }
  return candidate.suit === leadSuit && current.suit !== leadSuit && current.suit !== 'Spades';
}

function determineWinner(trickCards, leadSuit) {
  if (!trickCards.length) return null;

  let winner = trickCards[0];
  for (let i = 1; i < trickCards.length; i += 1) {
    if (cardBeats(trickCards[i].card, winner.card, leadSuit)) {
      winner = trickCards[i];
    }
  }
  return winner.seat;
}

function pickBotCard(hand, leadSuit, spadesBroken, trick = [], seat = 0) {
  if (!hand.length) return null;

  const leading = !leadSuit || !trick.length;
  if (leading) {
    return pickLead(hand, spadesBroken);
  }

  const follow = hand.filter((card) => card.suit === leadSuit);
  const winnerSeat = determineWinner(trick, leadSuit);
  const winnerEntry = trick.find((entry) => entry.seat === winnerSeat);
  const winnerCard = winnerEntry ? winnerEntry.card : null;
  const partnerWinning = winnerSeat != null
    && winnerSeat !== seat
    && teamForSeat(winnerSeat) === teamForSeat(seat);
  if (follow.length) {
    if (!partnerWinning && winnerCard) {
      const winners = follow.filter((card) => cardBeats(card, winnerCard, leadSuit));
      if (winners.length) return lowest(winners);
    }
    return lowest(follow);
  }

  const spades = hand.filter((card) => card.suit === 'Spades');
  const shouldTrump = !partnerWinning && winnerCard && spades.length;
  if (shouldTrump) {
    const winningTrumps = winnerCard.suit === 'Spades'
      ? spades.filter((card) => RANK_VALUES[card.rank] > RANK_VALUES[winnerCard.rank])
      : spades;
    if (winningTrumps.length) return lowest(winningTrumps);
  }

  const dump = hand.filter((card) => card.suit !== 'Spades');
  return lowest(dump.length ? dump : hand);
}

module.exports = {
  SUITS,
  RANK_VALUES,
  sortHand,
  pickBotCard,
  determineWinner,
  teamForSeat,
  cardBeats,
};
