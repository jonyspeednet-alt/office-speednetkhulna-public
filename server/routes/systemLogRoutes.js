const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getSystemLogs } = require('../controllers/systemLogController');
const { requirePermission } = require('../middleware/checkPermission');

const router = express.Router();

router.get('/', authMiddleware, requirePermission('audit.system_logs.view'), getSystemLogs);

module.exports = router;
