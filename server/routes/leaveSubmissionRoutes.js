const express = require('express');
const router = express.Router();
const leaveSubmissionController = require('../controllers/leaveSubmissionController');
const authMiddleware = require('../middleware/auth');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Leave-spam guard: per-user bucket, generous for legit bursts.
const leaveApplyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.user?.id ? `leave-apply:${req.user.id}` : `leave-apply-ip:${ipKeyGenerator(req.ip)}`,
  handler: (req, res) => res.status(429).json({ message: 'Too many leave requests. Please try again later.' }),
});

// Route: POST /api/leaves/apply
router.post('/apply', authMiddleware, leaveApplyLimiter, leaveSubmissionController.submitLeave);

// Route: GET /api/leaves/form-data
router.get('/form-data', authMiddleware, leaveSubmissionController.getLeaveFormData);

module.exports = router;