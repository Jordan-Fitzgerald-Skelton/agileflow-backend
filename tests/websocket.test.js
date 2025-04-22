const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

jest.mock('uuid');
jest.mock('../utils/db');

const { pool } = require('../utils/db');
const server = require('../server');

describe('WebSocket Integration Tests', () => {
  let clientSocket;
  let port;
  const TIMEOUT = 30000;

  beforeAll((done) => {
    uuidv4.mockReturnValue('mock-uuid');
    
    server.listen(() => {
      port = server.address().port;
      clientSocket = Client(`http://localhost:${port}`);
      clientSocket.on('connect', done);
    });
  }, TIMEOUT);

  afterAll((done) => {
    if (clientSocket) {
      clientSocket.removeAllListeners();
      if (clientSocket.connected) {
        clientSocket.disconnect();
      }
    }
    
    server.close(() => {
      done();
    });
  }, TIMEOUT);

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should join a room successfully', (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });

    clientSocket.once('user_list', (userList) => {
      expect(Array.isArray(userList)).toBe(true);
      expect(userList.length).toBe(1);
      expect(userList[0].name).toBe('Test User');
      expect(userList[0].email).toBe('test@example.com');
      done();
    });

    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  }, TIMEOUT);

  it('should handle room not found error', (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });

    clientSocket.once('error', (data) => {
      expect(data.message).toBe('Room not found');
      done();
    });

    clientSocket.emit('join_room', {
      invite_code: 'invalid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  }, TIMEOUT);

  it('should handle submit_prediction event', (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });

    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });

    clientSocket.once('prediction_submitted', (data) => {
      expect(data.role).toBe('developer');
      expect(data.prediction).toBe(5);
      done();
    });

    setTimeout(() => {
      clientSocket.emit('submit_prediction', {
        room_id: 'test-room-id',
        role: 'developer',
        prediction: 5
      });
    }, 100);
  }, TIMEOUT);

  it('should handle create_action event', (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });

    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });

    clientSocket.once('action_created', (data) => {
      expect(data.room_id).toBe('test-room-id');
      expect(data.user_name).toBe('Test User');
      expect(data.description).toBe('Test action');
      done();
    });

    setTimeout(() => {
      clientSocket.emit('create_action', {
        room_id: 'test-room-id',
        user_name: 'Test User',
        description: 'Test action'
      });
    }, 100);
  }, TIMEOUT);

  it('should handle leave_room event', (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });
    
    setTimeout(() => {
      clientSocket.emit('leave_room', { roomId: 'test-room-id' });
      setTimeout(() => {
        done();
      }, 100);
    }, 100);
  }, TIMEOUT);

  it('should handle disconnect event', (done) => {
    const tempClient = Client(`http://localhost:${port}`);
    
    tempClient.on('connect', () => {
      tempClient.once('disconnect', () => {
        done();
      });
      
      setTimeout(() => {
        tempClient.disconnect();
      }, 100);
    });
  }, TIMEOUT);
});