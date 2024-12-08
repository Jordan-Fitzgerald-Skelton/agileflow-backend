// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { auth } = require('express-openid-connect');
require('dotenv').config();

// Import consolidated API routes
const apiRoutes = require('./routes/APIroutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
});

// Middleware
app.use(cors());
app.use(express.json());

// Auth0 Configuration
const authConfig = {
    authRequired: false,
    auth0Logout: true,
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_DOMAIN,
    secret: process.env.AUTH0_SECRET,
};

// Apply Auth0 middleware
app.use(auth(authConfig));

// Register API routes
app.use('/api', apiRoutes);

// WebSocket Events
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User joined room: ${roomId}`);
        socket.to(roomId).emit('new-user', `User ${socket.id} has joined`);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
    });
});

// Start the Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});