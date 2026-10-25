const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');
const { requireOwnTicket } = require('../middleware/technicianScope');
const { requireSupportOffice, requireSupportOfficeTicket } = require('../middleware/supportOfficeScope');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Spam/storage-fill guards (per authenticated user; limits are generous).
const abuseLimiter = (prefix, limit, windowMs = 15 * 60 * 1000) => rateLimit({
  windowMs,
  limit,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `${prefix}:${req.user.id}` : `${prefix}-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' }),
});
const commentLimiter = abuseLimiter('support-comment', 60);
const callHandoffLimiter = abuseLimiter('support-call-handoff', 30);
const attachmentLimiter = abuseLimiter('support-attach', 20);
const deviceTokenLimiter = abuseLimiter('device-token', 20);
const appVersionGate = require('../middleware/appVersionGate');
const { fail } = require('../utilities/apiResponse');
const controller = require('../controllers/supportController');
const reportController = require('../controllers/supportReportController');
const verificationCallController = require('../controllers/supportVerificationController');
const routerController = require('../controllers/supportRouterController');
const liveController = require('../controllers/supportLiveStatusController');

// Work photos from the technician app. Stored under server/uploads so the
// existing /uploads static mount serves them to mobile clients.
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'uploads', 'ticket_attachments');
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
        cb(null, ATTACHMENTS_DIR);
      } catch (err) { cb(err); }
    },
    filename: (req, file, cb) => {
      const mime = String(file.mimetype || '').toLowerCase();
      const extByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      cb(null, `ticket-${Date.now()}-${Math.round(Math.random() * 1E9)}${extByMime[mime] || ''}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(String(file.mimetype || '').toLowerCase())) {
      return cb(new Error('Only JPG/PNG/WebP/GIF images are allowed'), false);
    }
    cb(null, true);
  },
});
// Convert multer errors (size/type) into JSON 400s instead of HTML pages.
const handleAttachmentUpload = (req, res, next) => {
  attachmentUpload.single('photo')(req, res, (err) => {
    if (err) {
      // Collapse multer internals to fixed strings (lib fingerprinting)
      const msg = /File too large/i.test(err.message || '') ? 'File too large' : 'Photo upload failed';
      return fail(res, msg, 400);
    }
    return next();
  });
};

const router = express.Router();
router.use(auth);
// Mobile app config: auth only (no permission check). Kept BEFORE the
// version gate so outdated apps can still fetch apk_url/message.
router.get('/app-config', controller.getAppConfig);
// Mobile version gate: skips web clients (no X-App-Version header).
router.use(appVersionGate);
router.get('/dashboard', requirePermission('support.ticket.view'), requireSupportOffice, controller.getDashboard);
router.get('/reports/technician-register', requirePermission('support.ticket.view'), requireSupportOffice, reportController.getTechnicianSupportRegister);
router.get('/customers/search', requireAnyPermission(['support.ticket.view','support.ticket.create']), controller.searchCustomers);
router.get('/tickets', requirePermission('support.ticket.view'), requireSupportOffice, controller.listTickets);
router.get('/tickets/my-summary', requirePermission('support.ticket.view'), requireSupportOffice, controller.getMySummary);
router.post('/tickets', requirePermission('support.ticket.create'), requireSupportOffice, controller.createTicket);
router.get('/tickets/:id', requirePermission('support.ticket.view'), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.getTicket);
router.post('/tickets/:id/call-handoffs', requirePermission('support.ticket.view'), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, callHandoffLimiter, controller.log3cxCallHandoff);
router.get('/tickets/:id/live-status', requirePermission('support.ticket.view'), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, liveController.getTicketLiveStatus);
router.patch('/tickets/:id', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.updateTicket);
router.delete('/tickets/:id', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.deleteTicket);
// Admin-only undo of an accidental solve/close (controller enforces admin).
router.post('/tickets/:id/revert', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.revertSolvedTicket);
router.get('/tickets/:id/comments', requirePermission('support.ticket.view'), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.listTicketComments);
router.post('/tickets/:id/comments', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, commentLimiter, controller.addTicketComment);
router.get('/customers/:customerId/comments', requirePermission('support.ticket.view'), requireSupportOffice, controller.listCustomerComments);
router.post('/tickets/:id/attachments', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, attachmentLimiter, handleAttachmentUpload, controller.addTicketAttachment);
router.get('/tickets/:id/attachments/:file', requirePermission('support.ticket.view'), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, controller.getTicketAttachment);

// Technician work reports (Standard fields). Submit: update perm + own
// ticket (requireOwnTicket). Review: assign perm holders (any reviewer).
router.post('/tickets/:id/reports', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireOwnTicket, requireSupportOfficeTicket, attachmentLimiter, handleAttachmentUpload, controller.submitWorkReport);
router.patch('/tickets/:id/reports/:reportId', requirePermission('support.ticket.assign'), requireSupportOffice, requireSupportOfficeTicket, controller.reviewWorkReport);

