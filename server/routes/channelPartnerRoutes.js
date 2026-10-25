const { currentFinancialMonth } = require('../utilities/channelFinancialLock');
const express = require("express");
const authMiddleware = require("../middleware/auth");
const controller = require("../controllers/channelPartnerController");
const productController = require("../controllers/channelProductController");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/checkPermission");
const { upload } = require("../middleware/uploadMiddleware");
const { checkReconciliationLock } = require("../middleware/reconciliationLock");
const { checkCommissionMonthLock } = require("../middleware/reconciliationLock");
const { checkCurrentMonthLock, checkAdvanceOwnershipAndLock, checkOldReconScope } = require("../middleware/reconciliationLock");
const pool = require("../utilities/db");

const router = express.Router();
router.use(authMiddleware);

const canView = requireAnyPermission([
  "reseller.profile",
  "reseller.list",
  "reseller.tasks.manage",
]);
const canManage = requireAnyPermission(["reseller.profile", "billing.generate_bill"]);
const canReadFinancials = requireAnyPermission([
  "billing.logs.view",
  "billing.monthly_summary.view",
  "billing.generate_bill",
]);

const canWriteFinancials = requirePermission("billing.generate_bill");

// Product catalog (global)
router.get("/products", canView, productController.listProducts);
router.post("/products", canWriteFinancials, productController.createProduct);
router.put("/products/:productId", canWriteFinancials, productController.updateProduct);
router.post(
  "/products/import",
  canWriteFinancials,
  upload.single("file"),
  productController.importProducts,
);

// User management
router.get("/:resellerId/users", canView, controller.listUsers);
router.post("/:resellerId/users", canManage, controller.addUser);
router.put("/:resellerId/users/:userId", canManage, controller.updateUser);
router.delete("/:resellerId/users/:userId", canManage, controller.deleteUser);

router.get(
  "/:resellerId/product-summary",
  canReadFinancials,
  productController.getProductSummary,
);
router.get(
  "/:resellerId/product-usage",
  canReadFinancials,
  productController.getPartnerProductUsage,
);
router.get(
  "/:resellerId/manual-product-charge",
  canReadFinancials,
  controller.getManualProductCharge,
);
router.post(
  "/:resellerId/manual-product-charge",
  canWriteFinancials,
  controller.saveManualProductCharge,
);
router.get(
  "/:resellerId/users/:userId/products",
  canView,
  productController.getUserProducts,
);
router.put(
  "/:resellerId/users/:userId/products",
  checkReconciliationLock,
  canWriteFinancials,
  productController.saveUserProducts,
);

// Excel Import
router.post(
  "/:resellerId/import-user-list",
  canWriteFinancials,
  upload.single("file"),
  checkReconciliationLock,
  controller.importChannelData,
);

// Maxim billing sync (no Maestro API — AJAX/form scraping worker)
const maximSync = require("../controllers/maximSyncController");
const { maximSyncLimiter, reconHeavyLimiter } = require("../middleware/heavyLimiter");
router.post("/:resellerId/maxim-sync", maximSyncLimiter, canWriteFinancials, maximSync.syncNow);
router.get(
  "/:resellerId/maxim-sync/status",
  canReadFinancials,
  maximSync.syncStatus,
);
router.get("/:resellerId/maxim-prefill", reconHeavyLimiter, canReadFinancials, maximSync.prefill);
router.get("/:resellerId/maxim-health", reconHeavyLimiter, canReadFinancials, maximSync.health);
router.put("/:resellerId/maxim-suffix", reconHeavyLimiter, canWriteFinancials, maximSync.setSuffix);

// User-product usage bulk import (user-wise, per month)
router.post(
  "/:resellerId/products/import-usage",
  canWriteFinancials,
  upload.single("file"),
  productController.importUserProductUsage,
);

// Partner Advances Excel Import
router.post(
  "/:resellerId/import-partner-advances",
  canWriteFinancials,
  upload.single("file"),
  checkReconciliationLock,
  controller.importPartnerAdvances,
);

// User payment collection tracking
router.get(
  "/:resellerId/user-payments",
  canReadFinancials,
  controller.getUserPayments,
);
router.post(
  "/:resellerId/user-payments/init",
  checkReconciliationLock,
  canWriteFinancials,
  controller.initMonthlyPayments,
);

// ============================================================================
// Phase 4: Reconciliation Workflow - Apply lock middleware
// ============================================================================

const { checkReconciliationModifiable } = require("../middleware/reconciliationLock");

router.post(
  "/:resellerId/user-payments/record",
  checkReconciliationLock,
  canWriteFinancials,
  controller.recordUserPayment,
);
router.post(
  "/:resellerId/user-payments/bulk",
  checkReconciliationLock,
  canWriteFinancials,
  controller.bulkRecordPayments,
);

