/**
 * Maxim sync HTTP layer (channel-partner scope).
 * Worker lives in server/utilities/maximSync.js — this file only handles
 * validation, sync-log rows, prefill aggregation and suffix mapping.
 */
const pool = require("../utilities/db");
const { initChannelPartnerTables } = require("../utilities/channelPartnerInit");
const { runMaximSync } = require("../utilities/maximSync");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SUFFIX_RE = /^@[a-z0-9_.-]+$/i;

const resolveSuffix = async (resellerId, override) => {
  if (override) {
    if (!SUFFIX_RE.test(override) || override.length > 60)
      throw Object.assign(new Error("suffix must look like @speednetmasum"), {
        status: 400,
      });
    return override.toLowerCase();
  }
  await initChannelPartnerTables();
  const r = await pool.query(
    `SELECT COALESCE(
       (SELECT maxim_suffix FROM resellers WHERE id = $1),
       ''
     ) AS suffix`,
    [resellerId],
  ).catch(() => ({ rows: [{ suffix: "" }] }));
  // Column may not exist on very old DBs (init creates it) — retry post-init.
  let suffix = String(r.rows[0]?.suffix || "").toLowerCase();
  if (!suffix) {
    try {
      const r2 = await pool.query(
        `SELECT COALESCE(maxim_suffix,'') AS suffix FROM resellers WHERE id = $1`,
        [resellerId],
      );
      suffix = String(r2.rows[0]?.suffix || "").toLowerCase();
    } catch {
      suffix = "";
    }
  }
  if (!suffix)
    throw Object.assign(
      new Error("Maxim suffix not set for this reseller (save it first)"),
      { status: 400 },
    );
  return suffix;
};

// POST /api/channel-partners/:resellerId/maxim-sync {month, suffix?}
const syncNow = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month, suffix: suffixOverride } = req.body || {};
    if (!MONTH_RE.test(month || ""))
      return res.status(400).json({ message: "month must be YYYY-MM" });
    let suffix;
    try {
      suffix = await resolveSuffix(resellerId, suffixOverride);
    } catch (e) {
      return res.status(e.status || 500).json({ message: 'Maxim sync failed. Please try again later.' });
    }
    if (suffixOverride) {
      await pool.query(`UPDATE resellers SET maxim_suffix = $2 WHERE id = $1`, [
        resellerId,
        suffix,
      ]).catch(() => {});
    }
    const snapshotMonth = `${month}-01`;
    // Reap orphaned 'running' rows first: a crash between INSERT and UPDATE
    // would otherwise block this reseller+month forever (409 below).
    await pool.query(
      `UPDATE maxim_sync_logs SET status = 'failed', error = 'stale running reaped', finished_at = NOW()
        WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 hours'`,
    ).catch(() => {});
    // Overlap guard: cron and manual (either PM2 instance) must not scrape
    // the same reseller+month concurrently (double outbound + double upsert).
    const busy = await pool.query(
      `SELECT 1 FROM maxim_sync_logs
        WHERE reseller_id = $1 AND snapshot_month = $2::date AND status = 'running' LIMIT 1`,
      [resellerId, snapshotMonth],
    ).catch(() => ({ rows: [] }));
    if (busy.rows.length) {
      return res.status(409).json({ message: "Maxim sync already running for this month" });
    }
    const log = await pool.query(
      `INSERT INTO maxim_sync_logs
        (reseller_id, reseller_suffix, snapshot_month, source, status)
       VALUES ($1,$2,$3::date,$4,'running') RETURNING id`,
      [resellerId, suffix, snapshotMonth, "manual"],
    );
    const logId = log.rows[0].id;
    // Background: do not await (worker can take minutes for large POPs).
    runMaximSync({
      resellerId: Number(resellerId),
      suffix,
      monthYm: month,
      source: "manual",
      logId,
    }).catch((err) => console.error("[MaximSync] background failed:", err.message));
    res.json({ message: "Maxim sync started", logId, status: "running" });
  } catch (error) {
    console.error("maximSync.syncNow:", error);
    res.status(500).json({ message: "Failed to start Maxim sync" });
  }
};

