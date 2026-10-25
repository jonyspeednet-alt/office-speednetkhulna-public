const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');
const ctrl = require('../controllers/partnerOnboardingController');

// All routes require auth
router.use(authMiddleware);

// Create — requires reseller.add or onboarding create (fallback to any reseller perm) — broadened for HR
router.post(
  '/',
  requireAnyPermission(['reseller.add', 'partner_onboarding.create', 'reseller.requests.approve', 'users.manage']),
  (req, res, next) => {
    // Support both multipart and JSON
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      return ctrl.upload.single('photo')(req, res, (err) => {
        if (err) {
          if (String(err.message||'').includes('File too large')) return res.status(400).json({ message: 'Photo must be <= 2MB' });
          return res.status(400).json({ message: 'Photo upload failed' });
        }
        return ctrl.createOnboarding(req, res, next);
      });
    }
    return ctrl.createOnboarding(req, res, next);
  }
);

router.get(
  '/',
  requireAnyPermission(['reseller.list', 'reseller.profile', 'partner_onboarding.view', 'reseller.add', 'reseller.tasks.manage', 'reseller.requests.create', 'reseller.requests.review', 'reseller.requests.approve', 'reseller.status_noc.view', 'users.manage', 'employees.view', 'appointment_letters.generate']),
  ctrl.listOnboardings
);

router.get(
  '/:id',
  requireAnyPermission(['reseller.list', 'reseller.profile', 'partner_onboarding.view', 'reseller.add', 'reseller.tasks.manage', 'reseller.requests.create', 'reseller.requests.review', 'reseller.requests.approve', 'reseller.status_noc.view', 'users.manage', 'employees.view', 'appointment_letters.generate']),
  ctrl.getOnboarding
);

router.put(
  '/:id',
  requireAnyPermission(['reseller.add', 'partner_onboarding.create', 'reseller.profile', 'reseller.requests.approve', 'users.manage']),
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      return ctrl.upload.single('photo')(req, res, (err) => {
        if (err) {
          if (String(err.message||'').includes('File too large')) return res.status(400).json({ message: 'Photo must be <= 2MB' });
          return res.status(400).json({ message: 'Photo upload failed' });
        }
        return ctrl.updateOnboarding(req, res, next);
      });
    }
    return ctrl.updateOnboarding(req, res, next);
  }
);

router.delete(
  '/:id',
  requireAnyPermission(['reseller.add', 'partner_onboarding.manage', 'reseller.profile']),
  ctrl.deleteOnboarding
);

router.patch(
  '/:id/status',
  requireAnyPermission(['partner_onboarding.approve', 'reseller.requests.approve']),
  ctrl.updateStatus
);

router.post(
  '/:id/convert',
  requireAnyPermission(['reseller.add', 'partner_onboarding.manage']),
  ctrl.convertToReseller
);

module.exports = router;
