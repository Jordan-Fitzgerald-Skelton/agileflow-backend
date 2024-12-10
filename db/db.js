const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASS,
    port: process.env.DB_PORT,
    //Max number of clients 
    max: 20,
    //If idele for 30 seconds it closes the connection
    idleTimeoutMillis: 30000,
    //returns an error if connection time takes longer than 2 seconds
    connectionTimeoutMillis: 2000,
});

//Creates an entry in the log for the connection 
pool.on('connect', () => {
    console.log('Connected to the database');
});

//Query function
const query = async (text, params = []) => {
    try {
        const { rows } = await pool.query(text, params);
        return rows;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
};

//Handles shuting down the 'pool'
const closePool = async () => {
    try {
        await pool.end();
        console.log('Database connection pool closed');
    } catch (error) {
        console.error('Error closing database pool:', error);
    }
};

process.on('SIGINT', () => {
    closePool().then(() => {
        process.exit(0);
    });
});

module.exports = { query, closePool };
