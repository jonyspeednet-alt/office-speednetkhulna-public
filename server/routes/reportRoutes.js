const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');

// Route: GET /api/reports/leave-summary
router.get('/leave-summary', authMiddleware, requirePermission('reports.view'), reportController.getLeaveSummaryReport);

module.exports = router;
