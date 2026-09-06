const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.com')
    ? { rejectUnauthorized: false }
    : undefined,
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
