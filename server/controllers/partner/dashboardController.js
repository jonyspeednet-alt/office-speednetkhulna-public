// controllers/partner/dashboardController.js — reseller self-service dashboard
// Replaces dashboard.php + ajax_billing.php. Reuses the office billing engine
// so the numbers match the admin panel exactly:
//   - previous due  → fn_reseller_previous_due() / finalized bill's previous_due
//   - projected bill → calculateMonthlyBillBreakdown() / finalized bill amount
//   - total due      → same carry-forward formula as billing.js getMonthlySummary
const pool = require("../../utilities/db");
const {
  parseAmount,
  getDhakaMonthYm,
  normalizePartnerType,
  monthInfo,
  toDateOnlyString,
  LOG_TYPE_EXPR,
} = require("../reseller/utils");
const { calculateMonthlyBillBreakdown } = require("../reseller/service");

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** GET /api/partner/dashboard */
const getDashboard = async (req, res) => {
  try {
    const reseller = req.reseller;
    const partnerType = normalizePartnerType(reseller.partner_type);
    if (partnerType !== "distribution_partner") {
      return res.json({
        reseller: {
          id: reseller.id,
          partner_type: partnerType,
          reseller_name: reseller.reseller_name,
          company_name: reseller.company_name,
          profile_image: reseller.profile_image || null,
        },
      });
    }
    const resellerId = reseller.id;
    const ym = getDhakaMonthYm();
    const info = monthInfo(ym);
    const logTypeExpr = LOG_TYPE_EXPR();

    // Finalized bill for the current month (if any)
    const billRes = await pool.query(
      `SELECT amount, adjustment, previous_due, bill_details
       FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2::date LIMIT 1`,
      [resellerId, info.monthStartStr],
    );
    const bill = billRes.rows[0] || null;

    // Current-month payments / discounts / product charges
    const logsRes = await pool.query(
      `SELECT
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment')), 0) AS paid,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} = 'discount'), 0) AS discount,
         COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product','product_charge','charge')), 0) AS product_charges
       FROM billing_logs
       WHERE reseller_id = $1
         AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $2`,
      [resellerId, ym],
    );
    const paid = round2(logsRes.rows[0]?.paid);
    const discount = round2(logsRes.rows[0]?.discount);
    const productCharges = round2(logsRes.rows[0]?.product_charges);

    let projected;
    let previousDue;
    if (bill) {
      projected = round2(Number(bill.amount || 0) + Number(bill.adjustment || 0));
      previousDue = round2(bill.previous_due);
    } else {
      let breakdownTotal = 0;
      try {
        const breakdown = await calculateMonthlyBillBreakdown(
          resellerId,
          ym,
          reseller,
        );
        breakdownTotal = Number(breakdown.total || 0);
      } catch (e) {
        console.warn("partner dashboard breakdown warning:", e.message);
      }
      projected = round2(breakdownTotal);
      const dueRes = await pool.query(
        `SELECT fn_reseller_previous_due($1, $2::date) AS prev_due`,
        [resellerId, info.monthStartStr],
      );
      previousDue = round2(dueRes.rows[0]?.prev_due);
    }

    const totalBill = round2(previousDue + projected + productCharges);
    const netDue = round2(totalBill - paid - discount);

    // Recent 5 payments (positive billing_logs)
    const paymentsRes = await pool.query(
      `SELECT id, transaction_amount, change_desc, effective_date
       FROM billing_logs
       WHERE reseller_id = $1 AND transaction_amount > 0
       ORDER BY effective_date DESC, created_at DESC LIMIT 5`,
      [resellerId],
    );

    // Recent 5 bandwidth requests
    const requestsRes = await pool.query(
      `SELECT id, bw_type, change_type, amount, admin_status, engineer_status, created_at
       FROM bandwidth_requests
       WHERE reseller_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 5`,
      [resellerId],
    );

    res.json({
      reseller: {
        id: reseller.id,
        partner_type: reseller.partner_type || "distribution_partner",
        reseller_name: reseller.reseller_name,
        company_name: reseller.company_name,
        contact_no: reseller.contact_no,
        pop_location: reseller.pop_location,
        nttn_type: reseller.nttn_type,
        connection_type: reseller.connection_type,
        security_deposit: parseAmount(reseller.security_deposit, 0),
        profile_image: reseller.profile_image || null,
        iig_bw: parseAmount(reseller.iig_bw, 0),
        bdix_bw: parseAmount(reseller.bdix_bw, 0),
        ggc_bw: parseAmount(reseller.ggc_bw, 0),
        fna_bw: parseAmount(reseller.fna_bw, 0),
        cdn_bw: parseAmount(reseller.cdn_bw, 0),
        bcdn_bw: parseAmount(reseller.bcdn_bw, 0),
        nttn_capacity: parseAmount(reseller.nttn_capacity, 0),
        rate_iig: parseAmount(reseller.rate_iig, 0),
        rate_bdix: parseAmount(reseller.rate_bdix, 0),
        rate_ggc: parseAmount(reseller.rate_ggc, 0),
        rate_fna: parseAmount(reseller.rate_fna, 0),
        rate_cdn: parseAmount(reseller.rate_cdn, 0),
        rate_bcdn: parseAmount(reseller.rate_bcdn, 0),
        rate_nttn: parseAmount(reseller.rate_nttn, 0),
      },
      stats: {
        net_due: netDue,
        previous_due: previousDue,
        projected_bill: projected,
        paid_this_month: paid,
        has_finalized_bill: Boolean(bill),
      },
      recent_payments: paymentsRes.rows,
      recent_requests: requestsRes.rows,
    });
  } catch (error) {
    console.error("partner getDashboard error:", error);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
};

/** GET /api/partner/billing/current-bill */
const getCurrentBill = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const ym = getDhakaMonthYm();
    const info = monthInfo(ym);

    const billRes = await pool.query(
      `SELECT amount, bill_details FROM monthly_bills
       WHERE reseller_id = $1 AND bill_month = $2::date LIMIT 1`,
      [resellerId, info.monthStartStr],
    );

    if (billRes.rows[0]) {
      let items = [];
      try {
        const raw = billRes.rows[0].bill_details;
        items = typeof raw === "string" ? JSON.parse(raw) : raw || [];
      } catch (_) {
        items = [];
      }
      if (!Array.isArray(items)) items = [];
      return res.json({
        finalized: true,
        items,
        total: parseAmount(billRes.rows[0].amount, 0),
      });
    }

    // No finalized bill yet — show the projected breakdown (matches the card)
    const breakdown = await calculateMonthlyBillBreakdown(
      resellerId,
      ym,
      req.reseller,
    );
    res.json({ finalized: false, items: breakdown.items, total: breakdown.total });
  } catch (error) {
    console.error("partner getCurrentBill error:", error);
    res.status(500).json({ message: "Failed to load current bill" });
  }
};

