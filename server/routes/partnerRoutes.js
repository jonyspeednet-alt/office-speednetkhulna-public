// routes/partnerRoutes.js — reseller self-service portal (partner.speednetkhulna.com)
// All routes except login/logout require a valid partner_token (requirePartner).
const express = require("express");
const router = express.Router();

const {
  requirePartner,
  requirePartnerLoose,
  requireDistributionPartner,
  requireCommissionPartner,
} = require("../middleware/partnerAuth");
const { upload } = require("../middleware/uploadMiddleware");

const auth = require("../controllers/partner/authController");
const dashboard = require("../controllers/partner/dashboardController");
const requests = require("../controllers/partner/requestController");
const invoice = require("../controllers/partner/invoiceController");
const settings = require("../controllers/partner/settingsController");
const commission = require("../controllers/partner/commissionController");

// ── Auth ────────────────────────────────────────────────────
// S7: partner login had no rate limit while accepting phone numbers as usernames.
// Two-dimensional (mirrors office /api/auth/login): per-account 5/15min so one
// reseller's typos never lock the whole market, plus a coarse per-IP guard.
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { LoginRateStore } = require('../utilities/loginRateStore');
const normalizePartnerUsername = (raw) => {
  // Exact-trimmed only — NO case/phone transforms. The DB lookup is an exact
  // match, so the bucket must be too: transformed keys let attackers fill a
  // victim's bucket (or collide distinct identities) without the exact form.
  const s = String(raw || "").trim();
  if (!s) return "";
  return `raw:${s}`;
};
const partnerAccountLimiter = rateLimit({
  store: new LoginRateStore('partner-account'),
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    if (req.partnerLoginAccountId != null) return `partner-account:${req.partnerLoginAccountId}`;
    const id = normalizePartnerUsername(req.body?.username);
    if (id) return `partner-acct:${id}`;
    return `partner-acct-ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) =>
    res.status(429).json({ message: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" }),
});
const partnerIpLimiter = rateLimit({
  store: new LoginRateStore('partner-ip'),
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) =>
    res.status(429).json({ message: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" }),
});
// Per-reseller abuse guard for settings/request writes.
const partnerAbuseLimiter = (prefix, limit, windowMs = 15 * 60 * 1000) => rateLimit({
  windowMs,
  limit,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.reseller?.id ? `${prefix}:${req.reseller.id}` : `${prefix}-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "অনেকবার চেষ্টা করা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" }),
});
router.post("/login", partnerIpLimiter, async (req, res, next) => {
  try {
    if (typeof req.body?.username !== 'string' || req.body.username.length > 254 ||
        typeof req.body?.password !== 'string' || req.body.password.length > 1024) {
      return res.status(400).json({ message: 'Invalid login input' });
    }
    req.partnerLoginAccountId = await auth.resolvePartnerAccount(req.body.username);
    next();
  } catch (_) {
    return res.status(503).json({ message: 'Login temporarily unavailable. Please retry.' });
  }
}, partnerAccountLimiter, auth.login);
router.post("/logout", requirePartnerLoose, partnerAbuseLimiter("partner-logout", 10), auth.logout);
router.get("/me", requirePartner, auth.me);

// ── Dashboard & billing ─────────────────────────────────────
router.get("/avatar/:file", requirePartner, settings.serveAvatar);

router.get("/dashboard", requirePartner, dashboard.getDashboard);
router.get("/billing/current-bill", requirePartner, requireDistributionPartner, dashboard.getCurrentBill);
router.get("/billing/previous-due", requirePartner, requireDistributionPartner, dashboard.getPreviousDue);
router.get("/billing/paid-this-month", requirePartner, requireDistributionPartner, dashboard.getPaidThisMonth);

// Channel and MAC partners receive their own reseller-scoped, read-only views.
router.get("/commission-summary", requirePartner, requireCommissionPartner, commission.getSummary);
router.get("/commission-history", requirePartner, requireCommissionPartner, commission.getHistory);
router.get("/commission-payments", requirePartner, requireCommissionPartner, commission.getPayments);

// ── Bandwidth requests ──────────────────────────────────────
router.get("/requests", requirePartner, requireDistributionPartner, requests.listRequests);
router.post("/requests", requirePartner, requireDistributionPartner, partnerAbuseLimiter("partner-req", 20), requests.createRequest);
router.put("/requests/:id", requirePartner, requireDistributionPartner, requests.updateRequest);

// ── Payments & invoices ─────────────────────────────────────
router.get("/payments", requirePartner, requireDistributionPartner, invoice.listPayments);
router.get("/invoice/:billId", requirePartner, requireDistributionPartner, invoice.getInvoice);

// ── Settings ────────────────────────────────────────────────
router.post("/settings/password", requirePartner, partnerAbuseLimiter("partner-pw", 5), settings.changePassword);
router.post(
  "/settings/profile-image",
  requirePartner,
  partnerAbuseLimiter("partner-avatar", 20),
  upload.single("profile_image"),
  settings.uploadProfileImage,
);

module.exports = router;
