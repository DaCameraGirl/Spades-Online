const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SALT_ROUNDS = 10;

const PUBLIC_FIELDS = `
  id, screen_name as "screenName", elo_rating as "eloRating",
  highest_rating as "highestRating", wins, losses, games_played as "gamesPlayed"
`;

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function createPlayer({ screenName, email, password }) {
  const trimmedName = String(screenName || '').trim();
  const trimmedEmail = String(email || '').trim().toLowerCase();

  if (trimmedName.length < 2 || trimmedName.length > 20) {
    throw new AuthError('invalid_screen_name', 'Screen name must be 2-20 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new AuthError('invalid_email', 'Enter a valid email address.');
  }
  if (String(password || '').length < 6) {
    throw new AuthError('invalid_password', 'Password must be at least 6 characters.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = await query(
      `insert into players (screen_name, email, password_hash)
       values ($1, $2, $3)
       returning ${PUBLIC_FIELDS}`,
      [trimmedName, trimmedEmail, passwordHash],
    );
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint && error.constraint.includes('screen_name')) {
        throw new AuthError('screen_name_taken', 'That screen name is already taken.');
      }
      if (error.constraint && error.constraint.includes('email')) {
        throw new AuthError('email_taken', 'An account with that email already exists.');
      }
    }
    throw error;
  }
}

async function authenticate({ email, password }) {
  const trimmedEmail = String(email || '').trim().toLowerCase();
  const result = await query(
    `select id, password_hash as "passwordHash" from players where lower(email) = $1`,
    [trimmedEmail],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError('invalid_credentials', 'Incorrect email or password.');

  const matches = await bcrypt.compare(String(password || ''), row.passwordHash);
  if (!matches) throw new AuthError('invalid_credentials', 'Incorrect email or password.');

  return getPlayerById(row.id);
}

async function createSession(playerId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `insert into sessions (token, player_id, expires_at) values ($1, $2, $3)`,
    [token, playerId, expiresAt],
  );
  return token;
}

async function getPlayerBySession(token) {
  if (!token) return null;
  const result = await query(
    `select p.id, p.screen_name as "screenName", p.elo_rating as "eloRating",
            p.highest_rating as "highestRating", p.wins, p.losses,
            p.games_played as "gamesPlayed"
     from sessions s
     join players p on p.id = s.player_id
     where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return result.rows[0] || null;
}

async function deleteSession(token) {
  await query(`delete from sessions where token = $1`, [token]);
}

async function getPlayerById(playerId) {
  const result = await query(
    `select ${PUBLIC_FIELDS} from players where id = $1`,
    [playerId],
  );
  return result.rows[0] || null;
}

async function getLeaderboard(limit = 25) {
  const result = await query(
    `select screen_name as "screenName", elo_rating as "eloRating"
     from players
     order by elo_rating desc
     limit $1`,
    [Math.min(100, Math.max(1, Number(limit) || 25))],
  );
  return result.rows;
}

module.exports = {
  AuthError,
  createPlayer,
  authenticate,
  createSession,
  getPlayerBySession,
  deleteSession,
  getPlayerById,
  getLeaderboard,
};
