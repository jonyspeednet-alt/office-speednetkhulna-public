const pool = require("../../utilities/db");
const { getDhakaMonthYm, normalizedPartnerTypeSql, normalizeBwType } = require("./utils");

const BW_KEYS = ["iig_bw", "bdix_bw", "ggc_bw", "fna_bw", "cdn_bw", "bcdn_bw", "nttn_capacity"];
const BW_LABELS = { iig_bw: "iig", bdix_bw: "bdix", ggc_bw: "ggc", fna_bw: "fna", cdn_bw: "cdn", bcdn_bw: "bcdn", nttn_capacity: "nttn" };

function reconstructBwHistory(currentBw, implementedRequests, monthList) {
  const bw = {};
  BW_KEYS.forEach((k) => { bw[k] = Number(currentBw[k] || 0); });

  // Sort by implementation_date DESC to walk backwards
  const sortedDesc = [...implementedRequests].sort((a, b) => {
    const da = a.implementation_date ? new Date(a.implementation_date).getTime() : 0;
    const db = b.implementation_date ? new Date(b.implementation_date).getTime() : 0;
    return db - da;
  });

  // For each month in reverse, we need to reverse all changes that happened AFTER that month end
  // monthList is oldest-first: ["2025-08", "2025-09", ..., "2026-07"]
  // We'll build a map of month → snapshot

  // First: identify month-end boundaries
  const monthEndDates = monthList.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m, 0); // last day of month
  });

  // Start: reverse all changes that are after the LAST month in our list
  // (i.e. changes that happened after monthList[-1] month end)
  const lastMonthEnd = monthEndDates[monthEndDates.length - 1];
  const changesAfterLastMonth = sortedDesc.filter((r) => {
    if (!r.implementation_date) return false;
    const d = new Date(r.implementation_date);
    return d > lastMonthEnd;
  });

  // Reverse these to get state at end of last month
  changesAfterLastMonth.forEach((r) => {
    const col = normalizeBwType(r.bw_type);
    const factor = r.change_type === "decrease" ? 1 : -1;
    bw[col] = Math.max(0, bw[col] + factor * Number(r.amount || 0));
  });

  // Now walk months from last to first
  const historyMap = {};

  // Snapshot for end of last month
  historyMap[monthList[monthList.length - 1]] = { ...bw };

  for (let i = monthList.length - 1; i > 0; i--) {
    // Reverse changes that happened in monthList[i] (the month we're backing out of)
    const changesInMonth = sortedDesc.filter((r) => {
      if (!r.implementation_date) return false;
      const d = new Date(r.implementation_date);
      const dYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return dYm === monthList[i];
    });

    changesInMonth.forEach((r) => {
      const col = normalizeBwType(r.bw_type);
      const factor = r.change_type === "decrease" ? 1 : -1;
      bw[col] = Math.max(0, bw[col] + factor * Number(r.amount || 0));
    });

    historyMap[monthList[i - 1]] = { ...bw };
  }

  // Build output array (oldest first)
  return monthList.map((ym) => {
    const snap = historyMap[ym] || {};
    const entry = { month: ym };
    BW_KEYS.forEach((k) => {
      entry[BW_LABELS[k]] = Number(snap[k] || 0);
    });
    entry.total = BW_KEYS.reduce((s, k) => s + Number(snap[k] || 0), 0);
    return entry;
  });
}

