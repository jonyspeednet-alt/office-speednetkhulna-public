const XLSX = require("xlsx");
const path = require('path');
const { openFirstSheet, sanitizeRows } = require("../utilities/xlsxGuard");
const pool = require("../utilities/db");
const { writeChannelPayments } = require("../utilities/channelPaymentWriter");
const { lockChannelMonth, lockProductMonth, withChannelMonthTransaction, withCommissionTransaction, financialError } = require("../utilities/channelFinancialLock");

// Escape LIKE wildcards so search input can't inject %/_ patterns
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

const { initChannelPartnerTables } = require("../utilities/channelPartnerInit");
const {
  roundAmount: roundAmountHelper,
  sumProductDeduction,
  getProductDeductionForMonth,
} = require("../utilities/channelProductHelpers");
const {
  logResellerFinancialChange,
  getActor,
  getReqMeta,
} = require("../utilities/resellerFinancialAudit");

const parseAmount = (v, d = 0) => {
  if (v === null || v === undefined || v === "") return d;
  if (typeof v === "number") return Number.isFinite(v) ? v : d;
  const cleaned = String(v)
    .replace(/[,৳$]/g, "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  if (!cleaned) return d;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : d;
};

// API writes must not use the forgiving spreadsheet parser: malformed input
// must never silently replace an existing financial amount with zero.
const parseFinancialAmount = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') throw financialError(400, 'Amount must be a finite number');
  const text = String(value).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw financialError(400, 'Amount must be a finite number');
  const amount = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(amount)) throw financialError(400, 'Amount must be a finite number');
  return amount;
};

const roundAmount = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const normalizeSheetHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const getSheetValue = (row, aliases) => {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }

  const normalizedAliases = aliases.map(normalizeSheetHeader);
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.includes(normalizeSheetHeader(key))) return value;
  }

  return undefined;
};

const hasSheetValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== "";

/**
 * Calculate billing status based on amounts
 * @param {number} amountDue - Total amount due
 * @param {number} amountPaid - Amount paid
 * @returns {string} - 'realized', 'partial_deferred', or 'deferred'
 */
const calculateBillingStatus = (amountDue, amountPaid) => {
  const due = roundAmount(parseAmount(amountDue, 0));
  const paid = roundAmount(parseAmount(amountPaid, 0));

  if (paid >= due && due > 0) return "realized";
  if (paid > 0 && paid < due) return "partial_deferred";
  return "deferred";
};

/**
 * Calculate realized and deferred amounts
 * @param {number} amountDue - Total amount due
 * @param {number} amountPaid - Amount paid
 * @returns {{realized: number, deferred: number}}
 */
const calculateRealizedDeferred = (amountDue, amountPaid) => {
  const due = roundAmount(Math.max(0, parseAmount(amountDue, 0)));
  const paid = roundAmount(Math.max(0, parseAmount(amountPaid, 0)));

  return {
    realized: roundAmount(Math.min(paid, due)),
    deferred: roundAmount(Math.max(0, due - paid)),
  };
};

const calculatePaymentStatus = (amountDue, amountPaid) => {
  const due = roundAmount(Math.max(0, parseAmount(amountDue, 0)));
  const paid = roundAmount(Math.max(0, parseAmount(amountPaid, 0)));
  if (paid <= 0) return "unpaid";
  if (paid >= due && due > 0) return "paid";
  return "partial";
};

const monthToDateSql = (paramRef) => `(${paramRef} || '-01')::date`;

const getDhakaMonthYm = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return y && m
    ? `${y}-${m}`
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const getPreviousMonthYm = (month) => {
  const [year, monthNo] = String(month || "")
    .split("-")
    .map(Number);
  if (!year || !monthNo) return null;
  const previous = new Date(year, monthNo - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
};

// ─── Channel Partner Users ─────────────────────────────────

const listUsers = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { status, search } = req.query;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));

    let sql = `SELECT * FROM channel_partner_users WHERE reseller_id = $1`;
    const params = [resellerId];
    let idx = 2;

    if (status) {
      if (!['active', 'inactive'].includes(String(status))) {
        return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
      }
      sql += ` AND status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (search) {
      sql += ` AND (user_name ILIKE $${idx} ESCAPE '\\' OR user_id_code ILIKE $${idx} ESCAPE '\\' OR phone ILIKE $${idx} ESCAPE '\\')`;
      params.push(`%${escapeLike(search)}%`);
      idx++;
    }

    sql += ` ORDER BY user_name ASC LIMIT $${idx}`;
    params.push(limit);
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error("channelPartner.listUsers:", error);
    res.status(500).json({ message: "Failed to list users" });
  }
};

const addUser = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { user_name, user_id_code, phone, package_name, monthly_rate } =
      req.body;

    if (!user_name) {
      return res.status(400).json({ message: "user_name is required" });
    }

    if (parseAmount(monthly_rate, 0) < 0) return res.status(400).json({ message: "monthly_rate cannot be negative" });

    const result = await pool.query(
      `INSERT INTO channel_partner_users
        (reseller_id, user_name, user_id_code, phone, package_name, monthly_rate, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [
        resellerId,
        user_name,
        user_id_code || "",
        phone || "",
        package_name || "",
        parseAmount(monthly_rate, 0),
      ],
    );

    await pool
      .query(
        `UPDATE resellers SET channel_user_count = (
        SELECT COUNT(*) FROM channel_partner_users
        WHERE reseller_id = $1
      ) WHERE id = $1`,
        [resellerId],
      )
      .catch(() => { });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.addUser:", error);
    res.status(500).json({ message: "Failed to add user" });
  }
};

const updateUser = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, userId } = req.params;
    const {
      user_name,
      user_id_code,
      phone,
      package_name,
      monthly_rate,
      status,
    } = req.body;

    if (monthly_rate != null && parseAmount(monthly_rate, 0) < 0) return res.status(400).json({ message: "monthly_rate cannot be negative" });

    // Status allowlist — arbitrary strings previously persisted as-is
    if (status !== undefined && status !== null && !['active', 'inactive'].includes(String(status))) {
      return res.status(400).json({ message: "status must be 'active' or 'inactive'" });
    }

    const result = await pool.query(
      `UPDATE channel_partner_users
       SET user_name = COALESCE($1, user_name),
           user_id_code = COALESCE($2, user_id_code),
           phone = COALESCE($3, phone),
           package_name = COALESCE($4, package_name),
           monthly_rate = COALESCE($5, monthly_rate),
           status = COALESCE($6, status),
           updated_at = NOW()
       WHERE id = $7 AND reseller_id = $8
       RETURNING *`,
      [
        user_name,
        user_id_code,
        phone,
        package_name,
        monthly_rate != null ? parseAmount(monthly_rate, 0) : null,
        status,
        userId,
        resellerId,
      ],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    await pool
      .query(
        `UPDATE resellers SET channel_user_count = (
        SELECT COUNT(*) FROM channel_partner_users
        WHERE reseller_id = $1
      ) WHERE id = $1`,
        [resellerId],
      )
      .catch(() => { });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.updateUser:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
};

