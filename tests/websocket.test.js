const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');
const app = require('../server'); // Adjust path as needed
const { pool } = require('../utils/db'); // Adjust path as needed

jest.mock('uuid');
jest.mock('../utils/db');

describe('WebSocket Tests', () => {
  let io, serverSocket, clientSocket, httpServer;

  beforeAll((done) => {
    // Create HTTP server for testing
    httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      // Get the port that was assigned
      const port = httpServer.address().port;
      // Connect client socket to server
      clientSocket = Client(`http://localhost:${port}`);
      
      // Get a reference to the server socket when client connects
      io.on('connection', (socket) => {
        serverSocket = socket;
        done();
      });
      
      // Mock UUID generation
      uuidv4.mockReturnValue('mock-uuid');
      
      // Mock DB functions
      pool.query = jest.fn();
    });
  });

  afterAll(() => {
    // Clean up
    io.close();
    clientSocket.close();
    httpServer.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should join a room successfully', (done) => {
    // Mock DB response for room query
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });
    
    // Set up listener for user_list event
    clientSocket.on('user_list', (userList) => {
      expect(Array.isArray(userList)).toBe(true);
      expect(userList.length).toBeGreaterThanOrEqual(1);
      expect(userList[0].name).toBe('Test User');
      expect(userList[0].email).toBe('test@example.com');
      done();
    });
    
    // Emit join_room event
    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  });

  it('should handle room not found error', (done) => {
    // Mock empty DB response
    pool.query.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    });
    
    // Set up listener for error event
    clientSocket.on('error', (data) => {
      expect(data.message).toBe('Room not found');
      done();
    });
    
    // Emit join_room event with invalid code
    clientSocket.emit('join_room', {
      invite_code: 'invalid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  });

  it('should handle submit_prediction event', (done) => {
    // Listen for the prediction_submitted event
    clientSocket.on('prediction_submitted', (data) => {
      expect(data.role).toBe('developer');
      expect(data.prediction).toBe(5);
      done();
    });
    
    // Emit submit_prediction event
    clientSocket.emit('submit_prediction', {
      room_id: 'test-room-id',
      role: 'developer',
      prediction: 5
    });
  });

  it('should handle create_room event', (done) => {
    // Set up listener for room_created event
    clientSocket.on('room_created', (data) => {
      expect(data.room_id).toBe('new-room-id');
      done();
    });
    
    // Emit create_room event
    clientSocket.emit('create_room', {
      room_id: 'new-room-id',
      room_type: 'refinement'
    });
  });

  it('should handle create_action event', (done) => {
    // Set up listener for action_created event
    clientSocket.on('action_created', (data) => {
      expect(data.room_id).toBe('test-room-id');
      expect(data.user_name).toBe('Test User');
      expect(data.description).toBe('Test action');
      done();
    });
    
    // Emit create_action event
    clientSocket.emit('create_action', {
      room_id: 'test-room-id',
      user_name: 'Test User',
      description: 'Test action'
    });
  });

  it('should handle leave_room event', (done) => {
    // Mock active rooms state
    const activeRooms = new Map();
    activeRooms.set('test-room-id', new Map([
      [clientSocket.id, { name: 'Test User', email: 'test@example.com' }]
    ]));
    
    // Set up listener for user_list event
    clientSocket.on('user_list', (userList) => {
      expect(Array.isArray(userList)).toBe(true);
      expect(userList.length).toBe(0);
      done();
    });
    
    // Emit leave_room event
    clientSocket.emit('leave_room', { roomId: 'test-room-id' });
  });

  it('should handle disconnect event', (done) => {
    // Mock active rooms state
    const activeRooms = new Map();
    activeRooms.set('test-room-id', new Map([
      [clientSocket.id, { name: 'Test User', email: 'test@example.com' }]
    ]));
    
    // Set up listener for user_list event after disconnect
    clientSocket.on('user_list', (userList) => {
      expect(Array.isArray(userList)).toBe(true);
      expect(userList.length).toBe(0);
      done();
    });
    
    // Trigger disconnect
    clientSocket.disconnect();
  });
});