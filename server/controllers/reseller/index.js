// DEAD CODE — this router is NOT mounted anywhere (routes/index.js mounts
// resellerRoutes.js instead). Do NOT mount without fixing: pool.connect()
// with no release() in createReseller, and BEGIN without ROLLBACK on the
// updateReseller 404 path. See file headers in resellerHandlers.js.
const express = require('express');
const router = express.Router();

const resellerHandlers = require('./resellerHandlers');
const packageHandlers = require('./packageHandlers');
const billing = require('./billing');
const report = require('./report');
const status = require('./status');

// Reseller CRUD
router.post('/', resellerHandlers.createReseller);
router.get('/', resellerHandlers.getResellers);
router.get('/:id', resellerHandlers.getResellerById);
router.put('/:id', resellerHandlers.updateReseller);

// Packages under a reseller
router.get('/:resellerId/packages', packageHandlers.getPackagesByReseller);
router.post('/packages', packageHandlers.createPackage);
router.put('/packages/:id', packageHandlers.updatePackage);
router.delete('/packages/:id', packageHandlers.deletePackage);

// Billing and financial
router.post('/billing/log', billing.addBillingLog);
router.post('/billing/discount', billing.addDiscount);
router.get('/:resellerId/billing-logs', billing.getBillingLogs);
router.get('/:resellerId/monthly-summary', billing.getMonthlySummary);
router.post('/billing/summary/pay-date', billing.updateMonthlySummaryPayDate)


// Reports
router.get('/:resellerId/reports/detailed-monthly', report.getDetailedMonthlyReport);

// Status
router.get('/status/noc', status.getStatusNoc);


module.exports = router; 