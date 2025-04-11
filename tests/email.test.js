const nodemailer = require('nodemailer');

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn((mailOptions, callback) => callback(null, { response: 'Email sent' })),
  })),
}));

const { sendActionNotification } = require('../utils/email');

describe('Email Notification Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('should send action notification email', async () => {
    const mockTransport = nodemailer.createTransport();
    
    await sendActionNotification({
      email: 'test@example.com',
      userName: 'Test User',
      description: 'Complete this task'
    });
    
    expect(mockTransport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining('Action Item'),
        text: expect.stringContaining('Complete this task')
      }),
      expect.any(Function)
    );
  });
  
  test('should handle email sending failure', async () => {
    const mockError = new Error('Email sending failed');
    
    const mockTransport = nodemailer.createTransport();
    mockTransport.sendMail.mockImplementationOnce((mailOptions, callback) => {
      callback(mockError, null);
    });
    
    await expect(sendActionNotification({
      email: 'test@example.com',
      userName: 'Test User',
      description: 'Complete this task'
    })).resolves.not.toThrow();
    
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error sending email'),
      mockError
    );
  });
});