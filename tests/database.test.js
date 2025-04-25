const { runQuery } = require('../utils/db');
const pg = require('pg');

// Create proper mocks that simulate how pg works
jest.mock('pg', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  
  const mockPool = {
    connect: jest.fn(() => Promise.resolve(mockClient))
  };
  
  return { 
    Pool: jest.fn(() => mockPool)
  };
});

describe('Database Transaction Tests', () => {
  let mockClient;
  let mockPool;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get references to the mocks created by Jest
    mockPool = require('pg').Pool();
    mockClient = { 
      query: jest.fn(),
      release: jest.fn()
    };
    mockPool.connect.mockResolvedValue(mockClient);
  });
  
  test('should commit transaction on success', async () => {
    // Mock the client's query method to return what we want
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve();
      }
      // For custom queries in the callback
      return Promise.resolve({ rows: [{ result: 'success' }] });
    });
    
    const callback = jest.fn(async (client) => {
      // Simulate a successful query
      await client.query('SELECT * FROM test');
      return { result: 'success' };
    });
    
    const result = await runQuery(callback);
    
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(callback).toHaveBeenCalledWith(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
    expect(result).toEqual({ result: 'success' });
  });
  
  test('should rollback transaction on error', async () => {
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN' || query === 'ROLLBACK') {
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    
    const testError = new Error('Test error');
    const callback = jest.fn(() => Promise.reject(testError));
    
    await expect(runQuery(callback)).rejects.toThrow('Test error');
    
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(callback).toHaveBeenCalledWith(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
  
  test('should release client even if commit fails', async () => {
    let commitQuery = false;
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN') {
        return Promise.resolve();
      }
      if (query === 'COMMIT') {
        commitQuery = true;
        return Promise.reject(new Error('Commit failed'));
      }
      return Promise.resolve();
    });
    
    const callback = jest.fn(() => Promise.resolve({ result: 'success' }));
    
    await expect(runQuery(callback)).rejects.toThrow('Commit failed');
    expect(commitQuery).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });
});