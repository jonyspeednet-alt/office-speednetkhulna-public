const pool = require("../../utilities/db");
const {
  parseAmount,
  monthInfo,
  parseYMD,
  toDateOnlyString,
  getDhakaMonthYm,
  normalizeBillBwType,
  normalizeBwType,
  normalizeChangeType,
  LOG_TYPE_EXPR,
  nextMonthYm,
} = require("./utils");
const { calculateMonthlyBillBreakdown } = require("./service");
const { getActor, getReqMeta, logResellerFinancialChange } = require("../../utilities/resellerFinancialAudit");

// Rate column mapping: BW type -> resellers column
const RATE_COL_MAP = {
  IIG: "rate_iig",
  BDIX: "rate_bdix",
  GGC: "rate_ggc",
  FNA: "rate_fna",
  CDN: "rate_cdn",
  BCDN: "rate_bcdn",
  NTTN: "rate_nttn",
};

// Rate log column mapping: BW type -> [prev_col, new_col] in reseller_rate_change_logs
const RATE_LOG_COL_MAP = {
  IIG:  ["prev_rate_iig",  "rate_iig"],
  BDIX: ["prev_rate_bdix", "rate_bdix"],
  GGC:  ["prev_rate_ggc",  "rate_ggc"],
  FNA:  ["prev_rate_fna",  "rate_fna"],
  CDN:  ["prev_rate_cdn",  "rate_cdn"],
  BCDN: ["prev_rate_bcdn", "rate_bcdn"],
  NTTN: ["prev_rate_nttn", "rate_nttn"],
};

function extractCorrectionsFromBody(body) {
  if (Array.isArray(body?.corrections) && body.corrections.length > 0) {
    return body.corrections;
  }
  // Backwards compatibility for single correction object
  if (body?.bw_type || body?.amount !== undefined || body?.new_rate !== undefined || body?.effective_date) {
    return [{
      correction_type: body.correction_type || (body.new_rate !== undefined ? "rate" : "bandwidth"),
      bw_type: body.bw_type,
      change_type: body.change_type,
      amount: body.amount,
      new_rate: body.new_rate,
      effective_date: body.effective_date,
    }];
  }
  return [];
}

/**
 * Validate and normalize a single correction item from the request.
 * Returns { ok, error, normalized } where normalized is the cleaned correction object.
 */
function validateCorrection(item, idx) {
  const prefix = idx !== undefined ? `Correction #${idx + 1}` : 'Correction';
  const corrType = String(item?.correction_type || "bandwidth").toLowerCase();

  if (corrType !== "bandwidth" && corrType !== "rate") {
    return { ok: false, error: `${prefix}: correction_type must be 'bandwidth' or 'rate'` };
  }

  const bwType = normalizeBillBwType(item?.bw_type);
  if (!bwType) {
    return { ok: false, error: `${prefix}: Invalid or unsupported bandwidth type '${item?.bw_type || ''}'` };
  }

  const effDate = toDateOnlyString(item?.effective_date);
  if (!effDate) {
    return { ok: false, error: `${prefix}: valid effective_date (YYYY-MM-DD) is required` };
  }

  if (corrType === "bandwidth") {
    const changeType = normalizeChangeType(item.change_type);
    if (changeType !== "increase" && changeType !== "decrease") {
      return { ok: false, error: `${prefix}: change_type must be 'increase' or 'decrease'` };
    }
    const amount = Math.max(0, parseAmount(item.amount, 0));
    if (amount <= 0) {
      return { ok: false, error: `${prefix}: amount must be > 0` };
    }
    return {
      ok: true,
      normalized: { correction_type: "bandwidth", bw_type: bwType, change_type: changeType, amount, effective_date: effDate },
    };
  }

  // rate correction
  const newRate = parseAmount(item.new_rate, NaN);
  if (!Number.isFinite(newRate) || newRate < 0) {
    return { ok: false, error: `${prefix}: new_rate must be a non-negative number` };
  }
  return {
    ok: true,
    normalized: { correction_type: "rate", bw_type: bwType, new_rate: newRate, effective_date: effDate },
  };
}

