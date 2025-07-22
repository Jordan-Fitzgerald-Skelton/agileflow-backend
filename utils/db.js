const { Pool } = require('pg');

// Validate required environment variables
const validateDatabaseConfig = () => {
  const required = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
  }
};

// Initialize database configuration
let pool;
let isShuttingDown = false;

const initializeDatabase = () => {
  validateDatabaseConfig();

  // Create the database pool
  pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 30000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected database pool error:', err);
  });

  return pool;
};

// Connection test with retry logic
const connectWithRetry = async (maxRetries = 3, baseDelay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();

      console.log('[DB] Successfully connected to PostgreSQL database');
      return true;

    } catch (error) {
      console.error(`[DB] Connection attempt ${attempt}/${maxRetries} failed:`, error.message);

      if (attempt === maxRetries) {
        throw new Error('Database connection failed after all retry attempts');
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Simple query execution - NO automatic transactions
const runQuery = async (callback) => {
  if (isShuttingDown) {
    throw new Error('Database is shutting down, cannot execute query');
  }

  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  const client = await pool.connect();

  try {
    const result = await callback(client);
    return result;
  } finally {
    client.release();
  }
};

// Graceful shutdown function
const closeDatabasePool = async () => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log('[DB] Initiating graceful database shutdown...');

  if (pool) {
    try {
      await pool.end();
      console.log('[DB] Database pool closed gracefully');
    } catch (error) {
      console.error('[DB] Error during database shutdown:', error);
    }
  }
};

// Initialize database on module load
(async () => {
  try {
    initializeDatabase();
    await connectWithRetry();
  } catch (error) {
    console.error('[DB] Database initialization failed:', error);
  }
})();

// Handle process termination gracefully
process.on('SIGTERM', async () => {
  console.log('[DB] Received SIGTERM, closing database connections...');
  await closeDatabasePool();
});

process.on('SIGINT', async () => {
  console.log('[DB] Received SIGINT, closing database connections...');
  await closeDatabasePool();
});

module.exports = {
  pool,
  runQuery,
  connectWithRetry,
  closeDatabasePool
};
