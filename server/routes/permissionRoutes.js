const express = require('express');
const router = express.Router();
const permissionController = require('../controllers/permissionController');
const authMiddleware = require('../middleware/auth'); // Your auth middleware
const { requirePermission } = require('../middleware/checkPermission');
const requireFreshAuth = (req, res, next) => {
    req.requireFreshAuth = true;
    next();
};

// Route: POST /api/permissions/update
router.post('/update', authMiddleware, requirePermission('permissions.manage'), permissionController.updatePermission);

// Route: GET /api/permissions/manage
router.get('/manage', requireFreshAuth, authMiddleware, requirePermission('permissions.manage'), permissionController.getManagePermissionsData);

module.exports = router;
