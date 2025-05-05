const { Pool } = require('pg');

//connect and create the database pool 
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  max: 20, 
  idleTimeoutMillis: 30000
});

//executes the queries from the server, rolls backe when there are erros and 
//commits the query when it succeeds 
const runQuery = async (callback) => {
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

const retryConnection = () => {
  pool.connect((err, client, release) => {
    if (err) {
      console.error('Failed to connect to the database', err);
      //will retry the connection evry 5 secons 
      setTimeout(retryConnection, 5000); 
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

//exports everything for the server
module.exports = {
  pool,
  runQuery,
  retryConnection
};
