const K_FACTOR = 15;

// Standard Elo expected score for A against B.
function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

// Spades is partnership play, a team's pre-game rating is the arithmetic
// mean of its two players' persisted ratings.
function teamRating(playerARating, playerBRating) {
  return (playerARating + playerBRating) / 2;
}

// actualA is 1 if team A won the match, 0 if team A lost. Only the final
// delta is rounded, the expected-score math stays in floating point.
function eloDelta(ratingA, ratingB, actualA, k = K_FACTOR) {
  const expectedA = expectedScore(ratingA, ratingB);
  return Math.round(k * (actualA - expectedA));
}

// Zero-sum by construction: the losing team's delta is defined as the exact
// negation of the winning team's rounded delta, never computed separately,
// so the two can never drift apart by a rounding edge case.
function applyMatchResult(winningTeamRating, losingTeamRating, k = K_FACTOR) {
  const winnerDelta = eloDelta(winningTeamRating, losingTeamRating, 1, k);
  return { winnerDelta, loserDelta: -winnerDelta };
}

module.exports = {
  K_FACTOR,
  expectedScore,
  teamRating,
  eloDelta,
  applyMatchResult,
};
