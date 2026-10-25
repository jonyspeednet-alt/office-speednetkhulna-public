const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authMiddleware = require('../middleware/auth');
const requireFreshAuth = (req, res, next) => {
    req.requireFreshAuth = true;
    next();
};

// Route: GET /api/profile (Logged in user)
router.get('/', requireFreshAuth, authMiddleware, profileController.getUserProfile);

// Route: GET /api/profile/:id (Specific user)
router.get('/:id', requireFreshAuth, authMiddleware, profileController.getUserProfile);

module.exports = router;
