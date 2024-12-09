const express = require('express');
const { createRoom } = require('../controllers/roomController');

const router = express.Router();

// Room routes
router.post('/rooms', createRoom);

// Example of a public route
router.get('/', (req, res) => {
  res.send('This is a public route');
});

module.exports = router;