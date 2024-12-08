const { query } = require('../db/db'); // Import database query function

// Create a room in the database
const createRoom = async (req, res) => {
    const { name, adminId, persistent } = req.body;

    // Validate input
    if (!name || !adminId) {
        return res.status(400).json({ message: 'Name and adminId are required' });
    }

    try {
        // Insert the new room into the database
        const result = await query(
            'INSERT INTO rooms (name, admin_id, persistent) VALUES ($1, $2, $3) RETURNING *',
            [name, adminId, persistent || false]
        );

        const newRoom = result[0]; // Assuming the result returns an array with the inserted room
        res.status(201).json({ message: 'Room created successfully', room: newRoom });
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ message: 'Error creating room' });
    }
};

module.exports = { createRoom};
