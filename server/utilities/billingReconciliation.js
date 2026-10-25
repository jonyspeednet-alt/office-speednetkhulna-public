/**
 * Billing Reconciliation Utility
 * Handles month-end reconciliation process for channel partners
 */

const pool = require("./db");
const { getProductDeductionForMonth } = require("./channelProductHelpers");
const { lockChannelMonth, financialError, financialMonth } = require('./channelFinancialLock');

class BillingReconciliation {
  /**
   * Initiate month-end reconciliation for a specific period
   * @param {number} resellerId - Reseller ID
   * @param {Date} reconciliationPeriod - Period to reconcile (e.g., 2026-05-01)
   * @param {number} initiatedBy - User ID initiating reconciliation
   * @returns {Promise<Object>} Reconciliation log record
   */
  static async initiateReconciliation(
    resellerId,
    reconciliationPeriod,
    initiatedBy,
  ) {
    // All month comparisons and persisted dates use the same first-of-month
    // business date as the write lock, including callers passing PG Date values.
    reconciliationPeriod = `${financialMonth(reconciliationPeriod)}-01`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockChannelMonth(client, resellerId, reconciliationPeriod);

      // B3: never silently unlock an approved month — the legacy upsert below
      // overwrites reconciliation_status unconditionally.
      const existing = await client.query(
        `SELECT id, reconciliation_status FROM billing_reconciliation_logs
          WHERE reseller_id = $1 AND reconciliation_month = $2
          FOR UPDATE`,
        [resellerId, reconciliationPeriod],
      );
      if (existing.rows.length > 0 && ['approved', 'reconciled', 'finalized'].includes(existing.rows[0].reconciliation_status)) {
        throw financialError(409, 'Month already reconciled and locked. Re-initiation is not allowed.');
      }

      // Get all active users for this reseller
      const usersResult = await client.query(
        `SELECT COUNT(*) as total_users FROM channel_partner_users
         WHERE reseller_id = $1 AND COALESCE(status, 'active') = 'active'`,
        [resellerId],
      );
      const totalUsers = parseInt(usersResult.rows[0].total_users, 10);

      // Get total billed amount for this service period
      const billedResult = await client.query(
        `SELECT
           SUM(realized_amount) as total_realized,
           SUM(deferred_amount) as total_deferred,
           SUM(realized_amount + deferred_amount) as total_billed
         FROM channel_user_payments
         WHERE reseller_id = $1
           AND service_period = $2
           AND deleted_at IS NULL`,
        [resellerId, reconciliationPeriod],
      );

      const {
        total_realized = 0,
        total_deferred = 0,
        total_billed = 0,
      } = billedResult.rows[0] || {};

      // Get partner advances for this period
      const advancesResult = await client.query(
        `SELECT SUM(advance_amount) as total_advances
         FROM channel_partner_advances
         WHERE reseller_id = $1
           AND advance_month = $2
           AND settlement_status = 'pending_adjustment'`,
        [resellerId, reconciliationPeriod],
      );
      const totalAdvances =
        parseFloat(advancesResult.rows[0].total_advances) || 0;

      // Get manual adjustments for this period
      const adjustmentsResult = await client.query(
        `SELECT
           SUM(CASE WHEN adjustment_type = 'manual_adjustment' THEN adjustment_amount ELSE 0 END) as total_adjustments,
           SUM(CASE WHEN adjustment_type = 'deduction' THEN adjustment_amount ELSE 0 END) as total_deductions
         FROM channel_adjustment_audit
         WHERE reseller_id = $1
           AND adjustment_month = $2`,
        [resellerId, reconciliationPeriod],
      );

      const { total_adjustments = 0, total_deductions = 0 } =
        adjustmentsResult.rows[0] || {};

      // Get reseller profit share percentage
      const resellerResult = await client.query(
        `SELECT
          COALESCE(
            (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = r.id),
            (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = r.id ORDER BY ccl.created_at DESC LIMIT 1),
            0
          ) AS profit_share_percentage
         FROM resellers r WHERE r.id = $1`,
        [resellerId],
      );
      const profitSharePct =
        parseFloat(resellerResult.rows[0]?.profit_share_percentage) || 0;

      // Calculate expected commission on realized amount only (not including advances)
      const totalRealized = parseFloat(total_realized) || 0;
      const totalDeferredAmt = parseFloat(total_deferred) || 0;
      const expectedCommission = (totalRealized * profitSharePct) / 100;

      // Fetch product deduction for this month
      // B8: never toISOString() a Date (UTC shift under Asia/Dhaka) — use
      // local calendar fields.
      const monthYm = typeof reconciliationPeriod === 'string'
        ? reconciliationPeriod.slice(0, 7)
        : `${reconciliationPeriod.getFullYear()}-${String(reconciliationPeriod.getMonth() + 1).padStart(2, '0')}`;
      const productDeduction = (await getProductDeductionForMonth(resellerId, monthYm, client)) || 0;

      // Create or update reconciliation log using the active Phase 4 schema.
      const reconciliationResult = await client.query(
        `INSERT INTO billing_reconciliation_logs (
           reseller_id, reconciliation_month,
           total_collected, total_realized, total_deferred,
           gross_commission, partner_advances, net_commission,
          reconciliation_status, initiated_by, snapshot_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
         ON CONFLICT (reseller_id, reconciliation_month)
         DO UPDATE SET
           total_collected = EXCLUDED.total_collected,
           total_realized = EXCLUDED.total_realized,
           total_deferred = EXCLUDED.total_deferred,
           gross_commission = EXCLUDED.gross_commission,
           partner_advances = EXCLUDED.partner_advances,
           net_commission = EXCLUDED.net_commission,
            reconciliation_status = 'draft',
           initiated_by = EXCLUDED.initiated_by,
           snapshot_data = EXCLUDED.snapshot_data,
           updated_at = NOW()
         RETURNING *`,
        [
          resellerId,
          reconciliationPeriod,
          totalRealized,
          totalRealized,
          totalDeferredAmt,
          expectedCommission,
          totalAdvances,
          expectedCommission -
            totalAdvances -
            productDeduction -
            totalDeferredAmt +
            (parseFloat(total_adjustments) || 0) -
            (parseFloat(total_deductions) || 0),
          initiatedBy,
          JSON.stringify({
            total_users: totalUsers,
            total_billed: parseFloat(total_billed),
            product_deduction: productDeduction,
          }),
        ],
      );

      // Log to immutable audit
      await this.logAudit(
        client,
        initiatedBy,
        resellerId,
        "reconciliation.initiated",
        "billing_reconciliation_logs",
        reconciliationResult.rows[0].id,
        null,
        expectedCommission,
        "draft",
        "draft",
        { reconciliation_period: reconciliationPeriod },
      );

      await client.query("COMMIT");
      return reconciliationResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get reconciliation status and pending actions
   * @param {number} reconciliationLogId - Reconciliation log ID
   * @returns {Promise<Object>} Reconciliation status with pending actions
   */
  static async getReconciliationStatus(reconciliationLogId) {
    const result = await pool.query(
      `SELECT * FROM billing_reconciliation_logs WHERE id = $1`,
      [reconciliationLogId],
    );

    if (result.rows.length === 0) {
      throw financialError(404, "Reconciliation log not found");
    }

    const log = result.rows[0];
    const pendingActions = [];

    // Check for unreviewed deferred bills
    if (Number(log.total_deferred || 0) > 0) {
      pendingActions.push(`Review deferred bills: ${log.total_deferred}`);
    }

    // Check for pending advances
    if (Number(log.partner_advances || 0) > 0) {
      pendingActions.push(`Apply partner advances: ${log.partner_advances}`);
    }

    return {
      ...log,
      pending_actions: pendingActions,
      is_ready_for_approval: pendingActions.length === 0,
    };
  }

  /**
   * Approve and finalize reconciliation
   * @param {number} reconciliationLogId - Reconciliation log ID
   * @param {number} approvedBy - User ID approving reconciliation
   * @returns {Promise<Object>} Updated reconciliation log
   */
  static async approveReconciliation(reconciliationLogId, approvedBy) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const scope = await client.query('SELECT reseller_id, reconciliation_month FROM billing_reconciliation_logs WHERE id=$1', [reconciliationLogId]);
      if (!scope.rows.length) throw financialError(404, 'Reconciliation log not found');
      await lockChannelMonth(client, scope.rows[0].reseller_id, scope.rows[0].reconciliation_month, { allowApproved: true });

      // Get reconciliation log
      const logResult = await client.query(
        "SELECT * FROM billing_reconciliation_logs WHERE id = $1 FOR UPDATE",
        [reconciliationLogId],
      );

      if (logResult.rows.length === 0) {
        throw financialError(404, "Reconciliation log not found");
      }

      const log = logResult.rows[0];

      // B3: status guard — no re-approving approved/rejected rows (which would
      // re-run the advance UPDATE below a second time).
      if (['approved', 'reconciled', 'finalized'].includes(log.reconciliation_status)) {
        throw financialError(409, 'Reconciliation is already approved.');
      }
      if (!['pending', 'draft'].includes(log.reconciliation_status)) {
        throw financialError(409, `Only pending reconciliations can be approved (current: ${log.reconciliation_status}).`);
      }

      const reconciliationMonth = log.reconciliation_month;

      // Mark all partner advances as adjusted
      await client.query(
        `UPDATE channel_partner_advances
         SET settlement_status = 'adjusted', resolved_at = NOW(), resolved_by = $1
         WHERE reseller_id = $2
           AND advance_month = $3
           AND settlement_status = 'pending_adjustment'`,
        [approvedBy, log.reseller_id, reconciliationMonth],
      );

      // Update reconciliation status
      const updateResult = await client.query(
        `UPDATE billing_reconciliation_logs
         SET reconciliation_status = 'approved',
             approved_at = NOW(),
             approved_by = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [approvedBy, reconciliationLogId],
      );

      // Log to immutable audit
      await this.logAudit(
        client,
        approvedBy,
        log.reseller_id,
        "reconciliation.approved",
        "billing_reconciliation_logs",
        reconciliationLogId,
        null,
        log.net_commission,
        log.reconciliation_status || "pending",
        "approved",
        { reconciliation_month: reconciliationMonth },
      );

      await client.query("COMMIT");
      return updateResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get reconciliation report for a period
   * @param {number} resellerId - Reseller ID
   * @param {Date} period - Period to report on
   * @returns {Promise<Object>} Detailed reconciliation report
   */
  static async getReconciliationReport(resellerId, period) {
    period = `${financialMonth(period)}-01`;
    const result = await pool.query(
      `SELECT * FROM billing_reconciliation_logs
       WHERE reseller_id = $1 AND reconciliation_month = $2`,
      [resellerId, period],
    );

    if (result.rows.length === 0) {
      throw financialError(404, "No reconciliation found for this period");
    }

    const reconciliation = result.rows[0];

    // Get detailed user billing breakdown
    const billingsResult = await pool.query(
      `SELECT
         cpu.id as user_id,
         cpu.user_name,
         cup.realized_amount,
         cup.deferred_amount,
         cup.billing_status,
         cup.amount_paid
       FROM channel_user_payments cup
       JOIN channel_partner_users cpu ON cup.user_id = cpu.id
       WHERE cup.reseller_id = $1
         AND cup.service_period = $2
         AND cup.deleted_at IS NULL
       ORDER BY cpu.user_name`,
      [resellerId, period],
    );

    // Get partner advances applied
    const advancesResult = await pool.query(
      `SELECT
         cpa.id,
         cpa.user_id,
         cpu.user_name,
         cpa.advance_amount,
         cpa.advance_type,
         cpa.notes
       FROM channel_partner_advances cpa
       LEFT JOIN channel_partner_users cpu ON cpa.user_id = cpu.id
       WHERE cpa.reseller_id = $1
         AND cpa.advance_month = $2
       ORDER BY cpu.user_name`,
      [resellerId, period],
    );

    // Get adjustments/deductions
    const adjustmentsResult = await pool.query(
      `SELECT
         id,
         adjustment_type,
         adjustment_amount,
         reason,
         notes
       FROM channel_adjustment_audit
       WHERE reseller_id = $1 AND adjustment_month = $2
       ORDER BY created_at DESC`,
      [resellerId, period],
    );

    return {
      reconciliation,
      billings: billingsResult.rows,
      partner_advances: advancesResult.rows,
      adjustments: adjustmentsResult.rows,
      report_date: new Date().toISOString(),
    };
  }

  /**
   * Log to immutable audit table
   * @private
   */
  static async logAudit(
    client,
    actorUserId,
    resellerId,
    actionType,
    entityType,
    entityId,
    amountBefore,
    amountAfter,
    previousStatus,
    newStatus,
    requestPayload,
  ) {
    await client.query(
      `INSERT INTO reseller_financial_audit_log_immutable
       (actor_user_id, reseller_id, action_type, entity_type, entity_id,
        amount_before, amount_after, previous_status, new_status, request_payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        actorUserId,
        resellerId,
        actionType,
        entityType,
        entityId,
        amountBefore,
        amountAfter,
        previousStatus,
        newStatus,
        JSON.stringify(requestPayload),
      ],
    );
  }
}

module.exports = BillingReconciliation;
