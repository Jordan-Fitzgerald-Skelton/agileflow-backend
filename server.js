const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const apiRoutes = require('./routes/APIroutes');

const app = express();
const http = require('http');
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*' },
});

//Middleware
app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

const rooms = {};

//generates a random invite code
function generateInviteCode(length = 8) {
    return Math.random().toString(36).substr(2, length);
}

//websocket events
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    //create a room with an invite code
    socket.on('createRoom', (roomId) => {
        //checks that the room doesn't already exist
        if (rooms[roomId]) {
            socket.emit('error', `Room ${roomId} already exists.`);
            return;
        }
        //gets a random ivite code
        const inviteCode = generateInviteCode();
        //creates the room
        rooms[roomId] = {
            participants: { [socket.id]: true },
            inviteCode: inviteCode,
        };
        //joins the room
        socket.join(roomId);
        //provides the invite code to the user
        socket.emit('roomCreated', {
            message: `Room ${roomId} created successfully.`,
            inviteCode: inviteCode,
        });
        console.log(`Room ${roomId} created with invite code: ${inviteCode}`);
    });

    //joining a room with an invite code
    socket.on('joinByInvite', (inviteCode) => {
        //finds the room using the invite code
        const roomId = Object.keys(rooms).find((roomId) => rooms[roomId].inviteCode === inviteCode);
        if (!roomId) {
            socket.emit('error', 'Invalid invite code.');
            return;
        }
        socket.join(roomId);
        rooms[roomId].participants[socket.id] = true;
        socket.emit('joinedRoom', `You have successfully joined room ${roomId}.`);
        console.log(`User ${socket.id} joined room ${roomId} using invite code.`);
    });

    //for when a user disconnects
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

//start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});