const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.APP_EMAIL,
    pass: process.env.APP_PASS,
  },
});

/**
 * Send an email notification for an action item
 * @param {Object} options
 * @param {string} options.email - Recipient email address
 * @param {string} options.userName - User's name
 * @param {string} options.description - Action item description
 * @returns {Promise<void>}
 */
const sendActionNotification = async ({ email, userName, description }) => {
  return new Promise((resolve) => {
    const mailOptions = {
      from: process.env.APP_EMAIL,
      to: email,
      subject: "New Action Item Assigned",
      text: `Hello ${userName},\n\nYou have been assigned a new action item:\n\n${description}\n\nBest Regards,\nAgileFlow Team`,
    };
    
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("Error sending email:", err);
      } else {
        console.log("Email sent:", info.response);
      }
      resolve();
    });
  });
};

module.exports = {
  transporter,
  sendActionNotification
};