const deleteUser = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, userId } = req.params;

    await pool.query(
      `DELETE FROM channel_user_payments WHERE user_id = $1 AND reseller_id = $2`,
      [userId, resellerId],
    );

    const result = await pool.query(
      `DELETE FROM channel_partner_users WHERE id = $1 AND reseller_id = $2 RETURNING id`,
      [userId, resellerId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    await pool
      .query(
        `UPDATE resellers SET channel_user_count = (
        SELECT COUNT(*) FROM channel_partner_users
        WHERE reseller_id = $1
      ) WHERE id = $1`,
        [resellerId],
      )
      .catch(() => { });

    res.json({ message: "User deleted" });
  } catch (error) {
    console.error("channelPartner.deleteUser:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
};

// ─── User Payments (Collection Tracking) ───────────────────

const getUserPayments = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.query.month || getDhakaMonthYm();

    const result = await pool.query(
      `SELECT
        cup.id,
        cup.user_id,
        cpu.user_name,
        cpu.user_id_code,
        cpu.package_name,
        cpu.monthly_rate,
        cpu.phone,
        cpu.status AS user_status,
        cup.month,
        cup.amount_due,
        cup.amount_paid,
        cup.payment_date,
        cup.payment_status,
        cup.note
       FROM channel_user_payments cup
       JOIN channel_partner_users cpu ON cpu.id = cup.user_id
       WHERE cup.reseller_id = $1 AND cup.service_period = ${monthToDateSql("$2")}
       ORDER BY cpu.user_name ASC`,
      [resellerId, month],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("channelPartner.getUserPayments:", error);
    res.status(500).json({ message: "Failed to load user payments" });
  }
};

const initMonthlyPayments = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.body.month || getDhakaMonthYm();

    // Initialize all active users for the requested month. Existing rows are refreshed
    // without overwriting recorded payments, so newly added users are not missed.

    // Fetch users and their previous dues
    const prevMonth = (() => {
      const [y, m] = month.split("-");
      const d = new Date(parseInt(y), parseInt(m) - 2, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    const users = await withChannelMonthTransaction(pool, resellerId, month, async (client) => {
    const ownedUsers = await client.query(
      `SELECT
        cpu.id,
        COALESCE(cpu.monthly_rate, 0)::numeric AS monthly_rate,
        COALESCE(prev.amount_due - prev.amount_paid, 0)::numeric AS prev_due
       FROM channel_partner_users cpu
       LEFT JOIN channel_user_payments prev ON prev.user_id = cpu.id AND prev.month = $2
       WHERE cpu.reseller_id = $1 AND cpu.status = 'active' ORDER BY cpu.id FOR UPDATE OF cpu`,
      [resellerId, prevMonth],
    );

    if (ownedUsers.rows.length === 0) {
      throw financialError(400, "No active users found for this partner");
    }

    const values = ownedUsers.rows
      .map((u) => {
        const amountDue = roundAmount(Number(u.monthly_rate) + Number(u.prev_due));
        return `($1, ${u.id}, $2::varchar, ${monthToDateSql("$2")}, NOW(), 'deferred', ${amountDue}, 0, 0, ${amountDue}, 'unpaid')`;
      })
      .join(", ");

    await client.query(
      `INSERT INTO channel_user_payments (
        reseller_id, user_id, month, service_period, bill_issued_date,
        billing_status, amount_due, amount_paid, realized_amount,
        deferred_amount, payment_status
      )
       VALUES ${values}
       ON CONFLICT (user_id, month) DO UPDATE SET
         amount_due = EXCLUDED.amount_due,
         service_period = EXCLUDED.service_period,
         bill_issued_date = COALESCE(channel_user_payments.bill_issued_date, EXCLUDED.bill_issued_date),
         realized_amount = LEAST(COALESCE(channel_user_payments.amount_paid, 0), EXCLUDED.amount_due),
         deferred_amount = GREATEST(0, EXCLUDED.amount_due - COALESCE(channel_user_payments.amount_paid, 0)),
         billing_status = CASE
           WHEN COALESCE(channel_user_payments.amount_paid, 0) >= EXCLUDED.amount_due AND EXCLUDED.amount_due > 0 THEN 'realized'
           WHEN COALESCE(channel_user_payments.amount_paid, 0) > 0 THEN 'partial_deferred'
           ELSE 'deferred'
         END,
         payment_status = CASE
           WHEN COALESCE(channel_user_payments.amount_paid, 0) >= EXCLUDED.amount_due AND EXCLUDED.amount_due > 0 THEN 'paid'
           WHEN COALESCE(channel_user_payments.amount_paid, 0) > 0 THEN 'partial'
           ELSE 'unpaid'
         END,
         updated_at = NOW()
       WHERE channel_user_payments.reseller_id=EXCLUDED.reseller_id`,
      [resellerId, month],
    );

    return ownedUsers;
    });

    try {
      await generateCommissionInternal(resellerId, month);
    } catch (ce) {
      console.warn("Commission sync after initialization failed:", ce.message);
    }

    res.json({
      message: "Monthly payments initialized",
      month,
      count: users.rows.length,
    });
  } catch (error) {
    console.error("channelPartner.initMonthlyPayments:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to initialize monthly payments" });
  }
};

const paymentCalculations = (due, paid) => {
  const amountDue = roundAmount(due);
  return {
    amountDue,
    billingStatus: calculateBillingStatus(amountDue, paid),
    ...calculateRealizedDeferred(amountDue, paid),
    paymentStatus: calculatePaymentStatus(amountDue, paid),
  };
};

const recordUserPayment = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { user_id, month, amount_paid, payment_date, note } = req.body;
    const rows = await writeChannelPayments(pool, resellerId, month,
      [{ user_id, paid: parseFinancialAmount(amount_paid), payment_date, note }], paymentCalculations);
    try { await generateCommissionInternal(resellerId, month); }
    catch (error) { console.warn('Commission sync after payment record failed:', error.message); }
    return res.json(rows[0]);
  } catch (error) {
    console.error('channelPartner.recordUserPayment:', error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to record payment' });
  }
};

const bulkRecordPayments = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month, payments } = req.body;
    if (!Array.isArray(payments)) return res.status(400).json({ message: 'month and payments array are required' });
    const rows = await writeChannelPayments(pool, resellerId, month,
      payments.map((payment) => {
        if (!payment || typeof payment !== 'object') throw financialError(400, 'Invalid payment item');
        return { ...payment, paid: parseFinancialAmount(payment.amount_paid) };
      }), paymentCalculations);
    try { await generateCommissionInternal(resellerId, month); }
    catch (error) { console.warn('Commission sync after bulk payments failed:', error.message); }
    return res.json({ message: 'Payments recorded', count: rows.length });
  } catch (error) {
    console.error('channelPartner.bulkRecordPayments:', error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to record payments' });
  }
};

