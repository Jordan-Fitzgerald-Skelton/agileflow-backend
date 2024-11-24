const { Pool } = require('pg');
require('dotenv').config(); // Load environment variables from .env file

// PostgreSQL connection configuration
const pool = new Pool({
  user: process.env.DB_USER,          // Loaded from .env
  host: process.env.DB_HOST,          // Loaded from .env
  database: process.env.DB_NAME,      // Loaded from .env
  password: process.env.DB_PASS,      // Loaded from .env
  port: process.env.DB_PORT,          // Loaded from .env
});

// Example query function
const query = async (text, params) => {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
};

module.exports = { query };