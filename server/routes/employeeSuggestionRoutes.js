const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/employeeSuggestionController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.saveSuggestion);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMySuggestions);
router.get('/:id', ctrl.getSuggestionById);
router.put('/:id', ctrl.updateSuggestion);
router.delete('/:id', ctrl.deleteSuggestion);

module.exports = router;