// Commission summaries and settlements.
const getCommissionSummary = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.query.month || getDhakaMonthYm();

    const resellerResult = await pool.query(
      `SELECT r.id,
              COALESCE(r.channel_user_count, 0)::int AS channel_user_count,
              COALESCE(
                (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = r.id),
                (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = r.id ORDER BY ccl.created_at DESC LIMIT 1),
                0
              )::numeric AS profit_share_percentage
       FROM resellers r WHERE r.id = $1`,
      [resellerId],
    );

    if (!resellerResult.rows.length) {
      return res.status(404).json({ message: "Reseller not found" });
    }

    const reseller = resellerResult.rows[0];

    const totalUsersResult = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'active') AS active
       FROM channel_partner_users WHERE reseller_id = $1`,
      [resellerId],
    );
    const totalUsers = Number(totalUsersResult.rows[0]?.total || 0);
    const activeUsers = Number(totalUsersResult.rows[0]?.active || 0);

    const collectionResult = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE amount_paid > 0) AS paying_users,
        COUNT(*) FILTER (WHERE COALESCE(amount_due, 0) > COALESCE(amount_paid, 0)) AS non_paying_users,
        COALESCE(SUM(amount_due), 0)::numeric AS total_due,
        COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
        COALESCE(SUM(realized_amount), 0)::numeric AS total_realized,
        COALESCE(SUM(deferred_amount), 0)::numeric AS total_deferred
       FROM channel_user_payments
       WHERE reseller_id = $1 AND service_period = ${monthToDateSql("$2")}`,
      [resellerId, month],
    );
    const collection = collectionResult.rows[0] || {};
    const totalCollected = Number(collection.total_collected || 0);
    const totalRealized = Number(collection.total_realized || 0);
    const totalDeferred = Number(collection.total_deferred || 0);
    const payingUsers = Number(collection.paying_users || 0);
    const profitPct = Number(reseller.profit_share_percentage || 0);
    // Commission calculated on realized amount only (actually paid)
    const grossCommission = totalRealized * (profitPct / 100);

    // Get partner advances for this month
    const advancesResult = await pool.query(
      `SELECT COALESCE(SUM(advance_amount), 0)::numeric AS total_advances
       FROM channel_partner_advances
       WHERE reseller_id = $1
       AND advance_month = TO_DATE($2 || '-01', 'YYYY-MM-DD')
       AND settlement_status IN ('pending_adjustment', 'adjusted')`,
      [resellerId, month],
    );
    const partnerAdvances = Number(advancesResult.rows[0]?.total_advances || 0);
    const productDeduction = await getProductDeductionForMonth(resellerId, month);

    const existingLog = await pool.query(
      `SELECT * FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2`,
      [resellerId, month],
    );

    const commissionLog = existingLog.rows[0] || null;

    const totalPaidResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM channel_commission_payments
       WHERE reseller_id = $1 AND commission_log_id IN (
         SELECT id FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2
       )`,
      [resellerId, month],
    );
    const totalPaidToPartner = Number(totalPaidResult.rows[0]?.total || 0);

    const prevBalanceResult = await pool.query(
      `SELECT COALESCE(closing_balance, 0)::numeric AS balance
       FROM channel_commission_logs
       WHERE reseller_id = $1 AND month < $2
       ORDER BY month DESC LIMIT 1`,
      [resellerId, month],
    );
    const previousBalance = Number(prevBalanceResult.rows[0]?.balance || 0);

    res.json({
      month,
      profit_share_percentage: profitPct,
      total_users: totalUsers,
      active_users: activeUsers,
      paying_users: payingUsers,
      non_paying_users: Number(collection.non_paying_users || 0),
      total_due: Number(collection.total_due || 0),
      total_collected: totalCollected,
      total_realized: totalRealized,
      total_deferred: totalDeferred,
      gross_commission: grossCommission,
      partner_advances: partnerAdvances,
      product_deduction: productDeduction,
      adjustments: Number(commissionLog?.adjustments || 0),
      deductions: Number(commissionLog?.deductions || 0),
      adjustment_note: commissionLog?.adjustment_note || "",
      deduction_note: commissionLog?.deduction_note || "",
      net_commission: commissionLog
        ? Number(commissionLog.net_commission)
        : roundAmountHelper(
          grossCommission - partnerAdvances - productDeduction - totalDeferred,
        ),
      previous_balance: previousBalance,
      total_payable: commissionLog
        ? Number(commissionLog.total_payable)
        : roundAmountHelper(
          grossCommission -
          partnerAdvances -
          productDeduction -
          totalDeferred +
          previousBalance,
        ),
      paid_to_partner: totalPaidToPartner,
      closing_balance: commissionLog
        ? Number(commissionLog.closing_balance)
        : roundAmountHelper(
          grossCommission -
          partnerAdvances -
          productDeduction -
          totalDeferred +
          previousBalance -
          totalPaidToPartner,
        ),
      commission_status: commissionLog?.status || "not_generated",
      payment_status: commissionLog?.payment_status || "pending",
    });
  } catch (error) {
    console.error("channelPartner.getCommissionSummary:", error);
    res.status(500).json({ message: "Failed to load commission summary" });
  }
};

const generateCommissionInternal = async (resellerId, month) => withChannelMonthTransaction(pool, resellerId, month, async (client) => {
  const resellerResult = await client.query(
    `SELECT r.id,
            COALESCE(
              (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = r.id),
              (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = r.id ORDER BY ccl.created_at DESC LIMIT 1),
              0
            )::numeric AS profit_share_pct
     FROM resellers r WHERE r.id = $1`,
    [resellerId],
  );
  if (!resellerResult.rows.length) return null;

  // B5: never rewrite a non-draft commission log. This function is called from
  // payment/init/import paths — a late edit must not silently change a
  // finalized month's net_commission / total_payable / closing_balance.
  const existingLog = await client.query(
    `SELECT * FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2`,
    [resellerId, month],
  );
  if (existingLog.rows.length > 0 && existingLog.rows[0].status !== "draft") {
    console.warn(
      `[commission] generate skipped for reseller ${resellerId} month ${month}: status is '${existingLog.rows[0].status}'`,
    );
    return existingLog.rows[0];
  }

  const profitPct = Number(resellerResult.rows[0].profit_share_pct || 0);

  const collectionResult = await client.query(
    `SELECT
      COUNT(*) AS total_users,
      COUNT(*) FILTER (WHERE amount_paid > 0) AS paying_users,
      COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
      COALESCE(SUM(realized_amount), 0)::numeric AS total_realized,
      COALESCE(SUM(deferred_amount), 0)::numeric AS total_deferred
     FROM channel_user_payments
     WHERE reseller_id = $1 AND service_period = ${monthToDateSql("$2")}`,
    [resellerId, month],
  );
  const stats = collectionResult.rows[0] || {};
  const totalCollected = Number(stats.total_collected || 0);
  const totalRealized = Number(stats.total_realized || 0);
  const totalDeferred = Number(stats.total_deferred || 0);
  // Commission calculated on realized amount (actually paid), not total collected
  const grossCommission = totalRealized * (profitPct / 100);

  // Get partner advances for this month
  const advancesResult = await client.query(
    `SELECT COALESCE(SUM(advance_amount), 0)::numeric AS total_advances
     FROM channel_partner_advances
     WHERE reseller_id = $1
     AND advance_month = TO_DATE($2 || '-01', 'YYYY-MM-DD')
     AND settlement_status IN ('pending_adjustment', 'adjusted')`,
    [resellerId, month],
  );
  const partnerAdvances = Number(advancesResult.rows[0]?.total_advances || 0);
  const productDeduction = await getProductDeductionForMonth(resellerId, month, client);

  const prevBalanceResult = await client.query(
    `SELECT COALESCE(closing_balance, 0)::numeric AS balance
     FROM channel_commission_logs
     WHERE reseller_id = $1 AND month < $2
     ORDER BY month DESC LIMIT 1`,
    [resellerId, month],
  );
  const previousBalance = Number(prevBalanceResult.rows[0]?.balance || 0);

  const existingPaidResult = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM channel_commission_payments
     WHERE reseller_id = $1 AND commission_log_id IN (
       SELECT id FROM channel_commission_logs WHERE reseller_id = $1 AND month = $2
     )`,
    [resellerId, month],
  );
  const alreadyPaid = Number(existingPaidResult.rows[0]?.total || 0);

  const manualAdjustments = 0;
  const manualDeductions = 0;
  // Net commission deducts deferred (unpaid user bills) from gross
  const netCommission = roundAmount(
    grossCommission -
    partnerAdvances -
    productDeduction -
    totalDeferred +
    manualAdjustments -
    manualDeductions,
  );
  const totalPayable = roundAmount(netCommission + previousBalance);
  const closingBalance = roundAmount(totalPayable - alreadyPaid);

  const paymentStatus =
    alreadyPaid >= totalPayable && totalPayable > 0
      ? "paid"
      : alreadyPaid > 0
        ? "partial"
        : "pending";

  const result = await client.query(
    `INSERT INTO channel_commission_logs
      (reseller_id, month, total_users, paying_users, total_collection,
       profit_share_pct, gross_commission, partner_advances, product_deduction,
       deferred_amount, adjustments, deductions, net_commission, previous_balance, total_payable,
       paid_amount, closing_balance, payment_status, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, $11, $12, $13, $14, $15, $16, 'draft')
     ON CONFLICT (reseller_id, month) DO UPDATE SET
       total_users = EXCLUDED.total_users,
       paying_users = EXCLUDED.paying_users,
       total_collection = EXCLUDED.total_collection,
       profit_share_pct = EXCLUDED.profit_share_pct,
       gross_commission = EXCLUDED.gross_commission,
       partner_advances = EXCLUDED.partner_advances,
       product_deduction = EXCLUDED.product_deduction,
       deferred_amount = EXCLUDED.deferred_amount,
       net_commission = EXCLUDED.gross_commission - EXCLUDED.partner_advances - EXCLUDED.product_deduction
         - EXCLUDED.deferred_amount
         + COALESCE(channel_commission_logs.adjustments, 0) - COALESCE(channel_commission_logs.deductions, 0),
       previous_balance = EXCLUDED.previous_balance,
       total_payable = EXCLUDED.gross_commission - EXCLUDED.partner_advances - EXCLUDED.product_deduction
         - EXCLUDED.deferred_amount
         + COALESCE(channel_commission_logs.adjustments, 0) - COALESCE(channel_commission_logs.deductions, 0) + EXCLUDED.previous_balance,
       paid_amount = $14,
       closing_balance = EXCLUDED.gross_commission - EXCLUDED.partner_advances - EXCLUDED.product_deduction
         - EXCLUDED.deferred_amount
         + COALESCE(channel_commission_logs.adjustments, 0) - COALESCE(channel_commission_logs.deductions, 0) + EXCLUDED.previous_balance - $14,
       payment_status = $16,
       updated_at = NOW()
     WHERE channel_commission_logs.status = 'draft'
     RETURNING *`,
    [
      resellerId,
      month,
      Number(stats.total_users || 0),
      Number(stats.paying_users || 0),
      totalCollected,
      profitPct,
      grossCommission,
      partnerAdvances,
      productDeduction,
      totalDeferred,
      netCommission,
      previousBalance,
      totalPayable,
      alreadyPaid,
      closingBalance,
      paymentStatus,
    ],
  );
  if (result.rows.length) return result.rows[0];
  const current = await client.query("SELECT * FROM channel_commission_logs WHERE reseller_id=$1 AND month=$2", [resellerId, month]);
  return current.rows[0];
});

const generateCommission = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const month = req.body.month || getDhakaMonthYm();
    const result = await generateCommissionInternal(resellerId, month);
    if (!result) return res.status(404).json({ message: "Reseller not found" });
    res.json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'MONTH_LOCKED') return res.status(403).json({ message: "Month is locked by approved reconciliation" });
    console.error("channelPartner.generateCommission:", error);
    res.status(500).json({ message: "Failed to generate commission" });
  }
};

const adjustCommission = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, logId } = req.params;
    const { type, amount, note } = req.body;

    if (!type || !amount) {
      return res.status(400).json({ message: "type and amount are required" });
    }
    // Type allowlist: anything else previously became a credit by default,
    // silently flipping debit→credit on typos or crafted input.
    if (!["adjustment", "deduction", "partner_collected"].includes(type)) {
      return res.status(400).json({ message: "type must be adjustment, deduction, or partner_collected" });
    }

    const amt = parseFinancialAmount(amount);
    if (amt < 0) {
      return res.status(400).json({ message: "amount cannot be negative" });
    }
    const isDeduction = type === "deduction" || type === "partner_collected";

    const updateField = isDeduction ? "deductions" : "adjustments";
    const noteField = isDeduction ? "deduction_note" : "adjustment_note";

    let finalNote = note || "";
    if (type === "partner_collected") {
      finalNote = `[পার্টনার বিল কালেকশন] ${finalNote}`.trim();
    }

    const result = await withCommissionTransaction(pool, resellerId, logId, async (client) => client.query(
      `UPDATE channel_commission_logs
       SET ${updateField} = $1,
           ${noteField} = $2,
           net_commission = gross_commission
             - COALESCE(partner_advances, 0) - COALESCE(product_deduction, 0)
             - COALESCE(deferred_amount, 0)
             + CASE WHEN '${updateField}' = 'adjustments' THEN $1 ELSE adjustments END
             - CASE WHEN '${updateField}' = 'deductions' THEN $1 ELSE deductions END,
           total_payable = gross_commission
             - COALESCE(partner_advances, 0) - COALESCE(product_deduction, 0)
             - COALESCE(deferred_amount, 0)
             + CASE WHEN '${updateField}' = 'adjustments' THEN $1 ELSE adjustments END
             - CASE WHEN '${updateField}' = 'deductions' THEN $1 ELSE deductions END
             + previous_balance,
           closing_balance = gross_commission
             - COALESCE(partner_advances, 0) - COALESCE(product_deduction, 0)
             - COALESCE(deferred_amount, 0)
             + CASE WHEN '${updateField}' = 'adjustments' THEN $1 ELSE adjustments END
             - CASE WHEN '${updateField}' = 'deductions' THEN $1 ELSE deductions END
             + previous_balance - paid_amount,
           updated_at = NOW()
       WHERE id = $3 AND reseller_id = $4 AND status = 'draft'
       RETURNING *`,
      [amt, finalNote, logId, resellerId],
    ));

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ message: "Commission log not found or already finalized" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.adjustCommission:", error);
    res.status(error.status || 500).json({ message: "Failed to adjust commission" });
  }
};

