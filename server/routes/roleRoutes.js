const express = require('express');
const router = express.Router();
const { getRoles, saveRole, deleteRole, assignRoleToUser } = require('../controllers/roleController');
const authMiddleware = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');

// Role LIST is read-only: HR / profile editors need it for the Edit form,
// but role create/edit/delete/assign stay on permissions.manage only
// (assign can hand out Admin — never widen that gate).
router.get('/', authMiddleware, requireAnyPermission(['permissions.manage', 'users.manage', 'users.edit.any', 'employees.create_edit']), getRoles);

router.use(authMiddleware, requirePermission('permissions.manage'));

router.post('/save', saveRole);
router.delete('/:id', deleteRole);
router.post('/assign', assignRoleToUser);

module.exports = router;
