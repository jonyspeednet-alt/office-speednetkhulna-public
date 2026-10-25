const pool = require("../../utilities/db");
const {
  parseAmount,
  parseWholeNumber,
  monthInfo,
  getDhakaMonthYm,
  normalizeBillBwType,
  BILL_BW_MAP,
  fmtDayMon,
  parseYMD,
  toDateOnlyString,
  getOtcAppliedMonthYm,
} = require("./utils");
const {
  joiningDateExpr,
  hasResellerOtcAppliedMonthColumn,
} = require("./dbSetup");

const getResellerRecurringMonthlyTotal = (reseller = {}) => {
  const bandwidthTotal =
    parseAmount(reseller.iig_bw, 0) * parseAmount(reseller.rate_iig, 0) +
    parseAmount(reseller.bdix_bw, 0) * parseAmount(reseller.rate_bdix, 0) +
    parseAmount(reseller.ggc_bw, 0) * parseAmount(reseller.rate_ggc, 0) +
    parseAmount(reseller.fna_bw, 0) * parseAmount(reseller.rate_fna, 0) +
    parseAmount(reseller.cdn_bw, 0) * parseAmount(reseller.rate_cdn, 0) +
    parseAmount(reseller.bcdn_bw, 0) * parseAmount(reseller.rate_bcdn, 0) +
    parseAmount(reseller.nttn_capacity, 0) * parseAmount(reseller.rate_nttn, 0);

  const realIpTotal =
    Math.max(0, parseWholeNumber(reseller.real_ip_count, 0)) *
    parseAmount(reseller.real_ip_price, 0);

  return bandwidthTotal + realIpTotal;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// --- Recurring billing rules (reseller_billing_rules) ---
// Single source of truth: rules apply ONLY as breakdown items[] lines.
// They must NEVER create billing_logs rows (that would double-count against
// the billing_logs aggregates in billing.js/invoice.js).
// Unknown rule_type values are ignored by the engine.
const BILLING_RULE_TYPES = ["discount_fixed", "bw_billable"];

// Application order: bw_billable first (proportional waiver computed from the
// bandwidth type's segment totals) -> discount_fixed (flat Tk off the total).
const RULE_TYPE_ORDER = {
  bw_billable: 0,
  discount_fixed: 1,
};

const sortBillingRules = (rules) =>
  [...(rules || [])].sort(
    (a, b) =>
      (RULE_TYPE_ORDER[a?.rule_type] ?? 99) -
        (RULE_TYPE_ORDER[b?.rule_type] ?? 99) ||
      String(toDateOnlyString(a?.effective_month) || "").localeCompare(
        String(toDateOnlyString(b?.effective_month) || ""),
      ) ||
      Number(a?.id || 0) - Number(b?.id || 0),
  );

// Pure in-memory filter: active rules for one reseller+month.
// Active = is_active AND deleted_at IS NULL AND effective_month <= ym-01
// AND (end_month IS NULL OR end_month >= ym-01).
const filterBillingRulesForMonth = (allRules, resellerId, ym) => {
  const monthYm = String(ym || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthYm)) return [];
  const monthStart = `${monthYm}-01`;
  const targetId = Number(resellerId);
  if (!Number.isFinite(targetId)) return [];
  return sortBillingRules(
    (allRules || []).filter((r) => {
      if (!r || typeof r !== "object") return false;
      if (Number(r.reseller_id) !== targetId) return false;
      if (r.deleted_at != null && String(r.deleted_at).trim() !== "")
        return false;
      const act = r.is_active;
      if (
        act === false ||
        act === 0 ||
        act === "0" ||
        act === "f" ||
        act === "false" ||
        act === "FALSE"
      )
        return false;
      if (!BILLING_RULE_TYPES.includes(String(r.rule_type))) return false;
      const eff = toDateOnlyString(r.effective_month);
      if (!eff || eff > monthStart) return false;
      if (r.end_month != null && String(r.end_month).trim() !== "") {
        const end = toDateOnlyString(r.end_month);
        if (!end || end < monthStart) return false;
      }
      return true;
    }),
  );
};

