const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/meetingMinutesController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.saveMinutes);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyMinutes);
router.get('/:id', ctrl.getMinutesById);
router.put('/:id', ctrl.updateMinutes);
router.delete('/:id', ctrl.deleteMinutes);

module.exports = router;
