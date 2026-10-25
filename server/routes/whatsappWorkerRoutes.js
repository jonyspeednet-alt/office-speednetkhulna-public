const express = require('express');
const router = express.Router();
const controller = require('../controllers/whatsappWorkerController');

router.use(controller.requireWorkerApiKey);
router.get('/jobs/next', controller.getNextWorkerJob);
router.post('/jobs/next', controller.getNextWorkerJob);
router.post('/jobs/:id/complete', controller.completeWorkerJob);
router.post('/jobs/:id/fail', controller.failWorkerJob);
router.post('/state', controller.syncWorkerState);

module.exports = router;
