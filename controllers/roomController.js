
const rooms = [];


const createRoom = (req, res) => {
    const { name, adminId, persistent } = req.body;

    if (!name || !adminId) {
        return res.status(400).json({ message: 'Name and adminId are required' });
    }

    const newRoom = {
        id: rooms.length + 1,
        name,
        adminId,
        persistent: persistent || false,
    };

    rooms.push(newRoom);
    res.status(201).json({ message: 'Room created successfully', room: newRoom });
};

module.exports = { createRoom };