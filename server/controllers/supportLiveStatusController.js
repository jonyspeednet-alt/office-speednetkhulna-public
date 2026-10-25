const pool = require('../utilities/db');
const { success, fail, notFound, serverError } = require('../utilities/apiResponse');
const { getRouterDevice, fetchLiveUserStatus } = require('../services/mikrotikLiveStatusService');

const CACHE_TTL_MS = 90_000;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_LIMIT = 10;

const ERROR_BUCKETS = new Set(['TIMEOUT', 'UNREACHABLE', 'AUTH', 'NOT_FOUND_ON_ROUTER', 'ROUTER_INACTIVE']);

// customerId -> { payload, at } (payload = last live/db-fallback response data)
const liveCache = new Map();
// cacheKey -> Promise<responseData> (coalesce concurrent live fetches)
const inflight = new Map();
// userId -> number[] (epoch ms of live-fetch attempts, sliding 60s window)
const userStamps = new Map();

const parseSnapshot = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

const checkThrottle = (userId) => {
  const key = String(userId || 'anon');
  const now = Date.now();
  const cutoff = now - THROTTLE_WINDOW_MS;
  const stamps = (userStamps.get(key) || []).filter((t) => t > cutoff);
  if (stamps.length >= THROTTLE_LIMIT) {
    userStamps.set(key, stamps);
    return false;
  }
  stamps.push(now);
  userStamps.set(key, stamps);
  return true;
};

// Map any underlying failure to a safe enum bucket. Never leaks raw messages,
// hosts, usernames, or passwords to the client.
const classifyError = (err) => {
  if (err && (err.code === 'ROUTER_INACTIVE' || /router (missing|inactive|not found)/i.test(String(err.message || '')))) return 'ROUTER_INACTIVE';
  const msg = String((err && (err.code || err.message)) || err || '').toUpperCase();
  if (/ETIMEDOUT|ECONNABORTED|TIMEOUT|TIMED OUT/.test(msg)) return 'TIMEOUT';
  if (/EAUTH|AUTH|LOGIN FAIL|INVALID USER|WRONG PASSWORD|UNAUTHOR/.test(msg)) return 'AUTH';
  if (/NOT FOUND|NO SUCH|NOT_FOUND_ON_ROUTER/.test(msg)) return 'NOT_FOUND_ON_ROUTER';
  return 'UNREACHABLE';
};

const toLiveOrNull = (raw, fallbackStatus) => {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return null;
  };
  let status = pick('status');
  if (!ERROR_BUCKETS.has(status) && !['online', 'offline', 'disabled', 'unknown'].includes(status)) status = null;
  if (!status) {
    if (raw.disabled === true || String(raw.disabled || '').toLowerCase() === 'true') status = 'disabled';
    else if (raw.online === true || String(raw.online || '').toLowerCase() === 'true') status = 'online';
    else if (raw.online === false || String(raw.online || '').toLowerCase() === 'false') status = 'offline';
    else status = fallbackStatus || 'unknown';
  }
  const ip = pick('ip', 'address', 'remoteAddress', 'remote-address', 'remote_address');
  return {
    status,
    ip,
    uptime: pick('uptime', 'sessionUptime', 'session_uptime'),
    profile: pick('profile', 'package_profile'),
    service: pick('service', 'sessionService', 'session_service'),
    remoteAddress: pick('remoteAddress', 'remote-address', 'remote_address') || ip,
    callerId: pick('callerId', 'caller-id', 'caller_id'),
    lastDisconnectReason: pick('lastDisconnectReason', 'last-disconnect-reason', 'last_disconnect_reason'),
    lastLoggedOut: pick('lastLoggedOut', 'last-logged-out', 'last_logged_out'),
  };
};

