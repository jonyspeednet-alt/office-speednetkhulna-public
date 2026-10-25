// Read-only commission/profit-share views for channel and MAC partners.
const pool = require("../../utilities/db");
const { getDhakaMonthYm } = require("../reseller/utils");
const { getProductDeductionForMonth, roundAmount } = require("../../utilities/channelProductHelpers");

const getSummary = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
      ? String(req.query.month)
      : getDhakaMonthYm();

    const profileResult = await pool.query(
      `SELECT COALESCE(
          (SELECT profit_share_percentage FROM channel_partner_profile_settings WHERE reseller_id = $1),
          (SELECT profit_share_pct FROM channel_commission_logs WHERE reseller_id = $1 ORDER BY month DESC LIMIT 1),
          0
        )::numeric AS profit_share_percentage,
        (SELECT COUNT(*)::int FROM channel_partner_users WHERE reseller_id = $1) AS total_users,
        (SELECT COUNT(*)::int FROM channel_partner_users WHERE reseller_id = $1 AND status = 'active') AS active_users`,
      [resellerId],
    );

    const collectionResult = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE amount_paid > 0)::int AS paying_users,
          COALESCE(SUM(amount_due), 0)::numeric AS total_due,
          COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
          COALESCE(SUM(realized_amount), 0)::numeric AS total_realized,
          COALESCE(SUM(deferred_amount), 0)::numeric AS total_deferred
       FROM channel_user_payments
       WHERE reseller_id = $1 AND service_period = $2::date`,
      [resellerId, `${month}-01`],
    );
    const [profile] = profileResult.rows;
    const [collection] = collectionResult.rows;

    const logResult = await pool.query(
      `SELECT total_users, paying_users, total_collection, profit_share_pct,
              gross_commission, partner_advances, product_deduction, deferred_amount,
              adjustments, deductions, net_commission, previous_balance, total_payable,
              paid_amount, closing_balance, status, payment_status
       FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2 LIMIT 1`,
      [resellerId, month],
    );
    const log = logResult.rows[0] || null;
    const advanceResult = await pool.query(
      `SELECT COALESCE(SUM(advance_amount), 0)::numeric AS total
       FROM channel_partner_advances
       WHERE reseller_id = $1 AND advance_month = $2::date
         AND settlement_status IN ('pending_adjustment', 'adjusted')`,
      [resellerId, `${month}-01`],
    );
    const paidResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM channel_commission_payments
       WHERE reseller_id = $1 AND commission_log_id IN (
         SELECT id FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2
       )`,
      [resellerId, month],
    );
    const previousResult = await pool.query(
      `SELECT COALESCE(closing_balance, 0)::numeric AS balance
       FROM channel_commission_logs
       WHERE reseller_id = $1 AND month < $2
       ORDER BY month DESC LIMIT 1`,
      [resellerId, month],
    );

    const pct = Number(log?.profit_share_pct ?? profile.profit_share_percentage ?? 0);
    const realized = Number(collection.total_realized || 0);
    const deferred = Number(log?.deferred_amount ?? collection.total_deferred ?? 0);
    const advances = Number(log?.partner_advances ?? advanceResult.rows[0]?.total ?? 0);
    const productDeduction = Number(log?.product_deduction ?? await getProductDeductionForMonth(resellerId, month));
    const gross = Number(log?.gross_commission ?? roundAmount(realized * pct / 100));
    const adjustments = Number(log?.adjustments || 0);
    const deductions = Number(log?.deductions || 0);
    const net = log ? Number(log.net_commission || 0) : roundAmount(gross - advances - productDeduction - deferred + adjustments - deductions);
    const previous = log ? Number(log.previous_balance || 0) : Number(previousResult.rows[0]?.balance || 0);
    const paid = log ? Number(log.paid_amount || 0) : Number(paidResult.rows[0]?.total || 0);

    res.json({
      month,
      finalized: log?.status === "finalized",
      commission_status: log?.status || "not_generated",
      payment_status: log?.payment_status || (paid > 0 ? "partial" : "pending"),
      profit_share_percentage: pct,
      total_users: Number(log?.total_users ?? profile.total_users ?? 0),
      active_users: Number(profile.active_users || 0),
      paying_users: Number(log?.paying_users ?? collection.paying_users ?? 0),
      total_due: Number(collection.total_due || 0),
      total_collected: Number(log?.total_collection ?? collection.total_collected ?? 0),
      total_realized: realized,
      total_deferred: deferred,
      gross_commission: gross,
      partner_advances: advances,
      product_deduction: productDeduction,
      adjustments,
      deductions,
      net_commission: net,
      previous_balance: previous,
      total_payable: log ? Number(log.total_payable || 0) : roundAmount(net + previous),
      paid_to_partner: paid,
      closing_balance: log ? Number(log.closing_balance || 0) : roundAmount(net + previous - paid),
    });
  } catch (error) {
    console.error("partner commission summary error:", error);
    res.status(500).json({ message: "কমিশনের তথ্য লোড করা যায়নি।" });
  }
};

const getHistory = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT month, total_users, paying_users, total_collection, profit_share_pct,
              gross_commission, adjustments, deductions, net_commission, previous_balance,
              total_payable, paid_amount, closing_balance, payment_status, finalized_at
       FROM channel_commission_logs
       WHERE reseller_id = $1 AND status = 'finalized'
       ORDER BY month DESC LIMIT 24`,
      [req.reseller.id],
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error("partner commission history error:", error);
    res.status(500).json({ message: "কমিশন হিস্ট্রি লোড করা যায়নি।" });
  }
};

const getPayments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ccp.id, ccp.amount, ccp.payment_method, ccp.payment_date,
              ccp.reference_no, ccl.month AS commission_month
       FROM channel_commission_payments ccp
       LEFT JOIN channel_commission_logs ccl ON ccl.id = ccp.commission_log_id
       WHERE ccp.reseller_id = $1
       ORDER BY ccp.payment_date DESC, ccp.id DESC LIMIT 100`,
      [req.reseller.id],
    );
    res.json({ rows: result.rows, total: roundAmount(result.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)) });
  } catch (error) {
    console.error("partner commission payments error:", error);
    res.status(500).json({ message: "পেমেন্ট হিস্ট্রি লোড করা যায়নি।" });
  }
};

module.exports = { getSummary, getHistory, getPayments };
