//midleware test for database
const jwt = require('jsonwebtoken');
const { query } = require('../db/db'); // uses the database query from db.js

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // get the user from the database to see if they still exist
    const users = await query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    req.user = users[0]; // add the users information to the request
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

module.exports = authenticateToken;