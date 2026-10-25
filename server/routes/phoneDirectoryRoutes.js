const express = require('express');
const router = express.Router();
const controller = require('../controllers/phoneDirectoryController');
const authMiddleware = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');

router.get('/', authMiddleware, requireAnyPermission(['phone_directory.view', 'users.manage']), controller.getPhones);
router.post('/', authMiddleware, requirePermission('users.manage'), controller.addPhone);
router.put('/:id', authMiddleware, requirePermission('users.manage'), controller.updatePhone);
router.delete('/:id', authMiddleware, requirePermission('users.manage'), controller.deletePhone);
router.get('/export', authMiddleware, requireAnyPermission(['phone_directory.view', 'users.manage']), controller.exportPhones);
router.get('/users', authMiddleware, requirePermission('users.manage'), controller.getUsersForDropdown);

module.exports = router;
