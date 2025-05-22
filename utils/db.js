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
  try {
    validateDatabaseConfig();
    
    // Create the database pool with enhanced configuration
    pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT, 10),
      max: 20, // Maximum number of clients in the pool
      min: 2, // Minimum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection cannot be established
      acquireTimeoutMillis: 60000, // Return error after 60 seconds if a client cannot be checked out
      statement_timeout: 30000, // Cancel statements after 30 seconds
      query_timeout: 30000, // Cancel queries after 30 seconds
    });
    
    // Enhanced event handling
    pool.on('connect', (client) => {
      console.log(`[DB] New client connected (Total: ${pool.totalCount})`);
    });
    
    pool.on('acquire', (client) => {
      console.log(`[DB] Client acquired from pool (Idle: ${pool.idleCount}, Total: ${pool.totalCount})`);
    });
    
    pool.on('remove', (client) => {
      console.log(`[DB] Client removed from pool (Total: ${pool.totalCount})`);
    });
    
    pool.on('error', (err) => {
      console.error('[DB] Unexpected database pool error:', err);
      // Don't exit the process, let the application handle the error gracefully
      if (!isShuttingDown) {
        console.log('[DB] Attempting to recover from database error...');
        // Could implement additional recovery logic here
      }
    });
    
    return pool;
  } catch (error) {
    console.error('[DB] Failed to initialize database pool:', error);
    throw error;
  }
};

// Connection retry logic with exponential backoff
const connectWithRetry = async (maxRetries = 5, baseDelay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      
      // Test the connection with a simple query
      await client.query('SELECT 1');
      client.release();
      
      console.log('[DB] Successfully connected to PostgreSQL database');
      return true;
      
    } catch (error) {
      console.error(`[DB] Connection attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt === maxRetries) {
        console.error('[DB] All connection attempts failed. Database is unavailable.');
        throw new Error('Database connection failed after all retry attempts');
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 1000; // Add random jitter to prevent thundering herd
      const totalDelay = delay + jitter;
      
      console.log(`[DB] Retrying connection in ${Math.round(totalDelay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
};

// Enhanced query execution function
const runQuery = async (callback, useTransaction = true) => {
  if (isShuttingDown) {
    throw new Error('Database is shutting down, cannot execute query');
  }

  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  const client = await pool.connect();
  
  try {
    if (useTransaction) {
      await client.query('BEGIN');
    }
    
    const result = await callback(client);
    
    if (useTransaction) {
      await client.query('COMMIT');
    }
    
    return result;
  } catch (error) {
    if (useTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[DB] Error during rollback:', rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

// Simple query function for operations that don't need transactions
const runSimpleQuery = async (callback) => {
  return runQuery(callback, false);
};

// Health check function
const checkDatabaseHealth = async () => {
  try {
    const client = await pool.connect();
    const startTime = Date.now();
    
    await client.query('SELECT 1 as health_check, NOW() as current_time');
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    client.release();
    
    return {
      healthy: true,
      responseTime,
      poolStats: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    };
  } catch (error) {
    console.error('[DB] Health check failed:', error);
    return {
      healthy: false,
      error: error.message,
      poolStats: pool ? {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      } : null
    };
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
      // Wait for active queries to complete (with timeout)
      await Promise.race([
        pool.end(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database shutdown timeout')), 10000)
        )
      ]);
      console.log('[DB] Database pool closed gracefully');
    } catch (error) {
      console.error('[DB] Error during database shutdown:', error);
      // Force close if graceful shutdown fails
      try {
        await pool.end();
      } catch (forceError) {
        console.error('[DB] Error during forced database shutdown:', forceError);
      }
    }
  }
};

// Initialize database on module load
try {
  initializeDatabase();
  
  // Attempt initial connection
  connectWithRetry().catch(error => {
    console.error('[DB] Initial database connection failed:', error);
    // Don't exit the process, let the application decide how to handle this
  });
} catch (error) {
  console.error('[DB] Database initialization failed:', error);
}

// Handle process termination gracefully
process.on('SIGTERM', async () => {
  console.log('[DB] Received SIGTERM, closing database connections...');
  await closeDatabasePool();
});

process.on('SIGINT', async () => {
  console.log('[DB] Received SIGINT, closing database connections...');
  await closeDatabasePool();
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('[DB] Uncaught exception:', error);
  await closeDatabasePool();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('[DB] Unhandled rejection at:', promise, 'reason:', reason);
  await closeDatabasePool();
  process.exit(1);
});

// Periodic health checks (optional)
const startHealthChecks = (intervalMs = 60000) => {
  const healthCheckInterval = setInterval(async () => {
    if (isShuttingDown) {
      clearInterval(healthCheckInterval);
      return;
    }
    
    const health = await checkDatabaseHealth();
    if (!health.healthy) {
      console.warn('[DB] Database health check failed:', health);
    } else {
      console.log(`[DB] Health check passed (${health.responseTime}ms)`, health.poolStats);
    }
  }, intervalMs);
  
  return healthCheckInterval;
};

module.exports = {
  pool,
  runQuery,
  runSimpleQuery,
  connectWithRetry,
  checkDatabaseHealth,
  closeDatabasePool,
  startHealthChecks
};
