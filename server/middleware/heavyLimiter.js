// middleware/heavyLimiter.js — caps for CPU/DB-heavy endpoints (Maxim sync,
// reconciliation, statements, reports). Authenticated-DoS guard: a low-priv
// billing user must not fan out reseller x month aggregations at line rate.
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const heavyLimiter = (prefix, limit, windowMs = 60 * 60 * 1000) => rateLimit({
  windowMs,
  limit,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id
      ? `${prefix}:u:${req.user.id}`
      : `${prefix}-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "Too many heavy requests. Please try again later." }),
});

// Background-job fan-out (Maxim scrape = minutes of outbound + DB writes)
const maximSyncLimiter = heavyLimiter("maxim-sync", 10);
// Reconciliation state changes + full reports/statements
const reconHeavyLimiter = heavyLimiter("recon-heavy", 30);

module.exports = { heavyLimiter, maximSyncLimiter, reconHeavyLimiter };
