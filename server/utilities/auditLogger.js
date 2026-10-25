const pool = require('./db');

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 30;
const MAX_OBJECT_KEYS = 60;
const MAX_DEPTH = 4;

const SENSITIVE_KEYS = new Set([
  'password',
  'new_password',
  'current_password',
  'confirm_password',
  'token',
  'authorization',
  'cookie',
  'jwt',
  'secret',
  'password_enc',
  'fcm_token',
  'api_key',
  'api_token',
  'send_to',
  'recipient_phone',
  'phone',
  'msisdn',
  'message_body',
  'otp',
  'newpassword',
  'oldpassword',
]);

const safeJson = (value) => {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return JSON.stringify({ _note: 'non-serializable payload' });
  }
};

const redactByKey = (key, value) => {
  if (!key) return value;
  const normalized = String(key).toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return '[REDACTED]';
  // substring / case-insensitive fallback: any key containing password/token/secret is sensitive
  if (normalized.includes('password') || normalized.includes('token') || normalized.includes('secret')) return '[REDACTED]';
  return value;
};

const sanitizeValue = (value, depth = 0) => {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
  }

  if (Buffer.isBuffer(value)) return '[BINARY]';
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const output = {};
    const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);
    for (const key of keys) {
      const redacted = redactByKey(key, value[key]);
      output[key] = sanitizeValue(redacted, depth + 1);
    }
    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      output._truncated_keys = true;
    }
    return output;
  }

  return String(value);
};

const getIpAddress = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
};

