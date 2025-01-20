const request = require('supertest');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

app.post('/rooms', async (req, res) => {
  const { roomName, isPersistent } = req.body;
  if (!roomName || typeof roomName !== 'string' || typeof isPersistent !== 'boolean') {
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

app.post('/rooms/join', async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode || typeof inviteCode !== 'string') {
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

describe('Room Management API', () => {
  beforeAll(() => {
    server.listen(3001); // Start the server on a different port for testing
  });

  afterAll(() => {
    server.close(); // Close the server after tests
  });

  it('should create a room', async () => {
    const response = await request(app)
      .post('/rooms')
      .send({ roomName: 'TestRoom', isPersistent: true });
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.room).toHaveProperty('room_id', 'TestRoom');
  });

  it('should join a room', async () => {
    // Assume the room has been created with the invite code '123456'
    const response = await request(app)
      .post('/rooms/join')
      .send({ inviteCode: '123456' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.room).toHaveProperty('invite_code', '123456');
  });
});
