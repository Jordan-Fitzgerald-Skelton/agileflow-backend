const { executeTransaction } = require('../utils/db');

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn(),
  };
  return {
    Pool: jest.fn(() => mPool),
    Client: jest.fn(() => mClient),
  };
});

describe('Database Transaction Tests', () => {
  let mockClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = require('pg').Pool().connect();
  });
  
  test('should commit transaction on success', async () => {
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve();
      }
      return Promise.resolve({ rows: [{ result: 'success' }] });
    });
    
    const callback = jest.fn(() => Promise.resolve({ result: 'success' }));
    const result = await executeTransaction(callback);
    
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(callback).toHaveBeenCalledWith(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
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
    
    await expect(executeTransaction(callback)).rejects.toThrow('Test error');
    
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(callback).toHaveBeenCalledWith(mockClient);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
  
  test('should release client even if commit fails', async () => {
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN') {
        return Promise.resolve();
      }
      if (query === 'COMMIT') {
        return Promise.reject(new Error('Commit failed'));
      }
      return Promise.resolve();
    });
    
    const callback = jest.fn(() => Promise.resolve({ result: 'success' }));
    
    await expect(executeTransaction(callback)).rejects.toThrow('Commit failed');
    expect(mockClient.release).toHaveBeenCalled();
  });
});