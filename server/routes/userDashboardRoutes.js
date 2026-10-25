const express = require('express');
const router = express.Router();
const userDashboardController = require('../controllers/userDashboardController');
const authMiddleware = require('../middleware/auth');

// Route: GET /api/dashboard/user
router.get('/user', authMiddleware, userDashboardController.getUserDashboardData);

module.exports = router;