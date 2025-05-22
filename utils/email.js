const nodemailer = require('nodemailer');

// Validate required environment variables
const validateEmailConfig = () => {
  const required = ['APP_EMAIL', 'APP_PASS'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required email environment variables: ${missing.join(', ')}`);
  }
};

// Validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Sanitize text content to prevent injection
const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  // Remove potential HTML/script tags and normalize whitespace
  return text.replace(/<[^>]*>/g, '')
             .replace(/\s+/g, ' ')
             .trim()
             .substring(0, 1000); // Limit length
};

// Rate limiting for email sending
const emailRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_EMAILS_PER_WINDOW = 10;

const checkRateLimit = (email) => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!emailRateLimit.has(email)) {
    emailRateLimit.set(email, []);
  }
  
  const timestamps = emailRateLimit.get(email);
  // Remove old timestamps
  const recentTimestamps = timestamps.filter(timestamp => timestamp > windowStart);
  
  if (recentTimestamps.length >= MAX_EMAILS_PER_WINDOW) {
    return false;
  }
  
  recentTimestamps.push(now);
  emailRateLimit.set(email, recentTimestamps);
  return true;
};

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  emailRateLimit.forEach((timestamps, email) => {
    const recentTimestamps = timestamps.filter(timestamp => timestamp > windowStart);
    if (recentTimestamps.length === 0) {
      emailRateLimit.delete(email);
    } else {
      emailRateLimit.set(email, recentTimestamps);
    }
  });
}, RATE_LIMIT_WINDOW);

// Initialize email configuration
let transporter;

const initializeEmailTransporter = () => {
  try {
    validateEmailConfig();
    
    transporter = nodemailer.createTransporter({
      service: "gmail",
      auth: {
        user: process.env.APP_EMAIL,
        pass: process.env.APP_PASS,
      },
      pool: true, // Use connection pooling
      maxConnections: 5,
      maxMessages: 100,
    });

    // Verify transporter configuration
    transporter.verify((error, success) => {
      if (error) {
        console.error('[EMAIL] Transporter verification failed:', error);
      } else {
        console.log('[EMAIL] Email service is ready to send messages');
      }
    });

    return transporter;
  } catch (error) {
    console.error('[EMAIL] Failed to initialize email transporter:', error);
    throw error;
  }
};

// Initialize transporter on module load
try {
  initializeEmailTransporter();
} catch (error) {
  console.error('[EMAIL] Email service initialization failed:', error);
}

// Creates and sends the email with proper error handling
const sendActionNotification = async ({ email, userName, description }) => {
  try {
    // Input validation
    if (!email || !userName || !description) {
      throw new Error('Missing required fields: email, userName, and description are required');
    }

    if (!isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check rate limiting
    if (!checkRateLimit(email)) {
      throw new Error('Rate limit exceeded. Too many emails sent to this address recently.');
    }

    // Sanitize inputs
    const sanitizedUserName = sanitizeText(userName);
    const sanitizedDescription = sanitizeText(description);

    if (!sanitizedUserName || !sanitizedDescription) {
      throw new Error('Invalid or empty content after sanitization');
    }

    if (!transporter) {
      throw new Error('Email transporter not initialized');
    }

    const mailOptions = {
      from: process.env.APP_EMAIL,
      to: email,
      subject: "New Action Item Assigned",
      text: `Hello ${sanitizedUserName},

You have been assigned a new action item:

${sanitizedDescription}

Kind Regards,
AgileFlow Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>New Action Item Assigned</h2>
          <p>Hello <strong>${sanitizedUserName}</strong>,</p>
          <p>You have been assigned a new action item:</p>
          <div style="background-color: #f5f5f5; padding: 15px; margin: 10px 0; border-left: 4px solid #007cba;">
            ${sanitizedDescription}
          </div>
          <p>Kind Regards,<br>AgileFlow Team</p>
        </div>
      `
    };

    // Send email with promise-based approach
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`[EMAIL] Email sent successfully to ${email}:`, info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };

  } catch (error) {
    console.error(`[EMAIL] Failed to send email to ${email}:`, error.message);
    
    // Re-throw the error so calling code can handle it appropriately
    throw new Error(`Email sending failed: ${error.message}`);
  }
};

// Graceful shutdown function
const closeEmailService = async () => {
  if (transporter) {
    try {
      transporter.close();
      console.log('[EMAIL] Email service closed gracefully');
    } catch (error) {
      console.error('[EMAIL] Error closing email service:', error);
    }
  }
};

// Handle process termination
process.on('SIGTERM', closeEmailService);
process.on('SIGINT', closeEmailService);

module.exports = {
  transporter,
  sendActionNotification,
  closeEmailService,
  isValidEmail
};
