const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const validator = require('validator');
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

pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

module.exports = { app, server, pool };

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
app.post('/create-room', async (req, res) => {
  try {
    const { roomName, isPersistent } = req.body;
    const inviteCode = await generateUniqueInviteCode();
    const roomId = uuidv4();

    await pool.query(
      'INSERT INTO refine_rooms (room_id, room_name, is_persistent, invite_code, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [roomId, roomName, isPersistent, inviteCode]
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
    const result = await pool.query('SELECT room_id FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invalid invite code.' });
    }

    const roomId = result.rows[0].room_id;
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

    await pool.query(
      'INSERT INTO predictions (room_id, prediction) VALUES ($1, $2) ON CONFLICT (room_id) DO UPDATE SET prediction = EXCLUDED.prediction',
      [roomId, prediction]
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

  socket.on('joinRoom', ({ roomId }) => {
    socket.join(roomId);
    console.log(`User joined room ${roomId}`);
  });

  socket.on('submitPrediction', async ({ roomId }) => {
    const result = await pool.query('SELECT AVG(prediction) as avg_prediction FROM predictions WHERE room_id = $1', [roomId]);
    io.to(roomId).emit('updatePredictions', { avgPrediction: result.rows[0].avg_prediction });
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