const finalizeCommission = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, logId } = req.params;

    const result = await withCommissionTransaction(pool, resellerId, logId, async (client) => client.query(
      `UPDATE channel_commission_logs
       SET status = 'finalized',
           finalized_at = NOW(),
           finalized_by = $1,
           updated_at = NOW()
       WHERE id = $2 AND reseller_id = $3 AND status = 'draft'
       RETURNING *`,
      [req.user?.id || null, logId, resellerId],
    ));

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ message: "Commission log not found or already finalized" });
    }

    await logResellerFinancialChange(pool, {
      reseller_id: Number(resellerId),
      ...getActor(req),
      ...getReqMeta(req),
      action_type: "FINALIZE_CHANNEL_COMMISSION",
      reference_table: "channel_commission_logs",
      reference_id: Number(logId),
      amount_before: 0,
      amount_after: Number(result.rows[0].net_commission),
      amount_delta: Number(result.rows[0].net_commission),
      note: `Commission finalized for month ${result.rows[0].month}`,
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.finalizeCommission:", error);
    res.status(error.status || 500).json({ message: "Failed to finalize commission" });
  }
};

const unfinalizeCommission = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, logId } = req.params;

    const result = await withCommissionTransaction(pool, resellerId, logId, async (client) => client.query(
      `UPDATE channel_commission_logs
       SET status = 'draft',
           finalized_at = NULL,
           finalized_by = NULL,
           updated_at = NOW()
       WHERE id = $1 AND reseller_id = $2 AND status = 'finalized'
       RETURNING *`,
      [logId, resellerId],
    ));

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ message: "Commission log not found or not finalized" });
    }

    await logResellerFinancialChange(pool, {
      reseller_id: Number(resellerId),
      ...getActor(req),
      ...getReqMeta(req),
      action_type: "UNFINALIZE_CHANNEL_COMMISSION",
      reference_table: "channel_commission_logs",
      reference_id: Number(logId),
      amount_before: Number(result.rows[0].net_commission),
      amount_after: 0,
      amount_delta: -Number(result.rows[0].net_commission),
      note: `Commission unfinalized for month ${result.rows[0].month}`,
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.unfinalizeCommission:", error);
    res.status(error.status || 500).json({ message: "Failed to unfinalize commission" });
  }
};

const getCommissionHistory = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;

    const result = await pool.query(
      `SELECT * FROM channel_commission_logs
       WHERE reseller_id = $1
       ORDER BY month DESC
       LIMIT 12`,
      [resellerId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("channelPartner.getCommissionHistory:", error);
    res.status(500).json({ message: "Failed to load commission history" });
  }
};

// ─── Commission Payments (to partner) ──────────────────────

const recordCommissionPayment = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const {
      commission_log_id,
      amount,
      payment_method,
      payment_date,
      reference_no,
      note,
    } = req.body;

    if (!amount || !payment_date) {
      return res
        .status(400)
        .json({ message: "amount and payment_date are required" });
    }

    if (!commission_log_id) {
      return res
        .status(400)
        .json({ message: "commission_log_id is required for commission payment" });
    }

    const paid = parseFinancialAmount(amount);
    if (paid <= 0) {
      return res.status(400).json({ message: "amount must be positive" });
    }

    // Scope the log to this reseller (cross-reseller write guard) + lock check
    const logCheck = await pool.query(
      `SELECT month FROM channel_commission_logs WHERE id = $1 AND reseller_id = $2 LIMIT 1`,
      [commission_log_id, resellerId],
    );
    if (!logCheck.rows.length) {
      return res.status(403).json({ message: "Commission log does not belong to this reseller" });
    }
    const logMonth = String(logCheck.rows[0].month || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(logMonth)) {
      const locked = await pool.query(
        `SELECT 1 FROM billing_reconciliation_logs WHERE reseller_id = $1 AND reconciliation_month = ($2 || '-01')::date AND reconciliation_status IN ('approved','reconciled','finalized') LIMIT 1`,
        [resellerId, logMonth],
      );
      if (locked.rows.length) {
        return res.status(403).json({ message: "Month is locked by approved reconciliation" });
      }
    }

    const result = await withChannelMonthTransaction(pool, resellerId, logMonth, async (client) => {
      const ownedLog = await client.query('SELECT id FROM channel_commission_logs WHERE id=$1 AND reseller_id=$2 FOR UPDATE', [commission_log_id, resellerId]);
      if (!ownedLog.rows.length) throw financialError(403, 'Commission log does not belong to this reseller');
      const inserted = await client.query(
      `INSERT INTO channel_commission_payments
        (reseller_id, commission_log_id, amount, payment_method, payment_date, reference_no, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        resellerId,
        commission_log_id || null,
        paid,
        payment_method || "Cash",
        payment_date,
        reference_no || "",
        note || "",
        req.user?.id || null,
      ],
    );

    if (commission_log_id) {
      const totalPaidResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total
         FROM channel_commission_payments
         WHERE commission_log_id = $1 AND reseller_id = $2`,
        [commission_log_id, resellerId],
      );
      const totalPaid = Number(totalPaidResult.rows[0]?.total || 0);

      await client.query(
        `UPDATE channel_commission_logs
         SET paid_amount = $1,
             closing_balance = total_payable - $1,
             payment_status = CASE
               WHEN $1 >= total_payable AND total_payable > 0 THEN 'paid'
               WHEN $1 > 0 THEN 'partial'
               ELSE 'pending'
             END,
             updated_at = NOW()
         WHERE id = $2 AND reseller_id = $3`,
        [totalPaid, commission_log_id, resellerId],
      );
    }

      return inserted;
    });

    await logResellerFinancialChange(pool, {
      reseller_id: Number(resellerId),
      ...getActor(req),
      ...getReqMeta(req),
      action_type: "CHANNEL_COMMISSION_PAYMENT",
      reference_table: "channel_commission_payments",
      reference_id: result.rows[0].id,
      amount_before: 0,
      amount_after: paid,
      amount_delta: paid,
      note: `Commission payment: ${paid} via ${payment_method || "Cash"}`,
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("channelPartner.recordCommissionPayment:", error);
    res.status(error.status || 500).json({ message: error.status ? error.message : "Failed to record commission payment" });
  }
};

const getCommissionPayments = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;

    const result = await pool.query(
      `SELECT ccp.*, ccl.month AS commission_month
       FROM channel_commission_payments ccp
       LEFT JOIN channel_commission_logs ccl ON ccl.id = ccp.commission_log_id
       WHERE ccp.reseller_id = $1
       ORDER BY ccp.created_at DESC
       LIMIT 50`,
      [resellerId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("channelPartner.getCommissionPayments:", error);
    res.status(500).json({ message: "Failed to load commission payments" });
  }
};

// ─── Statement (combined view) ─────────────────────────────

