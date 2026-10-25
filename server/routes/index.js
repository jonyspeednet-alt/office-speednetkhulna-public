// routes/index.js — Centralized API route registry
const express = require('express');
const router = express.Router();

// ── Public (no auth) ────────────────────────────────────────
router.use('/public', require('./publicRoutes'));

// ── Auth ────────────────────────────────────────────────────
router.use('/auth', require('./auth'));

// ── Dashboard ───────────────────────────────────────────────
router.use('/dashboard/admin', require('./adminDashboardRoutes'));
router.use('/dashboard', require('./userDashboardRoutes'));

// ── Navigation ──────────────────────────────────────────────
router.use('/sidebar', require('./sidebarRoutes'));
router.use('/admin/menus', require('./menuRoutes'));

// ── People ──────────────────────────────────────────────────
router.use('/employees', require('./employeeRoutes'));
router.use('/employee-of-the-month', require('./employeeOfTheMonthRoutes'));
router.use('/profile', require('./profileRoutes'));
router.use('/roles', require('./roleRoutes'));
router.use('/permissions', require('./permissionRoutes'));
router.use('/phone-directory', require('./phoneDirectoryRoutes'));

// ── Leave Management ────────────────────────────────────────
router.use('/leaves', require('./leaveRoutes'));
router.use('/leaves', require('./leaveSubmissionRoutes'));
router.use('/my-leaves', require('./myLeavesRoutes'));
router.use('/approvals', require('./approvalRoutes'));
router.use('/entitlements', require('./entitlementRoutes'));

// ── Communication ───────────────────────────────────────────
router.use('/internal/whatsapp', require('./whatsappRoutes'));
router.use('/internal/whatsapp-worker', require('./whatsappWorkerRoutes'));
router.use('/notices', require('./noticeRoutes'));

// ── Calendar & Scheduling ───────────────────────────────────
router.use('/calendar', require('./calendarRoutes'));

// ── Business ────────────────────────────────────────────────
router.use('/reports', require('./reportRoutes'));
router.use('/resellers', require('./resellerRoutes'));
router.use('/channel-partners', require('./channelPartnerRoutes'));
router.use('/partner-onboardings', require('./partnerOnboardingRoutes'));

// ── Partner Portal (reseller self-service, partner.speednetkhulna.com) ──
router.use('/partner', require('./partnerRoutes'));
router.use('/assets', require('./assetManagementRoutes'));
router.use('/appointment-letters', require('./appointmentLetterRoutes'));
router.use('/no-dues-certificates', require('./noDuesCertificateRoutes'));
router.use('/noc-letters', require('./nocLetterRoutes'));
router.use('/employee-of-the-year', require('./employeeOfTheYearRoutes'));
router.use('/termination-letters', require('./terminationLetterRoutes'));
router.use('/department-changes', require('./departmentChangeRoutes'));
router.use('/device-handovers', require('./deviceHandoverRoutes'));
router.use('/employee-suggestions', require('./employeeSuggestionRoutes'));
router.use('/experience-certificates', require('./experienceCertificateRoutes'));
router.use('/meeting-minutes', require('./meetingMinutesRoutes'));
router.use('/salary-increments', require('./salaryIncrementRoutes'));
router.use('/promotions', require('./promotionLetterRoutes'));
router.use('/pips', require('./pipRoutes'));
router.use('/punishments', require('./punishmentLetterRoutes'));
router.use('/procurement', require('./procurementRoutes'));
router.use('/office-work', require('./officeWorkRoutes'));
router.use('/route-visits', require('./routeVisitRoutes'));
router.use('/internet-registrations', require('./internetRegistrationRoutes'));
router.use('/support', require('./supportRoutes'));

// ── Logs & Audit ────────────────────────────────────────────
router.use('/audit-logs', require('./auditLogRoutes'));
router.use('/audit', require('./auditVerificationRoutes'));
router.use('/system-logs', require('./systemLogRoutes'));

module.exports = router;
