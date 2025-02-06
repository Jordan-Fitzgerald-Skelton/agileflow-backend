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

// Helper function to validate input
const validateInput = (input, type) => {
  if (type === 'string') return input && typeof input === 'string' && input.trim() !== '';
  if (type === 'number') return typeof input === 'number' && input >= 0;
  if (type === 'boolean') return typeof input === 'boolean';
  return false;
};

// Sanitize and check if room name exists
const sanitizeRoomName = (roomName) => roomName.replace(/[^a-zA-Z0-9 ]/g, '').trim();

const checkRoomExists = async (roomName) => {
  const result = await pool.query('SELECT * FROM refine_rooms WHERE room_name = $1', [roomName]);
  return result.rowCount > 0;
};

// Generate unique invite code securely
const generateUniqueInviteCode = async () => {
  let inviteCode;
  let isUnique = false;
  while (!isUnique) {
    inviteCode = crypto.randomBytes(3).toString('hex'); // Secure 6-char code
    const check = await pool.query('SELECT * FROM refine_rooms WHERE invite_code = $1', [inviteCode]);
    if (check.rowCount === 0) isUnique = true;
  }
  return inviteCode;
};

// Socket.io logic
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', async ({ roomName, isPersistent }, callback) => {
    roomName = sanitizeRoomName(roomName);
    if (!validateInput(roomName, 'string') || !validateInput(isPersistent, 'boolean')) {
      return callback({ success: false, message: 'Invalid input.' });
    }

    if (await checkRoomExists(roomName)) {
      return callback({ success: false, message: 'Room name already taken.' });
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

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    socket.rooms.forEach((room) => {
      socket.leave(room);
    });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