// Active billing rules for one reseller+month. Pure read (no writes).
// clientOrPool: pg pool or txn client (both expose .query).
// preloadedRules: optional array -> filtered in-memory, no query (batch path).
// Returns [] when the table does not exist yet (pre-migration) or on any error.
const getActiveBillingRules = async (
  resellerId,
  ym,
  clientOrPool = pool,
  preloadedRules = null,
) => {
  if (Array.isArray(preloadedRules))
    return filterBillingRulesForMonth(preloadedRules, resellerId, ym);
  const monthYm = String(ym || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthYm)) return [];
  if (!Number.isFinite(Number(resellerId))) return [];
  const monthStart = `${monthYm}-01`;
  try {
    const db = clientOrPool || pool;
    const res = await db.query(
      `SELECT id, reseller_id, rule_type, bw_type, effective_month, end_month,
              COALESCE(amount, 0)::numeric AS amount, note, is_active, deleted_at
       FROM reseller_billing_rules
       WHERE reseller_id = $1 AND is_active = TRUE AND deleted_at IS NULL
         AND effective_month <= $2::date
         AND (end_month IS NULL OR end_month >= $2::date)
       ORDER BY id ASC`,
      [Number(resellerId), monthStart],
    );
    return filterBillingRulesForMonth(res.rows, resellerId, ym);
  } catch (e) {
    return [];
  }
};

