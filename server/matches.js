const { pool } = require('./db');
const { teamRating, applyMatchResult } = require('./rating');

// Records a completed rated match and updates both teams' Elo atomically.
// Idempotent on idempotencyKey: a second call for the same match is a
// no-op, protected both by an upfront check and, since two concurrent
// calls could both pass that check under READ COMMITTED isolation, by
// the unique index on rated_matches.idempotency_key as the real backstop.
async function recordRatedMatch({ idempotencyKey, teamAPlayerIds, teamBPlayerIds, winningTeam }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'select 1 from rated_matches where idempotency_key = $1',
      [idempotencyKey],
    );
    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'already_recorded' };
    }

    const allIds = [...teamAPlayerIds, ...teamBPlayerIds];
    const ratingsResult = await client.query(
      'select id, elo_rating as "eloRating" from players where id = any($1::uuid[]) for update',
      [allIds],
    );
    if (ratingsResult.rowCount !== 4) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'missing_players' };
    }
    const ratingById = new Map(ratingsResult.rows.map((row) => [row.id, row.eloRating]));

    const teamARating = teamRating(ratingById.get(teamAPlayerIds[0]), ratingById.get(teamAPlayerIds[1]));
    const teamBRating = teamRating(ratingById.get(teamBPlayerIds[0]), ratingById.get(teamBPlayerIds[1]));
    const winningRating = winningTeam === 'A' ? teamARating : teamBRating;
    const losingRating = winningTeam === 'A' ? teamBRating : teamARating;
    const { winnerDelta, loserDelta } = applyMatchResult(winningRating, losingRating);
    const winnerIds = winningTeam === 'A' ? teamAPlayerIds : teamBPlayerIds;
    const loserIds = winningTeam === 'A' ? teamBPlayerIds : teamAPlayerIds;

    await client.query(
      `insert into rated_matches
        (idempotency_key, team_a_player1, team_a_player2, team_b_player1, team_b_player2,
         winning_team, team_a_rating_before, team_b_rating_before, delta)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        idempotencyKey,
        teamAPlayerIds[0], teamAPlayerIds[1],
        teamBPlayerIds[0], teamBPlayerIds[1],
        winningTeam, teamARating, teamBRating, winnerDelta,
      ],
    );

    for (const id of winnerIds) {
      await client.query(
        `update players set
           elo_rating = elo_rating + $1,
           highest_rating = greatest(highest_rating, elo_rating + $1),
           wins = wins + 1,
           games_played = games_played + 1,
           updated_at = now()
         where id = $2`,
        [winnerDelta, id],
      );
    }
    for (const id of loserIds) {
      await client.query(
        `update players set
           elo_rating = elo_rating + $1,
           losses = losses + 1,
           games_played = games_played + 1,
           updated_at = now()
         where id = $2`,
        [loserDelta, id],
      );
    }

    await client.query('COMMIT');
    return { applied: true, winnerDelta, loserDelta };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return { applied: false, reason: 'already_recorded' };
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { recordRatedMatch };
