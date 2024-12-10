const express = require('express');
const { createRoom, joinRoom } = require('../controllers/roomController');

const router = express.Router();

//Room routes
router.post('/rooms', createRoom);
router.post('/rooms/join', joinRoom);

//Public route
router.get('/', (req, res) => {
  res.send('This is a public route');
});

module.exports = router;