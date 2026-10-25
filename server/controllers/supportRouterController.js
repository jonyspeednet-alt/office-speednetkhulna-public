const pool = require('../utilities/db');
const { success, fail, notFound, serverError, unauthorized } = require('../utilities/apiResponse');
const { isSuperAdmin, resolvePermission } = require('../utilities/permissionRegistry');
// Contract: parallel Agent A owns this service file (syncDevice/fetchRouterData/
// async getDevices/syncConfiguredDevices({routerId}) + crypto helpers). Do not edit those.
const { encryptRouterPassword, decryptRouterPassword } = require('../services/supportRouterCrypto');
const mikrotik = require('../services/mikrotikSupportService');
const { normalizeRouterHost, isBlockedRouterHost, parseRouterUrl } = require('../utilities/routerTargetPolicy');

// escape % _ \ for ILIKE (value stays parameterized; wildcards inside it are neutralized)
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const PROTOCOLS = new Set(['api', 'rest']);

// Public projection: password_enc NEVER leaves the API; has_password flags presence.
const ROUTER_PUBLIC_COLUMNS = `id, label, protocol, host, base_url, port, username, is_active,
  last_synced_at, last_sync_status, last_error, created_by, updated_by, created_at, updated_at,
  (password_enc IS NOT NULL) AS has_password`;

const parsePort = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return { port: null };
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: 'Port must be an integer between 1 and 65535.' };
  return { port: n };
};

const coerceActive = (value, dflt) => {
  if (value === undefined || value === null || value === '') return { active: dflt };
  if (typeof value === 'boolean') return { active: value };
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 't', 'yes', 'y'].includes(s)) return { active: true };
  if (['false', '0', 'f', 'no', 'n'].includes(s)) return { active: false };
  return { error: 'Invalid is_active flag.' };
};

// Field-level validation shared by create (all required) and update (provided-only).
const validateRouterFields = (body, { isCreate }) => {
  const b = body || {};
  const out = {};

  if (isCreate || b.label !== undefined) {
    const label = String(b.label ?? '').trim();
    if (!label) return { error: 'Label is required.' };
    if (label.length > 100) return { error: 'Label must be <= 100 chars.' };
    out.label = label;
  }
  if (isCreate || b.protocol !== undefined) {
    const protocol = String(b.protocol ?? '').trim().toLowerCase();
    if (!PROTOCOLS.has(protocol)) return { error: 'Invalid protocol. Must be "api" or "rest".' };
    out.protocol = protocol;
  }
  if (isCreate || b.username !== undefined) {
    const username = String(b.username ?? '').trim();
    if (!username) return { error: 'Username is required.' };
    if (username.length > 100) return { error: 'Username must be <= 100 chars.' };
    out.username = username;
  }

  // Keep the field name `password` so the audit redactor catches it.
  const pwdPresent = b.password !== undefined && b.password !== null && String(b.password) !== '';
  if (isCreate) {
    if (!pwdPresent) return { error: 'Password is required.' };
    if (String(b.password).length > 500) return { error: 'Password must be <= 500 chars.' };
    out.password = String(b.password);
  } else if (pwdPresent) {
    if (String(b.password).length > 500) return { error: 'Password must be <= 500 chars.' };
    out.password = String(b.password);
  }

  if (isCreate || b.is_active !== undefined) {
    const r = coerceActive(b.is_active, true);
    if (r.error) return { error: r.error };
    out.is_active = r.active;
  }
  return { values: out };
};

