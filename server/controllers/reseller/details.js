const pool = require("../../utilities/db");
const {
  canViewResellerFinancials,
  hasAnyPermission,
  isAdminRole,
  getDhakaMonthYm,
  previousMonthYm,
  normalizedPartnerTypeSql,
  LOG_TYPE_EXPR_SIMPLE
} = require("./utils");
const { initialize, joiningDateExpr, detectChannelPartnerColumns, hasChannelPartnerColumns, hasResellerPartnerTypeColumn, hasResellerOtcAppliedMonthColumn, hasMaximSuffixColumn } = require("./dbSetup");
const { calculateMonthlyBillBreakdown } = require("./service");
const { resolvePermission } = require("../../utilities/permissionRegistry");

// Avoids expensive to_jsonb() per row — just reads the column directly with a fallback
const LOG_TYPE_EXPR = LOG_TYPE_EXPR_SIMPLE();

const getResellerProfileDetails = async (req, res) => {
  try {
    await initialize();
    await detectChannelPartnerColumns();
    const { id } = req.params;
    const perms = req.user?.permissions || {};
    const isAdmin = isAdminRole(req.user) || !!perms.all_access;
    const canViewProfile =
      isAdmin ||
      hasAnyPermission(req.user, [
        "reseller.profile",
        "reseller.list",
        "reseller.tasks.manage",
        "reseller.status_noc.view",
      ]);
    if (!canViewProfile) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Phase 1: fetch reseller row (other queries need partner_type from this)
    const resellerResult = await pool.query(
      `SELECT
        r.id,
        r.user_id AS reseller_code,
        COALESCE(r.reseller_name, r.company_name) AS name,
        r.company_name,
        r.contact_no AS phone,
        r.pop_location,
        r.latitude,
        r.longitude,
        ${hasResellerPartnerTypeColumn() ? `COALESCE(${normalizedPartnerTypeSql("COALESCE(r.partner_type, '')")}, 'distribution_partner') AS partner_type,` : `'distribution_partner' AS partner_type,`}
        COALESCE(r.status, 'active') AS status,
        COALESCE(r.iig_bw,0)::numeric AS iig_bw,
        COALESCE(r.bdix_bw,0)::numeric AS bdix_bw,
        COALESCE(r.ggc_bw,0)::numeric AS ggc_bw,
        COALESCE(r.fna_bw,0)::numeric AS fna_bw,
        COALESCE(r.cdn_bw,0)::numeric AS cdn_bw,
        COALESCE(r.bcdn_bw,0)::numeric AS bcdn_bw,
        COALESCE(r.nttn_capacity,0)::numeric AS nttn_capacity,
        COALESCE(r.rate_iig,0)::numeric AS rate_iig,
        COALESCE(r.rate_bdix,0)::numeric AS rate_bdix,
        COALESCE(r.rate_ggc,0)::numeric AS rate_ggc,
        COALESCE(r.rate_fna,0)::numeric AS rate_fna,
        COALESCE(r.rate_cdn,0)::numeric AS rate_cdn,
        COALESCE(r.rate_bcdn,0)::numeric AS rate_bcdn,
        COALESCE(r.rate_nttn,0)::numeric AS rate_nttn,
        COALESCE(r.nttn_type,'') AS nttn_type,
        COALESCE(r.nttn_link,'') AS nttn_link,
        COALESCE(r.connection_type,'') AS connection_type,
        0::numeric AS previous_month_due,
        0::numeric AS current_projected_bill,
        COALESCE(r.security_deposit,0)::numeric AS security_deposit,
        COALESCE(r.otc_charge,0)::numeric AS otc_charge,
        ${hasResellerOtcAppliedMonthColumn() ? `r.otc_charge_applied_month,` : `NULL::date AS otc_charge_applied_month,`}
        COALESCE(r.real_ip_count,0)::int AS real_ip_count,
        COALESCE(r.real_ip_price,0)::numeric AS real_ip_price,
        COALESCE(
          (SELECT COUNT(*)::int FROM channel_partner_users cpu WHERE cpu.reseller_id = r.id),
          ${hasChannelPartnerColumns() ? `COALESCE(r.channel_user_count,0)` : `0`}
        )::int AS channel_user_count,
        COALESCE(
          (SELECT COUNT(*)::int FROM channel_partner_users cpu WHERE cpu.reseller_id = r.id AND cpu.status = 'active'),
          0
        )::int AS channel_active_user_count,
        COALESCE(cpps.profit_share_percentage, 0)::numeric AS profit_share_percentage,
        ${hasMaximSuffixColumn() ? `COALESCE(r.maxim_suffix,'')` : `''`} AS maxim_suffix,
        r.next_pay_date,
        r.created_at,
        ${joiningDateExpr("r")} AS joining_date
      FROM resellers r
      LEFT JOIN channel_partner_profile_settings cpps ON cpps.reseller_id = r.id
      WHERE r.id = $1`,
      [id],
    );

    if (!resellerResult.rows.length) {
      return res.status(404).json({ message: "Reseller not found" });
    }
    const reseller = resellerResult.rows[0];

    const currentMonth = getDhakaMonthYm();
    const currentMonthDate = `${currentMonth}-01`;
    // Compute next month boundary for index-friendly range filter instead of TO_CHAR()
    const [yr, mo] = currentMonth.split('-').map(Number);
    const nextMonthDate = mo === 12
      ? `${yr + 1}-01-01`
      : `${yr}-${String(mo + 1).padStart(2, '0')}-01`;

    // Phase 2: all independent queries in parallel (was 8 sequential round-trips)
    const [
      currentMonthBillingResult,
      currentBillResult,
      lastBillResult,
      recentRequestsResult,
      statementResult,
      recentBillsResult,
      billPaymentsByMonthResult,
      partnersResult,
    ] = await Promise.all([
      // Paid + discount + product charges for current month — single query replaces 3 separate ones
      pool.query(
        `SELECT
          COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} = 'payment' THEN transaction_amount ELSE 0 END), 0)::numeric AS paid,
          COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} = 'discount' THEN transaction_amount ELSE 0 END), 0)::numeric AS discount,
          COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} IN ('product','product_charge','charge') THEN transaction_amount ELSE 0 END), 0)::numeric AS product
         FROM billing_logs
         WHERE reseller_id = $1
           AND COALESCE(effective_date, created_at) >= $2::date
           AND COALESCE(effective_date, created_at) < $3::date`,
        [id, currentMonthDate, nextMonthDate],
      ),
      // Current month finalized bill
      pool.query(
        `SELECT id, bill_month, created_at,
                COALESCE(amount,0)::numeric AS amount,
                COALESCE(adjustment,0)::numeric AS adjustment,
                COALESCE(previous_due,0)::numeric AS previous_due
         FROM monthly_bills
         WHERE reseller_id = $1 AND bill_month = $2::date
         LIMIT 1`,
        [id, currentMonthDate],
      ),
      // Most recent bill (for pending-bill warning)
      pool.query(
        `SELECT id, bill_month FROM monthly_bills WHERE reseller_id = $1 ORDER BY bill_month DESC LIMIT 1`,
        [id],
      ),
      // Recent bandwidth requests
      pool.query(
        `SELECT id, bw_type, change_type, amount AS requested_bw_mbps,
                requested_effective_date, created_at, COALESCE(admin_status,'pending') AS admin_status
         FROM bandwidth_requests
         WHERE reseller_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [id],
      ),
      // Statement items: invoices + billing log entries
      pool.query(
        `SELECT 'invoice'::text AS type, id, COALESCE(amount,0)::numeric AS amount,
                created_at AS date, TO_CHAR(bill_month, 'FMMonth YYYY') AS description
         FROM monthly_bills
         WHERE reseller_id = $1
         UNION ALL
         SELECT ${LOG_TYPE_EXPR}::text AS type, id,
                COALESCE(transaction_amount,0)::numeric AS amount,
                effective_date AS date,
                COALESCE(change_desc, CASE WHEN ${LOG_TYPE_EXPR} = 'discount' THEN 'Discount' ELSE 'Payment Received' END) AS description
         FROM billing_logs
         WHERE reseller_id = $1
           AND COALESCE(transaction_amount,0) > 0
           AND ${LOG_TYPE_EXPR} IN ('payment','discount','product','product_charge','charge')
         ORDER BY date DESC
         LIMIT 20`,
        [id],
      ),
      // Recent finalized bills (for bill history)
      pool.query(
        `SELECT id, bill_month, amount AS final_amount, adjustment, previous_due, created_at
         FROM monthly_bills
         WHERE reseller_id = $1
         ORDER BY bill_month DESC
         LIMIT 5`,
        [id],
      ),
      // Aggregated billing payments grouped by month — replaces N+1 loop
      pool.query(
        `SELECT
          TO_CHAR(DATE_TRUNC('month', COALESCE(effective_date, created_at)), 'YYYY-MM') AS ym,
          COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} IN ('payment','discount') THEN transaction_amount ELSE 0 END), 0)::numeric AS paid,
          COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} IN ('product','product_charge','charge') THEN transaction_amount ELSE 0 END), 0)::numeric AS product_charges
         FROM billing_logs
         WHERE reseller_id = $1
           AND COALESCE(effective_date, created_at) >= (DATE_TRUNC('month', NOW()) - INTERVAL '5 months')
         GROUP BY TO_CHAR(DATE_TRUNC('month', COALESCE(effective_date, created_at)), 'YYYY-MM')`,
        [id],
      ),
      // Reseller partners (multiple partner names + contacts)
      pool.query(
        `SELECT id, partner_name, contact_no, sort_order
         FROM reseller_partners WHERE reseller_id = $1 ORDER BY sort_order ASC, id ASC`,
        [id],
      ),
    ]);

    const totalPaidCurrentMonth    = Number(currentMonthBillingResult.rows[0]?.paid    || 0);
    const totalDiscountCurrentMonth = Number(currentMonthBillingResult.rows[0]?.discount || 0);
    const totalProductCurrentMonth  = Number(currentMonthBillingResult.rows[0]?.product  || 0);
    const currentBill = currentBillResult.rows[0] || null;
    const lastBill    = lastBillResult.rows[0]    || null;

    let paymentsAfterLastBill = 0;
    let productChargesAfterLastBill = 0;
    let netDue = 0;
    let calcTooltip = "";
    let projectedBillCurrentMonth = 0;
    let previousDueCurrentMonth   = 0;
    // Compute previous_due dynamically (stale cache column dropped)
    try {
      const pdQ = await pool.query(
        `SELECT fn_reseller_previous_due($1, $2::date) AS prev_due`,
        [id, `${currentMonth}-01`],
      );
      previousDueCurrentMonth = Number(pdQ.rows[0]?.prev_due || 0);
    } catch (e) {
      previousDueCurrentMonth = 0;
    }

    // Phase 3: one conditional query (depends on currentBill from phase 2)
    if (currentBill) {
      projectedBillCurrentMonth = Number(currentBill.amount     || 0) + Number(currentBill.adjustment || 0);
      previousDueCurrentMonth   = Number(currentBill.previous_due || 0);
      const afterBillResult = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} IN ('payment','discount') THEN transaction_amount ELSE 0 END), 0)::numeric AS paid,
            COALESCE(SUM(CASE WHEN ${LOG_TYPE_EXPR} IN ('product','product_charge','charge') THEN transaction_amount ELSE 0 END), 0)::numeric AS product_charges
         FROM billing_logs
         WHERE reseller_id = $1 AND effective_date > $2`,
        [id, currentBill.created_at],
      );
      paymentsAfterLastBill       = Number(afterBillResult.rows[0]?.paid            || 0);
      productChargesAfterLastBill = Number(afterBillResult.rows[0]?.product_charges || 0);
    } else {
      try {
        const breakdown = await calculateMonthlyBillBreakdown(id, currentMonth);
        projectedBillCurrentMonth = Number(breakdown.total || 0);
      } catch (breakdownErr) {
        projectedBillCurrentMonth = 0;
        console.warn(`getResellerProfileDetails breakdown fallback failed for reseller=${id}, month=${currentMonth}: ${breakdownErr.message}`);
      }
    }

    projectedBillCurrentMonth = Math.round(projectedBillCurrentMonth * 100) / 100;
    previousDueCurrentMonth   = Math.round(previousDueCurrentMonth   * 100) / 100;

    if (currentBill) {
      netDue = previousDueCurrentMonth + projectedBillCurrentMonth + productChargesAfterLastBill - paymentsAfterLastBill;
    } else {
      netDue = previousDueCurrentMonth + projectedBillCurrentMonth + totalProductCurrentMonth - totalPaidCurrentMonth - totalDiscountCurrentMonth;
    }
    calcTooltip = "Formula: (Previous Due + Projected Bill + Product Charges) - Paid This Month - Discount This Month";

    let pendingBillWarning = "";
    const isChannelPartner = String(reseller.partner_type || "") === "channel_partner";
    if (!isChannelPartner && lastBill?.bill_month) {
      const lastBillMonth  = String(lastBill.bill_month).slice(0, 7);
      const prevMonthCheck = previousMonthYm(currentMonth);
      if (lastBillMonth < prevMonthCheck) {
        pendingBillWarning = `Warning: Bill for last month (${prevMonthCheck}) has not been generated.`;
      }
    }

    // Build billHistory from aggregated result — no more per-bill queries
    const paymentsByMonth = {};
    for (const row of billPaymentsByMonthResult.rows) {
      paymentsByMonth[row.ym] = {
        paid: Number(row.paid),
        product_charges: Number(row.product_charges),
      };
    }
    const billHistory = recentBillsResult.rows.map((bill) => {
      const ym = String(bill.bill_month).slice(0, 7);
      const { paid = 0, product_charges: productCharges = 0 } = paymentsByMonth[ym] || {};
      const prevDue     = Number(bill.previous_due  || 0);
      const amount      = Number(bill.final_amount  || 0);
      const adj         = Number(bill.adjustment    || 0);
      const closingDue  = prevDue + amount + adj + productCharges - paid;
      return { ...bill, paid, closing_due: closingDue };
    });

    const statementItems = statementResult.rows.map((item) => ({
      ...item,
      action_url: item.type === "invoice" ? `/view-static-invoice?id=${item.id}` : null,
    }));

    const canViewFinancials = canViewResellerFinancials(req.user);
    const canAddPayment  = isAdmin || resolvePermission(req.user, "billing.logs.view");
    const canAddDiscount = canAddPayment || resolvePermission(req.user, "billing.discount.add");
    const canViewInvoice = canViewFinancials;

    const safeReseller = { ...reseller };
    safeReseller.previous_month_due      = previousDueCurrentMonth;
    safeReseller.current_projected_bill  = projectedBillCurrentMonth;
    if (!canViewFinancials) {
      ["rate_iig","rate_bdix","rate_ggc","rate_fna","rate_cdn","rate_bcdn","rate_nttn",
       "previous_month_due","current_projected_bill","security_deposit",
       "next_pay_date","otc_charge","real_ip_price"].forEach((k) => {
        safeReseller[k] = null;
      });
    }

    const paidForDueCalculation = currentBill
      ? paymentsAfterLastBill
      : totalPaidCurrentMonth + totalDiscountCurrentMonth;

    const safeStats = canViewFinancials
      ? {
          total_paid_current_month:     totalPaidCurrentMonth,
          total_discount_current_month: totalDiscountCurrentMonth,
          previous_due_current_month:   previousDueCurrentMonth,
          projected_bill_current_month: projectedBillCurrentMonth,
          calculation_month:            currentMonth,
          paid_for_due_calculation:     paidForDueCalculation,
          payments_after_last_bill:     paymentsAfterLastBill,
          net_due:                      netDue,
          calc_tooltip:                 calcTooltip,
          pending_bill_warning:         pendingBillWarning,
          has_current_bill:             Boolean(currentBill),
        }
      : {
          total_paid_current_month:     null,
          total_discount_current_month: null,
          previous_due_current_month:   null,
          projected_bill_current_month: null,
          calculation_month:            null,
          paid_for_due_calculation:     null,
          payments_after_last_bill:     null,
          net_due:                      null,
          calc_tooltip:                 null,
          pending_bill_warning:         "",
          has_current_bill:             false,
        };

    res.json({
      reseller: safeReseller,
      partners: partnersResult.rows,
      permissions: {
        can_view_financials: canViewFinancials,
        can_add_payment:     canViewFinancials && canAddPayment,
        can_add_discount:    canViewFinancials && canAddDiscount,
        can_edit_profile:    isAdmin,
        can_view_invoice:    canViewInvoice,
      },
      stats:           safeStats,
      recent_requests: recentRequestsResult.rows,
      statement_items: canViewFinancials ? statementItems         : [],
      recent_bills:    canViewFinancials ? recentBillsResult.rows : [],
      bill_history:    canViewFinancials ? billHistory            : [],
    });
  } catch (error) {
    console.error("getResellerProfileDetails:", error);
    res.status(500).json({ message: "Failed to load reseller profile details" });
  }
};

module.exports = { getResellerProfileDetails };
