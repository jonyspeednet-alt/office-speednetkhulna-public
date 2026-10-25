const express = require('express');
const router = express.Router();
const entitlementController = require('../controllers/entitlementController');
const authMiddleware = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/checkPermission');

const canManageEntitlements = requireAnyPermission(['leave.entitlements.manage', 'leave.manage']);

router.get('/', authMiddleware, canManageEntitlements, entitlementController.getEntitlementsData);
router.post('/', authMiddleware, canManageEntitlements, entitlementController.addEntitlement);
router.put('/:id', authMiddleware, canManageEntitlements, entitlementController.updateEntitlement);
router.delete('/:id', authMiddleware, canManageEntitlements, entitlementController.deleteEntitlement);

module.exports = router;
