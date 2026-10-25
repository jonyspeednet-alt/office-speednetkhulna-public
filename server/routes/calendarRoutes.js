const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');
const authMiddleware = require('../middleware/auth');

// Route: GET /api/calendar/events
router.get('/events', authMiddleware, calendarController.getLeaveEvents);

module.exports = router;