// Batch variant: one query for many resellers -> { resellerId: [rules] }.
// Used by getMonthlySummary so row tasks apply rules in-memory (no N+1).
const getActiveBillingRulesForResellers = async (
  resellerIds,
  ym,
  clientOrPool = pool,
) => {
  const map = {};
  const ids = (resellerIds || []).map(Number).filter(Number.isFinite);
  const monthYm = String(ym || "").slice(0, 7);
  if (!ids.length || !/^\d{4}-\d{2}$/.test(monthYm)) return map;
  const monthStart = `${monthYm}-01`;
  try {
    const db = clientOrPool || pool;
    const res = await db.query(
      `SELECT id, reseller_id, rule_type, bw_type, effective_month, end_month,
              COALESCE(amount, 0)::numeric AS amount, note, is_active, deleted_at
       FROM reseller_billing_rules
       WHERE reseller_id = ANY($1::int[]) AND is_active = TRUE AND deleted_at IS NULL
         AND effective_month <= $2::date
         AND (end_month IS NULL OR end_month >= $2::date)
       ORDER BY reseller_id ASC, id ASC`,
      [ids, monthStart],
    );
    for (const r of res.rows || []) {
      const key = Number(r.reseller_id);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    for (const key of Object.keys(map))
      map[key] = filterBillingRulesForMonth(map[key], Number(key), ym);
  } catch (e) {
    return {};
  }
  return map;
};

const billingRuleLabel = (r) =>
  `Rule: ${(String(r?.note ?? "").trim() || String(r?.rule_type || "")).slice(0, 120)}`;

// Pure rule math shared by the breakdown and the projected total.
// baseTotal: already-prorated bw + ip + OTC.
// factor: prorate for fixed amounts (activeDays/daysInMonth in joining month,
// clipped to the from_day/to_day window).
// Only discount_fixed applies here; bw_billable is handled by
// applyBwBillableRules (it needs per-type segment totals).
const applyBillingRulesToTotal = (baseTotal, rules, factor, itemMeta = {}) => {
  const items = [];
  let total = round2(baseTotal);
  const f = Number.isFinite(Number(factor)) ? Number(factor) : 1;
  for (const r of sortBillingRules(rules || [])) {
    if (String(r?.rule_type) !== "discount_fixed") continue;
    const amt = Number(r?.amount);
    if (!Number.isFinite(amt)) continue;
    const off = round2(Math.abs(amt) * f);
    if (!(off > 0)) continue;
    total = round2(total - off);
    items.push({
      desc: billingRuleLabel(r),
      rule_id: r.id,
      rule_type: "discount_fixed",
      total: -off,
      change_type: "rule",
      ...(f !== 1
        ? { change_note: `Prorated x${round2(f)}` }
        : {}),
      ...itemMeta,
    });
  }
  return { items, total: round2(total) };
};

// Bandwidth waiver: bill only `amount` Mbps of `bw_type` for the month.
// typeTotals: { GGC: { total, bwDays, segs[] } } summed from that type's
// segment items (already prorated/clipped by the breakdown walk). The waived
// part is proportional: net = typeTotal x billable/avgBw, so with no mid-month
// changes it is exactly billable x rate x window/daysInMonth.
// One discount line is emitted PER SEGMENT (that period's own rate/days/
// date-range), so the invoice shows e.g. "01-06 @0.00" and "07-31 @8.00"
// separately instead of a single blended-rate line.
// Returns { items, waived } — waived is subtracted from the grand total.
const applyBwBillableRules = (typeTotals, rules, meta = {}) => {
  const items = [];
  let waived = 0;
  const windowDays = Number(meta.windowDays) || 0;
  if (!(windowDays > 0)) return { items, waived };
  for (const r of sortBillingRules(rules || [])) {
    if (String(r?.rule_type) !== "bw_billable") continue;
    const t = normalizeBillBwType(r?.bw_type);
    if (!t || !BILL_BW_MAP[t]) continue;
    const entry = typeTotals[t];
    if (!entry || !(entry.total > 0) || !(entry.bwDays > 0)) continue;
    const billable = Number(r?.amount);
    if (!Number.isFinite(billable) || billable < 0) continue;
    const avgBw = entry.bwDays / windowDays;
    if (!(avgBw > 0) || billable >= avgBw) continue; // nothing to waive
    const waivedRatio = (avgBw - billable) / avgBw;
    const off = round2(entry.total * waivedRatio);
    if (!(off > 0)) continue;
    // Split across this type's segments (chronological); the last line
    // absorbs rounding so the lines sum to exactly `off`.
    const segs = (entry.segs || [])
      .filter((s) => Number(s?.total) > 0)
      .sort((a, b) => Number(a.fromDay) - Number(b.fromDay));
    if (segs.length === 0) continue;
    let assigned = 0;
    segs.forEach((s, idx) => {
      const isLast = idx === segs.length - 1;
      const segOff = isLast ? round2(off - assigned) : round2(s.total * waivedRatio);
      if (!(segOff > 0)) return;
      assigned = round2(assigned + segOff);
      items.push({
        desc: `${t} discount`,
        bw: round2(s.bw * waivedRatio),
        rate: Number(s.rate),
        days: s.days,
        total: -segOff,
        date_range: s.dateRange,
        from_day_num: s.fromDay,
        to_day_num: s.toDay,
        rule_id: r.id,
        rule_type: "bw_billable",
        change_type: "rule",
        change_note: `Billed ${billable} of ${round2(avgBw)} Mbps`,
      });
    });
    waived = round2(waived + assigned);
  }
  return { items, waived };
};

// Sum per-type { total, bwDays } from segment items, keeping each segment
// so waivers can be split per period. Segment items carry desc = bwType
// (e.g. "GGC"); rule/Real-IP/OTC lines never match a bw type.
const sumTypeTotalsFromItems = (items) => {
  const totals = {};
  for (const it of items || []) {
    if (it?.change_type === "rule") continue;
    const t = normalizeBillBwType(it?.desc);
    if (!t || !BILL_BW_MAP[t]) continue;
    const bw = Number(it?.bw);
    const tot = Number(it?.total);
    const dys = Number(it?.days);
    if (!Number.isFinite(bw) || !Number.isFinite(tot) || !Number.isFinite(dys)) continue;
    if (!totals[t]) totals[t] = { total: 0, bwDays: 0, segs: [] };
    totals[t].total = round2(totals[t].total + tot);
    totals[t].bwDays += bw * dys;
    totals[t].segs.push({
      bw,
      rate: Number(it?.rate),
      days: dys,
      total: tot,
      fromDay: it?.from_day_num,
      toDay: it?.to_day_num,
      dateRange: it?.date_range,
    });
  }
  return totals;
};

const calculateResellerMonthProjectedTotal = (
  reseller = {},
  targetMonthStr = getDhakaMonthYm(),
  preloadedRules = null,
) => {
  const info = monthInfo(targetMonthStr);
  const created = parseYMD(reseller.joining_date || reseller.created_at);
  if (!created) return 0;

  const createdYM = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
  if (info.ym < createdYM) return 0;

  const recurringTotal = getResellerRecurringMonthlyTotal(reseller);

  // Recurring billing rules (sync path: only from preloaded array, no I/O).
  const rules = Array.isArray(preloadedRules)
    ? filterBillingRulesForMonth(preloadedRules, reseller?.id, info.ym)
    : [];

  // bw_billable: swap this type's full-month contribution to billable x rate
  // (prorated below via factor, same as the rest of the base).
  let adjustedRecurring = recurringTotal;
  for (const r of rules) {
    if (String(r?.rule_type) !== "bw_billable") continue;
    const t = normalizeBillBwType(r?.bw_type);
    const keys = t ? BILL_BW_MAP[t] : null;
    if (!keys) continue;
    const billable = Number(r?.amount);
    if (!Number.isFinite(billable) || billable < 0) continue;
    const actual = parseAmount(reseller[keys.col], 0);
    const rate = parseAmount(reseller[keys.rate], 0);
    adjustedRecurring -= Math.max(0, actual - billable) * rate;
  }

  const activeDays =
    info.ym === createdYM
      ? Math.max(0, info.daysInMonth - created.getDate() + 1)
      : info.daysInMonth;
  const proratedRecurring =
    info.daysInMonth > 0 ? (adjustedRecurring / info.daysInMonth) * activeDays : 0;
  const otcCharge =
    info.ym === getOtcAppliedMonthYm(reseller)
      ? parseAmount(reseller.otc_charge, 0)
      : 0;

  const base = proratedRecurring + otcCharge;
  const factor =
    info.daysInMonth > 0 ? activeDays / info.daysInMonth : 1;
  const applied = applyBillingRulesToTotal(base, rules, factor);
  return Math.round(Number(applied.total || 0) * 100) / 100;
};

const shouldPauseProjectedBilling = (reseller, targetMonthYm) => {
  const status = String(reseller?.status || "active").toLowerCase();
  if (status === "active") return false;
  return targetMonthYm >= getDhakaMonthYm();
};

const refreshProjectedBillForCurrentMonth = async (
  resellerId,
  targetMonthStr = getDhakaMonthYm(),
) => {
  const breakdown = await calculateMonthlyBillBreakdown(
    resellerId,
    targetMonthStr,
  );
  const total = Math.round(Number(breakdown?.total || 0) * 100) / 100;
  return total;
};

const calculateMonthlyBillBreakdown = async (
  resellerId,
  targetMonthStr,
  resellerRow = null,
  options = {},
) => {
  const info = monthInfo(targetMonthStr);
  const { fromDay: customFromDay, toDay: customToDay } = options;
  const reseller =
    resellerRow ||
    (
      await pool.query(
        `SELECT id,
              ${joiningDateExpr()} AS joining_date,
              COALESCE(status, 'active') AS status,
              COALESCE(iig_bw,0)::numeric AS iig_bw,
              COALESCE(bdix_bw,0)::numeric AS bdix_bw,
              COALESCE(ggc_bw,0)::numeric AS ggc_bw,
              COALESCE(fna_bw,0)::numeric AS fna_bw,
              COALESCE(cdn_bw,0)::numeric AS cdn_bw,
              COALESCE(bcdn_bw,0)::numeric AS bcdn_bw,
              COALESCE(nttn_capacity,0)::numeric AS nttn_capacity,
              COALESCE(rate_iig,0)::numeric AS rate_iig,
              COALESCE(rate_bdix,0)::numeric AS rate_bdix,
              COALESCE(rate_ggc,0)::numeric AS rate_ggc,
              COALESCE(rate_fna,0)::numeric AS rate_fna,
              COALESCE(rate_cdn,0)::numeric AS rate_cdn,
              COALESCE(rate_bcdn,0)::numeric AS rate_bcdn,
              COALESCE(rate_nttn,0)::numeric AS rate_nttn,
              COALESCE(otc_charge,0)::numeric AS otc_charge,
              ${hasResellerOtcAppliedMonthColumn() ? `otc_charge_applied_month,` : `NULL::date AS otc_charge_applied_month,`}
              COALESCE(real_ip_count,0)::int AS real_ip_count,
              COALESCE(real_ip_price,0)::numeric AS real_ip_price
       FROM resellers WHERE id = $1`,
        [resellerId],
      )
    ).rows?.[0];

  if (!reseller) return { items: [], total: 0 };
  if (shouldPauseProjectedBilling(reseller, info.ym))
    return { items: [], total: 0 };

  const created = parseYMD(reseller.joining_date || reseller.created_at);
  if (!created) return { items: [], total: 0 };

  const createdYM = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
  if (info.ym < createdYM) return { items: [], total: 0 };
  const startDayLimit = info.ym === createdYM ? created.getDate() : 1;

  const effectiveFromDay = Math.max(startDayLimit, customFromDay || startDayLimit);
  const effectiveToDay = Math.min(customToDay || info.daysInMonth, info.daysInMonth);
  const effectiveMonthEndStr = effectiveToDay < info.daysInMonth
    ? `${info.ym}-${String(effectiveToDay).padStart(2, '0')}`
    : info.monthEndStr;

  const rateHistoryByType = {};
  try {
    const rateRows = await pool.query(
      `SELECT UPPER(COALESCE(bw_type,'')) AS bw_type, COALESCE(rate,0)::numeric AS rate, effective_date::date AS effective_date
       FROM reseller_rate_history
       WHERE reseller_id = $1 AND effective_date <= $2::date
        ORDER BY effective_date ASC`,
      [resellerId, effectiveMonthEndStr],
    );
    for (const r of rateRows.rows) {
      const type = normalizeBillBwType(r.bw_type);
      if (!type) continue;
      if (!rateHistoryByType[type]) rateHistoryByType[type] = [];
      rateHistoryByType[type].push({
        rate: Number(r.rate || 0),
        effective_date: toDateOnlyString(r.effective_date),
      });
    }
  } catch (e) {
    // Optional table
  }

  const rateChangeLogMap = {}; // bwType -> { dateStr -> prevRate }
  try {
    const changeLogResult = await pool.query(
      `SELECT effective_date::date AS effective_date,
              prev_rate_iig, prev_rate_bdix, prev_rate_ggc, prev_rate_fna,
              prev_rate_cdn, prev_rate_bcdn, prev_rate_nttn,
              rate_iig, rate_bdix, rate_ggc, rate_fna,
              rate_cdn, rate_bcdn, rate_nttn
       FROM reseller_rate_change_logs
       WHERE reseller_id = $1
       ORDER BY effective_date ASC`,
      [resellerId],
    );
    for (const row of changeLogResult.rows) {
      const dateStr = toDateOnlyString(row.effective_date);
      if (!dateStr) continue;
      const rateColMap = {
        IIG: ["prev_rate_iig", "rate_iig"],
        BDIX: ["prev_rate_bdix", "rate_bdix"],
        GGC: ["prev_rate_ggc", "rate_ggc"],
        FNA: ["prev_rate_fna", "rate_fna"],
        CDN: ["prev_rate_cdn", "rate_cdn"],
        BCDN: ["prev_rate_bcdn", "rate_bcdn"],
        NTTN: ["prev_rate_nttn", "rate_nttn"],
      };
      for (const [bwType, [prevCol, nextCol]] of Object.entries(rateColMap)) {
        if (row[prevCol] != null) {
          if (!rateChangeLogMap[bwType]) rateChangeLogMap[bwType] = {};
          if (!rateChangeLogMap[bwType][dateStr]) {
            rateChangeLogMap[bwType][dateStr] = Number(row[prevCol]);
          }
        }
        const nextRate = parseAmount(row[nextCol], NaN);
        const prevRate = parseAmount(row[prevCol], NaN);
        if (
          Number.isFinite(nextRate) &&
          Number.isFinite(prevRate) &&
          nextRate !== prevRate &&
          dateStr <= effectiveMonthEndStr
        ) {
          if (!rateHistoryByType[bwType]) rateHistoryByType[bwType] = [];
          const hasExistingHistory = rateHistoryByType[bwType].some(
            (entry) => entry.effective_date === dateStr,
          );
          if (!hasExistingHistory) {
            rateHistoryByType[bwType].push({
              rate: nextRate,
              effective_date: dateStr,
            });
          }
        }
      }
    }
  } catch (e) {
    // Optional table
  }

  const futureChangesRows = await pool.query(
    `SELECT UPPER(COALESCE(bw_type,'')) AS bw_type, LOWER(COALESCE(change_type,'')) AS change_type,
            COALESCE(amount,0)::numeric AS amount, implementation_date::date AS implementation_date
     FROM bandwidth_requests
     WHERE reseller_id = $1
       AND COALESCE(admin_status,'pending') = 'approved'
       AND COALESCE(engineer_status,'pending') = 'implemented'
       AND implementation_date > $2::date
      ORDER BY implementation_date DESC`,
    [resellerId, effectiveMonthEndStr],
  );

  const workingBw = {};
  for (const [type, keys] of Object.entries(BILL_BW_MAP)) {
    workingBw[type] = parseAmount(reseller[keys.col], 0);
  }

  for (const fc of futureChangesRows.rows) {
    const t = normalizeBillBwType(fc.bw_type);
    if (!Object.prototype.hasOwnProperty.call(workingBw, t)) continue;
    const amt = parseAmount(fc.amount, 0);
    if (fc.change_type === "increase") workingBw[t] -= amt;
    else workingBw[t] += amt;
  }

  // Support simulated retroactive correction dry-runs without committing to database.
  // Accepts options.simulatedCorrections (array) or legacy options.simulatedCorrection (single object).
  const simCorrections = Array.isArray(options.simulatedCorrections)
    ? options.simulatedCorrections
    : (options.simulatedCorrection ? [options.simulatedCorrection] : []);

  // --- Simulated RATE corrections: inject into rateHistoryByType before segment building ---
  for (const sim of simCorrections) {
    if (sim.correction_type !== 'rate') continue;
    const simType = normalizeBillBwType(sim.bw_type);
    const simEff = sim.effective_date ? String(sim.effective_date).slice(0, 10) : '';
    const newRate = parseAmount(sim.new_rate, NaN);
    if (!simType || !simEff || !Number.isFinite(newRate) || newRate < 0) continue;
    if (simEff > effectiveMonthEndStr) continue; // rate change after this month, skip
    if (!rateHistoryByType[simType]) rateHistoryByType[simType] = [];
    // Remove any existing entry at same date (real or prior sim), then inject simulated rate
    rateHistoryByType[simType] = rateHistoryByType[simType].filter(
      (rh) => rh.effective_date !== simEff || rh._simulated,
    );
    rateHistoryByType[simType].push({ rate: newRate, effective_date: simEff, _simulated: true });
    rateHistoryByType[simType].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  }

  // --- Simulated BANDWIDTH corrections: rewind workingBw for future corrections ---
  for (const sim of simCorrections) {
    if (sim.correction_type === 'rate') continue; // already handled above
    const simType = normalizeBillBwType(sim.bw_type);
    const simEff = sim.effective_date ? String(sim.effective_date).slice(0, 10) : '';
    const simAmt = parseAmount(sim.amount, 0);
    if (!simType || !simEff || simAmt <= 0) continue;
    if (!Object.prototype.hasOwnProperty.call(workingBw, simType)) continue;
    // If the correction's effective date is AFTER this month's end, unwind its effect
    // (because workingBw is built from current DB state which already includes future changes)
    if (simEff > effectiveMonthEndStr) {
      if (sim.change_type === 'increase') workingBw[simType] -= simAmt;
      else workingBw[simType] += simAmt;
    }
  }

  const changeRows = await pool.query(
    `SELECT UPPER(COALESCE(bw_type,'')) AS bw_type, LOWER(COALESCE(change_type,'')) AS change_type,
            COALESCE(amount,0)::numeric AS amount, implementation_date::date AS implementation_date
     FROM bandwidth_requests
     WHERE reseller_id = $1
       AND COALESCE(admin_status,'pending') = 'approved'
       AND COALESCE(engineer_status,'pending') = 'implemented'
       AND implementation_date BETWEEN $2::date AND $3::date
      ORDER BY implementation_date DESC`,
    [resellerId, info.monthStartStr, effectiveMonthEndStr],
  );

  const changesByType = {};
  for (const c of changeRows.rows) {
    const t = normalizeBillBwType(c.bw_type);
    if (!t) continue;
    if (!changesByType[t]) changesByType[t] = [];
    changesByType[t].push(c);
  }

  // Inject simulated BANDWIDTH corrections that fall within this month's range
  for (const sim of simCorrections) {
    if (sim.correction_type === 'rate') continue;
    const simType = normalizeBillBwType(sim.bw_type);
    const simEff = sim.effective_date ? String(sim.effective_date).slice(0, 10) : '';
    const simAmt = parseAmount(sim.amount, 0);
    if (!simType || !simEff || simAmt <= 0) continue;
    if (simEff >= info.monthStartStr && simEff <= effectiveMonthEndStr) {
      if (!changesByType[simType]) changesByType[simType] = [];
      changesByType[simType].push({
        bw_type: simType,
        change_type: sim.change_type,
        amount: simAmt,
        implementation_date: simEff,
        _simulated: true,
      });
      changesByType[simType].sort((a, b) => String(b.implementation_date).localeCompare(String(a.implementation_date)));
    }
  }

  const items = [];
  let grandTotal = 0;

  for (const [bwType, keys] of Object.entries(BILL_BW_MAP)) {
    const typeChanges = changesByType[bwType] || [];
    const rate = parseAmount(reseller[keys.rate], 0);
    const initialBw = parseAmount(workingBw[bwType], 0);
    if (initialBw === 0 && typeChanges.length === 0) continue;

    const rateHistory = (rateHistoryByType[bwType] || [])
      .filter((rh) => rh.effective_date >= info.monthStartStr)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

    const allBwHistory = rateHistoryByType[bwType] || [];
    const preMonthRate = (() => {
      const preEntries = allBwHistory
        .filter((rh) => rh.effective_date < info.monthStartStr)
        .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
      if (preEntries.length > 0) return Number(preEntries[0].rate);
      const thisMonthLogEntries = Object.entries(rateChangeLogMap[bwType] || {})
        .filter(([d]) => d >= info.monthStartStr && d <= effectiveMonthEndStr)
        .sort(([a], [b]) => a.localeCompare(b));
      if (thisMonthLogEntries.length > 0) return thisMonthLogEntries[0][1];
      return rate;
    })();

    const buildRateSegments = (fromDay, toDay) => {
      if (rateHistory.length === 0)
        return [{ fromDay, toDay, segRate: preMonthRate }];
      const segs = [];
      let cursor = fromDay;
      let currentRate = preMonthRate;
      for (const rh of rateHistory) {
        const rhDate = parseYMD(rh.effective_date);
        if (!rhDate) continue;
        const rhDay = rhDate.getDate();
        if (rhDay > toDay) break;
        if (rhDay > cursor) {
          segs.push({
            fromDay: cursor,
            toDay: rhDay - 1,
            segRate: currentRate,
          });
          cursor = rhDay;
        }
        currentRate = Number(rh.rate);
      }
      if (cursor <= toDay) {
        segs.push({ fromDay: cursor, toDay, segRate: currentRate });
      }
      return segs.length > 0
        ? segs
        : [{ fromDay, toDay, segRate: preMonthRate }];
    };

    let cursorDay = effectiveToDay;
    let tempBw = initialBw;

    for (const change of typeChanges) {
      const changeDate = parseYMD(change.implementation_date);
      if (!changeDate) continue;
      const changeDay = changeDate.getDate();
      const duration = cursorDay - changeDay + 1;

      if (duration > 0 && tempBw > 0) {
        const rateSegs = buildRateSegments(changeDay, cursorDay);
        const isBwChange = change.change_type === "increase" || change.change_type === "decrease";
        const changeAmt = parseAmount(change.amount, 0);
        const prevBwForThis = isBwChange
          ? (change.change_type === "increase" ? tempBw - changeAmt : tempBw + changeAmt)
          : tempBw;
        for (const rs of rateSegs) {
          const segDuration = rs.toDay - rs.fromDay + 1;
          const cost =
            Math.round(
              (rs.segRate / info.daysInMonth) * tempBw * segDuration * 100,
            ) / 100;
          grandTotal += cost;
          // Build human-readable change notes
          const notes = [];
          if (isBwChange && changeAmt > 0) {
            const isUp = change.change_type === "increase";
            const sign = isUp ? "+" : "-";
            const fmtDate = fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), changeDay));
            notes.push(`BW ${prevBwForThis} ${sign} ${changeAmt} = ${tempBw} Mbps (${fmtDate})`);
          }
          if (rateSegs.length > 1) {
            const segIdx = rateSegs.indexOf(rs);
            if (segIdx > 0) {
              const prevRate = rateSegs[segIdx - 1].segRate;
              notes.push(`Rate: ${prevRate.toLocaleString()} → ${rs.segRate.toLocaleString()} Tk/Mo`);
            }
          }
          const changeNote = notes.length > 0 ? notes.join(" | ") : null;
          items.push({
            desc: bwType,
            bw: tempBw,
            prev_bw: prevBwForThis !== tempBw ? prevBwForThis : undefined,
            change_amount: isBwChange && changeAmt > 0 ? changeAmt : undefined,
            change_note: changeNote || undefined,
            rate: rs.segRate,
            from_day_num: rs.fromDay,
            to_day_num: rs.toDay,
            days: segDuration,
            total: cost,
            date_range: `${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), rs.fromDay))} - ${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), rs.toDay))}`,
            change_type:
              rateSegs.length > 1
                ? "rate_change"
                : change.change_type === "increase"
                  ? "প্যাকেজ বৃদ্ধি"
                  : change.change_type === "decrease"
                    ? "প্যাকেজ হ্রাস"
                    : "standard",
          });
        }
      }

      cursorDay = changeDay - 1;
      const amt = parseAmount(change.amount, 0);
      if (change.change_type === "increase") tempBw -= amt;
      else tempBw += amt;
    }

    if (cursorDay >= effectiveFromDay && tempBw > 0) {
        const rateSegs = buildRateSegments(effectiveFromDay, cursorDay);
      for (const rs of rateSegs) {
        const segDuration = rs.toDay - rs.fromDay + 1;
        const cost =
          Math.round(
            (rs.segRate / info.daysInMonth) * tempBw * segDuration * 100,
          ) / 100;
        grandTotal += cost;
        // For rate-change splits within the initial (earliest) segment, note the rate transition
        let changeNote = null;
        const isRateChangedSeg = rateSegs.length > 1 && rateSegs.indexOf(rs) > 0;
        if (isRateChangedSeg) {
          const segIdx = rateSegs.indexOf(rs);
          const prevRate = rateSegs[segIdx - 1].segRate;
          changeNote = `Rate: ${prevRate.toLocaleString()} → ${rs.segRate.toLocaleString()} Tk/Mo`;
        }
        items.push({
          desc: bwType,
          bw: tempBw,
          change_note: changeNote || undefined,
          rate: rs.segRate,
          from_day_num: rs.fromDay,
          to_day_num: rs.toDay,
          days: segDuration,
          total: cost,
          date_range: `${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), rs.fromDay))} - ${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), rs.toDay))}`,
          change_type: isRateChangedSeg ? "rate_change" : "standard",
        });
      }
    }
  }

  const realIpCount = Math.max(0, parseWholeNumber(reseller.real_ip_count, 0));
  const realIpPrice = parseAmount(reseller.real_ip_price, 0);
  if (realIpCount > 0) {
    const duration = effectiveToDay - effectiveFromDay + 1;
    if (duration > 0) {
      const cost =
        Math.round(
          ((realIpCount * realIpPrice) / info.daysInMonth) * duration * 100,
        ) / 100;
      grandTotal += cost;
      items.push({
        desc: "Real IP",
        bw: realIpCount,
        rate: realIpPrice,
        days: duration,
        total: cost,
        date_range: `${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), effectiveFromDay))} - ${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), effectiveToDay))}`,
        change_type: "standard",
      });
    }
  }

  // Recurring billing rules: pure read (no writes, never billing_logs).
  // options.preloadedRules (array) -> in-memory filter, no extra query.
  const billingRules = await getActiveBillingRules(
    resellerId,
    info.ym,
    pool,
    Array.isArray(options.preloadedRules) ? options.preloadedRules : null,
  );

  const otcCharge = parseAmount(reseller.otc_charge, 0);
  const otcDateRange = fmtDayMon(info.monthStart);
  if (otcCharge > 0 && info.ym === getOtcAppliedMonthYm(reseller)) {
    grandTotal += otcCharge;
    items.push({
      desc: "OTC",
      bw: 1,
      rate: otcCharge,
      days: 1,
      total: Math.round(otcCharge * 100) / 100,
      date_range: otcDateRange,
      change_type: "standard",
    });
  }

  // Apply rules in order: bw_billable (waiver from each type's segment
  // totals, prorated/clipped already by the walk above) -> discount_fixed
  // (flat Tk off, prorated by the effective window for joining-month and
  // from_day/to_day clipping, mirroring the proratedRecurring pattern).
  const ruleDuration = Math.max(0, effectiveToDay - effectiveFromDay + 1);
  const ruleFactor =
    info.daysInMonth > 0 ? ruleDuration / info.daysInMonth : 1;
  const ruleDateRange = `${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), effectiveFromDay))} - ${fmtDayMon(new Date(info.monthStart.getFullYear(), info.monthStart.getMonth(), effectiveToDay))}`;
  const bwApplied = applyBwBillableRules(sumTypeTotalsFromItems(items), billingRules, {
    windowDays: ruleDuration,
    daysInMonth: info.daysInMonth,
    dateRange: ruleDateRange,
    fromDay: effectiveFromDay,
    toDay: effectiveToDay,
  });
  grandTotal = round2(grandTotal - bwApplied.waived);
  for (const it of bwApplied.items) items.push(it);
  const appliedRules = applyBillingRulesToTotal(
    grandTotal,
    billingRules,
    ruleFactor,
    { days: ruleDuration, date_range: ruleDateRange },
  );
  grandTotal = appliedRules.total;
  for (const it of appliedRules.items) items.push(it);

  items.sort((a, b) => {
    const descCmp = String(a.desc).localeCompare(String(b.desc));
    if (descCmp !== 0) return descCmp;
    return (Number(a.from_day_num) || 0) - (Number(b.from_day_num) || 0);
  });
  grandTotal = Math.round(grandTotal * 100) / 100;
  return { items, total: grandTotal };
};

module.exports = {
  getResellerRecurringMonthlyTotal,
  calculateResellerMonthProjectedTotal,
  calculateMonthlyBillBreakdown,
  refreshProjectedBillForCurrentMonth,
  getActiveBillingRules,
  getActiveBillingRulesForResellers,
  filterBillingRulesForMonth,
  applyBillingRulesToTotal,
  applyBwBillableRules,
  sumTypeTotalsFromItems,
  BILLING_RULE_TYPES,
};