// GET /api/channel-partners/:resellerId/maxim-sync/status?month=
const syncStatus = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month } = req.query;
    const params = [resellerId];
    let monthFilter = "";
    if (month) {
      if (!MONTH_RE.test(month))
        return res.status(400).json({ message: "month must be YYYY-MM" });
      params.push(`${month}-01`);
      monthFilter = "AND l.snapshot_month = $2::date";
    }
    const log = await pool.query(
      `SELECT l.*, r.maxim_suffix AS saved_suffix
       FROM maxim_sync_logs l
       LEFT JOIN resellers r ON r.id = l.reseller_id
       WHERE l.reseller_id = $1 ${monthFilter}
       ORDER BY l.started_at DESC LIMIT 1`,
      params,
    ).catch(() => ({ rows: [] }));
    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM maxim_customer_snapshots
           WHERE reseller_id = $1 ${month ? "AND snapshot_month = $2::date" : ""}) AS customers,
         (SELECT COUNT(*)::int FROM maxim_payment_snapshots
           WHERE reseller_id = $1 ${month ? "AND snapshot_month = $2::date" : ""}) AS payments`,
      month ? [resellerId, `${month}-01`] : [resellerId],
    ).catch(() => ({ rows: [{ customers: 0, payments: 0 }] }));
    res.json({
      log: log.rows[0] || null,
      counts: counts.rows[0] || { customers: 0, payments: 0 },
    });
  } catch (error) {
    console.error("maximSync.syncStatus:", error);
    res.status(500).json({ message: "Failed to load Maxim sync status" });
  }
};

// GET /api/channel-partners/:resellerId/maxim-prefill?month=
// Returns ImportModal-ready rows: {name, receiveAmount, notPaidAmount, source:'maxim'}
const prefill = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month } = req.query;
    if (!MONTH_RE.test(month || ""))
      return res.status(400).json({ message: "month must be YYYY-MM" });
    let suffix;
    try {
      suffix = await resolveSuffix(resellerId, null);
    } catch (e) {
      return res.status(e.status || 500).json({ message: 'Maxim sync failed. Please try again later.' });
    }
    const snapshotMonth = `${month}-01`;
    const r = await pool.query(
      `SELECT p.username,
              MAX(p.cust_id) AS cust_id,
              MAX(c.name) AS name,
              MAX(c.package_name) AS package_name,
              COALESCE(SUM(p.rcv_amount),0)::numeric AS rcv,
              COALESCE(MAX(p.total_bill),0)::numeric AS total_bill,
              MAX(c.balance)::numeric AS balance,
              MAX(c.status) AS status
       FROM maxim_payment_snapshots p
       LEFT JOIN maxim_customer_snapshots c
         ON c.snapshot_month = p.snapshot_month AND c.username = p.username
       WHERE p.snapshot_month = $1::date AND p.reseller_id = $2
         AND LOWER(p.pay_type) = 'cash'
       GROUP BY p.username ORDER BY p.username`,
      [snapshotMonth, resellerId],
    );
    const rows = r.rows.map((row, idx) => {
      const rcv = Number(row.rcv || 0);
      const total = Number(row.total_bill || 0);
      const notPaid = Math.max(0, Math.round((total - rcv) * 100) / 100);
      return {
        id: `maxim-${idx}`,
        name: row.username,
        receiveAmount: rcv,
        notPaidAmount: notPaid,
        isDuplicate: false,
        checked: true,
        source: "maxim",
        meta: {
          cust_id: row.cust_id,
          customer_name: row.name,
          package: row.package_name,
          balance: row.balance,
          status: row.status,
        },
        rawRow: {
          "Customer Name": row.username,
          "Receive Amount": rcv,
          "Not Paid": notPaid,
        },
      };
    });
    res.json({ month, suffix, count: rows.length, rows });
  } catch (error) {
    console.error("maximSync.prefill:", error);
    res.status(500).json({ message: "Failed to build Maxim prefill" });
  }
};

// PUT /api/channel-partners/:resellerId/maxim-suffix {suffix}
const setSuffix = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { suffix } = req.body || {};
    if (!SUFFIX_RE.test(suffix || "") || String(suffix).length > 60)
      return res
        .status(400)
        .json({ message: "suffix must look like @speednetmasum" });
    await pool.query(`UPDATE resellers SET maxim_suffix = $2 WHERE id = $1`, [
      resellerId,
      String(suffix).toLowerCase(),
    ]);
    res.json({ message: "Maxim suffix saved", suffix: String(suffix).toLowerCase() });
  } catch (error) {
    console.error("maximSync.setSuffix:", error);
    res.status(500).json({ message: "Failed to save Maxim suffix" });
  }
};

// GET /api/channel-partners/:resellerId/maxim-health
// Per-month Portal vs Maxim comparison (last 8 months with any data).
const health = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const months = await pool.query(
      `SELECT month AS ym FROM (
         SELECT DISTINCT month FROM channel_user_payments WHERE reseller_id = $1
         UNION
         SELECT DISTINCT to_char(snapshot_month, 'YYYY-MM') AS month
           FROM maxim_payment_snapshots WHERE reseller_id = $1
         UNION
         SELECT DISTINCT to_char(snapshot_month, 'YYYY-MM') AS month
           FROM maxim_customer_snapshots WHERE reseller_id = $1
       ) m ORDER BY 1 DESC LIMIT 8`,
      [resellerId],
    );
    const rows = [];
    for (const { ym } of months.rows) {
      const snap = `${ym}-01`;
      const portal = await pool.query(
        `SELECT COUNT(*)::int AS users,
                COALESCE(SUM(amount_paid),0)::numeric AS paid,
                COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)),0)::numeric AS pending
         FROM channel_user_payments WHERE reseller_id = $1 AND month = $2`,
        [resellerId, ym],
      );
      const maxim = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM maxim_customer_snapshots
                  WHERE reseller_id = $1 AND snapshot_month = $2::date) AS customers,
                (SELECT COUNT(*)::int FROM maxim_payment_snapshots
                  WHERE reseller_id = $1 AND snapshot_month = $2::date
                    AND LOWER(pay_type) = 'cash') AS payments,
                (SELECT COALESCE(SUM(rcv_amount),0)::numeric FROM maxim_payment_snapshots
                  WHERE reseller_id = $1 AND snapshot_month = $2::date
                    AND LOWER(pay_type) = 'cash') AS cash`,
        [resellerId, snap],
      );
      const p = portal.rows[0];
      const m = maxim.rows[0];
      const paid = Number(p.paid || 0);
      const cash = Number(m.cash || 0);
      rows.push({
        month: ym,
        portal: { users: p.users, paid, pending: Number(p.pending || 0) },
        maxim: { customers: m.customers, payments: m.payments, cash },
        match: p.users > 0 && m.payments > 0 ? Math.abs(paid - cash) < 1 : null,
      });
    }
    res.json({ rows });
  } catch (error) {
    console.error("maximSync.health:", error);
    res.status(500).json({ message: "Failed to build Maxim health" });
  }
};

module.exports = { syncNow, syncStatus, prefill, setSuffix, health };