const getStatement = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;

    const result = await pool.query(
      `SELECT
        'commission'::text AS type,
        ccl.id,
        ccl.net_commission AS amount,
        (ccl.month || '-01')::date AS date,
        'কমিশন - ' || ccl.month || ' (ইউজার: ' || ccl.paying_users || ', কালেকশন: ' || ccl.total_collection || ', ' || ccl.profit_share_pct || '%)' AS description,
        ccl.month
       FROM channel_commission_logs ccl
       WHERE ccl.reseller_id = $1 AND ccl.status = 'finalized'
       UNION ALL
       SELECT
        'payment'::text AS type,
        ccp.id,
        ccp.amount,
        ccp.payment_date AS date,
        'পেমেন্ট - ' || ccp.payment_method || CASE WHEN ccp.reference_no != '' THEN ' (Ref: ' || ccp.reference_no || ')' ELSE '' END AS description,
        COALESCE(ccl.month, TO_CHAR(ccp.payment_date, 'YYYY-MM')) AS month
       FROM channel_commission_payments ccp
       LEFT JOIN channel_commission_logs ccl ON ccl.id = ccp.commission_log_id
       WHERE ccp.reseller_id = $1
       UNION ALL
       SELECT
        'adjustment'::text AS type,
        ccl.id,
        ccl.adjustments AS amount,
        (ccl.month || '-01')::date AS date,
        'সমন্বয় - ' || COALESCE(ccl.adjustment_note, '') AS description,
        ccl.month
       FROM channel_commission_logs ccl
       WHERE ccl.reseller_id = $1 AND ccl.adjustments != 0
       UNION ALL
       SELECT
        'deduction'::text AS type,
        ccl.id,
        ccl.deductions AS amount,
        (ccl.month || '-01')::date AS date,
        'কর্তন - ' || COALESCE(ccl.deduction_note, '') AS description,
        ccl.month
       FROM channel_commission_logs ccl
       WHERE ccl.reseller_id = $1 AND ccl.deductions != 0
       UNION ALL
       SELECT
        'product_charge'::text AS type,
        ccl.id,
        COALESCE(ccl.product_deduction, 0)::numeric AS amount,
        (ccl.month || '-01')::date AS date,
        'প্রোডাক্ট চার্জ - ' || ccl.month AS description,
        ccl.month
       FROM channel_commission_logs ccl
       WHERE ccl.reseller_id = $1 AND COALESCE(ccl.product_deduction, 0) != 0
       UNION ALL
       SELECT
        'advance'::text AS type,
        cpa.id,
        cpa.advance_amount AS amount,
        cpa.advance_month AS date,
        'অগ্রিম পেমেন্ট - ' || COALESCE(cpu.user_name, 'Unknown') || ' (' || cpa.advance_type || ')' AS description,
        TO_CHAR(cpa.advance_month, 'YYYY-MM') AS month
       FROM channel_partner_advances cpa
       LEFT JOIN channel_partner_users cpu ON cpu.id = cpa.user_id
       WHERE cpa.reseller_id = $1 AND cpa.settlement_status IN ('adjusted', 'pending_adjustment')
       ORDER BY date DESC
       LIMIT 50`,
      [resellerId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("channelPartner.getStatement:", error);
    res.status(500).json({ message: "Failed to load statement" });
  }
};

// ─── Excel Import ──────────────────────────────────────────

