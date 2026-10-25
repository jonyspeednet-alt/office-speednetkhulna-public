const pool = require('./db');
let sanitizeValue = null;
try {
  sanitizeValue = require('./auditLogger').sanitizeValue || null;
} catch (_) { sanitizeValue = null; }

let initDone = false;

const isOwnershipError = (error) =>
  error && (error.code === '42501' || String(error.message || '').toLowerCase().includes('must be owner'));

const initAppErrorsTable = async () => {
  if (initDone) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_errors (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source VARCHAR(40) NOT NULL,
        message TEXT NULL,
        stack TEXT NULL,
        route_path TEXT NULL,
        http_method VARCHAR(10) NULL,
        user_id INTEGER NULL
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_app_errors_created_at ON app_errors (created_at DESC)');
    initDone = true;
    console.log('[AppErrors] app_errors table ready');
  } catch (error) {
    if (isOwnershipError(error)) {
      initDone = true;
      console.warn('[AppErrors] init uses existing table (owner-only DDL skipped)');
      return;
    }
    console.error('[AppErrors] init failed:', error.message);
  }
};

// source: 'request' | 'uncaughtException' | 'unhandledRejection'
const logAppError = (source, err, context = {}) => {
  const error = err instanceof Error ? err : new Error(String(err));
  // Scrub before persist: message/stack can carry secrets, tokens, or
  // connection strings, and app_errors is readable via the audit viewer.
  let message = String(error.message || '').slice(0, 2000);
  let stack = String(error.stack || '').slice(0, 5000);
  if (typeof sanitizeValue === 'function') {
    try {
      const sm = sanitizeValue(message);
      if (typeof sm === 'string') message = sm;
      const ss = sanitizeValue(stack);
      if (typeof ss === 'string') stack = ss;
    } catch (_) {}
  }
  pool.query(
    `INSERT INTO app_errors (source, message, stack, route_path, http_method, user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      source,
      message,
      stack,
      context.routePath || null,
      context.httpMethod || null,
      context.userId || null,
    ],
  ).catch((insertErr) => {
    console.error('[AppErrors] insert failed:', insertErr.message);
  });
};

module.exports = { initAppErrorsTable, logAppError };
