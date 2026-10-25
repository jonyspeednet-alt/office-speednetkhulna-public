const pool = require("./db");

const roundAmount = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const monthToServiceDate = (monthYm) => {
  const m = String(monthYm || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  return `${m}-01`;
};

const sumProductDeduction = async (resellerId, monthYm, queryClient = pool) => {
  const serviceMonth = monthToServiceDate(monthYm);
  if (!serviceMonth) return 0;
  const result = await queryClient.query(
    `SELECT COALESCE(SUM(line_total), 0)::numeric AS total
     FROM channel_user_product_usage
     WHERE reseller_id = $1 AND service_month = $2::date`,
    [resellerId, serviceMonth],
  );
  return roundAmount(result.rows[0]?.total || 0);
};

const isCommissionMonthLocked = async (resellerId, monthYm) => {
  const month = String(monthYm || "").trim();
  if (!month) return false;

  const recon = await pool.query(
    `SELECT id FROM billing_reconciliation_logs
     WHERE reseller_id = $1 AND reconciliation_month = $2::date
       AND reconciliation_status IN ('approved','reconciled','finalized')
     LIMIT 1`,
    [resellerId, monthToServiceDate(month)],
  );
  if (recon.rows.length) return true;

  const comm = await pool.query(
    `SELECT id FROM channel_commission_logs
     WHERE reseller_id = $1 AND month = $2 AND status = 'finalized'
     LIMIT 1`,
    [resellerId, month],
  );
  return comm.rows.length > 0;
};

const recalcCommissionNet = (row) => {
  const gross = Number(row.gross_commission || 0);
  const advances = Number(row.partner_advances || 0);
  const product = Number(row.product_deduction || 0);
  const deferred = Number(row.deferred_amount || 0);
  const adjustments = Number(row.adjustments || 0);
  const deductions = Number(row.deductions || 0);
  const previous = Number(row.previous_balance || 0);
  const paid = Number(row.paid_amount || 0);

  const net = roundAmount(
    gross - advances - product - deferred + adjustments - deductions,
  );
  const totalPayable = roundAmount(net + previous);
  const closing = roundAmount(totalPayable - paid);
  return { net_commission: net, total_payable: totalPayable, closing_balance: closing };
};

const getProductDeductionForMonth = async (resellerId, monthYm, queryClient = pool) => {
  const month = String(monthYm || "").trim();
  if (!month) return 0;

  const manualResult = await queryClient.query(
    `SELECT amount FROM channel_partner_manual_product_charges
     WHERE reseller_id = $1 AND month = $2`,
    [resellerId, month]
  );
  
  if (manualResult.rows.length > 0) {
    return roundAmount(manualResult.rows[0].amount);
  }
  
  return sumProductDeduction(resellerId, month, queryClient);
};

module.exports = {
  roundAmount,
  monthToServiceDate,
  sumProductDeduction,
  isCommissionMonthLocked,
  recalcCommissionNet,
  getProductDeductionForMonth,
};