const importChannelData = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!month) {
      return res.status(400).json({ message: "Month is required" });
    }

    // S14: guarded parse (type check + row cap + proto-key strip)
    let worksheet;
    try {
      ({ worksheet } = await openFirstSheet(req.file));
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    const rawData = sanitizeRows(XLSX.utils.sheet_to_json(worksheet));

    if (rawData.length === 0) {
      return res.status(400).json({ message: "Excel file is empty" });
    }

    // Aggregate data by userName
    let skippedCount = 0;
    const aggregatedData = {};
    for (const row of rawData) {
      const rawUserName = getSheetValue(row, [
        "Customer Name", "Customer", "User Name", "customer_name", "user_name"
      ]);
      const userName = String(rawUserName || "").trim();
      if (!userName) {
        skippedCount++;
        continue;
      }

      const receiveVal = parseAmount(getSheetValue(row, [
        "Receive Amount", "Received Amount", "Receive", "Paid Amount", "amount_paid", "receive_amount"
      ]), 0);
      const notPaidVal = getSheetValue(row, [
        "Not Paid", "Unpaid", "Due", "Due Amount", "not_paid", "due_amount"
      ]);

      if (!aggregatedData[userName]) {
        aggregatedData[userName] = { receiveAmount: 0, notPaidAmount: 0, hasNotPaid: false };
      }
      aggregatedData[userName].receiveAmount += receiveVal;
      if (hasSheetValue(notPaidVal)) {
        aggregatedData[userName].notPaidAmount = parseAmount(notPaidVal, 0);
        aggregatedData[userName].hasNotPaid = true;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockChannelMonth(client, resellerId, month);

      let updatedCount = 0;
      let createdCount = 0;
      let totalReceived = 0;
      let totalNotPaid = 0;
      const prevMonth = getPreviousMonthYm(month);

      for (const userName in aggregatedData) {
        const { receiveAmount, notPaidAmount, hasNotPaid } = aggregatedData[userName];

        let userResult = await client.query(
          `SELECT id, COALESCE(monthly_rate, 0)::numeric AS monthly_rate
           FROM channel_partner_users
           WHERE reseller_id = $1 AND LOWER(TRIM(user_name)) = LOWER(TRIM($2))
           LIMIT 1`,
          [resellerId, userName],
        );

        let userId;
        let monthlyRate = 0;
        const initialMonthlyRate = roundAmount(receiveAmount + (hasNotPaid ? notPaidAmount : 0));

        if (userResult.rows.length > 0) {
          userId = userResult.rows[0].id;
          monthlyRate = Number(userResult.rows[0].monthly_rate || 0);
          updatedCount++;
        } else {
          const newUser = await client.query(
            `INSERT INTO channel_partner_users (reseller_id, user_name, status, monthly_rate)
             VALUES ($1, $2, 'active', $3)
             RETURNING id, COALESCE(monthly_rate, 0)::numeric AS monthly_rate`,
            [resellerId, userName, initialMonthlyRate],
          );
          userId = newUser.rows[0].id;
          monthlyRate = Number(newUser.rows[0].monthly_rate || 0);
          createdCount++;
        }

        const prevDueResult = prevMonth
          ? await client.query(
            `SELECT GREATEST(0, COALESCE(amount_due, 0) - COALESCE(amount_paid, 0))::numeric AS prev_due
               FROM channel_user_payments
               WHERE reseller_id = $1 AND user_id = $2 AND month = $3
               LIMIT 1`,
            [resellerId, userId, prevMonth],
          )
          : { rows: [] };
        const previousDue = Number(prevDueResult.rows[0]?.prev_due || 0);

        const existingPaymentResult = await client.query(
          `SELECT COALESCE(amount_due, 0)::numeric AS amount_due
           FROM channel_user_payments
           WHERE reseller_id = $1 AND user_id = $2 AND month = $3
           LIMIT 1`,
          [resellerId, userId, month],
        );
        const existingDue = Number(existingPaymentResult.rows[0]?.amount_due || 0);
        const sheetDeclaredDue = roundAmount(receiveAmount + (hasNotPaid ? notPaidAmount : 0));
        const calculatedDue = roundAmount(monthlyRate + previousDue);
        const amountDue = roundAmount(hasNotPaid
          ? Math.max(sheetDeclaredDue, calculatedDue, existingDue, receiveAmount)
          : Math.max(existingDue, calculatedDue, receiveAmount));

        if (monthlyRate <= 0 && amountDue > 0) {
          await client.query(
            `UPDATE channel_partner_users SET monthly_rate = $3, updated_at = NOW()
             WHERE reseller_id = $1 AND id = $2`,
            [resellerId, userId, amountDue],
          );
        }

        const billingStatus = calculateBillingStatus(amountDue, receiveAmount);
        const { realized, deferred } = calculateRealizedDeferred(amountDue, receiveAmount);
        const paymentStatus = calculatePaymentStatus(amountDue, receiveAmount);

        await client.query(
          `INSERT INTO channel_user_payments (
            reseller_id, user_id, month, service_period, bill_issued_date,
            billing_status, amount_due, amount_paid, realized_amount,
            deferred_amount, payment_status, payment_date, note
          )
           VALUES ($1, $2, $3::varchar, ($3 || '-01')::date, NOW(), $4, $5, $6, $7, $8, $9, NOW(), $10)
           ON CONFLICT (user_id, month) DO UPDATE SET
             amount_paid = EXCLUDED.amount_paid,
             amount_due = EXCLUDED.amount_due,
             realized_amount = EXCLUDED.realized_amount,
             deferred_amount = EXCLUDED.deferred_amount,
             billing_status = EXCLUDED.billing_status,
             payment_status = EXCLUDED.payment_status,
             payment_date = EXCLUDED.payment_date,
             note = EXCLUDED.note,
             updated_at = NOW()`,
          [
            resellerId,
            userId,
            month,
            billingStatus,
            amountDue,
            receiveAmount,
            realized,
            deferred,
            paymentStatus,
            hasNotPaid ? `Imported: Not Paid ${notPaidAmount}` : "Imported from sheet.",
          ],
        );

        totalReceived += receiveAmount;
        totalNotPaid += deferred;
      }

      await client.query(
        `UPDATE resellers SET channel_user_count = (
          SELECT COUNT(*) FROM channel_partner_users
          WHERE reseller_id = $1
        ) WHERE id = $1`,
        [resellerId],
      );

      await client.query("COMMIT");

      try {
        await generateCommissionInternal(resellerId, month);
      } catch (ce) {
        console.warn("Commission sync after import failed:", ce.message);
      }

      res.json({
        message: "Import successful",
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
        total: rawData.length,
        total_received: totalReceived,
        total_not_paid: totalNotPaid,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("channelPartner.importChannelData:", error);
    res
      .status(500)
      .json({ message: "Failed to import data" });
  }
};

// ─── Maxim auto-import (snapshots → payments, blank-only) ───
// Fills Receive from Maxim cash snapshots WITHOUT overwriting manual edits:
// - missing payment row → created (due derived like import)
// - amount_paid = 0 → filled with Maxim cash (statuses recomputed)
// - amount_paid > 0 → skipped (human touched it)
// - approved reconciliation month → skipped entirely (locked)
const autoImportMaximSnapshots = async (resellerId, month) => {
  await initChannelPartnerTables();
  const lock = await pool.query(
    `SELECT 1 FROM billing_reconciliation_logs
     WHERE reseller_id = $1 AND reconciliation_month = ($2 || '-01')::date
       AND reconciliation_status IN ('approved','reconciled','finalized') LIMIT 1`,
    [resellerId, month],
  );
  if (lock.rows.length > 0) return { locked: true, filled: 0, created: 0, skipped: 0, total: 0 };

  const snap = await pool.query(
    `SELECT username, SUM(rcv_amount)::numeric AS rcv, MAX(total_bill)::numeric AS bill
     FROM maxim_payment_snapshots
     WHERE reseller_id = $1 AND snapshot_month = ($2 || '-01')::date
       AND LOWER(pay_type) = 'cash'
     GROUP BY username`,
    [resellerId, month],
  );
  if (!snap.rows.length) return { locked: false, filled: 0, created: 0, skipped: 0, total: 0, empty: true };

  const prevMonth = getPreviousMonthYm(month);
  let filled = 0;
  let created = 0;
  let skipped = 0;

  for (const s of snap.rows) {
    const userName = s.username;
    const receive = roundAmount(Number(s.rcv || 0));

    let userResult = await pool.query(
      `SELECT id, COALESCE(monthly_rate, 0)::numeric AS monthly_rate
       FROM channel_partner_users
       WHERE reseller_id = $1 AND LOWER(TRIM(user_name)) = LOWER(TRIM($2))
       LIMIT 1`,
      [resellerId, userName],
    );
    let userId;
    let monthlyRate = 0;
    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
      monthlyRate = Number(userResult.rows[0].monthly_rate || 0);
    } else {
      const nu = await pool.query(
        `INSERT INTO channel_partner_users (reseller_id, user_name, status, monthly_rate)
         VALUES ($1, $2, 'active', $3) RETURNING id`,
        [resellerId, userName, roundAmount(Math.max(receive, Number(s.bill || 0)))],
      );
      userId = nu.rows[0].id;
      monthlyRate = roundAmount(Math.max(receive, Number(s.bill || 0)));
      created++;
    }

    const existing = await pool.query(
      `SELECT COALESCE(amount_paid, 0)::numeric AS amount_paid,
              COALESCE(amount_due, 0)::numeric AS amount_due
       FROM channel_user_payments
       WHERE reseller_id = $1 AND user_id = $2 AND month = $3 LIMIT 1`,
      [resellerId, userId, month],
    );

    if (!existing.rows.length) {
      const prevDueResult = prevMonth
        ? await pool.query(
            `SELECT GREATEST(0, COALESCE(amount_due, 0) - COALESCE(amount_paid, 0))::numeric AS prev_due
             FROM channel_user_payments
             WHERE reseller_id = $1 AND user_id = $2 AND month = $3 LIMIT 1`,
            [resellerId, userId, prevMonth],
          )
        : { rows: [] };
      const previousDue = Number(prevDueResult.rows[0]?.prev_due || 0);
      const amountDue = roundAmount(
        Math.max(monthlyRate + previousDue, receive, Number(s.bill || 0)),
      );
      const billingStatus = calculateBillingStatus(amountDue, receive);
      const { realized, deferred } = calculateRealizedDeferred(amountDue, receive);
      const paymentStatus = calculatePaymentStatus(amountDue, receive);
      await pool.query(
        `INSERT INTO channel_user_payments (
           reseller_id, user_id, month, service_period, bill_issued_date,
           billing_status, amount_due, amount_paid, realized_amount,
           deferred_amount, payment_status, payment_date, note
         )
         VALUES ($1, $2, $3::varchar, ($3 || '-01')::date, NOW(), $4, $5, $6, $7, $8, $9, NOW(), $10)`,
        [resellerId, userId, month, billingStatus, amountDue, receive,
         realized, deferred, paymentStatus, "Maxim auto-sync"],
      );
      filled++;
    } else if (Number(existing.rows[0].amount_paid || 0) === 0) {
      const amountDue = Number(existing.rows[0].amount_due || 0);
      const billingStatus = calculateBillingStatus(amountDue, receive);
      const { realized, deferred } = calculateRealizedDeferred(amountDue, receive);
      const paymentStatus = calculatePaymentStatus(amountDue, receive);
      await pool.query(
        `UPDATE channel_user_payments SET
           amount_paid = $4, realized_amount = $5, deferred_amount = $6,
           billing_status = $7, payment_status = $8, payment_date = NOW(),
           note = $9, updated_at = NOW()
         WHERE reseller_id = $1 AND user_id = $2 AND month = $3`,
        [resellerId, userId, month, receive, realized, deferred,
         billingStatus, paymentStatus, "Maxim auto-sync"],
      );
      filled++;
    } else {
      skipped++;
    }
  }

  await pool.query(
    `UPDATE resellers SET channel_user_count = (
       SELECT COUNT(*) FROM channel_partner_users WHERE reseller_id = $1
     ) WHERE id = $1`,
    [resellerId],
  );
  try {
    await generateCommissionInternal(resellerId, month);
  } catch (ce) {
    console.warn("Commission sync after Maxim auto-import failed:", ce.message);
  }
  return { locked: false, filled, created, skipped, total: snap.rows.length };
};

// ─── Partner Advance Import (Excel) ────────────────────────

const importPartnerAdvances = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    if (!month) {
      return res
        .status(400)
        .json({ message: "Month is required (YYYY-MM format)" });
    }

    // S14: guarded parse (type check + row cap + proto-key strip)
    let worksheet;
    try {
      ({ worksheet } = await openFirstSheet(req.file));
    } catch (e) {
      return res.status(e.status || 400).json({ message: e.message });
    }
    const data = sanitizeRows(XLSX.utils.sheet_to_json(worksheet));

    if (data.length === 0) {
      return res.status(400).json({ message: "Excel file is empty" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockChannelMonth(client, resellerId, month);

      let createdCount = 0;
      let totalAmount = 0;

      for (const row of data) {
        const userName = row["User Name"] || row["user_name"];
        const advanceAmount = parseAmount(
          row["Advance Amount"] || row["advance_amount"],
          0,
        );
        const advanceType =
          row["Advance Type"] || row["advance_type"] || "direct_payment";
        const notes = row["Notes"] || row["notes"] || "";

        if (!userName || advanceAmount <= 0) continue;
        // Advance-type allowlist: free text previously persisted as-is
        if (!['direct_payment', 'self_paid', 'manual_adjustment'].includes(String(advanceType).trim())) continue;

        // Find user by name (exact match — escape wildcards so a crafted
        // XLSX cell like "%" can't attribute advances to the wrong user)
        const userResult = await client.query(
          `SELECT id FROM channel_partner_users WHERE reseller_id = $1 AND user_name ILIKE $2 ESCAPE '\\'`,
          [resellerId, String(userName).replace(/([%_\\])/g, '\\$1')],
        );

        if (userResult.rows.length === 0) {
          console.warn(`User not found: ${userName}`);
          continue;
        }

        const userId = userResult.rows[0].id;
        const advanceMonth = new Date(month + "-01");

        // Insert advance
        await client.query(
          `INSERT INTO channel_partner_advances
            (reseller_id, user_id, advance_month, advance_amount, advance_type, settlement_status, notes, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending_adjustment', $6, $7, NOW())
           ON CONFLICT DO NOTHING`,
          [
            resellerId,
            userId,
            advanceMonth,
            advanceAmount,
            advanceType,
            notes,
            req.user?.id || null,
          ],
        );

        createdCount++;
        totalAmount += advanceAmount;
      }

      await client.query("COMMIT");

      try {
        await generateCommissionInternal(resellerId, month);
      } catch (ce) {
        console.warn("Commission sync after advance import failed:", ce.message);
      }

      res.json({
        message: "Partner advances imported successfully",
        created: createdCount,
        total_amount: totalAmount,
        total_rows: data.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("channelPartner.importPartnerAdvances:", error);
    res
      .status(500)
      .json({ message: "Failed to import partner advances" });
  }
};

// ─── Reconciliation Workflow (Phase 4) ─────────────────────

const {
  generateReconciliationReport,
} = require("../utilities/reportGenerator");

/**
 * Initiate reconciliation for a month
 * Creates a reconciliation record with snapshot of all data
 */
const initiateReconciliation = async (req, res) => {
  let client;
  let committed = false;
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { month } = req.body; // YYYY-MM format
    const userId = req.user?.id || 1;

    if (!month) {
      return res.status(400).json({
        success: false,
        error: "Month is required",
        message: "Please provide month in YYYY-MM format",
      });
    }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        error: "Invalid month format",
        message: "Month must be in YYYY-MM format",
      });
    }

    // Check if month is in the future
    const monthDate = new Date(month + "-01");
    const now = new Date();
    if (monthDate > now) {
      return res.status(400).json({
        success: false,
        error: "Cannot reconcile future month",
        message: "Reconciliation can only be done for past or current months",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await lockChannelMonth(client, resellerId, month);

    // Check if already reconciled
    const existingResult = await client.query(
      `
      SELECT id, reconciliation_status, approved_at
      FROM billing_reconciliation_logs
      WHERE reseller_id = $1 AND reconciliation_month = $2
    `,
      [resellerId, monthDate],
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (["approved", "reconciled", "finalized"].includes(existing.reconciliation_status)) {
        return res.status(400).json({
          success: false,
          error: "Month already reconciled",
          message: "This month has already been approved and locked",
          reconciliation_id: existing.id,
          approved_at: existing.approved_at,
        });
      }
      // If pending or rejected, allow re-initiation
    }

    // Get commission summary
    const summaryResult = await client.query(
      `
      SELECT
        COALESCE(SUM(amount_paid), 0)::numeric AS total_collected,
        COALESCE(SUM(realized_amount), 0)::numeric AS total_realized,
        COALESCE(SUM(deferred_amount), 0)::numeric AS total_deferred
      FROM channel_user_payments
      WHERE reseller_id = $1
        AND service_period = ${monthToDateSql("$2")}
        AND deleted_at IS NULL
    `,
      [resellerId, month],
    );

    const summary = summaryResult.rows[0];

    // Get partner profit share percentage from settings or latest commission log
    const partnerResult = await client.query(
      `
      SELECT
        COALESCE(
          (SELECT profit_share_percentage FROM channel_partner_profile_settings WHERE reseller_id = $1),
          (SELECT profit_share_pct FROM channel_commission_logs WHERE reseller_id = $1 ORDER BY created_at DESC LIMIT 1),
          0
        ) AS profit_share_pct
      FROM resellers WHERE id = $1
    `,
      [resellerId],
    );

    if (partnerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reseller not found",
      });
    }

    const profitPct = Number(partnerResult.rows[0].profit_share_pct || 0);

    // Calculate gross commission
    const totalRealized = Number(summary.total_realized || 0);
    const grossCommission = totalRealized * (profitPct / 100);

    // Get partner advances
    const advancesResult = await client.query(
      `
      SELECT COALESCE(SUM(advance_amount), 0)::numeric AS total_advances
      FROM channel_partner_advances
      WHERE reseller_id = $1
        AND advance_month = $2
        AND settlement_status IN ('pending_adjustment', 'adjusted')
    `,
      [resellerId, monthDate],
    );

    const partnerAdvances = Number(advancesResult.rows[0].total_advances || 0);

    // Calculate net commission
    const netCommission = grossCommission - partnerAdvances;

    // Get snapshot data
    const paymentsResult = await client.query(
      `
      SELECT
        cup.id, cup.user_id, cpu.user_name,
        cup.amount_paid, cup.realized_amount, cup.deferred_amount,
        cup.billing_status, cup.service_period
      FROM channel_user_payments cup
      LEFT JOIN channel_partner_users cpu ON cpu.id = cup.user_id
      WHERE cup.reseller_id = $1
        AND cup.service_period = ${monthToDateSql("$2")}
        AND cup.deleted_at IS NULL
      ORDER BY cpu.user_name
    `,
      [resellerId, month],
    );

    const advancesListResult = await client.query(
      `
      SELECT
        cpa.id, cpa.user_id, cpu.user_name,
        cpa.advance_amount, cpa.advance_type, cpa.notes,
        cpa.advance_month, cpa.settlement_status
      FROM channel_partner_advances cpa
      LEFT JOIN channel_partner_users cpu ON cpu.id = cpa.user_id
      WHERE cpa.reseller_id = $1
        AND cpa.advance_month = $2
        AND cpa.settlement_status IN ('pending_adjustment', 'adjusted')
      ORDER BY cpu.user_name
    `,
      [resellerId, monthDate],
    );

    const snapshot = {
      payments: paymentsResult.rows,
      advances: advancesListResult.rows,
      summary: {
        total_collected: summary.total_collected,
        total_realized: summary.total_realized,
        total_deferred: summary.total_deferred,
        gross_commission: grossCommission,
        partner_advances: partnerAdvances,
        net_commission: netCommission,
      },
    };

    // Insert or update reconciliation record
    const reconciliationResult = await client.query(
      `
      INSERT INTO billing_reconciliation_logs (
        reseller_id, reconciliation_month,
        total_collected, total_realized, total_deferred,
        gross_commission, partner_advances, net_commission,
        reconciliation_status, initiated_by, snapshot_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
      ON CONFLICT (reseller_id, reconciliation_month)
      DO UPDATE SET
        total_collected = EXCLUDED.total_collected,
        total_realized = EXCLUDED.total_realized,
        total_deferred = EXCLUDED.total_deferred,
        gross_commission = EXCLUDED.gross_commission,
        partner_advances = EXCLUDED.partner_advances,
        net_commission = EXCLUDED.net_commission,
        reconciliation_status = 'pending',
        initiated_by = EXCLUDED.initiated_by,
        snapshot_data = EXCLUDED.snapshot_data,
        updated_at = NOW()
      RETURNING *
    `,
      [
        resellerId,
        monthDate,
        summary.total_collected,
        summary.total_realized,
        summary.total_deferred,
        grossCommission,
        partnerAdvances,
        netCommission,
        userId,
        JSON.stringify(snapshot),
      ],
    );

    await client.query("COMMIT");
    committed = true;
    res.json({
      success: true,
      message: "Reconciliation initiated successfully",
      data: reconciliationResult.rows[0],
    });
  } catch (error) {
    console.error("channelPartner.initiateReconciliation:", error);
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to initiate reconciliation",
    });
  } finally {
    if (client) {
      if (!committed) { try { await client.query('ROLLBACK'); } catch (_) {} }
      client.release();
    }
  }
};

