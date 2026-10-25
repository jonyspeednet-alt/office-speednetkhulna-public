const express = require('express');
const authMiddleware = require('../middleware/auth');
const { listAuditLogs } = require('../controllers/auditLogController');
const { requirePermission } = require('../middleware/checkPermission');

const router = express.Router();

router.get('/', authMiddleware, requirePermission('audit.system_logs.view'), listAuditLogs);

module.exports = router;
