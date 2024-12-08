const express = require('express');
const { createRoom } = require('../controllers/roomController');
const { requiresAuth } = require('express-openid-connect');

const router = express.Router();

// Room routes
router.post('/rooms', createRoom);

// Auth routes
router.get('/protected', requiresAuth(), (req, res) => {
    res.json({ message: 'Protected data', user: req.oidc.user });
});

module.exports = router;