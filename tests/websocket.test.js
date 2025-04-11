const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

//dependencies
jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mPool = {
    connect: jest.fn((callback) => callback(null, mClient, mClient.release)),
    query: jest.fn(),
    on: jest.fn(),
  };
  return {
    Pool: jest.fn(() => mPool),
    Client: jest.fn(() => mClient),
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

describe('WebSocket Tests', () => {
  let io, serverSocket, clientSocket, httpServer;
  let mockPool;
  
  beforeAll((done) => {
    //setsup the socket.io server and client
    httpServer = createServer();
    io = new Server(httpServer);
    
    require('../app');
    
    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = Client(`http://localhost:${port}`);
      clientSocket.on('connect', done);
    });
    
    //setsup a mock database
    mockPool = require('pg').Pool();
  });
  
  afterAll(() => {
    io.close();
    clientSocket.close();
    httpServer.close();
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockImplementation((query, params) => {
      // Default mock implementation for general queries
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });
  
  test('should connect and receive a connection acknowledgment', (done) => {
    expect(clientSocket.connected).toBeTruthy();
    done();
  });
  
  test('should join a room successfully', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ 
        rows: [{ room_id: 'test-room-id' }], 
        rowCount: 1 
      });
    });
    
    clientSocket.on('user_list', (userList) => {
      expect(Array.isArray(userList)).toBeTruthy();
      expect(userList.length).toBeGreaterThan(0);
      expect(userList[0].name).toBe('Test User');
      expect(userList[0].email).toBe('test@example.com');
      done();
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'valid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  });
  
  test('should handle room not found', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    
    clientSocket.on('error', (data) => {
      expect(data.message).toBe('Room not found');
      done();
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'invalid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  });
  
  test('should broadcast prediction submitted', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ 
        rows: [{ room_id: 'test-room-id' }], 
        rowCount: 1 
      });
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'valid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
    
    clientSocket.on('prediction_submitted', (data) => {
      expect(data.role).toBe('developer');
      expect(data.prediction).toBe(5);
      done();
    });
    
    clientSocket.emit('submit_prediction', {
      room_id: 'test-room-id',
      role: 'developer',
      prediction: 5
    });
  });
  
  test('should handle invalid prediction data', (done) => {
    clientSocket.on('error', (data) => {
      expect(data.message).toBe('Invalid prediction data');
      done();
    });
    
    clientSocket.emit('submit_prediction', {
      room_id: 'test-room-id',
    });
  });
  
  test('should broadcast action created', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ 
        rows: [{ room_id: 'test-room-id' }], 
        rowCount: 1 
      });
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'valid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
    
    clientSocket.on('action_created', (data) => {
      expect(data.user_name).toBe('Test User');
      expect(data.description).toBe('Test action item');
      done();
    });
    
    clientSocket.emit('create_action', {
      room_id: 'test-room-id',
      user_name: 'Test User',
      description: 'Test action item'
    });
  });
  
  test('should handle user disconnection', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ 
        rows: [{ room_id: 'test-room-id' }], 
        rowCount: 1 
      });
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'valid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
    
    const clientSocket2 = Client(`http://localhost:${httpServer.address().port}`);
    
    clientSocket2.on('connect', () => {
      clientSocket2.emit('join_room', {
        invite_code: 'valid-code',
        name: 'Test User 2',
        email: 'test2@example.com'
      });
      
      clientSocket2.on('user_list', (userList) => {
        if (userList.length === 1 && userList[0].name === 'Test User 2') {
          expect(userList.length).toBe(1);
          expect(userList[0].name).toBe('Test User 2');
          clientSocket2.disconnect();
          done();
        }
      });
      
      clientSocket.disconnect();
    });
  });
  
  test('should leave room properly', (done) => {
    mockPool.query.mockImplementationOnce(() => {
      return Promise.resolve({ 
        rows: [{ room_id: 'test-room-id' }], 
        rowCount: 1 
      });
    });
    
    clientSocket.emit('join_room', {
      invite_code: 'valid-code',
      name: 'Test User',
      email: 'test@example.com'
    });
    
    const clientSocket2 = Client(`http://localhost:${httpServer.address().port}`);
    
    clientSocket2.on('connect', () => {
      clientSocket2.emit('join_room', {
        invite_code: 'valid-code',
        name: 'Test User 2',
        email: 'test2@example.com'
      });
      
      clientSocket2.on('user_list', (userList) => {
        if (userList.length === 1 && userList[0].name === 'Test User 2') {
          expect(userList.length).toBe(1);
          expect(userList[0].name).toBe('Test User 2');
          clientSocket2.disconnect();
          done();
        }
      });
      
      clientSocket.emit('leave_room', { roomId: 'test-room-id' });
    });
  });
});