// Mobile push registration (authenticated; mobile sends Bearer — authMiddleware
// accepts it. Auth closes the unauthenticated token-table spam hole.)
router.post('/device-token', auth, deviceTokenLimiter, controller.registerDeviceToken);
router.delete('/device-token', auth, deviceTokenLimiter, controller.unregisterDeviceToken);

// Verification Call
router.post('/verification', requireAnyPermission(['support.ticket.update','support.ticket.assign']), requireSupportOffice, requireSupportOfficeTicket, controller.saveVerificationCall);
router.get('/verification-calls/queue', requirePermission('support.ticket.view'), requireSupportOffice, verificationCallController.listVerificationCallQueue);
router.get('/verification-calls/report', requirePermission('support.ticket.view'), requireSupportOffice, verificationCallController.listVerificationCallReport);
router.get('/verification-calls/analytics', requirePermission('support.ticket.view'), requireSupportOffice, verificationCallController.listVerificationCallAnalytics);
router.get('/verification-calls/analytics/export', requirePermission('support.ticket.view'), requireSupportOffice, verificationCallController.exportVerificationCallMonth);
router.post(
  '/verification-calls/tickets/:id/attempts',
  requireAnyPermission(['support.ticket.update', 'support.ticket.assign']),
  requireSupportOffice,
  requireOwnTicket,
  requireSupportOfficeTicket,
  verificationCallController.startVerificationCallAttempt
);
router.patch(
  '/verification-calls/tickets/:id/attempts/:attemptId',
  requireAnyPermission(['support.ticket.update', 'support.ticket.assign']),
  requireSupportOffice,
  requireOwnTicket,
  requireSupportOfficeTicket,
  verificationCallController.finishVerificationCallAttempt
);

// SMS Portal & Templates
router.get('/sms-templates', requirePermission('support.ticket.view'), controller.getSmsTemplates);
router.get('/sms-templates/:id', requirePermission('support.ticket.view'), controller.getSmsTemplate);
router.post('/sms-templates', requirePermission('support.ticket.create'), controller.createSmsTemplate);
router.put('/sms-templates/:id', requirePermission('support.ticket.update'), controller.updateSmsTemplate);
router.patch('/sms-templates/:id', requirePermission('support.ticket.update'), controller.updateSmsTemplate);
router.delete('/sms-templates/:id', requirePermission('support.ticket.update'), controller.deleteSmsTemplate);
router.post('/send-sms', requirePermission('support.ticket.create'), controller.sendSmsPortal);
router.get('/sms-balance', requireAnyPermission(['support.ticket.view', 'support.ticket.create']), controller.getSmsBalance);
router.get('/sms-logs', requirePermission('support.ticket.view'), controller.listSmsLogs);
router.get('/whatsapp/sessions', requireAnyPermission(['support.ticket.view', 'leave.manage']), controller.getWhatsAppSessions);
router.post('/whatsapp/reconnect', requireAnyPermission(['support.ticket.create', 'support.ticket.update', 'leave.manage']), controller.reconnectWhatsAppSession);
router.post('/whatsapp/disconnect', requireAnyPermission(['support.ticket.create', 'support.ticket.update', 'leave.manage']), controller.disconnectWhatsAppSession);

router.post('/mikrotik/sync', requirePermission('support.mikrotik.sync'), controller.syncMikrotik);
router.get('/mikrotik/sync-runs', requirePermission('support.mikrotik.sync'), controller.getSyncRuns);

// MikroTik router inventory (password_enc never leaves the API).
// `/mikrotik/routers/...` and `/mikrotik/sync-runs` are distinct paths, so no
// clash; `:id` item routes and `:id/test|:id/sync` differ by full path+method.
router.get('/mikrotik/routers', requirePermission('support.mikrotik.sync'), routerController.listRouters);
router.post('/mikrotik/routers', requirePermission('support.router.manage'), routerController.createRouter);
router.get('/mikrotik/routers/:id', requirePermission('support.mikrotik.sync'), routerController.getRouter);
router.put('/mikrotik/routers/:id', requirePermission('support.router.manage'), routerController.updateRouter);
router.patch('/mikrotik/routers/:id', requirePermission('support.router.manage'), routerController.updateRouter);
router.delete('/mikrotik/routers/:id', requirePermission('support.router.manage'), routerController.deleteRouter);
router.post('/mikrotik/routers/:id/test', requirePermission('support.router.manage'), routerController.testRouterConnection);
router.post('/mikrotik/routers/:id/sync', requirePermission('support.mikrotik.sync'), routerController.syncOneRouter);

module.exports = router;
