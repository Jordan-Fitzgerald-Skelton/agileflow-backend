const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/db'); // Use your existing query function
const authenticateToken = require('../middleware/auth'); // Import the middleware
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key'; // Use .env or default fallback

// User signup route
router.post(
  '/signup',
  [
    body('email').isEmail().withMessage('Enter a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      // Check if user already exists
      const userExists = await query('SELECT * FROM users WHERE email = $1', [email]);
      if (userExists.length > 0) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Save user in the database
      await query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, hashedPassword]);

      res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
      res.status(500).json({ message: 'Database error', error: err.message });
    }
  }
);

// User login route
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Enter a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      // Check if user exists
      const users = await query('SELECT * FROM users WHERE email = $1', [email]);
      if (users.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = users[0];

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Generate JWT
      const token = jwt.sign({ email: user.email, id: user.id }, JWT_SECRET, { expiresIn: '1h' });

      res.json({ token });
    } catch (err) {
      res.status(500).json({ message: 'Database error', error: err.message });
    }
  }
);

// Protected route example using the authenticateToken middleware
router.get('/protected', authenticateToken, async (req, res) => {
  // If the request reaches here, it means the user is authenticated
  res.json({ message: 'Protected data', user: req.user });
});

module.exports = router;