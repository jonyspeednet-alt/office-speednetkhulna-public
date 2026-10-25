const pool = require('./db');
let sanitizeValue = null;
try {
  // Reuse the strong recursive redactor (substring fallback, depth cap).
  // Local require to avoid any circular-import risk at boot.
  sanitizeValue = require('./auditLogger').sanitizeValue || null;
} catch (_) { sanitizeValue = null; }

const round2 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
};

const safeJson = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch (_) {
    return JSON.stringify({ _note: 'non-serializable' });
  }
};

const sanitizePayload = (obj) => {
  if (!obj || typeof obj !== 'object') return {};
  if (typeof sanitizeValue === 'function') {
    try {
      const out = sanitizeValue(obj);
      return out && typeof out === 'object' ? out : {};
    } catch (_) {}
  }
  const clone = { ...obj };
  const sensitive = ['password', 'token', 'authorization', 'cookie', 'secret'];
  for (const key of Object.keys(clone)) {
    if (sensitive.includes(String(key).toLowerCase())) clone[key] = '[REDACTED]';
  }
  return clone;
};

const getReqMeta = (req) => {
  // Prefer req.ip (trust proxy resolves it); raw XFF is client-controlled (S10).
  const forwarded = req?.headers?.['x-forwarded-for'];
  return {
    route_path: req?.originalUrl || req?.url || null,
    http_method: req?.method || null,
    ip_address: req?.ip || (forwarded ? String(forwarded).split(',')[0].trim() : null) || req?.socket?.remoteAddress || null,
  };
};

const getActor = (req) => ({
  actor_user_id: req?.user?.id || null,
  actor_user_name: req?.user?.full_name || null,
  actor_role: req?.user?.role_name || req?.user?.role || null,
});

let initDone = false;

const initResellerFinancialAuditTable = async () => {
  if (initDone) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reseller_financial_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reseller_id INTEGER NOT NULL,
        actor_user_id INTEGER NULL,
        actor_user_name TEXT NULL,
        actor_role TEXT NULL,
        action_type VARCHAR(80) NOT NULL,
        reference_table VARCHAR(80) NULL,
        reference_id BIGINT NULL,
        amount_before NUMERIC(14,2) NULL,
        amount_after NUMERIC(14,2) NULL,
        amount_delta NUMERIC(14,2) NULL,
        due_before NUMERIC(14,2) NULL,
        due_after NUMERIC(14,2) NULL,
        due_delta NUMERIC(14,2) NULL,
        field_changes JSONB NULL,
        note TEXT NULL,
        request_payload JSONB NULL,
        route_path TEXT NULL,
        http_method VARCHAR(10) NULL,
        ip_address VARCHAR(64) NULL
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_reseller_fin_audit_reseller_id ON reseller_financial_audit_logs (reseller_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_reseller_fin_audit_created_at ON reseller_financial_audit_logs (created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_reseller_fin_audit_action_type ON reseller_financial_audit_logs (action_type)');
    initDone = true;
    console.log('[ResellerFinancialAudit] table ready');
  } catch (error) {
    // No crash: logging system is best-effort.
    if (error?.code === '42501' || String(error?.message || '').toLowerCase().includes('must be owner')) {
      initDone = true;
      console.warn('[ResellerFinancialAudit] init uses existing table (owner-only DDL skipped)');
      return;
    }
    console.error('[ResellerFinancialAudit] init failed:', error.message);
  }
};

const logResellerFinancialChange = async (dbClient, payload) => {
  const executor = dbClient && typeof dbClient.query === 'function' ? dbClient : pool;
  const values = [
    Number(payload.reseller_id),
    payload.actor_user_id ?? null,
    payload.actor_user_name ?? null,
    payload.actor_role ?? null,
    String(payload.action_type || 'UNKNOWN').slice(0, 80),
    payload.reference_table || null,
    payload.reference_id ?? null,
    round2(payload.amount_before),
    round2(payload.amount_after),
    round2(payload.amount_delta),
    round2(payload.due_before),
    round2(payload.due_after),
    round2(payload.due_delta),
    safeJson(payload.field_changes || {}),
    payload.note || null,
    safeJson(sanitizePayload(payload.request_payload || {})),
    payload.route_path || null,
    payload.http_method || null,
    payload.ip_address || null,
  ];

  await executor.query(
    `INSERT INTO reseller_financial_audit_logs (
      reseller_id, actor_user_id, actor_user_name, actor_role, action_type,
      reference_table, reference_id,
      amount_before, amount_after, amount_delta,
      due_before, due_after, due_delta,
      field_changes, note, request_payload,
      route_path, http_method, ip_address
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,
      $8,$9,$10,
      $11,$12,$13,
      $14::jsonb,$15,$16::jsonb,
      $17,$18,$19
    )`,
    values
  );
};

module.exports = {
  initResellerFinancialAuditTable,
  logResellerFinancialChange,
  getActor,
  getReqMeta,
};
