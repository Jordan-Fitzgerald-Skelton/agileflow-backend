const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*' },
});

// Middleware
app.use(express.json());

// Set up PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
});

// Connect to PostgreSQL
pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

// Generate unique invite code securely
const generateUniqueInviteCode = async () => {
  let inviteCode;
  let isUnique = false;
  while (!isUnique) {
    inviteCode = crypto.randomBytes(3).toString('hex');
    const check = await pool.query('SELECT * FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (check.rowCount === 0) isUnique = true;
  }
  return inviteCode;
};

// Create Room
app.post('/create-room', [
  body('roomName').isString().notEmpty(),
  body('isPersistent').isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { roomName, isPersistent } = req.body;
    const adminId = req.user.sub; // Ensure user is authenticated
    const inviteCode = await generateUniqueInviteCode();
    const roomId = uuidv4();

    await pool.query(
      'INSERT INTO refine_rooms (room_id, room_name, is_persistent, invite_code, admin_id, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [roomId, roomName, isPersistent, inviteCode, adminId]
    );

    res.json({ success: true, roomId, inviteCode });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room.' });
  }
});

// Join Room
app.post('/join-room', async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user.sub; // Ensure user is authenticated
    const result = await pool.query('SELECT room_id FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invalid invite code.' });
    }

    const roomId = result.rows[0].room_id;
    await pool.query('INSERT INTO room_users (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roomId, userId]);
    res.json({ success: true, roomId });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, message: 'Failed to join room.' });
  }
});

// Submit Prediction
app.post('/submit-prediction', async (req, res) => {
  try {
    const { roomId, prediction } = req.body;
    const userId = req.user.sub; // Ensure user is authenticated

    await pool.query(
      'INSERT INTO predictions (room_id, user_id, prediction) VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO UPDATE SET prediction = EXCLUDED.prediction',
      [roomId, userId, prediction]
    );

    res.json({ success: true, message: 'Prediction submitted successfully.' });
  } catch (error) {
    console.error('Error submitting prediction:', error);
    res.status(500).json({ success: false, message: 'Failed to submit prediction.' });
  }
});

// Socket.io Logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('userJoinRoom', ({ roomId, userId }) => {
    socket.join(roomId);
    console.log(`User ${userId} joined room ${roomId}`);
  });

  socket.on('submitPrediction', async ({ roomId }) => {
    try {
      const result = await pool.query('SELECT AVG(prediction) as avg_prediction FROM predictions WHERE room_id = $1', [roomId]);
      io.to(roomId).emit('updatePredictions', { avgPrediction: result.rows[0].avg_prediction });
    } catch (error) {
      console.error('Error calculating average prediction:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});