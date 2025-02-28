const request = require('supertest');
const { io } = require('socket.io-client');
const app = require('../server.js');
const http = require('http');
const { Server } = require('socket.io');

// Set up the HTTP server and Socket.IO server for testing
const server = http.createServer(app);
const ioServer = new Server(server, { cors: { origin: "*" } });

// Mock the database connection
jest.mock('pg', () => {
  const mPool = {
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

const SERVER_URL = 'http://localhost:5000';

describe('Backend Server Tests', () => {
  let socket;

  beforeAll(() => {
    server.listen(5000);
    socket = io(SERVER_URL);
  });

  afterAll(() => {
    server.close();
    socket.close();
  });

  describe('Room Management', () => {
    it('should create a refinement room', async () => {
      const response = await request(app)
        .post('/refinement/create/room')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('room_id');
      expect(response.body).toHaveProperty('invite_code');
    });

    it('should join a refinement room', async () => {
      const createResponse = await request(app)
        .post('/refinement/create/room')
        .expect(200);

      const joinResponse = await request(app)
        .post('/refinement/join/room')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          invite_code: createResponse.body.invite_code,
        })
        .expect(200);

      expect(joinResponse.body).toHaveProperty('success', true);
    });

    it('should create a retro room', async () => {
      const response = await request(app)
        .post('/retro/create/room')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('room_id');
      expect(response.body).toHaveProperty('invite_code');
    });

    it('should join a retro room', async () => {
      const createResponse = await request(app)
        .post('/retro/create/room')
        .expect(200);

      const joinResponse = await request(app)
        .post('/retro/join/room')
        .send({
          name: 'Test User',
          email: 'test@example.com',
          invite_code: createResponse.body.invite_code,
        })
        .expect(200);

      expect(joinResponse.body).toHaveProperty('success', true);
    });
  });

  describe('Predictions Handling', () => {
    let roomId;

    beforeAll(async () => {
      const response = await request(app)
        .post('/refinement/create/room')
        .expect(200);
      roomId = response.body.room_id;
    });

    it('should submit a prediction', async () => {
      const response = await request(app)
        .post('/refinement/prediction/submit')
        .send({
          room_id: roomId,
          role: 'Developer',
          prediction: 5,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });

    it('should retrieve predictions', async () => {
      const response = await request(app)
        .get(`/refinement/get/predictions?room_id=${roomId}`)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.predictions).toBeInstanceOf(Array);
    });
  });

  describe('Retro Comments', () => {
    let roomId;

    beforeAll(async () => {
      const response = await request(app)
        .post('/retro/create/room')
        .expect(200);
      roomId = response.body.room_id;
    });

    it('should add a comment', async () => {
      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: roomId,
          comment: 'Test comment',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('Action Items', () => {
    let roomId;

    beforeAll(async () => {
      const response = await request(app)
        .post('/retro/create/room')
        .expect(200);
      roomId = response.body.room_id;
    });

    it('should create an action item', async () => {
      const response = await request(app)
        .post('/retro/create/action')
        .send({
          room_id: roomId,
          user_name: 'Test User',
          description: 'Test action item',
        })
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Action created and email sent successfully');
    });
  });

  describe('WebSocket Events', () => {
    it('should join a room and receive user list', (done) => {
      socket.emit('join_room', { invite_code: 'testcode', name: 'Test User', email: 'test@example.com' });
      socket.on('user_list', (users) => {
        expect(users).toContainEqual({ name: 'Test User', email: 'test@example.com' });
        done();
      });
    });

    it('should submit a prediction and receive it', (done) => {
      socket.emit('submit_prediction', { room_id: 'testroom', role: 'Developer', prediction: 5 });
      socket.on('prediction_submitted', (data) => {
        expect(data).toEqual({ role: 'Developer', prediction: 5 });
        done();
      });
    });
  });
});
