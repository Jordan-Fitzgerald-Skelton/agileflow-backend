const express = require('express');
const { requiresAuth } = require('express-openid-connect');
const router = express.Router();

const { requiresAuth } = require('express-openid-connect');

router.get('/protected', requiresAuth(), (req, res) => {
  res.json({ message: 'Protected data', user: req.oidc.user });
});

module.exports = router;