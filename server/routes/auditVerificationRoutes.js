const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/checkPermission');
const controller = require('../controllers/auditVerificationController');

const router = express.Router();
router.use(authMiddleware);

const canAudit = requireAnyPermission([
    'billing.logs.view',
    'billing.monthly_summary.view',
]);

// Verify reconciliation snapshot integrity
// GET /api/audit/reconciliation/:reconciliationId/verify
router.get(
    '/reconciliation/:reconciliationId/verify',
    canAudit,
    controller.verifyReconciliationSnapshot
);

// Check audit log completeness for a reseller
// GET /api/audit/reseller/:resellerId/log-completeness?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
router.get(
    '/reseller/:resellerId/log-completeness',
    canAudit,
    controller.checkAuditLogCompleteness
);

// Run full financial integrity check for a reseller/month
// GET /api/audit/reseller/:resellerId/integrity-check?month=YYYY-MM
router.get(
    '/reseller/:resellerId/integrity-check',
    canAudit,
    controller.runIntegrityCheck
);

// Get financial health summary (all partners or single)
// GET /api/audit/financial-health
// GET /api/audit/financial-health/:resellerId
router.get(
    '/financial-health',
    canAudit,
    (req, res) => {
        req.params.resellerId = null;
        controller.getFinancialHealthSummary(req, res);
    }
);

router.get(
    '/financial-health/:resellerId',
    canAudit,
    controller.getFinancialHealthSummary
);

// Get raw audit log entries
// GET /api/audit/reseller/:resellerId/log?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=50
router.get(
    '/reseller/:resellerId/log',
    canAudit,
    controller.getAuditLog
);

module.exports = router;
