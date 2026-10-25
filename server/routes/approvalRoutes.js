const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approvalController');
const authMiddleware = require('../middleware/auth');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Public letter is unauthenticated: shed jwt.verify CPU-burn + ID enumeration.
const publicLetterLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).send('Too many requests. Please try again later.'),
});

router.get('/public/:id', publicLetterLimiter, approvalController.renderPublicApprovalLetter);

// Route: GET /api/approval/:id
router.get('/:id', authMiddleware, approvalController.getApprovalData);

module.exports = router;
