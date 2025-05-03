const Client = require("socket.io-client");
const { v4: uuidv4 } = require("uuid");

jest.mock("uuid");
jest.mock("../utils/db");

const { pool } = require("../utils/db");
const server = require("../server");

describe("WebSocket Tests", () => {
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

  it("create_room with invalid data", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Invalid room data");
      done();
    });
  
    clientSocket.emit("create_room", {});
  });  

  it("join a room successfully", (done) => {
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

  it("room not found", (done) => {
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

  it("submit_prediction event", (done) => {
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

  it("submit_prediction with invalid prediction value", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Invalid prediction data");
      done();
    });
  
    clientSocket.emit("submit_prediction", {
      room_id: "test-room-id",
      role: "developer",
      prediction: -1
    });
  });  

  it("reset_session event", (done) => {
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });
  
    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  
    clientSocket.once('session_reset', () => {
      done();
    });
  
    setTimeout(() => {
      clientSocket.emit('reset_session', {
        room_id: 'test-room-id'
      });
    }, 100);
  });

  it("reset_session without room_id", (done) => {
  clientSocket.once("error", (data) => {
    expect(data.message).toBe("Room ID is required");
    done();
  });

  clientSocket.emit("reset_session", {});
  });

  it("reset_session without room_id", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Room ID is required");
      done();
    });

    clientSocket.emit("reset_session", {});
  });

  
  it("reveal_results event", (done) => {
    const predictions = [
      { user: 'User A', role: 'developer', prediction: 5 },
      { user: 'User B', role: 'tester', prediction: 3 }
    ];
  
    pool.query.mockResolvedValueOnce({
      rows: [{ room_id: 'test-room-id' }],
      rowCount: 1
    });
  
    clientSocket.emit('join_room', {
      invite_code: 'test-code',
      name: 'Test User',
      email: 'test@example.com'
    });
  
    clientSocket.once('results_revealed', (data) => {
      expect(data).toEqual(predictions);
      done();
    });
  
    setTimeout(() => {
      clientSocket.emit('reveal_results', {
        room_id: 'test-room-id',
        predictions
      });
    }, 100);
  });

  it("reset_session with missing room_id", (done) => {
    clientSocket.once('error', (data) => {
      expect(data.message).toBe("Room ID is required");
      done();
    });
  
    clientSocket.emit('reset_session', {});
  });
  
  it("reveal_results without predictions", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Invalid results data");
      done();
    });
  
    clientSocket.emit("reveal_results", {
      room_id: "test-room-id"
    });
  });  

  it("create_action event", (done) => {
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

  it("create_action with missing fields", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Invalid action data");
      done();
    });
  
    clientSocket.emit("create_action", {
      room_id: "test-room-id",
      description: "Missing user name"
    });
  });  

  it("leave_room event", (done) => {
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

  it("leave_room without roomId", (done) => {
    clientSocket.once("error", (data) => {
      expect(data.message).toBe("Room ID is required");
      done();
    });
  
    clientSocket.emit("leave_room", {});
  });  

  it("disconnect event", (done) => {
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