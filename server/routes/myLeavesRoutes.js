const express = require('express');
const router = express.Router();
const myLeavesController = require('../controllers/myLeavesController');
const authMiddleware = require('../middleware/auth');

// Route: GET /api/my-leaves
router.get('/', authMiddleware, myLeavesController.getMyLeaves);

module.exports = router;