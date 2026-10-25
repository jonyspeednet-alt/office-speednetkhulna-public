const express = require("express");
const {
  login,
  logout,
  changePassword,
  refreshToken,
  getMe,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const { requireAnyPermission } = require("../middleware/checkPermission");

const router = express.Router();

// Standard fix for shared-office NAT self-DoS:
// Old rule was IP-only (5 fails / 15 min per IP) — one person's typo blocked
// the whole office because all PCs share one public IP.
// New rule is two-dimensional:
//   1) per-account (identifier/phone/email): 5 fails / 15 min → only that account locked
//   2) per-IP coarse guard: 60 fails / 15 min → only stops real brute-force / bot nets
// Successful logins never count (skipSuccessfulRequests).
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { LoginRateStore, resolveLoginAccount } = require('../utilities/loginRateStore');

const normalizeLoginIdentifier = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Email → case-insensitive; phone → same normalization as authController
  if (s.includes("@")) return `email:${s.toLowerCase()}`;
  let p = s.replace(/[\s\-+()]/g, "");
  if (p.startsWith("8801")) p = "0" + p.slice(3);
  else if (p.startsWith("880")) p = "0" + p.slice(3);
  // Employee IDs are also accepted by login and matched case-insensitively.
  return `phone:${p.toLowerCase()}`;
};

const loginLockMessage = (scope) => ({
  message: "Too many login attempts. Please try again after 15 minutes.",
  scope, // 'account' | 'ip' — lets frontend explain who is locked
});

const perAccountLimiter = rateLimit({
  store: new LoginRateStore('account'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
  // Only FAILED logins count — correct password never triggers a lock.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    if (req.loginAccountId != null) return `login-account:${req.loginAccountId}`;
    const id = normalizeLoginIdentifier(req.body?.identifier);
    if (id) return `login-acct:${id}`;
    // No identifier (bad request) → fall back to IP so it still counts somewhere
    return `login-acct-ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) =>
    res.status(429).json(loginLockMessage("account")),
});

// Coarse per-IP guard: high threshold so a normal office (a few typos)
// never trips it, but password-spraying bot nets still get throttled.
const perIpLimiter = rateLimit({
  store: new LoginRateStore('ip'),
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) =>
    res.status(429).json(loginLockMessage("ip")),
});

router.post("/login", perIpLimiter, async (req, res, next) => {
  try {
    if (typeof req.body?.identifier !== 'string' || req.body.identifier.length > 254 ||
        typeof req.body?.password !== 'string' || req.body.password.length > 1024) {
      return res.status(400).json({ message: 'Invalid login input' });
    }
    req.loginAccountId = await resolveLoginAccount(req.body.identifier);
    next();
  } catch (_) {
    return res.status(503).json({ message: 'Login temporarily unavailable. Please retry.' });
  }
}, perAccountLimiter, login);
// Refresh-loop guard: stolen token must not renew forever at machine speed.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `refresh:${req.user.id}` : `refresh-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "Too many requests. Please try again later." }),
});
// Change-password brute-force guard (hijacked session must not online-guess):
// 5 attempts / 15 min per authenticated user, failures only.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: false,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    req.user?.id ? `pwchange:${req.user.id}` : `pwchange-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "Too many attempts. Please try again after 15 minutes." }),
});
// Logout guard: loose-expired path must not become a session-DoS oracle.
// 10 logouts / 15 min per user is generous for humans, useless for looping.
const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `logout:${req.user.id}` : `logout-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "Too many requests. Please try again later." }),
});
// Admin self-service: unlock a locked account/IP without waiting 15 min.
// Body: { identifier?, ip? } — resets matching limiter keys.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `unlock:${req.user.id}` : `unlock-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) =>
    res.status(429).json({ message: "Too many requests. Please try again later." }),
});
router.post(
  "/unlock-login",
  authMiddleware,
  requireAnyPermission(["p_manage_users"]),
  unlockLimiter,
  async (req, res) => {
    try {
      res.locals.auditAction = "LOGIN_LOCK_CLEARED";
      res.locals.auditUserName = req.user?.full_name || null;
      const out = { reset: [] };
      const identifier = normalizeLoginIdentifier(req.body?.identifier);
      if (identifier) {
        const accountId = await resolveLoginAccount(req.body?.identifier);
        const key = accountId != null ? `login-account:${accountId}` : `login-acct:${identifier}`;
        await perAccountLimiter.resetKey(key);
        out.reset.push(key);
        await perAccountLimiter.resetKey(`login-acct-ip:${ipKeyGenerator(req.ip)}`);
      }
      const ip = String(req.body?.ip || "").trim();
      if (ip) {
        await perIpLimiter.resetKey(ipKeyGenerator(ip));
        out.reset.push(`login-ip:${ip}`);
      }
      return res.json({ message: "Login lock cleared (if any)", ...out });
    } catch (e) {
      return res.status(500).json({ message: "Unlock failed" });
    }
  }
);
router.post("/logout", authMiddleware, logoutLimiter, logout);
router.get("/me", authMiddleware, getMe);router.post("/change-password", authMiddleware, changePasswordLimiter, changePassword);
router.post("/refresh", authMiddleware, refreshLimiter, refreshToken);

module.exports = router;
