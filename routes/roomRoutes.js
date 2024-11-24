const express = require('express');
const { createRoom } = require('../controllers/roomController');
const router = express.Router();

// POST /api/rooms
router.post('/', createRoom);

module.exports = router;