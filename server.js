const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const apiRoutes = require('./routes/APIroutes');

const app = express();
const http = require('http');
const server = http.createServer(app);

//Attachs the Socket.io server to the HTTP server
const io = new Server(server, {
    cors: { origin: '*' },
});

//Middleware
app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

const rooms = {};

//Generates a random invite code
function generateInviteCode(length = 8) {
    return Math.random().toString(36).substr(2, length);
}

// WebSocket Events
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    //Create a room with an invite code
    socket.on('createRoom', (roomId) => {
        //Validates that the room doesn't already exist
        if (rooms[roomId]) {
            socket.emit('error', `Room ${roomId} already exists.`);
            return;
        }
        //Gets a random ivite code
        const inviteCode = generateInviteCode();
        //Creates the room
        rooms[roomId] = {
            participants: { [socket.id]: true },
            inviteCode: inviteCode,
        };
        // Join the room
        socket.join(roomId);
        //Provides the invite code to the user
        socket.emit('roomCreated', {
            message: `Room ${roomId} created successfully.`,
            inviteCode: inviteCode,
        });
        console.log(`Room ${roomId} created with invite code: ${inviteCode}`);
    });

    //Join Room with an invite code
    socket.on('joinByInvite', (inviteCode) => {
        //Find the room using the invite code
        const roomId = Object.keys(rooms).find((roomId) => rooms[roomId].inviteCode === inviteCode);
        //Validation for the invite codes
        if (!roomId) {
            socket.emit('error', 'Invalid invite code.');
            return;
        }
        socket.join(roomId);
        rooms[roomId].participants[socket.id] = true;
        //Creates a message to say you have joined a room
        socket.emit('joinedRoom', `You have successfully joined room ${roomId}.`);
        //Creates an entry in the log to say you joined 
        console.log(`User ${socket.id} joined room ${roomId} using invite code.`);
    });

    //User disconnects
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        for (const roomId in rooms) {
            if (rooms[roomId].participants[socket.id]) {
                delete rooms[roomId].participants[socket.id];
                socket.to(roomId).emit('user-disconnected', socket.id);
            }
        }
    });
});

//Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});