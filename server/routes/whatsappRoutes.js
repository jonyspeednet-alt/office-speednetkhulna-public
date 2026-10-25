const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/checkPermission');
const whatsappController = require('../controllers/whatsappController');

router.get('/status', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.getWhatsAppStatus);
router.get('/qr', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.getWhatsAppQr);
router.post('/start', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.startWhatsApp);
router.post('/reconnect', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.reconnectWhatsApp);
router.post('/stop', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.stopWhatsApp);
router.post('/test', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.sendWhatsAppTest);
router.post('/test-image', authMiddleware, requireAnyPermission(['users.manage', 'leave.manage', 'reports.view']), whatsappController.sendWhatsAppTestImage);

module.exports = router;
