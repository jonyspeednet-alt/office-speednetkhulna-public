const pool = require('../utilities/db');
const { print: apiPrint } = require('./routerosApiClient');
const { decryptRouterPassword } = require('./supportRouterCrypto');

const LIVE_TIMEOUT_MS = 8000;

const withTimeout = (promise, ms, message) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || 'Live status query timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const getRouterDevice = async (routerId) => {
  const result = await pool.query(
    `SELECT id,protocol,host,base_url,port,username,password_enc FROM mikrotik_routers WHERE id=$1 AND is_active=TRUE`,
    [routerId]
  );
  if (!result.rows || !result.rows.length) return null;
  const row = result.rows[0];
  const password = decryptRouterPassword(row.password_enc);
  return {
    id: row.id,
    protocol: row.protocol,
    host: row.host,
    baseUrl: row.base_url,
    port: row.port,
    username: row.username,
    password
  };
};

const emptyStatus = (overrides = {}) => ({
  found: false,
  online: false,
  ip: null,
  uptime: null,
  profile: null,
  service: null,
  interfaceName: null,
  disabled: false,
  remoteAddress: null,
  callerId: null,
  lastDisconnectReason: null,
  lastLoggedOut: null,
  ...overrides
});

const fetchApiStatus = async (device, pppoeUsername) => {
  const opts = { host: device.host, port: device.port || 8728, username: device.username, password: device.password };
  const [secrets, actives] = await Promise.all([
    apiPrint({
      ...opts,
      command: '/ppp/secret/print',
      properties: ['name', 'profile', 'disabled', 'remote-address', 'last-caller-id', 'last-disconnect-reason', 'last-logged-out'],
      queries: [`?name=${pppoeUsername}`]
    }),
    apiPrint({
      ...opts,
      command: '/ppp/active/print',
      properties: ['name', 'address', 'uptime', 'caller-id', 'service'],
      queries: [`?name=${pppoeUsername}`]
    })
  ]);
  const secret = (Array.isArray(secrets) ? secrets : []).find((s) => String(s.name || '') === pppoeUsername) || null;
  const active = (Array.isArray(actives) ? actives : []).find((a) => String(a.name || '') === pppoeUsername) || null;
  if (!secret) {
    return emptyStatus({
      online: !!active,
      ip: (active && active.address) || null,
      uptime: (active && active.uptime) || null,
      service: (active && active.service) || null,
      callerId: (active && active['caller-id']) || null
    });
  }
  return {
    found: true,
    online: !!active,
    ip: (active && active.address) || null,
    uptime: (active && active.uptime) || null,
    profile: secret.profile || null,
    service: (active && active.service) || null,
    interfaceName: null,
    disabled: String(secret.disabled || 'false') === 'true',
    remoteAddress: secret['remote-address'] || null,
    callerId: ((active && active['caller-id']) || secret['last-caller-id']) || null,
    lastDisconnectReason: secret['last-disconnect-reason'] || null,
    lastLoggedOut: secret['last-logged-out'] || null
  };
};

const restFetchJson = async (url, headers, signal) => {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`MikroTik REST returned HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const restQuerySingle = async (base, path, pppoeUsername, headers, signal) => {
  const filteredUrl = `${base}${path}?name=${encodeURIComponent(pppoeUsername)}`;
  try {
    const filtered = await restFetchJson(filteredUrl, headers, signal);
    // ALWAYS apply Node-side filter as safety (REST may ignore the query param).
    const match = filtered.find((x) => String((x && x.name) || '') === pppoeUsername) || null;
    if (match) return match;
    if (filtered.length === 0) {
      // Empty could mean "not found" OR "filtering unsupported and empty page".
      // Fall back to full list then filter in Node.
      const full = await restFetchJson(`${base}${path}`, headers, signal);
      return full.find((x) => String((x && x.name) || '') === pppoeUsername) || null;
    }
    // Non-empty but no Node-side match: server ignored filter and user truly absent.
    // Still try full list once in case of pagination quirks.
    const full = await restFetchJson(`${base}${path}`, headers, signal);
    return full.find((x) => String((x && x.name) || '') === pppoeUsername) || null;
  } catch (error) {
    // Filtered query failed (e.g. server rejects query param): fetch full then filter in Node.
    const full = await restFetchJson(`${base}${path}`, headers, signal);
    return full.find((x) => String((x && x.name) || '') === pppoeUsername) || null;
  }
};

const fetchRestStatus = async (device, pppoeUsername) => {
  const base = String(device.baseUrl).replace(/\/$/, '');
  const headers = { Authorization: `Basic ${Buffer.from(`${device.username}:${device.password}`).toString('base64')}` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const [secret, active] = await Promise.all([
      restQuerySingle(base, '/rest/ppp/secret', pppoeUsername, headers, controller.signal),
      restQuerySingle(base, '/rest/ppp/active', pppoeUsername, headers, controller.signal)
    ]);
    if (!secret) {
      return emptyStatus({
        online: !!active,
        ip: (active && active.address) || null,
        uptime: (active && active.uptime) || null,
        service: (active && active.service) || null,
        callerId: (active && active['caller-id']) || null
      });
    }
    return {
      found: true,
      online: !!active,
      ip: (active && active.address) || null,
      uptime: (active && active.uptime) || null,
      profile: secret.profile || null,
      service: (active && active.service) || null,
      interfaceName: null,
      disabled: String(secret.disabled || 'false') === 'true',
      remoteAddress: secret['remote-address'] || null,
      callerId: ((active && active['caller-id']) || secret['last-caller-id']) || null,
      lastDisconnectReason: secret['last-disconnect-reason'] || null,
      lastLoggedOut: secret['last-logged-out'] || null
    };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('Live status query timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const fetchLiveUserStatus = async (device, pppoeUsername) => {
  const username = String(pppoeUsername || '').trim();
  if (!device || !username) throw new Error('Device and PPPoE username are required');
  const task = device.protocol === 'api'
    ? fetchApiStatus(device, username)
    : fetchRestStatus(device, username);
  return withTimeout(task, LIVE_TIMEOUT_MS, 'Live status query timed out');
};

module.exports = { getRouterDevice, fetchLiveUserStatus };
