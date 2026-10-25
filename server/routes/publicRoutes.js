const express = require('express');
const router = express.Router();
const { getPublicEmployeeProfile } = require('../controllers/publicController');

// Simple in-memory rate limiter (no extra package needed)
const profileRequests = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30;
const RATE_MAP_MAX_SIZE = 5000; // prevent memory leak

const publicRateLimiter = (req, res, next) => {
  // S10: key by req.ip only — raw X-Forwarded-For is client-controlled.
  const ip = req.ip || 'unknown';
  const now = Date.now();

  // Enforce max size
  if (profileRequests.size >= RATE_MAP_MAX_SIZE) {
    for (const [k, v] of profileRequests) {
      if (now > v.resetAt) profileRequests.delete(k);
    }
    if (profileRequests.size >= RATE_MAP_MAX_SIZE) {
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }
  }

  if (!profileRequests.has(ip)) {
    profileRequests.set(ip, { count: 0, resetAt: now + WINDOW_MS });
  }
  const record = profileRequests.get(ip);
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }
  record.count += 1;
  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }
  next();
};

// Cleanup stale entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of profileRequests.entries()) {
    if (now > val.resetAt) profileRequests.delete(key);
  }
}, 5 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

router.get('/employees/:employee_id', publicRateLimiter, getPublicEmployeeProfile);

module.exports = router;
