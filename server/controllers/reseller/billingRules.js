const pool = require("../../utilities/db");
const {
  getActor,
  getReqMeta,
  logResellerFinancialChange,
} = require("../../utilities/resellerFinancialAudit");
const {
  resolvePermission,
  isSuperAdmin,
} = require("../../utilities/permissionRegistry");
const { initialize } = require("./dbSetup");
const { normalizeBillBwType, BILL_BW_MAP } = require("./utils");

// Only two rule kinds exist:
// - discount_fixed: flat Tk off the monthly total (amount = Tk, >= 0).
// - bw_billable: bill only `amount` Mbps of `bw_type` for the month; the rest
//   is waived and shown as a "<TYPE> discount" line (amount = Mbps, >= 0).
const RULE_TYPES = ["discount_fixed", "bw_billable"];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])(-01)?$/;

// Accept YYYY-MM (normalized to YYYY-MM-01) or YYYY-MM-01. Anything else (e.g.
// mid-month days) is rejected so rules always align to month boundaries.
const normalizeMonthStart = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!MONTH_RE.test(s)) return undefined;
  return s.length === 7 ? `${s}-01` : s;
};

const parseResellerId = (req) => {
  const raw = req.params.id ?? req.params.resellerId;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const parseRuleId = (req) => {
  const id = Number.parseInt(req.params.ruleId, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// Write gate: discount-type rules additionally require billing.discount.add,
// everything else requires billing.generate_bill (route already enforces the
// latter; this adds the stricter discount check inside the controller).
const canWriteRule = (user, ruleType) => {
  if (isSuperAdmin(user)) return true;
  if (String(ruleType).startsWith("discount")) {
    return resolvePermission(user, "billing.discount.add");
  }
  return resolvePermission(user, "billing.generate_bill");
};

const requiredWritePermission = (ruleType) =>
  String(ruleType).startsWith("discount")
    ? "billing.discount.add"
    : "billing.generate_bill";

const validateAmount = (ruleType, amount, bwType) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "amount must be a finite number";
  if (ruleType === "bw_billable") {
    const t = normalizeBillBwType(bwType);
    if (!t || !BILL_BW_MAP[t])
      return "bw_type must be one of IIG, BDIX, GGC, FNA, CDN, BCDN, NTTN";
    if (n < 0) return "billable bandwidth must be >= 0 Mbps";
  } else if (n < 0) {
    return "amount must be >= 0";
  }
  return null;
};

// bw_type is immutable after create (it is part of the uniqueness scope);
// amount / end_month / note are editable.
const normalizeRuleBwType = (ruleType, bwType) => {
  if (ruleType !== "bw_billable") return null;
  return normalizeBillBwType(bwType) || null;
};

const validateIdempotencyKey = (key) => {
  if (key === undefined || key === null || key === "") return null;
  const s = String(key).trim();
  if (s.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(s)) return undefined;
  return s;
};

const fetchReseller = async (executor, resellerId) => {
  const result = await executor.query(
    `SELECT id, partner_type FROM resellers WHERE id = $1`,
    [resellerId],
  );
  return result.rows[0] || null;
};

// List active, non-deleted rules. Optional ?month=YYYY-MM filters to rules
// covering that month.
const listRules = async (req, res) => {
  try {
    await initialize();
    const resellerId = parseResellerId(req);
    if (!resellerId) return res.status(400).json({ message: "Valid reseller id is required" });

    let monthStart = null;
    if (req.query.month !== undefined) {
      monthStart = normalizeMonthStart(req.query.month);
      if (monthStart === undefined) {
        return res.status(400).json({ message: "month must be YYYY-MM" });
      }
    }

    const reseller = await fetchReseller(pool, resellerId);
    if (!reseller) return res.status(404).json({ message: "Reseller not found" });

    const params = [resellerId];
    let monthFilter = "";
    if (monthStart) {
      params.push(monthStart);
      monthFilter = `AND effective_month <= $2::date AND (end_month IS NULL OR end_month >= $2::date)`;
    }
    const result = await pool.query(
      `SELECT * FROM reseller_billing_rules
        WHERE reseller_id = $1 AND deleted_at IS NULL AND is_active = TRUE
        ${monthFilter}
        ORDER BY effective_month DESC, id DESC`,
      params,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("listRules error:", error);
    res.status(500).json({ message: "Server Error. Please try again later." });
  }
};

const createRule = async (req, res) => {
  const client = await pool.connect();
  try {
    await initialize();
    const resellerId = parseResellerId(req);
    if (!resellerId) return res.status(400).json({ message: "Valid reseller id is required" });

    const { rule_type, bw_type, effective_month, end_month, amount, note, idempotency_key } = req.body || {};

    if (!RULE_TYPES.includes(rule_type)) {
      return res.status(400).json({ message: "rule_type must be discount_fixed or bw_billable" });
    }
    if (!canWriteRule(req.user, rule_type)) {
      return res.status(403).json({ message: `Unauthorized: missing permission (${requiredWritePermission(rule_type)})` });
    }

    const effStart = normalizeMonthStart(effective_month);
    if (effStart === undefined || effStart === null) {
      return res.status(400).json({ message: "effective_month must be YYYY-MM-01" });
    }
    const endStart = normalizeMonthStart(end_month);
    if (endStart === undefined) {
      return res.status(400).json({ message: "end_month must be YYYY-MM-01 or omitted" });
    }
    if (endStart !== null && endStart < effStart) {
      return res.status(400).json({ message: "end_month must be >= effective_month" });
    }

    const amountError = validateAmount(rule_type, amount, bw_type);
    if (amountError) return res.status(400).json({ message: amountError });
    const normBw = normalizeRuleBwType(rule_type, bw_type);

    const keyStr = validateIdempotencyKey(idempotency_key);
    if (keyStr === undefined) return res.status(400).json({ message: "Invalid idempotency_key" });

    // Idempotency dedupe scoped to this reseller (same pattern as addBillingLog).
    if (keyStr) {
      const existing = await pool.query(
        `SELECT * FROM reseller_billing_rules
          WHERE idempotency_key = $1 AND reseller_id = $2 AND deleted_at IS NULL`,
        [keyStr, resellerId],
      );
      if (existing.rows.length > 0) return res.status(200).json(existing.rows[0]);
    }

    const actor = getActor(req);
    const reqMeta = getReqMeta(req);

    await client.query("BEGIN");
    const reseller = await fetchReseller(client, resellerId);
    if (!reseller) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reseller not found" });
    }
    if (reseller.partner_type === "channel_partner") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Channel Partners use commission billing. Billing rules are only for bandwidth resellers." });
    }
    // Serialize concurrent rule writes for this reseller so the overlap
    // UNIQUE index violation is the only conflict path (mapped to 409 below).
    await client.query(`SELECT id FROM resellers WHERE id = $1 FOR UPDATE`, [resellerId]);

    let row;
    try {
      const inserted = await client.query(
        `INSERT INTO reseller_billing_rules
           (reseller_id, rule_type, bw_type, effective_month, end_month, amount, note, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)
         RETURNING *`,
        [
          resellerId,
          rule_type,
          normBw,
          effStart,
          endStart,
          Number(amount),
          note ? String(note).trim() : null,
          keyStr,
          actor.actor_user_id,
        ],
      );
      row = inserted.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err && err.code === "23505") {
        return res.status(409).json({ message: "An active rule of this type already exists for that month" });
      }
      throw err;
    }

    await logResellerFinancialChange(client, {
      reseller_id: resellerId,
      actor_user_id: actor.actor_user_id,
      actor_user_name: actor.actor_user_name,
      actor_role: actor.actor_role,
      action_type: "BILLING_RULE_CREATE",
      reference_table: "reseller_billing_rules",
      reference_id: row.id,
      amount_after: Number(row.amount),
      note: row.note,
      request_payload: req.body,
      route_path: reqMeta.route_path || req.originalUrl,
      http_method: reqMeta.http_method || req.method,
      ip_address: reqMeta.ip_address,
    });

    await client.query("COMMIT");
    res.status(201).json(row);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("createRule error:", error);
    res.status(500).json({ message: "Server Error. Please try again later." });
  } finally {
    client.release();
  }
};

