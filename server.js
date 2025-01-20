const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
//this retrieves the enviroment variables
require('dotenv').config();

//initialises the express app and socket server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

//middleware
//parses the json
app.use(express.json());

//sets up the database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

//tests the database connection
pool.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

//validats the inputs
const validateInput = (input, type) => {
  //this adds validation based on the input type (roomName, inviteCode)
  return input && typeof input === type;
};

//socket.io server
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  //Create room event
  socket.on('createRoom', async ({ roomName, isPersistent }, callback) => {
    if (!validateInput(roomName, 'string') || !validateInput(isPersistent, 'boolean')) {
      return callback({ success: false, message: 'Invalid input.' });
    }
    try {
    //used to generate a random invite code
      const inviteCode = Math.random().toString(36).substring(2, 8);
      const result = await pool.query(
        'INSERT INTO refine_rooms (room_id, is_persistent, invite_code, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
        [roomName, isPersistent, inviteCode]
      );
      const room = result.rows[0];
      callback({ success: true, room });
      //when a user joins the room
      socket.join(roomName);
      console.log(`Room created: ${roomName}, Invite Code: ${inviteCode}`);
    } catch (error) {
      console.error('Error creating room:', error);
      callback({ success: false, message: 'Failed to create room.' });
    }
  });

  //Join room event
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
        callback({ success: false, message: 'Invalid invite code.' });
      } else {
        const room = result.rows[0];
        //when a user joins the room
        socket.join(room.room_id);
        console.log(`User joined room: ${room.room_id}`);
        callback({ success: true, room });
      }
    } catch (error) {
      console.error('Error joining room:', error);
      callback({ success: false, message: 'Failed to join room.' });
    }
  });

  //A prediction is provided event
  socket.on('submitPrediction', ({ roomName, userId, prediction }, callback) => {
    if (!validateInput(roomName, 'string') || !validateInput(userId, 'string') || !validateInput(prediction, 'number')) {
      return callback({ success: false, message: 'Invalid input.' });
    }
    try {
    //sends the prediction to the room
      io.to(roomName).emit('newPrediction', { userId, prediction });
      callback({ success: true });
    } catch (error) {
      console.error('Error submitting prediction:', error);
      callback({ success: false, message: 'Failed to submit prediction.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

//Endpoints

//For creating a rooom
app.post('/rooms', async (req, res) => {
  const { roomName, isPersistent } = req.body;
  if (!validateInput(roomName, 'string') || !validateInput(isPersistent, 'boolean')) {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }
  try {
    const inviteCode = Math.random().toString(36).substring(2, 8);
    const result = await pool.query(
      'INSERT INTO refine_rooms (room_id, is_persistent, invite_code, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [roomName, isPersistent, inviteCode]
    );
    res.status(201).json({ success: true, room: result.rows[0] });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room.' });
  }
});

//For joining a room
app.post('/rooms/join', async (req, res) => {
  const { inviteCode } = req.body;
  if (!validateInput(inviteCode, 'string')) {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM refine_rooms WHERE invite_code = $1',
      [inviteCode]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ success: false, message: 'Invalid invite code.' });
    } else {
      res.status(200).json({ success: true, room: result.rows[0] });
    }
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ success: false, message: 'Failed to join room.' });
  }
});

//starts the socket.io server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});