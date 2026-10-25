const express = require('express');
const rateLimit = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');
const controller = require('../controllers/resellerController');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');

const router = express.Router();

// Partner-sheets webhook: token-based sync endpoint (public, no session).
// Rate-limit it so a leaked/guessed token cannot hammer the DB upsert.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many webhook requests. Try again later." },
});

const { ipKeyGenerator } = require('express-rate-limit');

// Invoice-email + request spam guard: authenticated users only, per-user buckets.
const resellerAbuseLimiter = (prefix, limit, windowMs = 15 * 60 * 1000) => rateLimit({
  windowMs,
  limit,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `${prefix}:${req.user.id}` : `${prefix}-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ message: 'Too many requests. Please try again later.' }),
});
const invoiceEmailLimiter = resellerAbuseLimiter('invoice-email', 10);
const bandwidthReqLimiter = resellerAbuseLimiter('bandwidth-req', 20);

router.post('/partner-sheets/webhook', webhookLimiter, controller.ingestPartnerSheetWebhook);
router.use(authMiddleware);

router.get('/resellers', requireAnyPermission(['reseller.list', 'reseller.tasks.manage']), controller.listResellers);
router.get('/partner-sheets', requireAnyPermission(['reseller.list', 'reseller.tasks.manage']), controller.getPartnerSheetList);
router.post('/resellers', requirePermission('reseller.add'), controller.createReseller);
router.get('/resellers/:id', requireAnyPermission(['reseller.profile', 'reseller.list']), controller.getResellerProfile);
router.get('/resellers/:id/details', requireAnyPermission(['reseller.profile', 'reseller.list', 'reseller.tasks.manage', 'reseller.status_noc.view']), controller.getResellerProfileDetails);
router.put('/resellers/:id', requirePermission('reseller.profile'), controller.updateReseller);
router.get('/reseller-status-noc', requirePermission('reseller.status_noc.view'), controller.getStatusNoc);

router.post('/bandwidth-requests', requirePermission('reseller.requests.create'), bandwidthReqLimiter, controller.createBandwidthRequest);
router.get('/bandwidth-requests', requireAnyPermission(['reseller.requests.review', 'reseller.tasks.manage']), controller.listBandwidthRequests);
router.patch('/bandwidth-requests/:id/review', requirePermission('reseller.requests.review'), controller.reviewBandwidthRequest);
router.post('/bandwidth-requests/:id/apply', requireAnyPermission(['reseller.requests.review', 'reseller.tasks.manage']), controller.applyApprovedRequest);

router.get('/billing-logs', requireAnyPermission(['billing.logs.view', 'reseller.list']), controller.getBillingLogs);
router.get('/financial-audit-logs', requireAnyPermission(['billing.logs.view', 'reseller.list', 'audit.system_logs.view']), controller.getFinancialAuditLogs);
router.post('/billing-logs', requirePermission('billing.generate_bill'), controller.addBillingLog);
router.post('/resellers/:id/discounts', requirePermission('billing.discount.add'), controller.addDiscount);

router.get('/resellers/:id/billing-rules', requireAnyPermission(['billing.invoice.view', 'billing.generate_bill']), controller.listRules);
router.post('/resellers/:id/billing-rules', requirePermission('billing.generate_bill'), controller.createRule);
router.patch('/resellers/:id/billing-rules/:ruleId', requirePermission('billing.generate_bill'), controller.updateRule);
router.delete('/resellers/:id/billing-rules/:ruleId', requirePermission('billing.generate_bill'), controller.deactivateRule);

router.get('/monthly-summary', requirePermission('billing.monthly_summary.view'), controller.getMonthlySummary);
router.patch('/monthly-summary/next-pay-date', requirePermission('billing.generate_bill'), controller.updateMonthlySummaryPayDate);
router.post('/generate-bills', requirePermission('billing.generate_bill'), controller.generateMonthlyBills);
router.post('/invoice/:resellerId/finalize', requirePermission('billing.generate_bill'), controller.finalizeInvoice);

router.get('/invoice/by-bill/:billId', requireAnyPermission(['billing.invoice.static_view', 'billing.invoice.view']), controller.getInvoiceByBillId);
router.post('/invoice/by-bill/:billId/send-email', requireAnyPermission(['billing.invoice.static_view', 'billing.invoice.view']), invoiceEmailLimiter, controller.sendInvoiceEmailByBillId);
router.get('/invoice/:resellerId', requirePermission('billing.invoice.view'), controller.getInvoice);
router.post('/invoice/:resellerId/send-email', requirePermission('billing.invoice.view'), invoiceEmailLimiter, controller.sendInvoiceEmailByReseller);

router.post('/resellers/:id/retroactive-bandwidth/preview', requireAnyPermission(['billing.invoice.view', 'billing.generate_bill']), controller.previewRetroactiveCorrection);
router.post('/resellers/:id/retroactive-bandwidth/apply', requirePermission('billing.generate_bill'), controller.applyRetroactiveCorrection);

router.post('/resellers/:id/rate-change', requirePermission('reseller.profile'), controller.changeResellerRate);
router.get('/resellers/:id/rate-change-logs', requireAnyPermission(['reseller.profile', 'billing.logs.view']), controller.getResellerRateChangeLogs);

router.get('/partner-report', requirePermission('billing.monthly_summary.view'), controller.getPartnerReport);
router.get('/partner-report/trends', requirePermission('billing.monthly_summary.view'), controller.getPartnerTrends);
router.get('/partner-report/:id/lifetime', requirePermission('billing.monthly_summary.view'), controller.getPartnerLifetimeReport);
router.get('/partner-report/:id', requirePermission('billing.monthly_summary.view'), controller.getPartnerDetailReport);

module.exports = router;