/**
 * Approve reconciliation
 * Locks the month and generates PDF report
 */
const approveReconciliation = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, reconciliationId } = req.params;
    const { notes } = req.body;
    const userId = req.user?.id || 1;

    // Get reconciliation
    const reconciliationResult = await pool.query(
      `
      SELECT brl.*, cp.reseller_name AS partner_name,
             COALESCE(
               (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = cp.id),
               (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = cp.id ORDER BY ccl.created_at DESC LIMIT 1),
               0
             ) AS profit_share_pct
      FROM billing_reconciliation_logs brl
      JOIN resellers cp ON cp.id = brl.reseller_id
      WHERE brl.id = $1 AND brl.reseller_id = $2
    `,
      [reconciliationId, resellerId],
    );

    if (reconciliationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reconciliation not found",
      });
    }

    const reconciliation = reconciliationResult.rows[0];

    // Check if already approved
    if (["approved", "reconciled", "finalized"].includes(reconciliation.reconciliation_status)) {
      return res.status(400).json({
        success: false,
        error: "Already approved",
        message: "This reconciliation has already been approved",
        approved_at: reconciliation.approved_at,
      });
    }

    // B1: accept legacy 'draft' rows too — initiate used to write 'draft' while
    // approve required 'pending', which deadlocked the whole workflow.
    if (!["pending", "draft"].includes(reconciliation.reconciliation_status)) {
      return res.status(400).json({
        success: false,
        error: "Cannot approve",
        message: `Reconciliation status is ${reconciliation.reconciliation_status}. Only pending reconciliations can be approved.`,
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockChannelMonth(client, resellerId, reconciliation.reconciliation_month, { allowApproved: true });
      const authoritative = await client.query(
        'SELECT * FROM billing_reconciliation_logs WHERE id=$1 AND reseller_id=$2 FOR UPDATE',
        [reconciliationId, resellerId]
      );
      if (!authoritative.rows.length || !['pending', 'draft'].includes(authoritative.rows[0].reconciliation_status)) {
        throw financialError(409, 'Reconciliation changed; reload before approving');
      }
      Object.assign(reconciliation, authoritative.rows[0]);

      // Update reconciliation status
      const approvalUpdate = await client.query(
        `
        UPDATE billing_reconciliation_logs
        SET reconciliation_status = 'approved',
            approved_by = $1,
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = $2 AND reseller_id=$3 AND reconciliation_status IN ('pending','draft')
        RETURNING id
      `,
        [userId, reconciliationId, resellerId],
      );

      if (!approvalUpdate.rows.length) throw financialError(409, "Reconciliation changed; reload before approving");
      await client.query("COMMIT");

      // Lock tracking is best-effort; the authoritative lock is billing_reconciliation_logs.
      try {
        await pool.query(
          `
          INSERT INTO channel_settlement_state_machine (
            reseller_id, settlement_month, current_state, locked_at
          ) VALUES ($1, $2, 'approved', NOW())
          ON CONFLICT (reseller_id, settlement_month)
          DO UPDATE SET
            current_state = 'approved',
            locked_at = NOW(),
            updated_at = NOW()
        `,
          [resellerId, reconciliation.reconciliation_month],
        );
      } catch (stateErr) {
        console.warn(
          `channelPartner.approveReconciliation state-machine warning: ${stateErr.message}`,
        );
      }

      // Generate PDF report (async, don't wait)
      generateReconciliationReport(reconciliation)
        .then((pdfPath) => {
          console.log(`PDF report generated: ${pdfPath}`);
        })
        .catch((error) => {
          console.error("Error generating PDF report:", error);
        });

      res.json({
        success: true,
        message: "Reconciliation approved successfully",
        message_bn: "নিষ্পত্তি সফলভাবে অনুমোদিত হয়েছে",
        reconciliation_id: reconciliationId,
        status: "approved",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("channelPartner.approveReconciliation:", error);
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to approve reconciliation",
    });
  }
};

/**
 * Reject reconciliation
 * Returns to pending status with reason
 */
const rejectReconciliation = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId, reconciliationId } = req.params;
    const { reason } = req.body;
    const userId = req.user?.id || 1;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Reason is required",
        message: "Please provide a reason for rejection",
      });
    }

    // Get reconciliation
    const reconciliationResult = await pool.query(
      `
      SELECT * FROM billing_reconciliation_logs
      WHERE id = $1 AND reseller_id = $2
    `,
      [reconciliationId, resellerId],
    );

    if (reconciliationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reconciliation not found",
      });
    }

    const reconciliation = reconciliationResult.rows[0];

    // Check if can be rejected
    if (["approved", "reconciled", "finalized"].includes(reconciliation.reconciliation_status)) {
      return res.status(400).json({
        success: false,
        error: "Cannot reject approved reconciliation",
        message: "Approved reconciliations cannot be rejected",
      });
    }

    // Update status
    const rejectionUpdate = await pool.query(
      `
      UPDATE billing_reconciliation_logs
      SET reconciliation_status = 'rejected',
          rejection_reason = $1,
          updated_at = NOW()
      WHERE id = $2 AND reseller_id=$3 AND reconciliation_status IN ('pending','draft')
      RETURNING id
    `,
      [reason, reconciliationId, resellerId],
    );

    if (!rejectionUpdate.rows.length) return res.status(409).json({ error: "Reconciliation changed; reload before rejecting" });
    res.json({
      success: true,
      message: "Reconciliation rejected",
      message_bn: "নিষ্পত্তি প্রত্যাখ্যাত হয়েছে",
      reconciliation_id: reconciliationId,
      status: "rejected",
      reason: reason,
    });
  } catch (error) {
    console.error("channelPartner.rejectReconciliation:", error);
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to reject reconciliation",
    });
  }
};

