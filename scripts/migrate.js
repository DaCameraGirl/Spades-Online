require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Migration applied.');
  await pool.end();
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