const getPartnerReport = async (req, res) => {
  try {
    const { partner_type, status } = req.query;
    const activeStatus = status || "active";

    let whereClause = `WHERE status = $1`;
    const params = [activeStatus];

    if (partner_type && partner_type !== "all") {
      whereClause += ` AND ${normalizedPartnerTypeSql("resellers.partner_type")} = $2`;
      params.push(partner_type);
    }

    const currentMonthYm = getDhakaMonthYm();
    const currentMonthDate = `${currentMonthYm}-01`;

    // 1. Fetch resellers
    const resellerResult = await pool.query(
      `SELECT id, reseller_name, company_name, partner_type, status,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn
       FROM resellers ${whereClause}`,
      params
    );
    const resellers = resellerResult.rows;

    // 2. Compute total bandwidth
    const bandwidthSummary = resellers.reduce(
      (acc, r) => {
        acc.iig += Number(r.iig_bw || 0);
        acc.bdix += Number(r.bdix_bw || 0);
        acc.ggc += Number(r.ggc_bw || 0);
        acc.fna += Number(r.fna_bw || 0);
        acc.cdn += Number(r.cdn_bw || 0);
        acc.bcdn += Number(r.bcdn_bw || 0);
        acc.nttn += Number(r.nttn_capacity || 0);
        acc.total += Number(r.iig_bw || 0) + Number(r.bdix_bw || 0) + Number(r.ggc_bw || 0) +
                     Number(r.fna_bw || 0) + Number(r.cdn_bw || 0) + Number(r.bcdn_bw || 0);
        return acc;
      },
      { iig: 0, bdix: 0, ggc: 0, fna: 0, cdn: 0, bcdn: 0, nttn: 0, total: 0 }
    );

    // 3. Partner type counts
    const partnerTypeCounts = resellers.reduce((acc, r) => {
      const pt = r.partner_type || "distribution_partner";
      acc[pt] = (acc[pt] || 0) + 1;
      return acc;
    }, {});

    // 4. Billing data for current month
    let dueParams = [currentMonthDate];
    let dueQuery = `SELECT id, fn_reseller_previous_due(id, $1::date) AS prev_due FROM resellers`;
    if (partner_type && partner_type !== "all") {
      dueQuery += ` WHERE ${normalizedPartnerTypeSql("resellers.partner_type")} = $2`;
      dueParams.push(partner_type);
    } else if (activeStatus) {
      dueQuery += ` WHERE status = $2`;
      dueParams.push(activeStatus);
    }

    let dueMap = {};
    try {
      const dueResult = await pool.query(dueQuery, dueParams);
      dueResult.rows.forEach((r) => {
        dueMap[r.id] = Number(r.prev_due || 0);
      });
    } catch (e) {
      console.warn("Could not compute previous_due:", e.message);
    }

    // 5. Finalized bills
    const billsResult = await pool.query(
      `SELECT reseller_id, amount, adjustment, previous_due FROM monthly_bills WHERE bill_month = $1`,
      [currentMonthDate]
    );
    const billsMap = {};
    billsResult.rows.forEach((b) => {
      billsMap[b.reseller_id] = b;
    });

    // 6. Billing logs for current month
    const logsResult = await pool.query(
      `SELECT reseller_id,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) IN ('payment') THEN transaction_amount ELSE 0 END) AS paid,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) = 'discount' THEN transaction_amount ELSE 0 END) AS discount,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) IN ('product', 'product_charge', 'charge') THEN transaction_amount ELSE 0 END) AS product_charges
       FROM billing_logs
       WHERE TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $1
       GROUP BY reseller_id`,
      [currentMonthYm]
    );
    const logsMap = {};
    logsResult.rows.forEach((l) => {
      logsMap[l.reseller_id] = l;
    });

    // 7. Build partner rows with billing
    let totalProjected = 0;
    let totalPaid = 0;
    let totalDiscount = 0;
    let totalDue = 0;

    const partnerRows = resellers.map((r) => {
      const bill = billsMap[r.id];
      const logs = logsMap[r.id] || { paid: 0, discount: 0, product_charges: 0 };
      const prevDue = dueMap[r.id] || 0;

      let projected = 0;
      if (bill) {
        projected = Number(bill.amount || 0) + Number(bill.adjustment || 0);
      } else {
        // Compute projected from rates and bandwidth
        projected =
          Number(r.iig_bw || 0) * Number(r.rate_iig || 0) +
          Number(r.bdix_bw || 0) * Number(r.rate_bdix || 0) +
          Number(r.ggc_bw || 0) * Number(r.rate_ggc || 0) +
          Number(r.fna_bw || 0) * Number(r.rate_fna || 0) +
          Number(r.cdn_bw || 0) * Number(r.rate_cdn || 0) +
          Number(r.bcdn_bw || 0) * Number(r.rate_bcdn || 0) +
          Number(r.nttn_capacity || 0) * Number(r.rate_nttn || 0);
      }

      const paid = Number(logs.paid || 0) + Number(logs.discount || 0);
      const due = prevDue + projected - paid;

      totalProjected += projected;
      totalPaid += paid;
      totalDiscount += Number(logs.discount || 0);
      totalDue += Math.max(0, due);

      const totalBw =
        Number(r.iig_bw || 0) + Number(r.bdix_bw || 0) + Number(r.ggc_bw || 0) +
        Number(r.fna_bw || 0) + Number(r.cdn_bw || 0) + Number(r.bcdn_bw || 0);

      return {
        id: r.id,
        name: r.reseller_name || r.company_name || "",
        company: r.company_name || "",
        partner_type: r.partner_type || "distribution_partner",
        total_bw: totalBw,
        iig_bw: Number(r.iig_bw || 0),
        bdix_bw: Number(r.bdix_bw || 0),
        ggc_bw: Number(r.ggc_bw || 0),
        fna_bw: Number(r.fna_bw || 0),
        cdn_bw: Number(r.cdn_bw || 0),
        bcdn_bw: Number(r.bcdn_bw || 0),
        nttn_capacity: Number(r.nttn_capacity || 0),
        projected: Math.round(projected * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        discount: Math.round(Number(logs.discount || 0) * 100) / 100,
        due: Math.round(Math.max(0, due) * 100) / 100,
        prev_due: Math.round(prevDue * 100) / 100,
      };
    });

    const collectionRate = totalProjected > 0 ? Math.round((totalPaid / totalProjected) * 10000) / 100 : 0;

    res.json({
      summary: {
        total_partners: resellers.length,
        partner_type_counts: partnerTypeCounts,
        bandwidth: bandwidthSummary,
        total_projected: Math.round(totalProjected * 100) / 100,
        total_paid: Math.round(totalPaid * 100) / 100,
        total_discount: Math.round(totalDiscount * 100) / 100,
        total_due: Math.round(totalDue * 100) / 100,
        collection_rate: collectionRate,
        month: currentMonthYm,
      },
      partners: partnerRows.sort((a, b) => b.projected - a.projected),
    });
  } catch (error) {
    console.error("getPartnerReport error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const getPartnerTrends = async (req, res) => {
  try {
    const { months, partner_type } = req.query;
    const monthCount = Math.min(Math.max(parseInt(months, 10) || 12, 1), 24);

    // Build list of last N months
    const now = new Date();
    const dhakaOffset = 6 * 60 * 60 * 1000;
    const dhakaNow = new Date(now.getTime() + dhakaOffset);
    const currentYear = dhakaNow.getFullYear();
    const currentMonth = dhakaNow.getMonth();

    const monthList = [];
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthList.push(ym);
    }

    // 1. Monthly bills aggregation per month
    const monthStart = `${monthList[0]}-01`;
    const billsResult = await pool.query(
      `SELECT TO_CHAR(bill_month, 'YYYY-MM') AS ym,
              SUM(amount) AS total_amount,
              SUM(adjustment) AS total_adjustment,
              SUM(previous_due) AS total_prev_due,
              COUNT(*) AS bill_count
       FROM monthly_bills
       WHERE bill_month >= $1::date
       GROUP BY TO_CHAR(bill_month, 'YYYY-MM')
       ORDER BY ym ASC`,
      [monthStart]
    );

    const billsByMonth = {};
    billsResult.rows.forEach((r) => {
      billsByMonth[r.ym] = r;
    });

    // 2. Billing logs (payments/discounts) aggregation per month
    const logsResult = await pool.query(
      `SELECT TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') AS ym,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) IN ('payment') THEN transaction_amount ELSE 0 END) AS total_paid,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) = 'discount' THEN transaction_amount ELSE 0 END) AS total_discount,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) IN ('product', 'product_charge', 'charge') THEN transaction_amount ELSE 0 END) AS total_product
       FROM billing_logs
       WHERE TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') >= $1
       GROUP BY TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM')
       ORDER BY ym ASC`,
      [monthList[0]]
    );

    const logsByMonth = {};
    logsResult.rows.forEach((r) => {
      logsByMonth[r.ym] = r;
    });

    // 3. Bandwidth snapshot (current allocation — no historical BW tracking, use current for all months)
    // We still show current allocation as a reference point
    let bwWhere = `WHERE status = 'active'`;
    const bwParams = [];
    if (partner_type && partner_type !== "all") {
      bwWhere += ` AND ${normalizedPartnerTypeSql("resellers.partner_type")} = $1`;
      bwParams.push(partner_type);
    }

    const bwResult = await pool.query(
      `SELECT ${normalizedPartnerTypeSql("resellers.partner_type")} AS ptype,
              SUM(COALESCE(iig_bw, 0)) AS iig,
              SUM(COALESCE(bdix_bw, 0)) AS bdix,
              SUM(COALESCE(ggc_bw, 0)) AS ggc,
              SUM(COALESCE(fna_bw, 0)) AS fna,
              SUM(COALESCE(cdn_bw, 0)) AS cdn,
              SUM(COALESCE(bcdn_bw, 0)) AS bcdn,
              SUM(COALESCE(nttn_capacity, 0)) AS nttn
       FROM resellers ${bwWhere}
       GROUP BY ptype`,
      bwParams
    );

    // 4. Per-partner-type monthly breakdown
    let partnerTypeWhere = `WHERE status = 'active'`;
    const ptParams = [];
    if (partner_type && partner_type !== "all") {
      partnerTypeWhere += ` AND ${normalizedPartnerTypeSql("r.partner_type")} = $1`;
      ptParams.push(partner_type);
    }

    // Monthly bills by partner_type
    const ptBillsResult = await pool.query(
      `SELECT TO_CHAR(mb.bill_month, 'YYYY-MM') AS ym,
              ${normalizedPartnerTypeSql("r.partner_type")} AS ptype,
              SUM(mb.amount) AS total_amount
       FROM monthly_bills mb
       JOIN resellers r ON r.id = mb.reseller_id
       WHERE mb.bill_month >= $1::date ${partner_type && partner_type !== "all" ? "AND " + normalizedPartnerTypeSql("r.partner_type") + " = $2" : ""}
       GROUP BY ym, ptype
       ORDER BY ym ASC`,
      partner_type && partner_type !== "all" ? [monthStart, partner_type] : [monthStart]
    );

    const ptBillsByMonth = {};
    ptBillsResult.rows.forEach((r) => {
      if (!ptBillsByMonth[r.ym]) ptBillsByMonth[r.ym] = {};
      ptBillsByMonth[r.ym][r.ptype] = Number(r.total_amount || 0);
    });

    // 5. Assemble trend data
    const trends = monthList.map((ym) => {
      const bill = billsByMonth[ym] || {};
      const log = logsByMonth[ym] || {};
      const projected = Number(bill.total_amount || 0) + Number(bill.total_adjustment || 0);
      const paid = Number(log.total_paid || 0) + Number(log.total_discount || 0);
      const due = Number(bill.total_prev_due || 0) + projected - paid;

      return {
        month: ym,
        projected: Math.round(projected * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        discount: Math.round(Number(log.total_discount || 0) * 100) / 100,
        due: Math.round(Math.max(0, due) * 100) / 100,
        prev_due: Math.round(Number(bill.total_prev_due || 0) * 100) / 100,
        product_charges: Math.round(Number(log.total_product || 0) * 100) / 100,
        bill_count: Number(bill.bill_count || 0),
        partner_type_breakdown: ptBillsByMonth[ym] || {},
      };
    });

    // 6. Bandwidth by partner type (current snapshot)
    const bandwidthByType = bwResult.rows.map((r) => ({
      partner_type: r.ptype,
      iig: Number(r.iig || 0),
      bdix: Number(r.bdix || 0),
      ggc: Number(r.ggc || 0),
      fna: Number(r.fna || 0),
      cdn: Number(r.cdn || 0),
      bcdn: Number(r.bcdn || 0),
      nttn: Number(r.nttn || 0),
      total:
        Number(r.iig || 0) + Number(r.bdix || 0) + Number(r.ggc || 0) +
        Number(r.fna || 0) + Number(r.cdn || 0) + Number(r.bcdn || 0),
    }));

    res.json({ trends, bandwidth_by_type: bandwidthByType });
  } catch (error) {
    console.error("getPartnerTrends error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const getPartnerDetailReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { months } = req.query;
    const monthCount = Math.min(Math.max(parseInt(months, 10) || 12, 1), 24);

    // 1. Fetch partner profile
    const profileResult = await pool.query(
      `SELECT id, reseller_name, company_name, partner_type, status,
              pop_location, contact_no, connection_type,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity, nttn_type, nttn_link,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              security_deposit, otc_charge, real_ip_count, real_ip_price,
              next_pay_date, joining_date, created_at
       FROM resellers WHERE id = $1`,
      [id]
    );

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: "Partner not found" });
    }
    const profile = profileResult.rows[0];

    // 2. Current month billing
    const currentMonthYm = getDhakaMonthYm();
    const currentMonthDate = `${currentMonthYm}-01`;

    const dueResult = await pool.query(
      `SELECT fn_reseller_previous_due(id, $1::date) AS prev_due FROM resellers WHERE id = $2`,
      [currentMonthDate, id]
    );
    const prevDue = Number(dueResult.rows[0]?.prev_due || 0);

    const billResult = await pool.query(
      `SELECT amount, adjustment, previous_due FROM monthly_bills WHERE reseller_id = $1 AND bill_month = $2 LIMIT 1`,
      [id, currentMonthDate]
    );
    const bill = billResult.rows[0];
    let projected = 0;
    if (bill) {
      projected = Number(bill.amount || 0) + Number(bill.adjustment || 0);
    } else {
      projected =
        Number(profile.iig_bw || 0) * Number(profile.rate_iig || 0) +
        Number(profile.bdix_bw || 0) * Number(profile.rate_bdix || 0) +
        Number(profile.ggc_bw || 0) * Number(profile.rate_ggc || 0) +
        Number(profile.fna_bw || 0) * Number(profile.rate_fna || 0) +
        Number(profile.cdn_bw || 0) * Number(profile.rate_cdn || 0) +
        Number(profile.bcdn_bw || 0) * Number(profile.rate_bcdn || 0) +
        Number(profile.nttn_capacity || 0) * Number(profile.rate_nttn || 0);
    }

    const logsResult = await pool.query(
      `SELECT log_type, transaction_amount, change_desc, effective_date, created_at
       FROM billing_logs
       WHERE reseller_id = $1 AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $2
       ORDER BY effective_date ASC, created_at ASC`,
      [id, currentMonthYm]
    );
    const paid = logsResult.rows
      .filter((l) => l.log_type === "payment" || l.log_type === "discount")
      .reduce((s, l) => s + Number(l.transaction_amount || 0), 0);
    const currentDue = prevDue + projected - paid;

    // 3. 12-month billing trend
    const now = new Date();
    const dhakaOffset = 6 * 60 * 60 * 1000;
    const dhakaNow = new Date(now.getTime() + dhakaOffset);
    const currentYear = dhakaNow.getFullYear();
    const currentMonth = dhakaNow.getMonth();

    const monthList = [];
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthList.push(ym);
    }

    const monthStart = `${monthList[0]}-01`;

    const trendBillsResult = await pool.query(
      `SELECT TO_CHAR(bill_month, 'YYYY-MM') AS ym,
              SUM(amount) AS total_amount, SUM(adjustment) AS total_adjustment
       FROM monthly_bills WHERE reseller_id = $1 AND bill_month >= $2::date
       GROUP BY TO_CHAR(bill_month, 'YYYY-MM') ORDER BY ym ASC`,
      [id, monthStart]
    );
    const trendBillsMap = {};
    trendBillsResult.rows.forEach((r) => { trendBillsMap[r.ym] = r; });

    const trendLogsResult = await pool.query(
      `SELECT TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') AS ym,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) IN ('payment') THEN transaction_amount ELSE 0 END) AS total_paid,
              SUM(CASE WHEN LOWER(COALESCE(log_type, '')) = 'discount' THEN transaction_amount ELSE 0 END) AS total_discount
       FROM billing_logs WHERE reseller_id = $1 AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') >= $2
       GROUP BY TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') ORDER BY ym ASC`,
      [id, monthList[0]]
    );
    const trendLogsMap = {};
    trendLogsResult.rows.forEach((r) => { trendLogsMap[r.ym] = r; });

    const trend = monthList.map((ym) => {
      const b = trendBillsMap[ym] || {};
      const l = trendLogsMap[ym] || {};
      const proj = Number(b.total_amount || 0) + Number(b.total_adjustment || 0);
      const p = Number(l.total_paid || 0) + Number(l.total_discount || 0);
      return {
        month: ym,
        projected: Math.round(proj * 100) / 100,
        paid: Math.round(p * 100) / 100,
      };
    });

    // 4. Recent billing transactions (last 20)
    const recentLogsResult = await pool.query(
      `SELECT id, log_type, transaction_amount, change_desc, effective_date, created_at
       FROM billing_logs WHERE reseller_id = $1
       ORDER BY COALESCE(effective_date, created_at) DESC LIMIT 20`,
      [id]
    );

    // 5. 12-month bandwidth allocation history (reconstructed from bandwidth_requests)
    const bwRequestsResult = await pool.query(
      `SELECT bw_type, change_type, amount, implementation_date
       FROM bandwidth_requests
       WHERE reseller_id = $1
         AND COALESCE(admin_status, 'pending') = 'approved'
         AND COALESCE(engineer_status, 'pending') = 'implemented'
         AND implementation_date IS NOT NULL
       ORDER BY implementation_date ASC`,
      [id]
    );
    const currentBw = {
      iig_bw: profile.iig_bw,
      bdix_bw: profile.bdix_bw,
      ggc_bw: profile.ggc_bw,
      fna_bw: profile.fna_bw,
      cdn_bw: profile.cdn_bw,
      bcdn_bw: profile.bcdn_bw,
      nttn_capacity: profile.nttn_capacity,
    };
    const bwHistory = reconstructBwHistory(currentBw, bwRequestsResult.rows, monthList);

    // 6. Merge trend + bw_history into monthly_history
    const monthlyHistory = monthList.map((ym, i) => {
      const t = trend[i] || {};
      const bw = bwHistory[i] || {};
      return {
        month: ym,
        projected: t.projected || 0,
        paid: t.paid || 0,
        iig: bw.iig || 0,
        bdix: bw.bdix || 0,
        ggc: bw.ggc || 0,
        fna: bw.fna || 0,
        cdn: bw.cdn || 0,
        bcdn: bw.bcdn || 0,
        nttn: bw.nttn || 0,
        bw_total: bw.total || 0,
      };
    });

    res.json({
      profile: {
        id: profile.id,
        name: profile.reseller_name || profile.company_name || "",
        company: profile.company_name || "",
        partner_type: profile.partner_type || "distribution_partner",
        status: profile.status,
        pop_location: profile.pop_location || "",
        contact_no: profile.contact_no || "",
        connection_type: profile.connection_type || "",
        joining_date: profile.joining_date,
        next_pay_date: profile.next_pay_date,
        bandwidth: {
          iig: Number(profile.iig_bw || 0),
          bdix: Number(profile.bdix_bw || 0),
          ggc: Number(profile.ggc_bw || 0),
          fna: Number(profile.fna_bw || 0),
          cdn: Number(profile.cdn_bw || 0),
          bcdn: Number(profile.bcdn_bw || 0),
          nttn: Number(profile.nttn_capacity || 0),
          nttn_type: profile.nttn_type || "",
          total:
            Number(profile.iig_bw || 0) + Number(profile.bdix_bw || 0) + Number(profile.ggc_bw || 0) +
            Number(profile.fna_bw || 0) + Number(profile.cdn_bw || 0) + Number(profile.bcdn_bw || 0),
        },
        rates: {
          iig: Number(profile.rate_iig || 0),
          bdix: Number(profile.rate_bdix || 0),
          ggc: Number(profile.rate_ggc || 0),
          fna: Number(profile.rate_fna || 0),
          cdn: Number(profile.rate_cdn || 0),
          bcdn: Number(profile.rate_bcdn || 0),
          nttn: Number(profile.rate_nttn || 0),
        },
      },
      current_billing: {
        month: currentMonthYm,
        projected: Math.round(projected * 100) / 100,
        prev_due: Math.round(prevDue * 100) / 100,
        paid: Math.round(paid * 100) / 100,
        due: Math.round(Math.max(0, currentDue) * 100) / 100,
        transactions: logsResult.rows.map((l) => ({
          type: l.log_type,
          amount: Number(l.transaction_amount || 0),
          desc: l.change_desc || "",
          date: l.effective_date || l.created_at,
        })),
      },
      trend,
      bw_history: bwHistory,
      monthly_history: monthlyHistory,
      recent_transactions: recentLogsResult.rows.map((l) => ({
        id: l.id,
        type: l.log_type,
        amount: Number(l.transaction_amount || 0),
        desc: l.change_desc || "",
        date: l.effective_date || l.created_at,
      })),
    });
  } catch (error) {
    console.error("getPartnerDetailReport error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const getPartnerLifetimeReport = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Partner profile + current bandwidth
    const profileResult = await pool.query(
      `SELECT id, reseller_name, company_name, partner_type, status,
              iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity, nttn_type,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              joining_date
       FROM resellers WHERE id = $1`,
      [id]
    );
    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: "Partner not found" });
    }
    const p = profileResult.rows[0];

    // 2. All implemented bandwidth_requests (lifetime)
    const bwRequestsResult = await pool.query(
      `SELECT id, bw_type, change_type, amount, implementation_date::date AS impl_date,
              requested_effective_date AS req_date, created_at
       FROM bandwidth_requests
       WHERE reseller_id = $1
         AND COALESCE(admin_status, 'pending') = 'approved'
         AND COALESCE(engineer_status, 'pending') = 'implemented'
       ORDER BY implementation_date ASC`,
      [id]
    );

    // Compute BW summary per type
    const bwTypes = ["iig", "bdix", "ggc", "fna", "cdn", "bcdn", "nttn"];
    const bwSummary = {};
    bwTypes.forEach((t) => { bwSummary[t] = { increase: 0, decrease: 0 }; });

    bwRequestsResult.rows.forEach((r) => {
      const t = (r.bw_type || "").toLowerCase().replace("_bw", "").replace("capacity", "");
      if (!bwSummary[t]) return;
      const amt = Number(r.amount || 0);
      if (r.change_type === "increase") bwSummary[t].increase += amt;
      else if (r.change_type === "decrease") bwSummary[t].decrease += amt;
    });

    const currentBw = {
      iig: Number(p.iig_bw || 0),
      bdix: Number(p.bdix_bw || 0),
      ggc: Number(p.ggc_bw || 0),
      fna: Number(p.fna_bw || 0),
      cdn: Number(p.cdn_bw || 0),
      bcdn: Number(p.bcdn_bw || 0),
      nttn: Number(p.nttn_capacity || 0),
    };

    // 3. All monthly_bills (lifetime)
    const billsResult = await pool.query(
      `SELECT TO_CHAR(bill_month, 'YYYY-MM') AS ym, amount, adjustment, previous_due
       FROM monthly_bills WHERE reseller_id = $1
       ORDER BY bill_month ASC`,
      [id]
    );

    // 4. All billing_logs (lifetime)
    const logsResult = await pool.query(
      `SELECT log_type, transaction_amount, change_desc, effective_date, created_at
       FROM billing_logs WHERE reseller_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Compute billing summary
    let totalBilled = 0;
    let totalAdjustment = 0;
    let totalPaid = 0;
    let totalDiscount = 0;
    const billsByMonth = {};
    billsResult.rows.forEach((b) => {
      const amt = Number(b.amount || 0);
      const adj = Number(b.adjustment || 0);
      totalBilled += amt;
      totalAdjustment += adj;
      if (!billsByMonth[b.ym]) billsByMonth[b.ym] = { billed: 0, adjustment: 0 };
      billsByMonth[b.ym].billed += amt;
      billsByMonth[b.ym].adjustment += adj;
    });

    logsResult.rows.forEach((l) => {
      const amt = Number(l.transaction_amount || 0);
      const t = (l.log_type || "").toLowerCase();
      if (t === "payment") totalPaid += amt;
      else if (t === "discount") totalDiscount += amt;
    });

    // Cumulative due calculation
    let runningDue = 0;
    const monthList = Object.keys(billsByMonth).sort();
    const billingHistory = monthList.map((ym) => {
      const b = billsByMonth[ym];
      const projected = b.billed + b.adjustment;
      // Find payments for this month
      const monthPayments = logsResult.rows
        .filter((l) => {
          const d = l.effective_date || l.created_at;
          const ly = d ? new Date(d).getFullYear() : 0;
          const lm = d ? new Date(d).getMonth() + 1 : 0;
          return `${ly}-${String(lm).padStart(2, "0")}` === ym && (l.log_type || "").toLowerCase() === "payment";
        })
        .reduce((s, l) => s + Number(l.transaction_amount || 0), 0);
      const monthDiscounts = logsResult.rows
        .filter((l) => {
          const d = l.effective_date || l.created_at;
          const ly = d ? new Date(d).getFullYear() : 0;
          const lm = d ? new Date(d).getMonth() + 1 : 0;
          return `${ly}-${String(lm).padStart(2, "0")}` === ym && (l.log_type || "").toLowerCase() === "discount";
        })
        .reduce((s, l) => s + Number(l.transaction_amount || 0), 0);
      runningDue += projected - monthPayments - monthDiscounts;
      return {
        month: ym,
        billed: Math.round(b.billed * 100) / 100,
        adjustment: Math.round(b.adjustment * 100) / 100,
        paid: Math.round(monthPayments * 100) / 100,
        discount: Math.round(monthDiscounts * 100) / 100,
        due: Math.round(Math.max(0, runningDue) * 100) / 100,
      };
    });

    res.json({
      profile: {
        id: p.id,
        name: p.reseller_name || p.company_name || "",
        company: p.company_name || "",
        partner_type: p.partner_type || "",
        status: p.status,
        joining_date: p.joining_date,
      },
      current_bandwidth: currentBw,
      bw_summary: bwTypes.map((t) => ({
        type: t.toUpperCase().replace("BCDN", "Other"),
        current: currentBw[t],
        increase: bwSummary[t].increase,
        decrease: bwSummary[t].decrease,
        net_change: bwSummary[t].increase - bwSummary[t].decrease,
      })),
      bw_change_log: bwRequestsResult.rows.map((r) => ({
        id: r.id,
        bw_type: r.bw_type,
        change_type: r.change_type,
        amount: Number(r.amount || 0),
        impl_date: r.impl_date,
        req_date: r.req_date,
      })),
      billing_summary: {
        total_billed: Math.round(totalBilled * 100) / 100,
        total_adjustment: Math.round(totalAdjustment * 100) / 100,
        total_paid: Math.round(totalPaid * 100) / 100,
        total_discount: Math.round(totalDiscount * 100) / 100,
        total_due: Math.round(Math.max(0, runningDue) * 100) / 100,
        months_count: monthList.length,
      },
      billing_history: billingHistory,
      rates: {
        iig: Number(p.rate_iig || 0),
        bdix: Number(p.rate_bdix || 0),
        ggc: Number(p.rate_ggc || 0),
        fna: Number(p.rate_fna || 0),
        cdn: Number(p.rate_cdn || 0),
        bcdn: Number(p.rate_bcdn || 0),
        nttn: Number(p.rate_nttn || 0),
      },
    });
  } catch (error) {
    console.error("getPartnerLifetimeReport error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

module.exports = { getPartnerReport, getPartnerTrends, getPartnerDetailReport, getPartnerLifetimeReport };