/**
 * Get list of reconciliations
 */
const getReconciliations = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { resellerId } = req.params;
    const { status } = req.query;
    // Clamp: NaN previously reached PG as LIMIT $n (500/error per request)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    let query = `
      SELECT
        brl.*,
        u1.full_name AS initiated_by_name,
        u2.full_name AS approved_by_name
      FROM billing_reconciliation_logs brl
      LEFT JOIN users u1 ON u1.id = brl.initiated_by
      LEFT JOIN users u2 ON u2.id = brl.approved_by
      WHERE brl.reseller_id = $1
    `;

    const params = [resellerId];

    if (status) {
      query += ` AND brl.reconciliation_status = $2`;
      params.push(status);
    }

    query += ` ORDER BY brl.reconciliation_month DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("channelPartner.getReconciliations:", error);
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to load reconciliations",
    });
  }
};

/**
 * Get reconciliation details
 */
const getReconciliationDetails = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { reconciliationId, resellerId } = req.params;

    const result = await pool.query(
      `
      SELECT
        brl.*,
        cp.reseller_name AS partner_name,
        COALESCE(
          (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = cp.id),
          (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = cp.id ORDER BY ccl.created_at DESC LIMIT 1),
          0
        ) AS profit_share_pct,
        u1.full_name AS initiated_by_name,
        u2.full_name AS approved_by_name
      FROM billing_reconciliation_logs brl
      JOIN resellers cp ON cp.id = brl.reseller_id
      LEFT JOIN users u1 ON u1.id = brl.initiated_by
      LEFT JOIN users u2 ON u2.id = brl.approved_by
      WHERE brl.id = $1 AND brl.reseller_id = $2
    `,
      [reconciliationId, resellerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reconciliation not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("channelPartner.getReconciliationDetails:", error);
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to load reconciliation details",
    });
  }
};

/**
 * Download reconciliation report (PDF)
 */
const downloadReconciliationReport = async (req, res) => {
  try {
    await initChannelPartnerTables();
    const { reconciliationId, resellerId } = req.params;

    // Get reconciliation with partner details
    const result = await pool.query(
      `
      SELECT
        brl.*,
        cp.reseller_name AS partner_name,
        COALESCE(
          (SELECT cpps.profit_share_percentage FROM channel_partner_profile_settings cpps WHERE cpps.reseller_id = cp.id),
          (SELECT ccl.profit_share_pct FROM channel_commission_logs ccl WHERE ccl.reseller_id = cp.id ORDER BY ccl.created_at DESC LIMIT 1),
          0
        ) AS profit_share_pct,
        u1.full_name AS initiated_by_name,
        u2.full_name AS approved_by_name
      FROM billing_reconciliation_logs brl
      JOIN resellers cp ON cp.id = brl.reseller_id
      LEFT JOIN users u1 ON u1.id = brl.initiated_by
      LEFT JOIN users u2 ON u2.id = brl.approved_by
      WHERE brl.id = $1 AND brl.reseller_id = $2
    `,
      [reconciliationId, resellerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Reconciliation not found",
      });
    }

    const reconciliation = result.rows[0];

    // Generate PDF
    const pdfPath = await generateReconciliationReport(reconciliation);

    if (req.query?.download === '1') {
      // The same authenticated, reseller-scoped route serves the document.
      // Generated files are never exposed through a public static directory.
      const filename = path.basename(pdfPath);
      await new Promise((resolve, reject) => {
        res.sendFile(path.join(__dirname, '../reports', filename), {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/pdf',
            'X-Content-Type-Options': 'nosniff',
          },
        }, (error) => error ? reject(error) : resolve());
      });
      return;
    }

    res.json({
      success: true,
      pdf_url: `/api/channel-partners/${encodeURIComponent(resellerId)}/reconciliation/${encodeURIComponent(reconciliationId)}/report?download=1`,
      message: "Report generated successfully",
    });
  } catch (error) {
    console.error("channelPartner.downloadReconciliationReport:", error);
    if (res.headersSent) return;
    res.status(error.status || 500).json({
      success: false,
      error: "Failed to generate report",
    });
  }
};

// --- Manual Product Charge Actions ---

const getManualProductCharge = async (req, res) => {
  try {
    const resellerId = req.params.resellerId;
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: "Month is required" });
    }
    const result = await pool.query(
      `SELECT amount, note FROM channel_partner_manual_product_charges
       WHERE reseller_id = $1 AND month = $2`,
      [resellerId, month]
    );
    if (result.rows.length === 0) {
      return res.json({ amount: null, note: "" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching manual product charge:", error);
    res.status(500).json({ error: "Failed to fetch manual product charge" });
  }
};

const saveManualProductCharge = async (req, res) => {
  try {
    const resellerId = req.params.resellerId;
    const { month, amount, note } = req.body;

    if (!month) {
      return res.status(400).json({ error: "Month is required" });
    }

    const { isCommissionMonthLocked } = require("../utilities/channelProductHelpers");
    const isLocked = await isCommissionMonthLocked(resellerId, month);
    if (isLocked) {
      return res.status(400).json({ error: "Commission month is locked." });
    }

    const parsedAmount = amount === null || amount === undefined || amount === '' ? null : parseFinancialAmount(amount);
    if (amount !== null && amount !== undefined && amount !== '' &&
        (parsedAmount === null || !Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      return res.status(400).json({ error: 'Amount must be a nonnegative finite number' });
    }
    await withChannelMonthTransaction(pool, resellerId, month, async (client) => {
      await lockProductMonth(client, resellerId, month);

    // If parsedAmount is null or empty, we delete the manual override
    if (parsedAmount === null || parsedAmount === "") {
      await client.query(
        `DELETE FROM channel_partner_manual_product_charges
         WHERE reseller_id = $1 AND month = $2`,
        [resellerId, month]
      );
    } else {
      await client.query(
        `INSERT INTO channel_partner_manual_product_charges (reseller_id, month, amount, note, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reseller_id, month) DO UPDATE SET
           amount = EXCLUDED.amount,
           note = EXCLUDED.note,
           updated_at = NOW()`,
        [resellerId, month, parsedAmount, String(note || "").trim(), req?.user?.id || null]
      );
    }

    });

    // Auto regenerate commission
    await generateCommissionInternal(resellerId, month);

    res.json({ success: true, message: "Manual product charge saved successfully" });
  } catch (error) {
    console.error("Error saving manual product charge:", error);
    res.status(error.status || 500).json({ error: error.status ? error.message : "Failed to save manual product charge" });
  }
};

module.exports = {
  listUsers,
  addUser,
  updateUser,
  deleteUser,
  getUserPayments,
  initMonthlyPayments,
  recordUserPayment,
  bulkRecordPayments,
  getCommissionSummary,
  generateCommission,
  adjustCommission,
  finalizeCommission,
  unfinalizeCommission,
  getCommissionHistory,
  recordCommissionPayment,
  getCommissionPayments,
  getStatement,
  importChannelData,
  importPartnerAdvances,
  autoImportMaximSnapshots,
  // Phase 4: Reconciliation
  initiateReconciliation,
  approveReconciliation,
  rejectReconciliation,
  getReconciliations,
  getReconciliationDetails,
  downloadReconciliationReport,
  downloadReconciliationReport,
  getManualProductCharge,
  saveManualProductCharge,
  generateCommissionInternal,
};
