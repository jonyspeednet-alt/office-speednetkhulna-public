const express = require('express');
const router = express.Router();
const officeWorkController = require('../controllers/officeWorkController');
const authMiddleware = require('../middleware/auth');

// Route: GET /api/office-work - Get all work entries for current user
router.get('/', authMiddleware, officeWorkController.getWorkEntries);

// Route: POST /api/office-work - Add new work entry
router.post('/', authMiddleware, officeWorkController.addWorkEntry);

// Route: GET /api/office-work/performance/summary - Admin/HR summary
router.get('/performance/summary', authMiddleware, officeWorkController.getWorkPerformanceSummary);
router.get('/performance/kpi-targets', authMiddleware, officeWorkController.getWorkKpiTargets);
router.post('/performance/kpi-targets', authMiddleware, officeWorkController.upsertWorkKpiTarget);

// Route: PUT /api/office-work/:id - Update work entry
router.put('/:id', authMiddleware, officeWorkController.updateWorkEntry);

// Route: PUT /api/office-work/:id/toggle - Toggle completion status
router.put('/:id/toggle', authMiddleware, officeWorkController.toggleWorkEntry);

// Route: DELETE /api/office-work/:id - Delete work entry
router.delete('/:id', authMiddleware, officeWorkController.deleteWorkEntry);

// Route: POST /api/office-work/:id/sessions - Add session under a task
router.post('/:id/sessions', authMiddleware, officeWorkController.addWorkSession);

module.exports = router;
