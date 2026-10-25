const db = require('../utilities/db');
const { financialMonth, currentFinancialMonth } = require('../utilities/channelFinancialLock');

/**
 * Middleware to check if a month is locked due to approved reconciliation
 * Prevents modifications to data after reconciliation is approved
 */
async function checkReconciliationLock(req, res, next) {
    try {
        const { resellerId } = req.params;
        const month = req.body?.month || req.query?.month;

        // If no month specified, skip check
        if (!month) {
            return next();
        }

        // B2: normalize 'YYYY-MM' → first-of-month DATE (reconciliation_month
        // is a DATE column; passing 'YYYY-MM' through would throw/mismatch).
        const monthDate = `${financialMonth(month)}-01`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(monthDate) || Number.isNaN(Date.parse(monthDate))) {
            return res.status(400).json({
                success: false,
                error: 'Invalid month',
                message: 'Month must be YYYY-MM or YYYY-MM-DD.',
            });
        }

        // Check if month is locked (has approved reconciliation)
        const result = await db.query(`
      SELECT id, reconciliation_status, approved_at
      FROM billing_reconciliation_logs
      WHERE reseller_id = $1
        AND reconciliation_month = $2::date
        AND reconciliation_status IN ('approved','reconciled','finalized')
    `, [resellerId, monthDate]);

        if (result.rows.length > 0) {
            const reconciliation = result.rows[0];
            return res.status(403).json({
                success: false,
                error: 'Month is locked',
                message: 'Cannot modify data for approved reconciliation. This month has been finalized.',
                message_bn: 'অনুমোদিত নিষ্পত্তির জন্য ডেটা পরিবর্তন করা যাবে না। এই মাসটি চূড়ান্ত করা হয়েছে।',
                reconciliation_id: reconciliation.id,
                approved_at: reconciliation.approved_at
            });
        }

        // Month is not locked, proceed
        next();

    } catch (error) {
        console.error('Error checking reconciliation lock:', error);
        // B2: fail CLOSED — a lock check that errors must not silently allow
        // writes into a possibly-approved month.
        return res.status(error.status || 500).json({
            success: false,
            error: 'Lock check failed',
            message: 'Could not verify reconciliation lock. Please retry.',
        });
    }
}

/**
 * Check if a specific reconciliation can be modified
 * Used for approval/rejection operations
 */