const deriveActionType = (req, res) => {
  if (res.locals?.auditAction) return String(res.locals.auditAction).slice(0, 80);
  const normalizedPath = String(req.path || '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 60);
  return `${String(req.method || 'REQ').toUpperCase()}_${normalizedPath || 'root'}`;
};

let initDone = false;

const isOwnershipError = (error) =>
  error && (error.code === '42501' || String(error.message || '').toLowerCase().includes('must be owner'));

const initAuditLogTable = async () => {
  if (initDone) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id INTEGER NULL,
        user_name TEXT NULL,
        role_name TEXT NULL,
        action_type VARCHAR(80) NOT NULL,
        http_method VARCHAR(10) NOT NULL,
        route_path TEXT NOT NULL,
        query_params JSONB NULL,
        request_body JSONB NULL,
        response_status INTEGER NOT NULL,
        response_body JSONB NULL,
        ip_address VARCHAR(64) NULL,
        user_agent TEXT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        error_message TEXT NULL
      )
    `);

    const ownerCheck = await pool.query(`
      SELECT
        current_user AS current_user,
        (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') AS table_owner
    `);
    const currentUser = ownerCheck.rows[0]?.current_user || '';
    const tableOwner = ownerCheck.rows[0]?.table_owner || '';

    if (tableOwner && currentUser && tableOwner !== currentUser) {
      console.warn('[AuditLog] index create skipped (table owner privilege required)');
    } else {
      const indexSql = [
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs (action_type)',
        'CREATE INDEX IF NOT EXISTS idx_audit_logs_route_path ON audit_logs (route_path)',
      ];
      for (const sql of indexSql) {
        await pool.query(sql);
      }
    }
    initDone = true;
    console.log('[AuditLog] audit_logs table ready');
  } catch (error) {
    // Do not crash app if audit table initialization fails.
    if (isOwnershipError(error)) {
      initDone = true;
      console.warn('[AuditLog] init uses existing table (owner-only DDL skipped)');
      return;
    }
    console.error('[AuditLog] init failed:', error.message);
  }
};

const shouldSkipRequest = (req) => {
  const path = String(req.path || '');
  if (path === '/health') return true;
  if (path.startsWith('/audit-logs')) return true;
  return false;
};

const auditLogMiddleware = (req, res, next) => {
  if (shouldSkipRequest(req)) return next();

  const startedAt = Date.now();
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let responsePayload;

  res.json = (body) => {
    responsePayload = body;
    return originalJson(body);
  };

  res.send = (body) => {
    if (responsePayload === undefined) responsePayload = body;
    return originalSend(body);
  };

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.id || res.locals?.auditUserId || null;
    const userName = req.user?.full_name || res.locals?.auditUserName || null;
    const roleName = req.user?.role_name || req.user?.role || res.locals?.auditRoleName || null;
    const responseStatus = Number(res.statusCode || 0);
    const success = responseStatus >= 200 && responseStatus < 400;
    const method = String(req.method || '').toUpperCase();

    // Successful reads (GET/HEAD) are the bulk of traffic and carry no side
    // effects — skip them to keep audit_logs from growing unbounded. Failed
    // reads (4xx/5xx) and all mutations (POST/PUT/PATCH/DELETE) are still logged.
    if (success && (method === 'GET' || method === 'HEAD')) return;

    const requestBody =
      method === 'GET' || method === 'HEAD'
        ? null
        : sanitizeValue({
            ...(req.body || {}),
            ...(req.files ? { _files: Object.keys(req.files) } : {}),
          });

    const queryParams = sanitizeValue(req.query || {});
    const responseBody = sanitizeValue(responsePayload);
    // error_message is re-exposed via the audit viewer: never persist raw
    // driver error text (pg errors carry host/db/user). Sanitize + truncate.
    const rawError =
      res.locals?.auditError
      || (!success && responseBody && typeof responseBody === 'object' ? responseBody.message : null)
      || null;
    let errorMessage = rawError == null ? null : sanitizeValue(String(rawError).slice(0, 500));
    // Scrub connection-string fragments pg errors love to embed
    if (typeof errorMessage === 'string') {
      errorMessage = errorMessage
        .replace(/password\s*=\s*'[^']*'/gi, "password='[REDACTED]'")
        .replace(/host\s*=\s*\S+/gi, 'host=[REDACTED]');
    }

    const payload = {
      user_id: userId,
      user_name: userName,
      role_name: roleName,
      action_type: deriveActionType(req, res),
      http_method: method,
      route_path: req.originalUrl || req.url || req.path || '',
      query_params: queryParams,
      request_body: requestBody,
      response_status: responseStatus,
      response_body: responseBody,
      ip_address: getIpAddress(req),
      user_agent: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 1000) : null,
      duration_ms: durationMs,
      success,
      error_message: errorMessage,
    };

    pool.query(
      `INSERT INTO audit_logs (
        user_id, user_name, role_name, action_type, http_method, route_path,
        query_params, request_body, response_status, response_body, ip_address,
        user_agent, duration_ms, success, error_message
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7::jsonb,$8::jsonb,$9,$10::jsonb,$11,
        $12,$13,$14,$15
      )`,
      [
        payload.user_id,
        payload.user_name,
        payload.role_name,
        payload.action_type,
        payload.http_method,
        payload.route_path,
        safeJson(payload.query_params),
        safeJson(payload.request_body),
        payload.response_status,
        safeJson(payload.response_body),
        payload.ip_address,
        payload.user_agent,
        payload.duration_ms,
        payload.success,
        payload.error_message,
      ]
    ).catch((err) => {
      console.error('[AuditLog] insert failed:', err.message);
    });
  });

  next();
};

// ============================================================================
// Financial Transaction Logging (Immutable Audit Trail)
// ============================================================================

/**
 * Log a financial transaction to the immutable audit log
 * @param {Object} transactionData
 * @param {number} transactionData.actor_user_id - User performing action
 * @param {number} transactionData.reseller_id - Reseller affected
 * @param {string} transactionData.action_type - Action type (e.g., 'payment.recorded')
 * @param {string} [transactionData.entity_type] - Entity type (e.g., 'channel_user_payments')
 * @param {number} [transactionData.entity_id] - ID of affected entity
 * @param {number} [transactionData.amount_before] - Amount before
 * @param {number} [transactionData.amount_after] - Amount after
 * @param {string} [transactionData.previous_status] - Status before
 * @param {string} [transactionData.new_status] - Status after
 * @param {Object} [transactionData.request_payload] - Transaction details
 * @param {string} [transactionData.notes] - Optional notes
 * @param {string} [transactionData.ip_address] - IP address
 * @returns {Promise<Object>} Audit log record
 */
const logFinancialTransaction = async (transactionData) => {
  try {
    const result = await pool.query(
      `INSERT INTO reseller_financial_audit_log_immutable
       (actor_user_id, reseller_id, action_type, entity_type, entity_id,
        amount_before, amount_after, previous_status, new_status,
        request_payload, notes, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       RETURNING *`,
      [
        transactionData.actor_user_id,
        transactionData.reseller_id,
        transactionData.action_type,
        transactionData.entity_type || null,
        transactionData.entity_id || null,
        transactionData.amount_before || null,
        transactionData.amount_after || null,
        transactionData.previous_status || null,
        transactionData.new_status || null,
        transactionData.request_payload ? JSON.stringify(sanitizeValue(transactionData.request_payload)) : null,
        transactionData.notes || null,
        transactionData.ip_address || null
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('[AuditLogger] Error logging financial transaction:', error.message);
    throw error;
  }
};

/**
 * Get audit trail for a reseller
 * @param {number} resellerId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} [actionType] - Optional filter by action type
 * @returns {Promise<Array>} Audit records
 */
const getFinancialAuditTrail = async (resellerId, startDate, endDate, actionType = null) => {
  let query = `
    SELECT * FROM reseller_financial_audit_log_immutable
    WHERE reseller_id = $1
      AND created_at >= $2
      AND created_at <= $3
  `;
  const params = [resellerId, startDate, endDate];

  if (actionType) {
    query += ` AND action_type = $4`;
    params.push(actionType);
  }

  query += ` ORDER BY created_at DESC LIMIT 1000`;

  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * Verify audit trail integrity
 * @param {number} resellerId
 * @param {Date} period
 * @returns {Promise<Object>} Integrity check results
 */
const verifyAuditIntegrity = async (resellerId, period) => {
  const result = await pool.query(
    `SELECT 
       COUNT(*) as total_records,
       COUNT(DISTINCT action_type) as unique_actions,
       COUNT(DISTINCT actor_user_id) as unique_actors,
       MIN(created_at) as earliest_record,
       MAX(created_at) as latest_record,
       SUM(CASE WHEN amount_after IS NOT NULL THEN 1 ELSE 0 END) as records_with_amounts
     FROM reseller_financial_audit_log_immutable
     WHERE reseller_id = $1
       AND DATE(created_at) = $2`,
    [resellerId, period]
  );

  return {
    ...result.rows[0],
    period,
    reseller_id: resellerId,
    verified_at: new Date().toISOString()
  };
};

/**
 * Export audit trail for compliance
 * @param {number} resellerId
 * @param {Date} startDate
 * @param {Date} endDate
 * @param {string} format - 'json' or 'csv'
 * @returns {Promise<string>} Formatted audit trail
 */
const exportFinancialAuditTrail = async (resellerId, startDate, endDate, format = 'json') => {
  const records = await getFinancialAuditTrail(resellerId, startDate, endDate);

  if (format === 'json') {
    return JSON.stringify(records, null, 2);
  }

  if (format === 'csv') {
    if (records.length === 0) return 'No records found';

    const headers = Object.keys(records[0]).join(',');
    const rows = records.map(record =>
      Object.values(record).map(val =>
        typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      ).join(',')
    );

    return [headers, ...rows].join('\n');
  }

  throw new Error('Unsupported format. Use json or csv.');
};

module.exports = {
  initAuditLogTable,
  auditLogMiddleware,
  logFinancialTransaction,
  getFinancialAuditTrail,
  verifyAuditIntegrity,
  exportFinancialAuditTrail,
  sanitizeValue,
};