/** Fetch full reseller row needed for billing calculations */
async function fetchResellerForCalc(client, resellerId, forUpdate = false) {
  const lockClause = forUpdate ? " FOR UPDATE" : "";
  const res = await (client || pool).query(
    `SELECT id, reseller_name, company_name, partner_type, joining_date, created_at, status,
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
            COALESCE(real_ip_count,0)::int AS real_ip_count,
            COALESCE(real_ip_price,0)::numeric AS real_ip_price,
            COALESCE(otc_charge,0)::numeric AS otc_charge
     FROM resellers WHERE id = $1${lockClause}`,
    [resellerId],
  );
  return res.rows[0] || null;
}

/** Extract custom fromDay/toDay from an existing bill_details JSON (to preserve partial-month billing) */
function extractCustomDayRange(billDetailsRaw, monthYm) {
  const fallbackFirstItem = () => {
    try {
      const details = typeof billDetailsRaw === "string" ? JSON.parse(billDetailsRaw) : billDetailsRaw;
      if (Array.isArray(details) && details.length > 0) {
        const firstItem = details[0];
        if (firstItem?.date_range && typeof firstItem.date_range === "string") {
          const rangeParts = firstItem.date_range.split("-").map((s) => s.trim());
          if (rangeParts.length === 2) {
            const d1 = parseInt(rangeParts[0].split(" ")[0], 10);
            const d2 = parseInt(rangeParts[1].split(" ")[0], 10);
            if (Number.isInteger(d1) && Number.isInteger(d2) && d1 > 0 && d2 >= d1) {
              const info = monthInfo(monthYm);
              if (d1 > 1 || d2 < info.daysInMonth) {
                return { customFromDay: d1, customToDay: d2 };
              }
            }
          }
        }
      }
    } catch (_) { /* ignore */ }
    return { customFromDay: undefined, customToDay: undefined };
  };
  // Prefer min/max across ALL segments: the first stored item may be a partial
  // mid-month segment (e.g. "15 Aug - 19 Aug"), which must not truncate the recalc.
  try {
    const details = typeof billDetailsRaw === "string" ? JSON.parse(billDetailsRaw) : billDetailsRaw;
    if (Array.isArray(details) && details.length > 0) {
      let minFrom = Infinity;
      let maxTo = -Infinity;
      for (const it of details) {
        const f = Number(it?.from_day_num);
        const t = Number(it?.to_day_num);
        if (Number.isInteger(f) && f > 0 && f < minFrom) minFrom = f;
        if (Number.isInteger(t) && t > 0 && t > maxTo) maxTo = t;
      }
      if (minFrom !== Infinity && maxTo !== -Infinity && maxTo >= minFrom) {
        const info = monthInfo(monthYm);
        if (minFrom > 1 || maxTo < info.daysInMonth) {
          return { customFromDay: minFrom, customToDay: maxTo };
        }
      }
    }
  } catch (_) { /* fall through */ }
  return fallbackFirstItem();
}

/**
 * Preview impact of one or more retroactive corrections across affected months.
 * Accepts POST body: { corrections: [...], admin_note? }
 */
