const request = require("supertest");
const { v4: uuidv4 } = require("uuid");

jest.mock("../utils/db", () => {
  return {
    pool: {
      query: jest.fn(),
      connect: jest.fn(),
      on: jest.fn()
    },
    runQuery: jest.fn(async (callback) => {
      const mockClient = {
        query: jest.fn()
      };
      return await callback(mockClient);
    }),
    retryConnection: jest.fn()
  };
});

jest.mock("../utils/email", () => {
  return {
    sendActionNotification: jest.fn().mockResolvedValue(true),
    transporter: {
      sendMail: jest.fn((mailOptions, callback) => callback(null, { response: 'Email sent' }))
    }
  };
});

jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid"),
}));

jest.mock('socket.io', () => {
  const mockOn = jest.fn();
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  const mockJoin = jest.fn();
  const mockLeave = jest.fn();
  
  const mockSocket = {
    id: 'mock-socket-id',
    join: mockJoin,
    leave: mockLeave,
    on: mockOn,
    emit: mockEmit
  };

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

const crypto = require("crypto");
jest.mock("crypto", () => {
  return {
    ...jest.requireActual("crypto"),
    randomBytes: jest.fn().mockReturnValue({
      toString: jest.fn().mockReturnValue('abc123')
    })
  };
});

const app = require("../server");
const { pool, runQuery } = require("../utils/db");

describe("Mock endpoint tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    pool.query.mockImplementation((query) => {
      if (query.includes('SELECT 1 FROM rooms WHERE invite_code')) {
        return { rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    
    runQuery.mockImplementation(async (callback) => {
      const mockClient = {
        query: jest.fn()
      };
      return await callback(mockClient);
    });
  });

  describe("create a refinement room", () => {
    test("should create a refinement room successfully", async () => {
      const mockQueryResult = {
        rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }],
        rowCount: 1
      };
      
      runQuery.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce(mockQueryResult)
        };
        await callback(mockClient);
        return mockQueryResult;
      });

      pool.query.mockImplementationOnce(() => {
        return { rowCount: 0 };
      });
    
      const response = await request(app).post("/refinement/create/room");
    
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
      expect(response.body.invite_code).toBe('abc123');
    });

    test("creating a refinement room fails correctly", async () => {
      // Mock runQuery to throw an error
      runQuery.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const response = await request(app).post('/refinement/create/room');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe("joining a refinement room", () => {
    test("join a refinement room successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

    test("invalid invite code", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

    test("error with missing parmeters", async () => {
      const response = await request(app)
        .post('/refinement/join/room')
        .send({
          invite_code: 'abc123',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test("error with an invalid email", async () => {
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

  describe("creating a retro room", () => {
    test("create a retro room successfully", async () => {
      const mockQueryResult = {
        rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }],
        rowCount: 1
      };
      
      runQuery.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce(mockQueryResult)
        };
        await callback(mockClient);
        return mockQueryResult;
      });
    
      pool.query.mockImplementationOnce(() => {
        return { rowCount: 0 };
      });
    
      const response = await request(app)
        .post('/retro/create/room')
        .send({});
    
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
      expect(response.body.invite_code).toBe('abc123');
    });

    test("error when creating a retro room fails", async () => {
      runQuery.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .post('/retro/create/room')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe("joining a retro room", () => {
    test("join a retro room successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

    test("invalid invite code", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

  describe('prediction tests', () => {
    test("submit a prediction successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

    test("error when submitting an invalid prediction", async () => {
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

    test("error with missing parameters", async () => {
      const response = await request(app)
        .post('/refinement/prediction/submit')
        .send({
          room_id: 'mock-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("get the final predictions", () => {
    test("get the final predictions successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
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

    test("error with a missing room_id", async () => {
      const response = await request(app)
        .get('/refinement/get/predictions')
        .query({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('retro comments', () => {
    test("add a comment successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

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

    test("error with missing parameters", async () => {
      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test("sanitize submitted comments", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });

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

  describe("create action items", () => {
    test("create an action item successfully", async () => {
      runQuery.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ email: 'test@example.com' }], rowCount: 1 })
            .mockResolvedValueOnce({ rowCount: 1 })
        };
        return await callback(mockClient);
      });
    
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

      const { sendActionNotification } = require("../utils/email");
      expect(sendActionNotification).toHaveBeenCalled();
    });    

    test("error when the user is not found", async () => {
      runQuery.mockImplementationOnce(() => {
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

    test("error with missing parmeters", async () => {
      const response = await request(app)
        .post('/retro/create/action')
        .send({
          room_id: 'mock-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });
});