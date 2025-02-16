const request = require('supertest');
const server = require('../server'); // Import the server instance

let inviteCode;
let roomId;

beforeAll(() => {
  console.log('Starting API tests...');
});

afterAll((done) => {
  server.close(done); // Close server after all tests
});

describe('Room Management API', () => {
  it('should create a room', async () => {
    const response = await request(server)
      .post('/rooms')
      .send({ roomName: 'TestRoom', isPersistent: true });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.room).toHaveProperty('room_id');
    expect(response.body.room).toHaveProperty('invite_code');

    roomId = response.body.room.room_id;
    inviteCode = response.body.room.invite_code;
  });

  it('should join a room using a valid invite code', async () => {
    const response = await request(server)
      .post('/rooms/join')
      .send({ inviteCode });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.room).toHaveProperty('room_id', roomId);
  });

  it('should return 404 when using an invalid invite code', async () => {
    const response = await request(server)
      .post('/rooms/join')
      .send({ inviteCode: 'invalid123' });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
