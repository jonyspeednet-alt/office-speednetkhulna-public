const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');
const authMiddleware = require('../middleware/auth'); // Your auth middleware
const { requirePermission } = require('../middleware/checkPermission');

// Route: GET /api/leaves
router.get('/', authMiddleware, requirePermission('leave.manage'), leaveController.getLeaveRequests);

// Route: PUT /api/leaves/:id/status
router.put('/:id/status', authMiddleware, requirePermission('leave.manage'), leaveController.updateLeaveStatus);

// Route: PATCH /api/leaves/:id/end-date (early return)
router.patch('/:id/end-date', authMiddleware, requirePermission('leave.manage'), leaveController.updateLeaveEndDate);

// Backward compatibility for legacy frontend links:
// /api/leaves/generate-approval/:id  -> /approval/:id (SPA route)
router.get('/generate-approval/:id', authMiddleware, (req, res) => {
  const id = encodeURIComponent(String(req.params.id || '').trim());
  return res.redirect(302, `/approval/${id}`);
});

module.exports = router;
