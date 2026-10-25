const pool = require('../utilities/db');

/**
 * Verify reconciliation snapshot integrity
 * Checks if snapshot data still matches current database state
 */
const verifyReconciliationSnapshot = async (req, res) => {
    try {
        const { reconciliationId } = req.params;

        const result = await pool.query(
            'SELECT * FROM verify_reconciliation_snapshot($1)',
            [reconciliationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Reconciliation not found'
            });
        }

        const v = result.rows[0];

        res.json({
            success: v.is_valid,
            message: v.message,
            details: {
                snapshot_total_realized: v.snap_realized,
                current_total_realized: v.curr_realized,
                snapshot_advances: v.snap_advances,
                current_advances: v.curr_advances,
                snapshot_commission: v.snap_commission,
                current_commission: v.curr_commission
            }
        });
    } catch (error) {
        console.error('auditVerification.verifyReconciliationSnapshot:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify reconciliation snapshot',
        });
    }
};

/**
 * Check audit log completeness for a reseller over a date range
 */
const checkAuditLogCompleteness = async (req, res) => {
    try {
        const { resellerId } = req.params;
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                error: 'start_date and end_date are required (YYYY-MM-DD)'
            });
        }

        const result = await pool.query(
            'SELECT * FROM check_audit_log_completeness($1, $2, $3)',
            [resellerId, start_date, end_date]
        );

        const check = result.rows[0];

        res.json({
            success: true,
            data: {
                total_events: check.total_events,
                first_event_id: check.first_event_id,
                last_event_id: check.last_event_id,
                date_range_ok: check.date_range_ok,
                message: check.message
            }
        });
    } catch (error) {
        console.error('auditVerification.checkAuditLogCompleteness:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check audit log completeness',
        });
    }
};

/**
 * Run full financial integrity check for a reseller/month
 */
const runIntegrityCheck = async (req, res) => {
    try {
        const { resellerId } = req.params;
        const { month } = req.query; // YYYY-MM

        if (!month) {
            return res.status(400).json({
                success: false,
                error: 'month is required (YYYY-MM)'
            });
        }

        const result = await pool.query(
            'SELECT * FROM full_financial_integrity_check($1, $2)',
            [resellerId, month]
        );

        const checks = result.rows;
        const allPassed = checks.every(c => c.passed);

        res.json({
            success: allPassed,
            message: allPassed
                ? 'All integrity checks passed'
                : 'Some integrity checks failed',
            reseller_id: resellerId,
            month: month,
            checks: checks.map(c => ({
                name: c.check_name,
                passed: c.passed,
                detail: c.detail
            }))
        });
    } catch (error) {
        console.error('auditVerification.runIntegrityCheck:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run integrity check',
        });
    }
};

/**
 * Get financial health summary for all channel partners
 */
const getFinancialHealthSummary = async (req, res) => {
    try {
        const { resellerId } = req.params;

        let query = 'SELECT * FROM channel_partner_financial_health';
        const params = [];

        if (resellerId) {
            query += ' WHERE reseller_id = $1';
            params.push(resellerId);
        }

        query += ' ORDER BY partner_name ASC';

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('auditVerification.getFinancialHealthSummary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get financial health summary'
        });
    }
};

/**
 * Get raw audit log entries for a reseller
 */
const getAuditLog = async (req, res) => {
    try {
        const { resellerId } = req.params;
        const { start_date, end_date, limit = 50 } = req.query;

        // Validate date/limit inputs — never push raw strings into the query
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (start_date && !DATE_RE.test(String(start_date))) {
            return res.status(400).json({ success: false, error: 'Invalid start_date (expected YYYY-MM-DD)' });
        }
        if (end_date && !DATE_RE.test(String(end_date))) {
            return res.status(400).json({ success: false, error: 'Invalid end_date (expected YYYY-MM-DD)' });
        }
        const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));

        let query = `
      SELECT
        audit.id, audit.reseller_id, audit.action_type,
        audit.entity_type AS reference_table, audit.entity_id AS reference_id,
        audit.amount_before, audit.amount_after,
        audit.amount_after - audit.amount_before AS amount_delta,
        audit.actor_user_id, actor.full_name AS actor_name,
        audit.notes AS note, audit.created_at
      FROM reseller_financial_audit_log_immutable audit
      LEFT JOIN users actor ON actor.id = audit.actor_user_id
      WHERE audit.reseller_id = $1
    `;
        const params = [resellerId];
        let idx = 2;

        if (start_date) {
            query += ` AND audit.created_at >= $${idx}`;
            params.push(start_date);
            idx++;
        }
        if (end_date) {
            query += ` AND audit.created_at <= $${idx}`;
            params.push(end_date + ' 23:59:59');
            idx++;
        }

        query += ` ORDER BY audit.created_at DESC LIMIT $${idx}`;
        params.push(safeLimit);

        const result = await pool.query(query, params);

        res.json({
            success: true,
            data: result.rows,
            count: result.rows.length
        });
    } catch (error) {
        console.error('auditVerification.getAuditLog:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get audit log'
        });
    }
};

module.exports = {
    verifyReconciliationSnapshot,
    checkAuditLogCompleteness,
    runIntegrityCheck,
    getFinancialHealthSummary,
    getAuditLog
};
