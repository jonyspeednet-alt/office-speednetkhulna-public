const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');

router.get('/', authMiddleware, requirePermission('menus.manage'), menuController.getMenus);
router.post('/', authMiddleware, requirePermission('menus.manage'), menuController.saveMenu);
router.post('/order', authMiddleware, requirePermission('menus.manage'), menuController.updateMenuOrder);
router.delete('/:id', authMiddleware, requirePermission('menus.manage'), menuController.deleteMenu);

module.exports = router;
