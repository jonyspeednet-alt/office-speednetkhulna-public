const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/employeeOfTheYearController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.saveRecord);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyRecords);
router.get('/:id', ctrl.getRecordById);
router.put('/:id', ctrl.updateRecord);
router.delete('/:id', ctrl.deleteRecord);

module.exports = router;
