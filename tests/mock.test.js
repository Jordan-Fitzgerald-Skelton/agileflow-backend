const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

// Mock the database module
jest.mock('../utils/db', () => {
  return {
    pool: {
      query: jest.fn(),
      connect: jest.fn(),
      on: jest.fn()
    },
    executeTransaction: jest.fn(async (callback) => {
      // Simulate client with query method
      const mockClient = {
        query: jest.fn()
      };
      // Mock the transaction and return the result of the callback
      return await callback(mockClient);
    }),
    connectWithRetry: jest.fn()
  };
});

// Mock the email module
jest.mock('../utils/email', () => {
  return {
    sendActionNotification: jest.fn().mockResolvedValue(true),
    transporter: {
      sendMail: jest.fn((mailOptions, callback) => callback(null, { response: 'Email sent' }))
    }
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Socket.io mock with all required methods
jest.mock('socket.io', () => {
  const mockOn = jest.fn();
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  const mockJoin = jest.fn();
  const mockLeave = jest.fn();
  
  // Mock socket object
  const mockSocket = {
    id: 'mock-socket-id',
    join: mockJoin,
    leave: mockLeave,
    on: mockOn,
    emit: mockEmit
  };

  // When io.on('connection', handler) is called, execute the handler with the mock socket
  mockOn.mockImplementation((event, handler) => {
    if (event === 'connection') {
      handler(mockSocket);
    }
    return mockSocket;
  });
  
  const mockIo = {
    on: mockOn,
    to: mockTo,
    emit: mockEmit
  };
  
  return {
    Server: jest.fn().mockImplementation(() => mockIo)
  };
});

// Required before importing the app
const crypto = require('crypto');
jest.mock('crypto', () => {
  return {
    ...jest.requireActual('crypto'),
    randomBytes: jest.fn().mockReturnValue({
      toString: jest.fn().mockReturnValue('abc123')
    })
  };
});

// Load the server
const app = require('../server');
const { executeTransaction } = require('../utils/db');

describe('API Endpoints Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the mock implementation for executeTransaction
    executeTransaction.mockImplementation(async (callback) => {
      const mockClient = {
        query: jest.fn()
      };
      return await callback(mockClient);
    });
  });

  // ========================= Room Management Tests =========================

  describe('Create Refinement Room', () => {
    test('should create a refinement room successfully', async () => {
      // Mock the executeTransaction to return successful result
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({
            rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }],
            rowCount: 1
          })
        };
        return await callback(mockClient);
      });

      const response = await request(app).post("/refinement/create/room");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
      expect(response.body.invite_code).toBe('abc123');
    });

    test('should handle error when creating refinement room fails', async () => {
      // Mock executeTransaction to throw an error
      executeTransaction.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const response = await request(app).post('/refinement/create/room');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Join Refinement Room', () => {
    test('should join a refinement room successfully', async () => {
      // Mock executeTransaction for successful room join
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ room_id: 'mock-uuid' }], rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      const response = await request(app)
        .post('/refinement/join/room')
        .send({
          invite_code: 'abc123',
          name: 'Test User',
          email: 'test@example.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
    });

    test('should return error with invalid invite code', async () => {
      // Mock executeTransaction for invalid invite code
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 })
        };
        const result = await callback(mockClient);
        throw new Error("Invalid invite code");
      });

      const response = await request(app)
        .post('/refinement/join/room')
        .send({
          invite_code: 'invalid',
          name: 'Test User',
          email: 'test@example.com'
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid invite code');
    });

    test('should return error with missing fields', async () => {
      const response = await request(app)
        .post('/refinement/join/room')
        .send({
          invite_code: 'abc123',
          //missing name and email
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return error with invalid email', async () => {
      const response = await request(app)
        .post('/refinement/join/room')
        .send({
          invite_code: 'abc123',
          name: 'Test User',
          email: 'invalid-email'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid email format');
    });
  });

  describe('Create Retro Room', () => {
    test('should create a retro room successfully', async () => {
      // Mock executeTransaction for successful retro room creation
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({
            rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }],
            rowCount: 1
          })
        };
        return await callback(mockClient);
      });

      const response = await request(app)
        .post('/retro/create/room')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
      expect(response.body.invite_code).toBe('abc123');
    });

    test('should handle error when creating retro room fails', async () => {
      // Mock executeTransaction to throw an error
      executeTransaction.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .post('/retro/create/room')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Join Retro Room', () => {
    test('should join a retro room successfully', async () => {
      // Mock executeTransaction for successful retro room join
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ room_id: 'mock-uuid' }], rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      const response = await request(app)
        .post('/retro/join/room')
        .send({
          invite_code: 'abc123',
          name: 'Test User',
          email: 'test@example.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
    });

    test('should return error with invalid invite code', async () => {
      // Mock executeTransaction for invalid invite code
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 })
        };
        const result = await callback(mockClient);
        throw new Error("Invalid invite code");
      });

      const response = await request(app)
        .post('/retro/join/room')
        .send({
          invite_code: 'invalid',
          name: 'Test User',
          email: 'test@example.com'
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  // ========================= Predictions Tests =========================

  describe('Submit Prediction', () => {
    test('should submit prediction successfully', async () => {
      // Mock executeTransaction for successful prediction submission
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      const response = await request(app)
        .post('/refinement/prediction/submit')
        .send({
          room_id: 'mock-uuid',
          role: 'developer',
          prediction: 5
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return error with invalid prediction', async () => {
      const response = await request(app)
        .post('/refinement/prediction/submit')
        .send({
          room_id: 'mock-uuid',
          role: 'developer',
          prediction: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return error with missing fields', async () => {
      const response = await request(app)
        .post('/refinement/prediction/submit')
        .send({
          room_id: 'mock-uuid',
          //missing role and prediction
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Get Predictions', () => {
    test('should get predictions successfully', async () => {
      // Mock executeTransaction for successful predictions retrieval
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({
              rows: [
                { role: 'developer', final_prediction: '5.5' },
                { role: 'qa', final_prediction: '8.0' }
              ],
              rowCount: 2
            })
            .mockResolvedValueOnce({ rowCount: 2 })
        };
        return await callback(mockClient);
      });

      const response = await request(app)
        .get('/refinement/get/predictions')
        .query({ room_id: 'mock-uuid' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.predictions).toHaveLength(2);
      expect(response.body.predictions[0].role).toBe('developer');
      expect(response.body.predictions[0].final_prediction).toBe(5.5);
    });

    test('should return error with missing room_id', async () => {
      const response = await request(app)
        .get('/refinement/get/predictions')
        .query({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ========================= Retro Comments Tests =========================

  describe('Add Retro Comment', () => {
    test('should add comment successfully', async () => {
      // Mock executeTransaction for successful comment addition
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      // Get the io object from the Socket.io mock
      const socketIo = require('socket.io');
      const io = socketIo.Server();

      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
          comment: 'Test comment'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(io.to).toHaveBeenCalledWith('mock-uuid');
    });

    test('should return error with missing fields', async () => {
      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
          //missing comment
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should sanitize HTML in comments', async () => {
      // Mock executeTransaction for successful comment addition
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      // Get the io object from the Socket.io mock
      const socketIo = require('socket.io');
      const io = socketIo.Server();
      const mockEmit = io.to().emit;

      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
          comment: '<script>alert("XSS")</script>'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('new_comment', '&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });
  });

  describe('Create Action Item', () => {
    test('should create action item successfully', async () => {
      // Mock executeTransaction for successful action item creation
      executeTransaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({
              rows: [{ email: 'test@example.com' }],
              rowCount: 1
            })
            .mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

      // Import email module and mock sendActionNotification
      const { sendActionNotification } = require('../utils/email');
      sendActionNotification.mockResolvedValueOnce(true);

      // Get the io object from the Socket.io mock
      const socketIo = require('socket.io');
      const io = socketIo.Server();
      const mockEmit = io.to().emit;

      const response = await request(app)
        .post('/retro/create/action')
        .send({
          room_id: 'mock-uuid',
          user_name: 'Test User',
          description: 'Test action item'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('action_added', {
        user_name: 'Test User',
        description: 'Test action item'
      });
      expect(sendActionNotification).toHaveBeenCalled();
    });

    test('should return error when user not found', async () => {
      // Mock executeTransaction for user not found scenario
      executeTransaction.mockImplementationOnce(() => {
        throw new Error("Assigned user not found in the room");
      });

      const response = await request(app)
        .post('/retro/create/action')
        .send({
          room_id: 'mock-uuid',
          user_name: 'Unknown User',
          description: 'Test action item'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('user not found');
    });

    test('should return error with missing fields', async () => {
      const response = await request(app)
        .post('/retro/create/action')
        .send({
          room_id: 'mock-uuid',
          //missing user_name and description
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});