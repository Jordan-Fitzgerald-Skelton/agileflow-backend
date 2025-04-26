const nodemailer = require("nodemailer");

const mockSendMail = jest.fn((mailOptions, callback) => callback(null, { response: 'Email sent' }));
const mockTransport = { sendMail: mockSendMail };

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => mockTransport)
}));

console.error = jest.fn();

const { sendActionNotification } = require("../utils/email");

describe("Email tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test("should send action email", async () => {
    await sendActionNotification({
      email: 'test@example.com',
      userName: 'Test User',
      description: 'Complete this task'
    });
    
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining('Action Item'),
        text: expect.stringContaining('Complete this task')
      }),
      expect.any(Function)
    );
  });
  
  test("should handle email sending failure", async () => {
    const mockError = new Error('Email sending failed');
    
    //reset for this test
    mockSendMail.mockImplementationOnce((mailOptions, callback) => {
      callback(mockError, null);
    });
    
    await sendActionNotification({
      email: 'test@example.com',
      userName: 'Test User',
      description: 'Complete this task'
    });
    
    expect(console.error).toHaveBeenCalledWith(
      "Error sending email:",
      mockError
    );
  });
});