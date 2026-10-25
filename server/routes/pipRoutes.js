const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/pipController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.savePip);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyPips);
router.get('/:id', ctrl.getPipById);
router.put('/:id', ctrl.updatePip);
router.delete('/:id', ctrl.deletePip);

module.exports = router;
