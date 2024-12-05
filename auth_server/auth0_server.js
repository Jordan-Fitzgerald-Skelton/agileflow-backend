const express = require('express');
const { auth, requiresAuth } = require('express-openid-connect');
const authRoutes = require('./routes/auth'); // Assuming auth.js is in routes folder

const app = express();

const config = {
  authRequired: false, // Allow public access to some routes
  auth0Logout: true,  // Redirect to Auth0 for logout
  baseURL: 'http://localhost:3000', // Adjust based on your setup
  clientID: 'UoUzOQqKZxB5EfLeRE1QvTcxieDnXsQ5', // Your Auth0 client ID
  issuerBaseURL: 'https://dev-cvqtn67vc7nb5ucq.us.auth0.com', // Your Auth0 domain
  secret: 'LONG_RANDOM_STRING' // Secret for session encryption
};

// Apply Auth0 authentication middleware
app.use(auth(config));

// Public route to check login status
app.get('/', (req, res) => {
  res.send(req.oidc.isAuthenticated() ? 'Logged in' : 'Logged out');
});

// Protected route to show user profile
app.get('/profile', requiresAuth(), (req, res) => {
  res.send(JSON.stringify(req.oidc.user, null, 2));
});

// Include your existing protected routes
app.use('/api/auth', authRoutes); 

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});