// Commission
router.get(
  "/:resellerId/commission-summary",
  reconHeavyLimiter,
  canReadFinancials,
  controller.getCommissionSummary,
);
router.post(
  "/:resellerId/commission-generate",
  checkCommissionMonthLock,
  canWriteFinancials,
  controller.generateCommission,
);
router.patch(
  "/:resellerId/commission/:logId/adjust",
  checkCommissionMonthLock,
  canWriteFinancials,
  controller.adjustCommission,
);
router.patch(
  "/:resellerId/commission/:logId/finalize",
  checkCommissionMonthLock,
  canWriteFinancials,
  controller.finalizeCommission,
);
router.patch(
  "/:resellerId/commission/:logId/unfinalize",
  checkCommissionMonthLock,
  canWriteFinancials,
  controller.unfinalizeCommission,
);
router.get(
  "/:resellerId/commission-history",
  canReadFinancials,
  controller.getCommissionHistory,
);

// Commission payments (to partner)
router.post(
  "/:resellerId/commission-payments",
  checkCommissionMonthLock,
  canWriteFinancials,
  controller.recordCommissionPayment,
);
router.get(
  "/:resellerId/commission-payments",
  canReadFinancials,
  controller.getCommissionPayments,
);

// Statement
router.get("/:resellerId/statement", reconHeavyLimiter, canReadFinancials, controller.getStatement);

// ============================================================================
// Phase 1: Billing Standardization - Partner Advances & Reconciliation
// ============================================================================

const BillingReconciliation = require("../utilities/billingReconciliation");
const PartnerAdvanceManager = require("../utilities/partnerAdvanceManager");

