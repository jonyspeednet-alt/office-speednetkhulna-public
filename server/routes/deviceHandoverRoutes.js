const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/deviceHandoverController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.saveForm);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyForms);
router.get('/:id', ctrl.getFormById);
router.put('/:id', ctrl.updateForm);
router.delete('/:id', ctrl.deleteForm);

module.exports = router;