const previewRetroactiveCorrection = async (req, res) => {
  try {
    const resellerId = parseInt(req.params.resellerId || req.params.id, 10);
    if (!resellerId || !Number.isSafeInteger(resellerId)) {
      return res.status(400).json({ message: "Valid reseller ID is required" });
    }

    // Normalize corrections array (supports both { corrections: [...] } and legacy single-object)
    const rawCorrections = extractCorrectionsFromBody(req.body);
    if (rawCorrections.length === 0) {
      return res.status(400).json({ message: "At least one correction is required" });
    }

    const normalized = [];
    for (let i = 0; i < rawCorrections.length; i++) {
      const result = validateCorrection(rawCorrections[i], i);
      if (!result.ok) return res.status(400).json({ message: result.error });
      normalized.push(result.normalized);
    }

    const reseller = await fetchResellerForCalc(null, resellerId, false);
    if (!reseller) return res.status(404).json({ message: "Reseller not found" });
    if (reseller.partner_type === "channel_partner") {
      return res.status(400).json({
        message: "Channel Partners use commission billing. Retroactive correction is only for bandwidth resellers.",
      });
    }

    const joiningDate = parseYMD(reseller.joining_date || reseller.created_at);
    const earliestEffDate = normalized.reduce((min, c) => (c.effective_date < min ? c.effective_date : min), normalized[0].effective_date);

    if (joiningDate && toDateOnlyString(joiningDate) > earliestEffDate) {
      return res.status(400).json({
        message: `Earliest effective date (${earliestEffDate}) cannot be prior to reseller joining date (${toDateOnlyString(joiningDate)})`,
      });
    }

    const startMonthYm = earliestEffDate.slice(0, 7);
    const currentDhakaMonth = getDhakaMonthYm();

    const existingBillsRes = await pool.query(
      `SELECT id, reseller_id, bill_month, amount, adjustment, adjustment_note, previous_due, bill_details
       FROM monthly_bills
       WHERE reseller_id = $1 AND bill_month >= $2::date
       ORDER BY bill_month ASC`,
      [resellerId, `${startMonthYm}-01`],
    );

    const logTypeExpr = LOG_TYPE_EXPR();
    const timeline = [];
    let runningPrevDue = null;
    let netDelta = 0;

    for (let i = 0; i < existingBillsRes.rows.length; i++) {
      const b = existingBillsRes.rows[i];
      const monthYm = toDateOnlyString(b.bill_month).slice(0, 7);
      const oldAmount = parseAmount(b.amount, 0);
      const oldPrevDue = parseAmount(b.previous_due, 0);
      const adjustment = parseAmount(b.adjustment, 0);

      const { customFromDay, customToDay } = extractCustomDayRange(b.bill_details, monthYm);

      const simulatedBreakdown = await calculateMonthlyBillBreakdown(resellerId, monthYm, reseller, {
        fromDay: customFromDay,
        toDay: customToDay,
        simulatedCorrections: normalized,
      });

      const newAmount = parseAmount(simulatedBreakdown.total, 0);
      if (i === 0) runningPrevDue = oldPrevDue;
      const assignedPrevDue = runningPrevDue;

      const logsRes = await pool.query(
        `SELECT
           COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0)::numeric AS total_paid,
           COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0)::numeric AS total_product
         FROM billing_logs
         WHERE reseller_id = $1
           AND COALESCE(effective_date, created_at) >= $2::date
           AND COALESCE(effective_date, created_at) < ($2::date + interval '1 month')`,
        [resellerId, `${monthYm}-01`],
      );

      const paid = parseAmount(logsRes.rows[0]?.total_paid, 0);
      const product = parseAmount(logsRes.rows[0]?.total_product, 0);
      const oldClosingDue = Math.round((oldPrevDue + oldAmount + adjustment + product - paid) * 100) / 100;
      const newClosingDue = Math.round((assignedPrevDue + newAmount + adjustment + product - paid) * 100) / 100;

      timeline.push({
        bill_id: b.id,
        month: monthYm,
        is_finalized: true,
        old_amount: oldAmount,
        new_amount: newAmount,
        old_previous_due: oldPrevDue,
        new_previous_due: assignedPrevDue,
        old_closing_due: oldClosingDue,
        new_closing_due: newClosingDue,
        adjustment,
        adjustment_note: b.adjustment_note,
        delta: Math.round((newAmount - oldAmount + (assignedPrevDue - oldPrevDue)) * 100) / 100,
      });

      runningPrevDue = newClosingDue;
      netDelta += Math.round((newAmount - oldAmount) * 100) / 100;
    }

    // Projected current month impact (if not yet finalized)
    const isCurrentFinalized = existingBillsRes.rows.some(
      (b) => toDateOnlyString(b.bill_month).slice(0, 7) === currentDhakaMonth,
    );

    let projectedMonthPreview = null;
    if (!isCurrentFinalized && startMonthYm <= currentDhakaMonth) {
      const simulatedCur = await calculateMonthlyBillBreakdown(resellerId, currentDhakaMonth, reseller, {
        simulatedCorrections: normalized,
      });
      const currentDueQ = await pool.query(
        `SELECT fn_reseller_previous_due($1, $2::date) AS current_due`,
        [resellerId, `${currentDhakaMonth}-01`],
      );
      const oldCurrentDue = parseAmount(currentDueQ.rows[0]?.current_due, 0);
      const simulatedPrevDue = runningPrevDue !== null ? runningPrevDue : oldCurrentDue;
      projectedMonthPreview = {
        month: currentDhakaMonth,
        is_finalized: false,
        new_amount: simulatedCur.total,
        new_previous_due: simulatedPrevDue,
        new_projected_total: Math.round((simulatedPrevDue + Number(simulatedCur.total)) * 100) / 100,
      };
    }

    res.json({
      reseller_id: resellerId,
      reseller_name: reseller.reseller_name || reseller.company_name,
      corrections: normalized,
      start_month: startMonthYm,
      current_month: currentDhakaMonth,
      affected_finalized_count: timeline.length,
      timeline,
      projected_month: projectedMonthPreview,
      total_financial_delta: Math.round(netDelta * 100) / 100,
    });
  } catch (error) {
    console.error("previewRetroactiveCorrection error:", error);
    res.status(500).json({ message: "Failed to simulate retroactive correction: " + error.message });
  }
};