const getTicketLiveStatus = async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!/^\d+$/.test(rawId)) return fail(res, 'Invalid ticket ID', 400);
    const ticketId = Number(rawId);

    const ticketRes = await pool.query(
      'SELECT id, customer_id, customer_snapshot FROM support_tickets WHERE id=$1',
      [ticketId]
    );
    if (!ticketRes.rowCount) return notFound(res, 'Ticket not found.');
    const ticket = ticketRes.rows[0];
    const snapshot = parseSnapshot(ticket.customer_snapshot);

    // Prefer live network_customers row; fall back to the ticket snapshot.
    let customerRow = null;
    if (ticket.customer_id !== null && ticket.customer_id !== undefined) {
      const custRes = await pool.query(
        'SELECT id, router_id, pppoe_username, is_online, disabled, last_synced_at FROM network_customers WHERE id=$1',
        [ticket.customer_id]
      );
      if (custRes.rowCount) customerRow = custRes.rows[0];
    }

    const pppoeUsername = customerRow
      ? customerRow.pppoe_username
      : (snapshot.pppoe_username || snapshot.username || null);
    const routerId = customerRow
      ? customerRow.router_id
      : (snapshot.router_id || snapshot.routerId || null);

    if (!pppoeUsername) return notFound(res, 'Customer not found.');

    const cacheKey = customerRow ? `customer:${customerRow.id}` : `ticket:${ticketId}`;
    const now = Date.now();

    // 90s cache: serve stale-safe snapshot without touching the router.
    const cached = liveCache.get(cacheKey);
    if (cached && (now - cached.at) < CACHE_TTL_MS) {
      return success(res, { ...cached.payload, source: 'cache', cached: true });
    }

    // Coalesce concurrent live fetches for the same customer.
    if (inflight.has(cacheKey)) {
      try {
        const shared = await inflight.get(cacheKey);
        return success(res, shared);
      } catch { /* fall through to a fresh attempt */ }
    }

    // Per-user throttle applies to live fetches only (cache hits bypass).
    if (!checkThrottle(req.user && req.user.id)) {
      return fail(res, 'Live status rate limit exceeded (10/min). Try again shortly.', 429);
    }

    const fetchPromise = (async () => {
      const fetchedAt = new Date().toISOString();
      const base = {
        ticket_id: ticketId,
        pppoe_username: String(pppoeUsername),
        router_id: routerId ? String(routerId) : null,
        router_label: null,
        live: null,
        db_fallback: customerRow
          ? { is_online: customerRow.is_online, disabled: customerRow.disabled, last_synced_at: customerRow.last_synced_at }
          : {
              is_online: snapshot.is_online ?? null,
              disabled: snapshot.disabled ?? null,
              last_synced_at: snapshot.last_synced_at ?? null,
            },
        source: 'db-fallback',
        cached: false,
        fetched_at: fetchedAt,
        router_reachable: false,
        error: null,
      };

      try {
        if (typeof getRouterDevice !== 'function' || typeof fetchLiveUserStatus !== 'function') {
          throw Object.assign(new Error('live status service unavailable'), { code: 'UNREACHABLE' });
        }
        const device = await getRouterDevice(base.router_id);
        if (device && (device.label || device.name)) base.router_label = String(device.label || device.name);
        if (!base.router_label && base.router_id) {
          try {
            const labelRes = await pool.query('SELECT label FROM mikrotik_routers WHERE id=$1', [base.router_id]);
            if (labelRes.rowCount) base.router_label = labelRes.rows[0].label;
          } catch { /* label stays null; never fail the request for it */ }
        }
        if (!device) throw Object.assign(new Error('router missing or inactive'), { code: 'ROUTER_INACTIVE' });
        const liveRaw = await fetchLiveUserStatus(device, base.pppoe_username);

        // Router answered but has no such user: still 200, unknown + enum error.
        if (!liveRaw || liveRaw.found === false) {
          base.live = toLiveOrNull(liveRaw, 'unknown') || {
            status: 'unknown', ip: null, uptime: null, profile: null, service: null,
            remoteAddress: null, callerId: null, lastDisconnectReason: null, lastLoggedOut: null,
          };
          base.live.status = 'unknown';
          base.error = 'NOT_FOUND_ON_ROUTER';
          base.source = 'live';
          base.router_reachable = true;
        } else {
          base.live = toLiveOrNull(liveRaw, 'unknown');
          base.error = null;
          base.source = 'live';
          base.router_reachable = true;
        }
      } catch (err) {
        base.source = 'db-fallback';
        base.router_reachable = false;
        const bucket = classifyError(err);
        base.error = ERROR_BUCKETS.has(bucket) ? bucket : 'UNREACHABLE';
        if (!base.live) base.live = null;
      }

      liveCache.set(cacheKey, { payload: { ...base }, at: Date.now() });
      return base;
    })();

    inflight.set(cacheKey, fetchPromise);
    try {
      const payload = await fetchPromise;
      return success(res, payload);
    } finally {
      if (inflight.get(cacheKey) === fetchPromise) inflight.delete(cacheKey);
    }
  } catch (error) { return serverError(res, error); }
};

module.exports = { getTicketLiveStatus };