async function checkReconciliationModifiable(req, res, next) {
    try {
        const { reconciliationId, resellerId } = req.params;

        const result = await db.query(`
      SELECT id, reconciliation_status, approved_at
      FROM billing_reconciliation_logs
      WHERE id = $1 AND reseller_id = $2
    `, [reconciliationId, resellerId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Reconciliation not found'
            });
        }

        const reconciliation = result.rows[0];

        // Only pending (or legacy draft — see B1) reconciliations can be modified
        if (!['pending', 'draft'].includes(reconciliation.reconciliation_status)) {
            return res.status(403).json({
                success: false,
                error: 'Reconciliation cannot be modified',
                message: `Reconciliation is already ${reconciliation.reconciliation_status}`,
                current_status: reconciliation.reconciliation_status
            });
        }

        // Reconciliation is modifiable, proceed
        next();

    } catch (error) {
        console.error('Error checking reconciliation modifiable:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

module.exports = {
    checkReconciliationLock,
    checkReconciliationModifiable,
    checkCommissionMonthLock,
    checkCurrentMonthLock,
    checkAdvanceOwnershipAndLock,
    checkOldReconScope,
};

/**
 * Advances use the server-side current month (no month in body) — inject it
 * so checkReconciliationLock actually guards instead of always next()ing.
 */
function checkCurrentMonthLock(req, res, next) {
    try {
        if (!req.body || typeof req.body !== 'object') req.body = {};
        if (!req.body.month) req.body.month = currentFinancialMonth();
    } catch (_) {}
    return checkReconciliationLock(req, res, next);
}

/**
 * apply/dispute/reverse take only advanceId — verify it belongs to
 * :resellerId AND its month is not approved. Fail closed.
 */
async function checkAdvanceOwnershipAndLock(req, res, next) {
    try {
        const { resellerId, advanceId } = req.params;
        const r = await db.query(
          `SELECT reseller_id, advance_month FROM channel_partner_advances WHERE id=$1 LIMIT 1`,
          [advanceId]
        );
        if (!r.rows.length) {
            return res.status(404).json({ success: false, error: 'Advance not found' });
        }
        if (Number(r.rows[0].reseller_id) !== Number(resellerId)) {
            return res.status(403).json({ success: false, error: 'Not allowed', message: 'Advance does not belong to this reseller.' });
        }
        const m = financialMonth(r.rows[0].advance_month);
        if (/^\d{4}-\d{2}$/.test(m)) {
            const locked = await db.query(
              `SELECT 1 FROM billing_reconciliation_logs WHERE reseller_id=$1 AND reconciliation_month=($2||'-01')::date AND reconciliation_status IN ('approved','reconciled','finalized') LIMIT 1`,
              [resellerId, m]
            );
            if (locked.rows.length) {
                return res.status(403).json({ success: false, error: 'Month is locked', message: 'Cannot modify advance for approved reconciliation.' });
            }
        }
        return next();
    } catch (error) {
        console.error('Error checking advance lock:', error);
        return res.status(500).json({ success: false, error: 'Lock check failed', message: 'Could not verify lock. Please retry.' });
    }
}

/**
 * Legacy reconciliation-old endpoints take only :reconciliationLogId —
 * scope to :resellerId and (for approve) require pending/draft.
 */
async function checkOldReconScope(req, res, next) {
    try {
        const { resellerId, reconciliationLogId } = req.params;
        const r = await db.query(
          `SELECT id, reseller_id, reconciliation_status FROM billing_reconciliation_logs WHERE id=$1 LIMIT 1`,
          [reconciliationLogId]
        );
        if (!r.rows.length) {
            return res.status(404).json({ success: false, error: 'Reconciliation not found' });
        }
        if (Number(r.rows[0].reseller_id) !== Number(resellerId)) {
            return res.status(403).json({ success: false, error: 'Not allowed', message: 'Reconciliation does not belong to this reseller.' });
        }
        if (req.method !== 'GET' && !['pending', 'draft'].includes(String(r.rows[0].reconciliation_status))) {
            return res.status(403).json({ success: false, error: 'Reconciliation cannot be modified', message: `Reconciliation is already ${r.rows[0].reconciliation_status}` });
        }
        return next();
    } catch (error) {
        console.error('Error checking reconciliation scope:', error);
        return res.status(500).json({ success: false, error: 'Lock check failed', message: 'Could not verify reconciliation. Please retry.' });
    }
}

/**
 * Commission guard: block generate/adjust/finalize/unfinalize when the
 * target month already has an APPROVED billing reconciliation.
 * - generate: month from body (YYYY-MM)
 * - adjust/finalize/unfinalize: month resolved from channel_commission_logs.logId
 * Fail-closed on DB error.
 */
async function checkCommissionMonthLock(req, res, next) {
    try {
        const { resellerId, logId } = req.params;
        let raw = String(req.body?.month || req.query?.month || '').trim().slice(0, 10);
        // commission-payments carries the log id in the body, not params
        const bodyLogId = req.body?.commission_log_id;
        if (!raw && (logId || bodyLogId)) {
            const lr = await db.query(
              `SELECT month FROM channel_commission_logs WHERE id=$1 AND reseller_id=$2 LIMIT 1`,
              [logId || bodyLogId, resellerId]
            );
            if (lr.rows.length) raw = financialMonth(lr.rows[0].month);
            else if (bodyLogId) {
                // log id does not belong to this reseller — fail closed
                return res.status(403).json({ success: false, error: 'Not allowed', message: 'Commission log does not belong to this reseller.' });
            }
        }
        if (!raw) return next();
        const monthDate = `${financialMonth(raw)}-01`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(monthDate) || Number.isNaN(Date.parse(monthDate))) {
            return res.status(400).json({ success: false, error: 'Invalid month', message: 'Month must be YYYY-MM.' });
        }
        const locked = await db.query(
          `SELECT id FROM billing_reconciliation_logs WHERE reseller_id=$1 AND reconciliation_month=$2::date AND reconciliation_status IN ('approved','reconciled','finalized') LIMIT 1`,
          [resellerId, monthDate]
        );
        if (locked.rows.length) {
            return res.status(403).json({ success: false, error: 'Month is locked', message: 'Cannot modify commission for approved reconciliation.' });
        }
        return next();
    } catch (error) {
        console.error('Error checking commission lock:', error);
        return res.status(error.status || 500).json({ success: false, error: 'Lock check failed', message: 'Could not verify reconciliation lock. Please retry.' });
    }
}