/** GET /api/partner/billing/previous-due — last 5 months w/ closing due */
const getPreviousDue = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const billsRes = await pool.query(
      `SELECT id, bill_month, amount, previous_due, adjustment, created_at
       FROM monthly_bills WHERE reseller_id = $1
       ORDER BY bill_month DESC LIMIT 5`,
      [resellerId],
    );

    const rows = [];
    for (const b of billsRes.rows) {
      // B8: see invoiceController — never toISOString() a pg DATE.
      const ym = toDateOnlyString(b.bill_month).slice(0, 7);
      const paidRes = await pool.query(
        `SELECT COALESCE(SUM(transaction_amount),0) AS total
         FROM billing_logs
         WHERE reseller_id = $1 AND TO_CHAR(COALESCE(effective_date, created_at),'YYYY-MM') = $2`,
        [resellerId, ym],
      );
      const paid = parseAmount(paidRes.rows[0]?.total, 0);
      const prevDue = parseAmount(b.previous_due, 0);
      const amount = parseAmount(b.amount, 0);
      const adj = parseAmount(b.adjustment, 0);
      rows.push({
        id: b.id,
        bill_month: b.bill_month,
        created_at: b.created_at,
        previous_due: prevDue,
        amount,
        adjustment: adj,
        paid,
        closing_due: round2(prevDue + amount + adj - paid),
      });
    }
    res.json({ rows });
  } catch (error) {
    console.error("partner getPreviousDue error:", error);
    res.status(500).json({ message: "Failed to load billing history" });
  }
};

/** GET /api/partner/billing/paid-this-month */
const getPaidThisMonth = async (req, res) => {
  try {
    const resellerId = req.reseller.id;
    const ym = getDhakaMonthYm();
    const paymentsRes = await pool.query(
      `SELECT id, transaction_amount, change_desc, effective_date
       FROM billing_logs
       WHERE reseller_id = $1 AND transaction_amount > 0
         AND TO_CHAR(COALESCE(effective_date, created_at),'YYYY-MM') = $2
       ORDER BY effective_date DESC`,
      [resellerId, ym],
    );
    const total = paymentsRes.rows.reduce(
      (s, p) => s + parseAmount(p.transaction_amount, 0),
      0,
    );
    res.json({ rows: paymentsRes.rows, total: round2(total) });
  } catch (error) {
    console.error("partner getPaidThisMonth error:", error);
    res.status(500).json({ message: "Failed to load payments" });
  }
};

module.exports = {
  getDashboard,
  getCurrentBill,
  getPreviousDue,
  getPaidThisMonth,
};
