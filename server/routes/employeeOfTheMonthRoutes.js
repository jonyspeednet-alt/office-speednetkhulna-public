const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/checkPermission');
const controller = require('../controllers/employeeOfTheMonthController');

router.use(authMiddleware);
// Every signed-in employee can see the latest winner announcement.
router.get('/latest', controller.getLatestAward);
router.use(requireAnyPermission([
  'appointment_letters.generate',
  'termination_letters.generate',
  'employees.create_edit',
  'users.manage',
]));
router.get('/', controller.listAwards);
router.put('/:awardMonth', controller.saveAward);
router.delete('/:awardMonth', controller.deleteAward);

module.exports = router;
