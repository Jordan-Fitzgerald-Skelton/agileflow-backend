const { Pool } = require('pg');

//database setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20,
  idleTimeoutMillis: 30000
});

const executeTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const connectWithRetry = () => {
  pool.connect((err, client, release) => {
    if (err) {
      console.error('Failed to connect to the database', err);
      setTimeout(connectWithRetry, 5000);
      return;
    }
    release();
    console.log('Successfully connected to PostgreSQL database');
    pool.on('error', (err) => {
      console.error('Unexpected database error', err);
      process.exit(-1);
    });
  });
};

module.exports = {
  pool,
  executeTransaction,
  connectWithRetry
};