const { query } = require('../db/db');

//Generate a random invite code
const generateInviteCode = (length = 8) => {
    return Math.random().toString(36).substr(2, length);
};

//Creates a room in the database
const createRoom = async (req, res) => {
    const { roomId } = req.body;

    //Validates the input
    if (!roomId) {
        return res.status(400).json({ message: 'Room ID is required' });
    }
    // Generate an invite code
    const inviteCode = generateInviteCode();
    try {
        //Inserts the room_id and invite_code into the database
        const result = await query(
            'INSERT INTO room (room_id, invitecode) VALUES ($1, $2) RETURNING *',
            [roomId, inviteCode]
        );
        const newRoom = result[0];
        //Responds with success and the rooms data
        res.status(201).json({
            message: 'Room created successfully',
            room: newRoom,
            inviteCode: newRoom.invitecode,
        });
    //Error handeling 
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ message: 'Error creating room' });
    }
};

const joinRoom = async (req, res) => {
    const { inviteCode } = req.body;
    if (!inviteCode) {
        return res.status(400).json({ message: 'Invite code is required' });
    }

    try {
        const result = await query(
            'SELECT * FROM room WHERE invitecode = $1',
            [inviteCode]
        );
        if (result.length === 0) {
            return res.status(404).json({ message: 'Room not found' });
        }
        res.status(200).json({ message: 'Successfully joined the room', room: result[0] });
    } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({ message: 'Error joining room' });
    }
};

module.exports = { createRoom, joinRoom };
