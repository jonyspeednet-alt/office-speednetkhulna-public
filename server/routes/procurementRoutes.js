const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listPurchaseOrders,
  getPurchaseOrderDetails,
  createPurchaseOrder,
  updatePOStatus
} = require('../controllers/procurementController');
const { requirePermission } = require('../middleware/checkPermission');

const router = express.Router();

router.use(authMiddleware);

router.get('/', requirePermission('procurement.manage'), listPurchaseOrders);
router.post('/', requirePermission('procurement.manage'), createPurchaseOrder);
router.get('/:id', requirePermission('procurement.manage'), getPurchaseOrderDetails);
router.patch('/:id/status', requirePermission('procurement.manage'), updatePOStatus);

module.exports = router;
