const express = require('express');
const path = require('path');
const router = express.Router();
const ctrl = require('../controllers/routeVisitController');
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const { upload, resizeAndSave } = require('../middleware/uploadMiddleware');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'route_visits');
require('fs').mkdirSync(uploadDir, { recursive: true });

// Plans
router.get('/routes', authMiddleware, ctrl.listRoutes);
router.post('/routes', authMiddleware, ctrl.createRoute);

// Visits (photo optional single file field "photo")
router.get('/', authMiddleware, ctrl.listVisits);
router.post('/', authMiddleware, upload.single('photo'), resizeAndSave(uploadDir, 'route-visit'), ctrl.createVisit);
router.put('/:id', authMiddleware, upload.single('photo'), resizeAndSave(uploadDir, 'route-visit'), ctrl.updateVisit);
router.patch('/:id/verify', authMiddleware, requirePermission('route_visit.verify'), ctrl.verifyVisit);

// Reports + targets
router.get('/reports/daily', authMiddleware, ctrl.dailyReport);
router.get('/reports/monthly', authMiddleware, ctrl.monthlyReport);
router.get('/targets', authMiddleware, ctrl.listTargets);
router.post('/targets', authMiddleware, requirePermission('route_visit.verify'), ctrl.upsertTarget);

module.exports = router;
