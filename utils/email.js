const nodemailer = require('nodemailer');

//sets up the nodemailer(Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.APP_EMAIL,
    pass: process.env.APP_PASS,
  },
});

//creates and sends the email
const sendActionNotification = async ({ email, userName, description }) => {
  return new Promise((resolve) => {
    const mailOptions = {
      from: process.env.APP_EMAIL,
      to: email,
      subject: "New Action Item Assigned",
      text: `Hello ${userName},\n\nYou have been assigned a new action item:\n\n${description}\n\Kind Regards,\nAgileFlow Team`,
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

//exports everything to the server
module.exports = {
  transporter,
  sendActionNotification
};