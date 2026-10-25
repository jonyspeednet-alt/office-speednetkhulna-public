const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/noDuesCertificateController');

router.use(authMiddleware);
router.use(requirePermission('appointment_letters.generate'));

router.post('/', ctrl.saveCertificate);
router.get('/next-numbers', ctrl.getNextNumbers);
router.get('/', ctrl.getMyCertificates);
router.get('/:id', ctrl.getCertificateById);
router.put('/:id', ctrl.updateCertificate);
router.delete('/:id', ctrl.deleteCertificate);

module.exports = router;
