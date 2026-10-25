const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const controller = require('../controllers/internetRegistrationController');
const { requirePermission } = require('../middleware/checkPermission');

router.get('/', authMiddleware, controller.getRegistrations);
router.get('/branches', authMiddleware, controller.getBranches);
router.get('/packages', authMiddleware, controller.getPackages);
router.get('/free-ids', authMiddleware, controller.getAvailableFreeIds);
router.post('/free-ids/bulk', authMiddleware, requirePermission('support.router.manage'), controller.createFreeIdsBulk);
router.post('/free-ids', authMiddleware, requirePermission('support.router.manage'), controller.createFreeIds);
router.post('/', authMiddleware, controller.createRegistration);

module.exports = router;