// Partner Advances
router.post(
  "/:resellerId/advances",
  checkCurrentMonthLock,
  canWriteFinancials,
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { user_id, advance_amount, advance_type, notes } = req.body;

      if (!user_id || !advance_amount || !advance_type) {
        return res.status(400).json({
          error:
            "Missing required fields: user_id, advance_amount, advance_type",
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
        notes || null,
      );

      res.status(201).json({
        success: true,
        data: advance,
        message: "Partner advance recorded successfully",
      });
    } catch (error) {
      console.error("[PartnerAdvances] Error:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.post(
  "/:resellerId/advances/bulk",
  checkCurrentMonthLock,
  canWriteFinancials,
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { advances } = req.body;

      if (!Array.isArray(advances) || advances.length === 0) {
        return res.status(400).json({
          error: "advances must be a non-empty array",
        });
      }
      // Bulk cap: one request = one bounded transaction (mirrors payments)
      if (advances.length > 200) {
        return res.status(400).json({
          error: "advances must have at most 200 items",
        });
      }

      const createdAdvances = await PartnerAdvanceManager.recordBulkAdvances(
        parseInt(resellerId),
        advances,
        req.user.id,
      );

      res.status(201).json({
        success: true,
        data: createdAdvances,
        count: createdAdvances.length,
        message: `${createdAdvances.length} partner advances recorded`,
      });
    } catch (error) {
      console.error("[PartnerAdvances] Bulk error:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.get("/:resellerId/advances/pending", canReadFinancials, async (req, res) => {
  try {
    const { resellerId } = req.params;
    const advances = await PartnerAdvanceManager.getPendingAdvances(
      parseInt(resellerId),
      "pending_adjustment",
    );

    res.status(200).json({
      success: true,
      data: advances,
      count: advances.length,
    });
  } catch (error) {
    console.error("[PartnerAdvances] Error getting pending:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
  }
});

router.patch(
  "/:resellerId/advances/:advanceId/apply",
  checkAdvanceOwnershipAndLock,
  canWriteFinancials,
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
        message: "Partner advance applied to settlement",
      });
    } catch (error) {
      console.error("[PartnerAdvances] Error applying:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.patch(
  "/:resellerId/advances/:advanceId/dispute",
  checkAdvanceOwnershipAndLock,
  canWriteFinancials,
  async (req, res) => {
    try {
      const { advanceId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "reason is required" });
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
        message: "Partner advance marked as disputed",
      });
    } catch (error) {
      console.error("[PartnerAdvances] Error disputing:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.patch(
  "/:resellerId/advances/:advanceId/reverse",
  checkAdvanceOwnershipAndLock,
  canWriteFinancials,
  async (req, res) => {
    try {
      const { advanceId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "reason is required" });
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
        message: "Partner advance reversed",
      });
    } catch (error) {
      console.error("[PartnerAdvances] Error reversing:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.get("/:resellerId/advances/history", canReadFinancials, async (req, res) => {
  try {
    const { resellerId } = req.params;
    const { month, status } = req.query;

    let query = `
        SELECT
          cpa.id,
          cpa.user_id,
          cpu.user_name,
          cpa.advance_month,
          cpa.advance_amount,
          cpa.advance_type,
          cpa.settlement_status,
          cpa.notes,
          cpa.created_by,
          cpa.created_at,
          cpa.resolved_by,
          cpa.resolved_at
        FROM channel_partner_advances cpa
        LEFT JOIN channel_partner_users cpu ON cpu.id = cpa.user_id
        WHERE cpa.reseller_id = $1
      `;

    const params = [parseInt(resellerId)];
    let paramIndex = 2;

    if (month) {
      query += ` AND cpa.advance_month = TO_DATE($${paramIndex} || '-01', 'YYYY-MM-DD')`;
      params.push(month);
      paramIndex++;
    }

    if (status) {
      query += ` AND cpa.settlement_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY cpa.created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);

    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(advance_amount), 0) AS total
         FROM channel_partner_advances
         WHERE reseller_id = $1 ${month ? `AND advance_month = TO_DATE($2 || '-01', 'YYYY-MM-DD')` : ""}
         ${status ? `AND settlement_status = $${month ? 3 : 2}` : ""}`,
      month && status
        ? [parseInt(resellerId), month, status]
        : month
          ? [parseInt(resellerId), month]
          : status
            ? [parseInt(resellerId), status]
            : [parseInt(resellerId)],
    );

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      total_amount: Number(totalResult.rows[0].total),
    });
  } catch (error) {
    console.error("[PartnerAdvances] Error getting history:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
  }
});

// Reconciliation (Phase 1 - Old endpoints, kept for backward compatibility)
router.post(
  "/:resellerId/reconciliation-old/initiate",
  canWriteFinancials,
  async (req, res) => {
    try {
      const { resellerId } = req.params;
      const { reconciliation_period } = req.body;

      if (!reconciliation_period) {
        return res.status(400).json({
          error: "reconciliation_period is required (YYYY-MM-01 format)",
        });
      }

      const period = new Date(reconciliation_period);
      const reconciliation = await BillingReconciliation.initiateReconciliation(
        parseInt(resellerId),
        period,
        req.user.id,
      );

      res.status(201).json({
        success: true,
        data: reconciliation,
        message: "Reconciliation initiated",
      });
    } catch (error) {
      console.error("[Reconciliation] Error initiating:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.get(
  "/:resellerId/reconciliation-old/:reconciliationLogId",
  checkOldReconScope,
  canReadFinancials,
  async (req, res) => {
    try {
      const { reconciliationLogId } = req.params;
      const status = await BillingReconciliation.getReconciliationStatus(
        parseInt(reconciliationLogId),
      );

      res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      console.error("[Reconciliation] Error getting status:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.patch(
  "/:resellerId/reconciliation-old/:reconciliationLogId/approve",
  checkOldReconScope,
  canWriteFinancials,
  async (req, res) => {
    try {
      const { reconciliationLogId } = req.params;
      const reconciliation = await BillingReconciliation.approveReconciliation(
        parseInt(reconciliationLogId),
        req.user.id,
      );

      res.status(200).json({
        success: true,
        data: reconciliation,
        message: "Reconciliation approved and finalized",
      });
    } catch (error) {
      console.error("[Reconciliation] Error approving:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.get(
  "/:resellerId/reconciliation-old/report/:period",
  canReadFinancials,
  async (req, res) => {
    try {
      const { resellerId, period } = req.params;
      const periodDate = new Date(period + "-01");

      const report = await BillingReconciliation.getReconciliationReport(
        parseInt(resellerId),
        periodDate,
      );

      res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      console.error("[Reconciliation] Error getting report:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

router.get(
  "/:resellerId/settlement/statement/:period",
  canReadFinancials,
  async (req, res) => {
    try {
      const { resellerId, period } = req.params;
      const periodDate = new Date(period + "-01");

      const statement = await BillingReconciliation.getReconciliationReport(
        parseInt(resellerId),
        periodDate,
      );

      const format = req.query.format || "json";

      if (format === "json") {
        res.status(200).json({
          success: true,
          data: statement,
          format: "json",
        });
      } else if (format === "pdf") {
        res.status(501).json({
          error: "PDF export not yet implemented",
        });
      } else {
        res.status(400).json({
          error: "format must be json or pdf",
        });
      }
    } catch (error) {
      console.error("[Settlement] Error getting statement:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Server Error. Please try again later.' });
    }
  },
);

// ============================================================================
// Phase 4: Reconciliation Workflow (New Endpoints)
// ============================================================================

// Reconciliation endpoints
router.post(
  "/:resellerId/reconciliation/initiate",
  reconHeavyLimiter,
  canWriteFinancials,
  controller.initiateReconciliation,
);

router.get(
  "/:resellerId/reconciliation/list",
  canReadFinancials,
  controller.getReconciliations,
);

router.get(
  "/:resellerId/reconciliation/:reconciliationId",
  canReadFinancials,
  controller.getReconciliationDetails,
);

router.post(
  "/:resellerId/reconciliation/:reconciliationId/approve",
  checkReconciliationModifiable,
  canWriteFinancials,
  controller.approveReconciliation,
);

router.post(
  "/:resellerId/reconciliation/:reconciliationId/reject",
  checkReconciliationModifiable,
  canWriteFinancials,
  controller.rejectReconciliation,
);

router.get(
  "/:resellerId/reconciliation/:reconciliationId/report",
  reconHeavyLimiter,
  canReadFinancials,
  controller.downloadReconciliationReport,
);

module.exports = router;
