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

// Sanitize text content
const sanitizeText = (text) => {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '')
             .replace(/&/g, '&amp;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#39;')
             .replace(/\s+/g, ' ')
             .trim()
             .substring(0, 1000);
};

// Initialize email configuration
let transporter;

const initializeEmailTransporter = () => {
  try {
    validateEmailConfig();
    
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.APP_EMAIL,
        pass: process.env.APP_PASS,
      },
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

// Simple email sending function
const sendActionNotification = async ({ email, userName, description }) => {
  try {
    // Basic validation
    if (!email || !userName || !description) {
      throw new Error('Missing required fields: email, userName, and description are required');
    }

    if (!isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    if (!transporter) {
      throw new Error('Email transporter not initialized');
    }

    // Sanitize inputs
    const sanitizedUserName = sanitizeText(userName);
    const sanitizedDescription = sanitizeText(description);

    if (!sanitizedUserName || !sanitizedDescription) {
      throw new Error('Invalid or empty content after sanitization');
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

    const info = await transporter.sendMail(mailOptions);
    
    console.log(`[EMAIL] Email sent successfully to ${email}:`, info.messageId);
    
    return {
      success: true,
      messageId: info.messageId
    };

  } catch (error) {
    console.error(`[EMAIL] Failed to send email to ${email}:`, error.message);
    throw error;
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

module.exports = {
  sendActionNotification,
  closeEmailService,
  isValidEmail
};
