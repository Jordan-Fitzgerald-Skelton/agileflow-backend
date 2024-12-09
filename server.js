const express = require('express');
const https = require('https'); // Import https module
const fs = require('fs'); // Import file system module
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

// Import consolidated API routes
const apiRoutes = require('./routes/APIroutes');

const app = express();

// Load SSL certificates
const sslOptions = {
    key: fs.readFileSync('./ssl/key.pem'),
    cert: fs.readFileSync('./ssl/cert.pem'),
};

// Create HTTPS server
const server = https.createServer(sslOptions, app);

// Attach Socket.io to the HTTPS server
const io = new Server(server, {
    cors: { origin: '*' },
});

// Middleware
app.use(cors());
app.use(express.json());

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

// Start the HTTPS server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Secure server is running at https://localhost:${PORT}`);
});