const request = require('supertest');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('pg');

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

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn((mailOptions, callback) => callback(null, { response: 'Email sent' })),
  })),
}));

//import the app
const app = require('../app');

describe('API Endpoints Tests', () => {
  let mockPool;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = require('pg').Pool();
    mockPool.query.mockImplementation((query, params) => {
      // Default mock implementation for general queries
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  // ========================= Room Management Tests =========================
  
  describe('Create Refinement Room', () => {
    test('should create a refinement room successfully', async () => {
      //mock a database response
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }], rowCount: 1 });
      });

      const response = await request(app)
        .post('/refinement/create/room')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.room_id).toBe('mock-uuid');
      expect(response.body.invite_code).toBe('abc123');
    });

    test('should handle error when creating refinement room fails', async () => {
      //mocks a database error
      mockPool.query.mockImplementationOnce(() => {
        return Promise.reject(new Error('Database error'));
      });

      const response = await request(app)
        .post('/refinement/create/room')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Join Refinement Room', () => {
    test('should join a refinement room successfully', async () => {
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [{ room_id: 'mock-uuid' }], rowCount: 1 });
      });
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
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
      //empty result for invalid invite code
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [], rowCount: 0 });
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [{ room_id: 'mock-uuid', invite_code: 'abc123' }], rowCount: 1 });
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.reject(new Error('Database error'));
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [{ room_id: 'mock-uuid' }], rowCount: 1 });
      });
      
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [], rowCount: 0 });
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
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
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({
          rows: [
            { role: 'developer', final_prediction: '5.5' },
            { role: 'qa', final_prediction: '8.0' }
          ],
          rowCount: 2
        });
      });
      
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 2 });
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
      const mockEmit = jest.fn();
      jest.spyOn(require('socket.io').Server.prototype, 'to').mockReturnValue({
        emit: mockEmit
      });

      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
      });

      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
          comment: 'Test comment'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('new_comment', 'Test comment');
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
      const mockEmit = jest.fn();
      jest.spyOn(require('socket.io').Server.prototype, 'to').mockReturnValue({
        emit: mockEmit
      });

      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
      });

      const response = await request(app)
        .post('/retro/new/comment')
        .send({
          room_id: 'mock-uuid',
          comment: '<script>alert("XSS")</script>'
        });

      expect(response.status).toBe(200);
      expect(mockEmit).toHaveBeenCalledWith('new_comment', '&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });
  });

  describe('Create Action Item', () => {
    test('should create action item successfully', async () => {
      const mockEmit = jest.fn();
      jest.spyOn(require('socket.io').Server.prototype, 'to').mockReturnValue({
        emit: mockEmit
      });

      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({
          rows: [{ email: 'test@example.com' }],
          rowCount: 1
        });
      });
      
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rowCount: 1 });
      });

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
    });

    test('should return error when user not found', async () => {
      mockPool.query.mockImplementationOnce(() => {
        return Promise.resolve({ rows: [], rowCount: 0 });
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
      expect(response.body.message).toContain('User not found');
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