/**
 * Apply one or more retroactive corrections and cascade-recalculate all affected bills.
 * Accepts POST body: { corrections: [...], admin_note }
 */
const applyRetroactiveCorrection = async (req, res) => {
  const client = await pool.connect();
  try {
    const resellerId = parseInt(req.params.resellerId || req.params.id, 10);
    if (!resellerId || !Number.isSafeInteger(resellerId)) {
      return res.status(400).json({ message: "Valid reseller ID is required" });
    }

    const note = String(req.body.admin_note || "").trim();
    if (!note) {
      return res.status(400).json({ message: "Admin note / justification is strictly required for retroactive corrections" });
    }

    const rawCorrections = extractCorrectionsFromBody(req.body);
    if (rawCorrections.length === 0) {
      return res.status(400).json({ message: "At least one correction is required" });
    }

    const normalized = [];
    for (let i = 0; i < rawCorrections.length; i++) {
      const result = validateCorrection(rawCorrections[i], i);
      if (!result.ok) return res.status(400).json({ message: result.error });
      normalized.push(result.normalized);
    }

    await client.query("BEGIN");

    const reseller = await fetchResellerForCalc(client, resellerId, true);
    if (!reseller) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reseller not found" });
    }
    if (reseller.partner_type === "channel_partner") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Channel Partners use commission billing. Retroactive correction is only for bandwidth resellers." });
    }

    const joiningDate = parseYMD(reseller.joining_date || reseller.created_at);
    const earliestEffDate = normalized.reduce((min, c) => (c.effective_date < min ? c.effective_date : min), normalized[0].effective_date);
    if (joiningDate && toDateOnlyString(joiningDate) > earliestEffDate) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: `Earliest effective date (${earliestEffDate}) cannot be prior to reseller joining date (${toDateOnlyString(joiningDate)})`,
      });
    }

    const actor = getActor(req);
    const reqMeta = getReqMeta(req);
    const requestedBy = actor.actor_user_id || null;

    const appliedRefs = []; // track IDs for audit

    // ─── Apply each correction ───────────────────────────────────────────────
    for (const corr of normalized) {
      if (corr.correction_type === "bandwidth") {
        // Insert into bandwidth_requests as already approved & implemented
        const bwReqRes = await client.query(
          `INSERT INTO bandwidth_requests (
             reseller_id, bw_type, change_type, amount, requested_effective_date, implementation_date,
             admin_status, engineer_status, requested_by, admin_note, tech_note, created_at
           ) VALUES (
             $1, $2, $3, $4, $5::date, $5::date,
             'approved', 'implemented', $6, $7, $8, NOW()
           ) RETURNING id`,
          [
            resellerId,
            corr.bw_type,
            corr.change_type,
            corr.amount,
            corr.effective_date,
            requestedBy,
            `Retroactive correction: ${note}`,
            `Retroactive ${corr.change_type} of ${corr.amount} Mbps ${corr.bw_type} applied by ${actor.actor_user_name || "Admin"}`,
          ],
        );
        const bwRequestId = bwReqRes.rows[0].id;
        appliedRefs.push({ type: "bandwidth_request", id: bwRequestId, detail: corr });

        // Billing log entry
        await client.query(
          `INSERT INTO billing_logs (reseller_id, request_id, change_desc, transaction_amount, effective_date, created_at, log_type)
           VALUES ($1, $2, $3, 0, $4::date, NOW(), 'bandwidth_change')`,
          [
            resellerId,
            bwRequestId,
            `Retroactive correction: ${corr.change_type} ${corr.amount} Mbps on ${corr.bw_type} (Effective: ${corr.effective_date})`,
            corr.effective_date,
          ],
        );

        // Update resellers table current capacity column
        const bwCol = normalizeBwType(corr.bw_type);
        const capacityDelta = (corr.change_type === "decrease" ? -1 : 1) * corr.amount;
        await client.query(
          `UPDATE resellers SET ${bwCol} = GREATEST(0, COALESCE(${bwCol},0) + $1), last_activity_date = NOW() WHERE id = $2`,
          [capacityDelta, resellerId],
        );

      } else if (corr.correction_type === "rate") {
        // Fetch current rates from resellers table
        const currentRatesRes = await client.query(
          `SELECT rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn FROM resellers WHERE id = $1`,
          [resellerId],
        );
        const currentRates = currentRatesRes.rows[0] || {};
        const rateCol = RATE_COL_MAP[corr.bw_type];
        const prevRate = parseAmount(currentRates[rateCol], 0);

        // Update resellers table with new rate
        await client.query(
          `UPDATE resellers SET ${rateCol} = $1, last_activity_date = NOW() WHERE id = $2`,
          [corr.new_rate, resellerId],
        );

        // Insert into reseller_rate_change_logs (preserve prev & new for all types)
        const logCols = RATE_LOG_COL_MAP;
        const rateLogRes = await client.query(
          `INSERT INTO reseller_rate_change_logs
             (reseller_id, changed_by_id, changed_by, changed_by_role, effective_date, note,
              rate_iig, rate_bdix, rate_ggc, rate_fna, rate_cdn, rate_bcdn, rate_nttn,
              prev_rate_iig, prev_rate_bdix, prev_rate_ggc, prev_rate_fna, prev_rate_cdn, prev_rate_bcdn, prev_rate_nttn)
           VALUES ($1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,$11,$12,$13,
             $14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          [
            resellerId,
            actor.actor_user_id || null,
            actor.actor_user_name || null,
            actor.actor_role || null,
            corr.effective_date,
            `Retroactive rate correction: ${note}`,
            // new rates — only this bw_type changes, others stay
            corr.bw_type === "IIG"  ? corr.new_rate : parseAmount(currentRates.rate_iig, 0),
            corr.bw_type === "BDIX" ? corr.new_rate : parseAmount(currentRates.rate_bdix, 0),
            corr.bw_type === "GGC"  ? corr.new_rate : parseAmount(currentRates.rate_ggc, 0),
            corr.bw_type === "FNA"  ? corr.new_rate : parseAmount(currentRates.rate_fna, 0),
            corr.bw_type === "CDN"  ? corr.new_rate : parseAmount(currentRates.rate_cdn, 0),
            corr.bw_type === "BCDN" ? corr.new_rate : parseAmount(currentRates.rate_bcdn, 0),
            corr.bw_type === "NTTN" ? corr.new_rate : parseAmount(currentRates.rate_nttn, 0),
            // prev rates
            parseAmount(currentRates.rate_iig, 0),
            parseAmount(currentRates.rate_bdix, 0),
            parseAmount(currentRates.rate_ggc, 0),
            parseAmount(currentRates.rate_fna, 0),
            parseAmount(currentRates.rate_cdn, 0),
            parseAmount(currentRates.rate_bcdn, 0),
            parseAmount(currentRates.rate_nttn, 0),
          ],
        );
        const rateLogId = rateLogRes.rows[0].id;
        appliedRefs.push({ type: "rate_change_log", id: rateLogId, detail: corr });

        // Update reseller_rate_history (used by billing engine for in-month rate segments)
        if (corr.new_rate !== prevRate) {
          await client.query(
            `DELETE FROM reseller_rate_history WHERE reseller_id=$1 AND bw_type=$2 AND effective_date=$3::date`,
            [resellerId, corr.bw_type, corr.effective_date],
          );
          await client.query(
            `INSERT INTO reseller_rate_history (reseller_id, bw_type, rate, effective_date) VALUES ($1, $2, $3, $4::date)`,
            [resellerId, corr.bw_type, corr.new_rate, corr.effective_date],
          );
        }
      }
    }

    // ─── Two-phase commit (permanent fix) ─────────────────────────────────────
    // calculateMonthlyBillBreakdown reads bandwidth_requests / rate history via the
    // GLOBAL pool, which under READ COMMITTED cannot see this transaction's
    // uncommitted inserts. Recalculating before commit therefore silently missed the
    // just-applied rows (flat segment at the new BW, no split, no change_note —
    // seen live: GGC Aug-2026 billed 600 Mbps for the whole period instead of
    // prorating from the effective date). Commit the correction writes first so the
    // cascade below recalculates against fully visible state.
    await client.query("COMMIT");

    // Phase 2 runs in a fresh transaction: recalculate bills + audit.
    await client.query("BEGIN");

    // ─── Cascade Recalculate all finalized monthly_bills from earliest affected month ───
    const startMonthYm = earliestEffDate.slice(0, 7);

    const existingBills = await client.query(
      `SELECT id, bill_month, amount, adjustment, adjustment_note, previous_due, bill_details
       FROM monthly_bills
       WHERE reseller_id = $1 AND bill_month >= $2::date
       ORDER BY bill_month ASC`,
      [resellerId, `${startMonthYm}-01`],
    );

    const logTypeExpr = LOG_TYPE_EXPR();
    const updatedBills = [];
    let runningPrevDue = null;

    // Fetch refreshed reseller row for calculations (after all updates applied)
    const refreshedReseller = (await client.query(`SELECT * FROM resellers WHERE id = $1`, [resellerId])).rows[0];

    for (let i = 0; i < existingBills.rows.length; i++) {
      const b = existingBills.rows[i];
      const monthYm = toDateOnlyString(b.bill_month).slice(0, 7);
      const adjustment = parseAmount(b.adjustment, 0);

      const { customFromDay, customToDay } = extractCustomDayRange(b.bill_details, monthYm);

      // Recalculate with updated DB state (no simulation needed — corrections are already committed)
      const recalculated = await calculateMonthlyBillBreakdown(resellerId, monthYm, refreshedReseller, {
        fromDay: customFromDay,
        toDay: customToDay,
      });

      // Diagnostic (permanent): if a bandwidth correction targets this month but no
      // segment carries a change_note, warn server-side so the miss is traceable
      // (seen once: GGC Aug-2026 produced a flat segment with no note).
      try {
        const effTypes = new Set(
          normalized
            .filter((c) => c.correction_type === "bandwidth" && String(c.effective_date || "").slice(0, 7) === monthYm)
            .map((c) => String(c.bw_type || "").toUpperCase()),
        );
        if (effTypes.size > 0) {
          const noted = new Set(
            recalculated.items.filter((i) => i.change_note).map((i) => String(i.desc || "").toUpperCase()),
          );
          const missing = [...effTypes].filter((t) => !noted.has(t));
          if (missing.length > 0) {
            console.warn(`[retroactive-correction] reseller ${resellerId} month ${monthYm}: no change_note for ${missing.join(",")} despite in-month corrections`);
          }
        }
      } catch (_) { /* diagnostic only */ }

      const newAmount = parseAmount(recalculated.total, 0);
      if (i === 0) runningPrevDue = parseAmount(b.previous_due, 0);
      const assignedPrevDue = runningPrevDue;

      await client.query(
        `UPDATE monthly_bills
         SET amount = $1, bill_details = $2, previous_due = $3
         WHERE id = $4`,
        [newAmount, JSON.stringify(recalculated.items), assignedPrevDue, b.id],
      );

      const logsRes = await client.query(
        `SELECT
           COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('payment', 'discount')), 0)::numeric AS total_paid,
           COALESCE(SUM(transaction_amount) FILTER (WHERE ${logTypeExpr} IN ('product', 'product_charge', 'charge')), 0)::numeric AS total_product
         FROM billing_logs
         WHERE reseller_id = $1
           AND COALESCE(effective_date, created_at) >= $2::date
           AND COALESCE(effective_date, created_at) < ($2::date + interval '1 month')`,
        [resellerId, `${monthYm}-01`],
      );

      const paid = parseAmount(logsRes.rows[0]?.total_paid, 0);
      const product = parseAmount(logsRes.rows[0]?.total_product, 0);
      const closingDue = Math.round((assignedPrevDue + newAmount + adjustment + product - paid) * 100) / 100;

      updatedBills.push({
        id: b.id,
        month: monthYm,
        old_amount: parseAmount(b.amount, 0),
        new_amount: newAmount,
        old_previous_due: parseAmount(b.previous_due, 0),
        new_previous_due: assignedPrevDue,
        closing_due: closingDue,
      });

      runningPrevDue = closingDue;
    }

    // ─── Comprehensive Audit Log ─────────────────────────────────────────────
    let auditLogId = null;
    try {
      // Compute total bill delta from the updated bills (amount_after - amount_before)
      const totalOldAmount = updatedBills.reduce((s, b) => s + b.old_amount, 0);
      const totalNewAmount = updatedBills.reduce((s, b) => s + b.new_amount, 0);
      const computedNetDelta = Math.round((totalNewAmount - totalOldAmount) * 100) / 100;

      // Log one audit entry per affected bill month for granular invoice display
      for (const ub of updatedBills) {
        const billDelta = Math.round((ub.new_amount - ub.old_amount) * 100) / 100;
        await logResellerFinancialChange(client, {
          reseller_id: resellerId,
          actor_user_id: actor.actor_user_id || null,
          actor_user_name: actor.actor_user_name || null,
          actor_role: actor.actor_role || null,
          action_type: 'RETROACTIVE_CORRECTION',
          reference_table: 'monthly_bills',
          reference_id: ub.id,
          amount_before: Math.round(ub.old_amount * 100) / 100,
          amount_after: Math.round(ub.new_amount * 100) / 100,
          amount_delta: billDelta,
          field_changes: {
            corrections: normalized,
            affected_month: ub.month,
          },
          note: `Retroactive correction for ${ub.month}: bill changed from ${ub.old_amount.toFixed(2)} → ${ub.new_amount.toFixed(2)} Tk (Δ ${billDelta >= 0 ? '+' : ''}${billDelta.toFixed(2)}). ${normalized.length} correction(s): ${normalized.map(c => c.correction_type === 'rate' ? `Rate ${c.bw_type} → ${c.new_rate} Tk/Mo${c.effective_date ? ` (eff. ${String(c.effective_date).slice(0, 10)})` : ''}` : `BW ${c.change_type} ${c.amount} Mbps ${c.bw_type}${c.effective_date ? ` (eff. ${String(c.effective_date).slice(0, 10)})` : ''}`).join('; ')}. Admin note: ${note}`,
          request_payload: { corrections: normalized, refs: appliedRefs },
          route_path: reqMeta.route_path,
          http_method: reqMeta.http_method,
          ip_address: reqMeta.ip_address,
        });
      }

      // Also log a summary entry for the overall correction session
      const summaryRes = await logResellerFinancialChange(client, {
        reseller_id: resellerId,
        actor_user_id: actor.actor_user_id || null,
        actor_user_name: actor.actor_user_name || null,
        actor_role: actor.actor_role || null,
        action_type: 'RETROACTIVE_CORRECTION_SUMMARY',
        reference_table: 'resellers',
        reference_id: resellerId,
        amount_before: Math.round(totalOldAmount * 100) / 100,
        amount_after: Math.round(totalNewAmount * 100) / 100,
        amount_delta: computedNetDelta,
        field_changes: { corrections: normalized, updated_bill_count: updatedBills.length },
        note: `Retroactive correction applied: ${normalized.length} correction(s). Updated ${updatedBills.length} bill(s). Net Δ: ${computedNetDelta >= 0 ? '+' : ''}${computedNetDelta.toFixed(2)} Tk. Admin note: ${note}`,
        request_payload: { corrections: normalized, updated_bills: updatedBills, refs: appliedRefs },
        route_path: reqMeta.route_path,
        http_method: reqMeta.http_method,
        ip_address: reqMeta.ip_address,
      });
      auditLogId = summaryRes?.rows?.[0]?.id || null;
    } catch (auditErr) {
      console.warn("Retroactive correction audit logging non-fatal error:", auditErr.message);
    }


    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      message: `Retroactive correction applied successfully. ${normalized.length} correction(s) applied. ${updatedBills.length} finalized bill(s) recalculated and synchronized.`,
      applied_corrections: normalized,
      audit_log_id: auditLogId,
      updated_bills: updatedBills,
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* no active txn (e.g. phase-1 already committed) */ }
    console.error("applyRetroactiveCorrection error:", error);
    console.error("applyRetroactiveCorrection: phase-1 correction rows may already be committed while the bill cascade failed — verify bills before retrying to avoid double-apply.");
    res.status(500).json({ message: "Failed to apply retroactive correction: " + error.message });
  } finally {
    client.release();
  }
};

module.exports = {
  previewRetroactiveCorrection,
  applyRetroactiveCorrection,
};