const updateRule = async (req, res) => {
  const client = await pool.connect();
  try {
    await initialize();
    const resellerId = parseResellerId(req);
    const ruleId = parseRuleId(req);
    if (!resellerId || !ruleId) {
      return res.status(400).json({ message: "Valid reseller id and rule id are required" });
    }

    const { amount, end_month, note, rule_type, bw_type } = req.body || {};
    if (amount === undefined && end_month === undefined && note === undefined) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const actor = getActor(req);
    const reqMeta = getReqMeta(req);

    await client.query("BEGIN");
    const reseller = await fetchReseller(client, resellerId);
    if (!reseller) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reseller not found" });
    }
    if (reseller.partner_type === "channel_partner") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Channel Partners use commission billing. Billing rules are only for bandwidth resellers." });
    }
    await client.query(`SELECT id FROM resellers WHERE id = $1 FOR UPDATE`, [resellerId]);

    const current = await client.query(
      `SELECT * FROM reseller_billing_rules
        WHERE id = $1 AND reseller_id = $2 AND deleted_at IS NULL AND is_active = TRUE
        FOR UPDATE`,
      [ruleId, resellerId],
    );
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Billing rule not found" });
    }
    const before = current.rows[0];

    // rule_type / bw_type define the uniqueness scope — they cannot change.
    if (rule_type !== undefined && rule_type !== before.rule_type) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "rule_type cannot be changed. Stop this rule and create a new one." });
    }
    if (bw_type !== undefined) {
      const normBefore = normalizeRuleBwType(before.rule_type, before.bw_type);
      const normReq = normalizeRuleBwType(before.rule_type, bw_type);
      if (normReq !== normBefore) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "bw_type cannot be changed. Stop this rule and create a new one." });
      }
    }

    if (!canWriteRule(req.user, before.rule_type)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: `Unauthorized: missing permission (${requiredWritePermission(before.rule_type)})` });
    }

    let nextAmount = before.amount;
    if (amount !== undefined) {
      const amountError = validateAmount(before.rule_type, amount, before.bw_type);
      if (amountError) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: amountError });
      }
      nextAmount = Number(amount);
    }

    let nextEnd = before.end_month
      ? new Date(before.end_month).toISOString().slice(0, 10)
      : null;
    if (end_month !== undefined) {
      const parsed = normalizeMonthStart(end_month);
      if (parsed === undefined) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "end_month must be YYYY-MM-01 or null" });
      }
      nextEnd = parsed;
    }
    const effStr = new Date(before.effective_month).toISOString().slice(0, 10);
    if (nextEnd !== null && nextEnd < effStr) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "end_month must be >= effective_month" });
    }

    const nextNote = note !== undefined ? (note ? String(note).trim() : null) : before.note;

    let row;
    try {
      const updated = await client.query(
        `UPDATE reseller_billing_rules
          SET amount = $1, end_month = $2::date, note = $3, updated_at = NOW()
          WHERE id = $4 AND reseller_id = $5
          RETURNING *`,
        [nextAmount, nextEnd, nextNote, ruleId, resellerId],
      );
      row = updated.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err && err.code === "23505") {
        return res.status(409).json({ message: "An active rule of this type already exists for that month" });
      }
      throw err;
    }

    await logResellerFinancialChange(client, {
      reseller_id: resellerId,
      actor_user_id: actor.actor_user_id,
      actor_user_name: actor.actor_user_name,
      actor_role: actor.actor_role,
      action_type: "BILLING_RULE_UPDATE",
      reference_table: "reseller_billing_rules",
      reference_id: row.id,
      amount_before: Number(before.amount),
      amount_after: Number(row.amount),
      field_changes: {
        before: { amount: Number(before.amount), end_month: before.end_month, note: before.note },
        after: { amount: Number(row.amount), end_month: row.end_month, note: row.note },
      },
      note: row.note,
      request_payload: req.body,
      route_path: reqMeta.route_path || req.originalUrl,
      http_method: reqMeta.http_method || req.method,
      ip_address: reqMeta.ip_address,
    });

    await client.query("COMMIT");
    res.json(row);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("updateRule error:", error);
    res.status(500).json({ message: "Server Error. Please try again later." });
  } finally {
    client.release();
  }
};

