const { currentFinancialMonth } = require('../utilities/channelFinancialLock');
/**
 * Channel Partner Billing Routes (Phase 1 Extensions)
 * Reconciliation, Partner Advances, and Settlement statements
 */

const express = require('express');
const router = express.Router();
const BillingReconciliation = require('../utilities/billingReconciliation');
const PartnerAdvanceManager = require('../utilities/partnerAdvanceManager');
const { logFinancialTransaction } = require('../utilities/auditLogger');

// Middleware: Ensure authenticated user
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Middleware: Ensure user has permission
const requirePermission = (permissionCode) => (req, res, next) => {
  // TODO: Implement permission check via req.user.permissions
  // For now, allow all authenticated requests
  next();
};

// ============================================================================
// PARTNER ADVANCES
// ============================================================================

/**
 * POST /reseller/:resellerId/advances
 * Record a single partner advance
 */
router.post(
  '/:resellerId/advances',
  requireAuth,
  requirePermission('billing.advance.record'),
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { user_id, advance_amount, advance_type, notes } = req.body;

      // Validate required fields
      if (!user_id || !advance_amount || !advance_type) {
        return res.status(400).json({
          error: 'Missing required fields: user_id, advance_amount, advance_type'
        });
      }

      const advanceMonth = `${currentFinancialMonth()}-01`;

      const advance = await PartnerAdvanceManager.recordAdvance(
        parseInt(resellerId),
        parseInt(user_id),
        advanceMonth,
        Number(advance_amount),
        advance_type,
        req.user.id,
        notes || null
      );

      res.status(201).json({
        success: true,
        data: advance,
        message: 'Partner advance recorded successfully'
      });
    } catch (error) {
      console.error('[PartnerAdvances] Error:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * POST /reseller/:resellerId/advances/bulk
 * Record multiple partner advances in bulk
 */
router.post(
  '/:resellerId/advances/bulk',
  requireAuth,
  requirePermission('billing.advance.record'),
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { advances } = req.body;

      if (!Array.isArray(advances) || advances.length === 0) {
        return res.status(400).json({
          error: 'advances must be a non-empty array'
        });
      }

      const createdAdvances = await PartnerAdvanceManager.recordBulkAdvances(
        parseInt(resellerId),
        advances,
        req.user.id
      );

      res.status(201).json({
        success: true,
        data: createdAdvances,
        count: createdAdvances.length,
        message: `${createdAdvances.length} partner advances recorded`
      });
    } catch (error) {
      console.error('[PartnerAdvances] Bulk error:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * GET /reseller/:resellerId/advances/pending
 * Get pending partner advances
 */
router.get(
  '/:resellerId/advances/pending',
  requireAuth,
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const advances = await PartnerAdvanceManager.getPendingAdvances(
        parseInt(resellerId),
        'pending_adjustment'
      );

      res.status(200).json({
        success: true,
        data: advances,
        count: advances.length
      });
    } catch (error) {
      console.error('[PartnerAdvances] Error getting pending:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * PATCH /reseller/:resellerId/advances/:advanceId/apply
 * Apply partner advance to settlement
 */
router.patch(
  '/:resellerId/advances/:advanceId/apply',
  requireAuth,
  requirePermission('billing.advance.adjust'),
  async (req, res) => {
    try {
      const { advanceId } = req.params;
      const updated = await PartnerAdvanceManager.applyAdvanceAdjustment(
        parseInt(advanceId),
        req.user.id,
        Number(req.params.resellerId),
      );

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Partner advance applied to settlement'
      });
    } catch (error) {
      console.error('[PartnerAdvances] Error applying:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * PATCH /reseller/:resellerId/advances/:advanceId/dispute
 * Dispute a partner advance
 */
router.patch(
  '/:resellerId/advances/:advanceId/dispute',
  requireAuth,
  requirePermission('billing.advance.adjust'),
  async (req, res) => {
    try {
      const { advanceId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const updated = await PartnerAdvanceManager.disputeAdvance(
        parseInt(advanceId),
        req.user.id,
        reason,
        Number(req.params.resellerId),
      );

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Partner advance marked as disputed'
      });
    } catch (error) {
      console.error('[PartnerAdvances] Error disputing:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * PATCH /reseller/:resellerId/advances/:advanceId/reverse
 * Reverse a partner advance
 */
router.patch(
  '/:resellerId/advances/:advanceId/reverse',
  requireAuth,
  requirePermission('billing.advance.adjust'),
  async (req, res) => {
    try {
      const { advanceId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'reason is required' });
      }

      const updated = await PartnerAdvanceManager.reverseAdvance(
        parseInt(advanceId),
        req.user.id,
        reason,
        Number(req.params.resellerId),
      );

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Partner advance reversed'
      });
    } catch (error) {
      console.error('[PartnerAdvances] Error reversing:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

// ============================================================================
// RECONCILIATION
// ============================================================================

/**
 * POST /reseller/:resellerId/reconciliation/initiate
 * Initiate month-end reconciliation
 */
router.post(
  '/:resellerId/reconciliation/initiate',
  requireAuth,
  requirePermission('billing.reconciliation.initiate'),
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { reconciliation_period } = req.body;

      if (!reconciliation_period) {
        return res.status(400).json({
          error: 'reconciliation_period is required (YYYY-MM-01 format)'
        });
      }

      const period = new Date(reconciliation_period);
      const reconciliation = await BillingReconciliation.initiateReconciliation(
        parseInt(resellerId),
        period,
        req.user.id
      );

      res.status(201).json({
        success: true,
        data: reconciliation,
        message: 'Reconciliation initiated'
      });
    } catch (error) {
      console.error('[Reconciliation] Error initiating:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * GET /reseller/:resellerId/reconciliation/:reconciliationLogId
 * Get reconciliation status and details
 */
router.get(
  '/:resellerId/reconciliation/:reconciliationLogId',
  requireAuth,
  async (req, res) => {
    try {
      const { reconciliationLogId } = req.params;
      const status = await BillingReconciliation.getReconciliationStatus(
        parseInt(reconciliationLogId)
      );

      res.status(200).json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('[Reconciliation] Error getting status:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * PATCH /reseller/:resellerId/reconciliation/:reconciliationLogId/approve
 * Approve and finalize reconciliation
 */
router.patch(
  '/:resellerId/reconciliation/:reconciliationLogId/approve',
  requireAuth,
  requirePermission('billing.reconciliation.approve'),
  async (req, res) => {
    try {
      const { reconciliationLogId } = req.params;
      const reconciliation = await BillingReconciliation.approveReconciliation(
        parseInt(reconciliationLogId),
        req.user.id
      );

      res.status(200).json({
        success: true,
        data: reconciliation,
        message: 'Reconciliation approved and finalized'
      });
    } catch (error) {
      console.error('[Reconciliation] Error approving:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * GET /reseller/:resellerId/reconciliation/report/:period
 * Get detailed reconciliation report
 */
router.get(
  '/:resellerId/reconciliation/report/:period',
  requireAuth,
  requirePermission('billing.reconciliation.report'),
  async (req, res) => {
    try {
      const { resellerId, period } = req.params;
      const periodDate = new Date(period + '-01');

      const report = await BillingReconciliation.getReconciliationReport(
        parseInt(resellerId),
        periodDate
      );

      res.status(200).json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('[Reconciliation] Error getting report:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

/**
 * GET /reseller/:resellerId/settlement/statement/:period
 * Get settlement statement (JSON or PDF)
 */
router.get(
  '/:resellerId/settlement/statement/:period',
  requireAuth,
  requirePermission('billing.settlement.statement'),
  async (req, res) => {
    try {
      const { resellerId, period } = req.params;
      const periodDate = new Date(period + '-01');

      // For now, return reconciliation report as settlement statement
      const statement = await BillingReconciliation.getReconciliationReport(
        parseInt(resellerId),
        periodDate
      );

      // TODO: Generate PDF if format=pdf query param is set
      const format = req.query.format || 'json';

      if (format === 'json') {
        res.status(200).json({
          success: true,
          data: statement,
          format: 'json'
        });
      } else if (format === 'pdf') {
        res.status(501).json({
          error: 'PDF export not yet implemented'
        });
      } else {
        res.status(400).json({
          error: 'format must be json or pdf'
        });
      }
    } catch (error) {
      console.error('[Settlement] Error getting statement:', error.message);
      res.status(500).json({ error: 'Server Error. Please try again later.' });
    }
  }
);

module.exports = router;