// Protocol-dependent connection validation over effective (merged) values.
const validateConnection = (eff) => {
  const protocol = eff.protocol;
  if (protocol === 'api') {
    const host = String(eff.host ?? '').trim();
    if (!host) return { error: 'Host is required for API protocol.' };
    if (host.length > 255) return { error: 'Host must be <= 255 chars.' };
    let canonicalHost;
    try { canonicalHost = normalizeRouterHost(host); } catch (_) { return { error: 'Host target is not allowed.' }; }
    if (isBlockedRouterHost(canonicalHost)) return { error: 'Host target is not allowed.' };
    const pr = parsePort(eff.port);
    if (pr.error) return { error: pr.error };
    if (String(eff.base_url ?? '').trim() !== '') return { error: 'base_url must be empty for API protocol.' };
    return { values: { host: canonicalHost, port: pr.port, base_url: null } };
  }
  const baseUrl = String(eff.base_url ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) return { error: 'base_url is required for REST protocol.' };
  if (!/^https?:\/\//i.test(baseUrl)) return { error: 'base_url must start with http:// or https://.' };
  if (baseUrl.length > 500) return { error: 'base_url must be <= 500 chars.' };
  try { parseRouterUrl(baseUrl); } catch (_) { return { error: 'base_url target is not allowed.' }; }
  if (String(eff.host ?? '').trim() !== '') return { error: 'host must be empty for REST protocol (use base_url).' };
  if (eff.port !== undefined && eff.port !== null && String(eff.port).trim() !== '') {
    return { error: 'port must be empty for REST protocol (use base_url).' };
  }
  return { values: { host: null, port: null, base_url: baseUrl } };
};

const toDevice = (row, plainPassword) => ({
  id: row.id,
  protocol: row.protocol,
  host: row.host,
  baseUrl: row.base_url,
  port: row.port,
  username: row.username,
  password: plainPassword,
});

const listRouters = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitRaw = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(200, Math.max(10, limitRaw));
    const offset = (page - 1) * limit;

    const params = [];
    const where = [];
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      where.push(`(id ILIKE $${params.length} ESCAPE '\\' OR label ILIKE $${params.length} ESCAPE '\\' OR COALESCE(host,'') ILIKE $${params.length} ESCAPE '\\')`);
    }
    const activeRaw = String(req.query.is_active ?? '').trim().toLowerCase();
    if (['true', '1'].includes(activeRaw)) {
      where.push('is_active = TRUE');
    } else if (['false', '0'].includes(activeRaw)) {
      where.push('is_active = FALSE');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM mikrotik_routers ${whereSql}`, params),
      pool.query(`SELECT ${ROUTER_PUBLIC_COLUMNS} FROM mikrotik_routers ${whereSql}
        ORDER BY label ASC, id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    ]);
    const total = countRes.rows[0].total;
    if (req.query.page || req.query.limit) {
      return success(res, { rows: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    res.set('X-Total-Count', String(total));
    return success(res, dataRes.rows);
  } catch (error) { return serverError(res, error); }
};

const createRouter = async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.id ?? '').trim().toLowerCase();
    if (!ID_RE.test(id)) {
      return fail(res, 'Invalid router id. Use 2-40 chars: lowercase letters, digits, "-" or "_" (must start with a letter or digit).', 400);
    }
    const v = validateRouterFields(b, { isCreate: true });
    if (v.error) return fail(res, v.error, 400);
    const c = validateConnection({ protocol: v.values.protocol, host: b.host, port: b.port, base_url: b.base_url });
    if (c.error) return fail(res, c.error, 400);

    let passwordEnc;
    try {
      passwordEnc = encryptRouterPassword(v.values.password);
    } catch (e) { return serverError(res, e); }

    try {
      const r = await pool.query(
        `INSERT INTO mikrotik_routers (id, label, protocol, host, base_url, port, username, password_enc, is_active, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING ${ROUTER_PUBLIC_COLUMNS}`,
        [id, v.values.label, v.values.protocol, c.values.host, c.values.base_url, c.values.port,
          v.values.username, passwordEnc, v.values.is_active, req.user?.id || null]
      );
      res.locals.auditAction = 'MIKROTIK_ROUTER_CREATE';
      return success(res, r.rows[0], 201);
    } catch (e) {
      if (e && e.code === '23505') return fail(res, 'Router ID already exists.', 409);
      throw e;
    }
  } catch (error) { return serverError(res, error); }
};

const getRouter = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const r = await pool.query(`SELECT ${ROUTER_PUBLIC_COLUMNS} FROM mikrotik_routers WHERE id=$1`, [id]);
    if (!r.rowCount) return notFound(res, 'Router not found.');
    return success(res, r.rows[0]);
  } catch (error) { return serverError(res, error); }
};