// Soft-delete only: is_active = FALSE + deleted_at = NOW(). No hard DELETE.
const deactivateRule = async (req, res) => {
  const client = await pool.connect();
  try {
    await initialize();
    const resellerId = parseResellerId(req);
    const ruleId = parseRuleId(req);
    if (!resellerId || !ruleId) {
      return res.status(400).json({ message: "Valid reseller id and rule id are required" });
    }

    const actor = getActor(req);
    const reqMeta = getReqMeta(req);

    await client.query("BEGIN");
    const reseller = await fetchReseller(client, resellerId);
    if (!reseller) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Reseller not found" });
    }
    if (reseller.partner_type === "channel_partner") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Channel Partners use commission billing. Billing rules are only for bandwidth resellers." });
    }
    await client.query(`SELECT id FROM resellers WHERE id = $1 FOR UPDATE`, [resellerId]);

    const current = await client.query(
      `SELECT * FROM reseller_billing_rules
        WHERE id = $1 AND reseller_id = $2 AND deleted_at IS NULL AND is_active = TRUE
        FOR UPDATE`,
      [ruleId, resellerId],
    );
    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Billing rule not found" });
    }
    const before = current.rows[0];

    if (!canWriteRule(req.user, before.rule_type)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: `Unauthorized: missing permission (${requiredWritePermission(before.rule_type)})` });
    }

    const updated = await client.query(
      `UPDATE reseller_billing_rules
        SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND reseller_id = $2
        RETURNING *`,
      [ruleId, resellerId],
    );

    await logResellerFinancialChange(client, {
      reseller_id: resellerId,
      actor_user_id: actor.actor_user_id,
      actor_user_name: actor.actor_user_name,
      actor_role: actor.actor_role,
      action_type: "BILLING_RULE_DEACTIVATE",
      reference_table: "reseller_billing_rules",
      reference_id: ruleId,
      amount_before: Number(before.amount),
      note: `Deactivated ${before.rule_type} rule effective ${new Date(before.effective_month).toISOString().slice(0, 10)}`,
      request_payload: req.body,
      route_path: reqMeta.route_path || req.originalUrl,
      http_method: reqMeta.http_method || req.method,
      ip_address: reqMeta.ip_address,
    });

    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("deactivateRule error:", error);
    res.status(500).json({ message: "Server Error. Please try again later." });
  } finally {
    client.release();
  }
};

module.exports = {
  listRules,
  createRule,
  updateRule,
  deactivateRule,
};
