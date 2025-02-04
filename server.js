const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid'); // For unique room IDs
const validator = require('validator'); // For input validation
require('dotenv').config();

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*' }, // Use environment variable for production
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

// Helper function to validate input
const validateInput = (input, type) => {
  if (type === 'string') return input && typeof input === 'string' && input.trim() !== '';
  if (type === 'number') return typeof input === 'number' && input >= 0;
  if (type === 'boolean') return typeof input === 'boolean';
  return false;
};

// Middleware for validating room creation
const validateRoomCreation = (req, res, next) => {
  const { roomName, isPersistent } = req.body;
  if (!validateInput(roomName, 'string') || !validateInput(isPersistent, 'boolean')) {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }
  next();
};

const validateRoomJoin = (req, res, next) => {
  const { inviteCode } = req.body;
  if (!validateInput(inviteCode, 'string')) {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }
  next();
};

// Ensure unique invite codes
const generateUniqueInviteCode = async () => {
  let inviteCode;
  let isUnique = false;

  while (!isUnique) {
    inviteCode = Math.random().toString(36).substring(2, 8);
    const check = await pool.query('SELECT * FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (check.rowCount === 0) isUnique = true;
  }
  return inviteCode;
};

// Socket.io logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', async ({ roomName, isPersistent }, callback) => {
    if (!validateInput(roomName, 'string') || !validateInput(isPersistent, 'boolean')) {
      return callback({ success: false, message: 'Invalid input.' });
    }

    if (!validator.isAlphanumeric(roomName.replace(/\s/g, ''))) {
      return callback({ success: false, message: 'Room name must be alphanumeric.' });
    }

    try {
      const roomId = uuidv4();
      const inviteCode = await generateUniqueInviteCode();

      const result = await pool.query(
        'INSERT INTO refine_rooms (room_id, room_name, is_persistent, invite_code, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
        [roomId, roomName, isPersistent, inviteCode]
      );

      const room = result.rows[0];
      socket.join(room.room_id);
      callback({ success: true, room });

      console.log(`Room created: ${room.room_name}, Invite Code: ${inviteCode}`);
    } catch (error) {
      console.error('Error creating room:', error);
      callback({ success: false, message: 'Failed to create room.' });
    }
  });

  socket.on('joinRoom', async ({ inviteCode }, callback) => {
    if (!validateInput(inviteCode, 'string')) {
      return callback({ success: false, message: 'Invalid invite code.' });
    }

    try {
      const result = await pool.query(
        'SELECT * FROM refine_rooms WHERE invite_code = $1',
        [inviteCode]
      );

      if (result.rowCount === 0) {
        return callback({ success: false, message: 'Invalid invite code.' });
      }

      const room = result.rows[0];
      socket.join(room.room_id);
      console.log(`User joined room: ${room.room_name}`);
      callback({ success: true, room });
    } catch (error) {
      console.error('Error joining room:', error);
      callback({ success: false, message: 'Failed to join room.' });
    }
  });

  socket.on('submitPrediction', ({ roomId, userId, prediction }, callback) => {
    if (!validateInput(roomId, 'string') || !validateInput(userId, 'string') || !validateInput(prediction, 'number')) {
      return callback({ success: false, message: 'Invalid input.' });
    }

    try {
      io.to(roomId).emit('newPrediction', { userId, prediction });
      callback({ success: true });
    } catch (error) {
      console.error('Error submitting prediction:', error);
      callback({ success: false, message: 'Failed to submit prediction.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    socket.rooms.forEach((room) => socket.leave(room));
  });
});

// REST API Endpoints
app.post('/rooms', validateRoomCreation, async (req, res) => {
  const { roomName, isPersistent } = req.body;

  if (!validator.isAlphanumeric(roomName.replace(/\s/g, ''))) {
    return res.status(400).json({ success: false, message: 'Room name must be alphanumeric.' });
  }

  try {
    const roomId = uuidv4();
    const inviteCode = await generateUniqueInviteCode();

    const result = await pool.query(
      'INSERT INTO refine_rooms (room_id, room_name, is_persistent, invite_code, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [roomId, roomName, isPersistent, inviteCode]
    );

    res.status(201).json({ success: true, room: result.rows[0] });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room.' });
  }
});

app.post('/rooms/join', validateRoomJoin, async (req, res) => {
  const { inviteCode } = req.body;
  try {
    const result = await pool.query('SELECT * FROM refine_rooms WHERE invite_code = $1', [inviteCode]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invalid invite code.' });
    }

    res.status(200).json({ success: true, room: result.rows[0] });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, message: 'Failed to join room.' });
  }
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await pool.end();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});