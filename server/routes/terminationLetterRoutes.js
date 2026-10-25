const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/terminationLetterController');

router.use(authMiddleware);
router.use(requirePermission('termination_letters.generate'));

router.post('/', ctrl.saveLetter);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyLetters);
router.get('/:id', ctrl.getLetterById);
router.put('/:id', ctrl.updateLetter);
router.delete('/:id', ctrl.deleteLetter);

module.exports = router;
