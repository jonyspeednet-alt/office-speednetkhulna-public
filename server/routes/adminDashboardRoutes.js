const express = require('express');
const router = express.Router();
const adminDashboardController = require('../controllers/adminDashboardController');
const authMiddleware = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/checkPermission');

// Route: GET /api/dashboard/admin
router.get(
  '/',
  authMiddleware,
  requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']),
  adminDashboardController.getAdminDashboardData
);

module.exports = router;