const updateRouter = async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(req.params.id || '').trim();
    const existing = await pool.query('SELECT * FROM mikrotik_routers WHERE id=$1', [id]);
    if (!existing.rowCount) return notFound(res, 'Router not found.');
    const row = existing.rows[0];

    // Rename allowed: id is TEXT PK with no FKs — propagate to history tables in one transaction.
    let newId = null;
    if (b.id !== undefined && b.id !== null && String(b.id).trim() !== '') {
      newId = String(b.id).trim().toLowerCase();
      if (newId !== id) {
        if (!ID_RE.test(newId)) {
          return fail(res, 'Invalid new router id. Use 2-40 chars: lowercase letters, digits, "-" or "_" (must start with a letter or digit).', 400);
        }
        const taken = await pool.query('SELECT 1 FROM mikrotik_routers WHERE id=$1', [newId]);
        if (taken.rowCount) return fail(res, 'Router ID already exists.', 409);
      } else {
        newId = null; // unchanged
      }
    }

    const v = validateRouterFields(b, { isCreate: false });
    if (v.error) return fail(res, v.error, 400);

    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
    if (v.values.label !== undefined) push('label', v.values.label);
    if (v.values.protocol !== undefined) push('protocol', v.values.protocol);
    if (v.values.username !== undefined) push('username', v.values.username);
    if (v.values.is_active !== undefined) push('is_active', v.values.is_active);

    const connTouched = ['protocol', 'host', 'port', 'base_url'].some((k) => b[k] !== undefined);
    if (connTouched) {
      const eff = {
        protocol: v.values.protocol !== undefined ? v.values.protocol : row.protocol,
        host: b.host !== undefined ? b.host : row.host,
        port: b.port !== undefined ? b.port : row.port,
        base_url: b.base_url !== undefined ? b.base_url : row.base_url,
      };
      const c = validateConnection(eff);
      if (c.error) return fail(res, c.error, 400);
      push('host', c.values.host);
      push('base_url', c.values.base_url);
      push('port', c.values.port);
    }

    // Absent/empty password = unchanged; present + non-empty = re-encrypt.
    if (v.values.password !== undefined) {
      let passwordEnc;
      try {
        passwordEnc = encryptRouterPassword(v.values.password);
      } catch (e) { return serverError(res, e); }
      push('password_enc', passwordEnc);
    }

    if (!sets.length && !newId) {
      const { password_enc: _omit, ...publicRow } = row;
      return success(res, { ...publicRow, has_password: !!row.password_enc });
    }
    push('updated_by', req.user?.id || null);
    if (newId) push('id', newId);
    params.push(id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE mikrotik_routers SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} RETURNING ${ROUTER_PUBLIC_COLUMNS}`,
        params
      );
      if (newId) {
        await client.query('UPDATE network_customers SET router_id=$1, updated_at=NOW() WHERE router_id=$2', [newId, id]);
        await client.query('UPDATE mikrotik_sync_runs SET router_id=$1 WHERE router_id=$2', [newId, id]);
      }
      await client.query('COMMIT');
      res.locals.auditAction = newId ? 'MIKROTIK_ROUTER_RENAME' : 'MIKROTIK_ROUTER_UPDATE';
      return success(res, r.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e && e.code === '23505') return fail(res, 'Router ID already exists.', 409);
      throw e;
    } finally {
      client.release();
    }
  } catch (error) { return serverError(res, error); }
};

const deleteRouter = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = await pool.query(`SELECT ${ROUTER_PUBLIC_COLUMNS} FROM mikrotik_routers WHERE id=$1`, [id]);
    if (!existing.rowCount) return notFound(res, 'Router not found.');

    const hard = String(req.query.hard ?? '').trim().toLowerCase();
    if (hard === 'true' || hard === '1') {
      if (!isSuperAdmin(req.user) && !resolvePermission(req.user, 'system.all_access')) {
        return unauthorized(res, 'Hard delete requires super-admin access.');
      }
      const cnt = await pool.query('SELECT COUNT(*)::int AS total FROM network_customers WHERE router_id=$1', [id]);
      const total = cnt.rows[0].total;
      if (total > 0) {
        return fail(res, `Cannot hard-delete router: ${total} customer(s) still reference it. Move or remove them first.`, 409, { customer_count: total });
      }
      await pool.query('DELETE FROM mikrotik_routers WHERE id=$1', [id]);
      res.locals.auditAction = 'MIKROTIK_ROUTER_DELETE';
      return success(res, { message: `Router ${id} deleted`, hard: true });
    }

    const r = await pool.query(
      `UPDATE mikrotik_routers SET is_active=FALSE, updated_by=$2, updated_at=NOW() WHERE id=$1 RETURNING ${ROUTER_PUBLIC_COLUMNS}`,
      [id, req.user?.id || null]
    );
    res.locals.auditAction = 'MIKROTIK_ROUTER_DELETE';
    return success(res, r.rows[0]);
  } catch (error) { return serverError(res, error); }
};

// 60s cooldown after 5 consecutive test failures, per router (in-memory).
const testCooldowns = new Map();
const TEST_MAX_FAILS = 5;
const TEST_COOLDOWN_MS = 60 * 1000;

// Generic buckets only: never the lib error string, never credentials.
const classifyRouterTestError = (err) => {
  const msg = String(err?.message || '').toLowerCase();
  if (!msg) return { code: 'UNKNOWN', message: 'Router test failed for an unknown reason.' };
  if (/timed?\s?out|etimedout|abort/.test(msg)) return { code: 'TIMEOUT', message: 'Router connection timed out. Check IP/port and firewall.' };
  if (/auth|401|403|unauthorized|forbidden|invalid user|bad username|login|password|wrong/.test(msg)) {
    return { code: 'AUTH', message: 'Router authentication failed. Check username/password.' };
  }
  if (/unknown|unexpected|internal/.test(msg) && !/unreach|refus|econn|enotfound|ehost|enet/.test(msg)) {
    return { code: 'UNKNOWN', message: 'Router test failed for an unknown reason.' };
  }
  return { code: 'UNREACHABLE', message: 'Router is unreachable. Check network, IP/port and firewall.' };
};

const testRouterConnection = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const cd = testCooldowns.get(id);
    if (cd && cd.cooldownUntil > Date.now()) {
      return fail(res, 'Router test is temporarily paused after repeated failures. Try again later.', 503, { code: 'UNKNOWN', retry_after_seconds: 60 });
    }
    const existing = await pool.query('SELECT * FROM mikrotik_routers WHERE id=$1', [id]);
    if (!existing.rowCount) return notFound(res, 'Router not found.');
    const row = existing.rows[0];

    let plain;
    try {
      plain = decryptRouterPassword(row.password_enc);
    } catch (e) { return serverError(res, e); }

    const t0 = Date.now();
    try {
      const records = await mikrotik.fetchRouterData(toDevice(row, plain));
      testCooldowns.delete(id);
      res.locals.auditAction = 'MIKROTIK_ROUTER_TEST';
      return success(res, { ok: true, records_seen: Array.isArray(records) ? records.length : 0, latency_ms: Date.now() - t0 });
    } catch (e) {
      const fails = (testCooldowns.get(id)?.fails || 0) + 1;
      const entry = { fails, cooldownUntil: fails >= TEST_MAX_FAILS ? Date.now() + TEST_COOLDOWN_MS : 0 };
      testCooldowns.set(id, entry);
      res.locals.auditAction = 'MIKROTIK_ROUTER_TEST';
      const bucket = classifyRouterTestError(e);
      return fail(res, bucket.message, 503, { code: bucket.code });
    }
  } catch (error) { return serverError(res, error); }
};

const syncOneRouter = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const existing = await pool.query('SELECT * FROM mikrotik_routers WHERE id=$1', [id]);
    if (!existing.rowCount) return notFound(res, 'Router not found.');
    const row = existing.rows[0];

    let plain;
    try {
      plain = decryptRouterPassword(row.password_enc);
    } catch (e) { return serverError(res, e); }

    try {
      const result = await mikrotik.syncDevice(toDevice(row, plain));
      return success(res, { routerId: result.routerId, synced: result.synced });
    } catch (e) {
      const bucket = classifyRouterTestError(e);
      return fail(res, bucket.message, 503, { code: bucket.code });
    }
  } catch (error) { return serverError(res, error); }
};

module.exports = {
  listRouters,
  createRouter,
  getRouter,
  updateRouter,
  deleteRouter,
  testRouterConnection,
  syncOneRouter,
};
