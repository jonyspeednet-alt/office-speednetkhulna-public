const express = require('express');
const router = express.Router();
const sidebarController = require('../controllers/sidebarController');
const authMiddleware = require('../middleware/auth');

// Route: GET /api/sidebar
router.get('/', authMiddleware, sidebarController.getSidebarData);

module.exports = router;