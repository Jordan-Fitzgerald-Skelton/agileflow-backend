const express = require('express');
const authRoutes = require('./routes/auth'); // Import the auth.js route file

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request body (built-in to Express)
app.use(express.json());

// Use the auth routes for any request starting with '/auth'
app.use('/auth', authRoutes);

// check if the server is running
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});