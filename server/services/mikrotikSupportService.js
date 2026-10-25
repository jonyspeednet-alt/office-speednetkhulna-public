const pool = require('../utilities/db');
const { routerJsonRequest } = require('../utilities/routerJsonRequest');
const { print: apiPrint } = require('./routerosApiClient');
const { decryptRouterPassword } = require('./supportRouterCrypto');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const normalizePhone = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^01\d{9}$/.test(digits)) return digits;
  if (/^8801\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  return null;
};

const parseComment = (comment) => {
  const raw = String(comment || '').trim();
  const matches = raw.match(/(?:\+?880|0)1\d{9}/g) || [];
  const phones = [...new Set(matches.map(normalizePhone).filter(Boolean))];
  if (!raw) return { phone: null, alternatePhones: [], address: null, status: 'no_phone', confidence: 'low' };
  const withoutPhones = raw.replace(/(?:\+?880|0)1\d{9}/g, ' ').replace(/\b(phone|mobile|tel|ph|address|addr)\s*[:=-]?/gi, ' ').replace(/[|,;\-/]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const address = withoutPhones || null;
  const confidence = phones.length && address ? 'medium' : phones.length ? 'high' : 'low';
  return { phone: phones[0] || null, alternatePhones: phones.slice(1), address, status: phones[0] ? 'parsed' : 'review_required', confidence };
};

const encryptedDevicesPath = path.resolve(__dirname, '../../secrets/mikrotik_support_devices.enc.json');

const decryptDeviceConfig = (encrypted) => {
  const vaultRaw = process.env.ROUTER_VAULT_KEY;
  const legacySecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  const keys = [];
  if (vaultRaw && String(vaultRaw).trim()) keys.push(crypto.createHash('sha256').update(String(vaultRaw)).digest());
  if (legacySecret) keys.push(crypto.createHash('sha256').update(legacySecret).digest());
  if (!keys.length) throw new Error('Support device configuration cannot be unlocked: application secret is missing');
  if (!encrypted || encrypted.v !== 1 || !encrypted.iv || !encrypted.tag || !encrypted.data) {
    throw new Error('Support device configuration file is invalid');
  }
  for (const key of keys) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8');
  } catch { /* try next key (vault → legacy backward-compat) */ }
  }
  throw new Error('Support device configuration could not be unlocked');
};

const getDevicesFromEnv = () => {
  let raw = String(process.env.MIKROTIK_SUPPORT_DEVICES_JSON || '').trim();
  if (!raw && fs.existsSync(encryptedDevicesPath)) {
    raw = decryptDeviceConfig(JSON.parse(fs.readFileSync(encryptedDevicesPath, 'utf8')));
  }
  if (!raw) return [];
  try {
    const devices = JSON.parse(raw);
    return Array.isArray(devices) ? devices.filter((d) => d && d.id && (d.protocol === 'api' ? d.host : d.baseUrl) && d.username && d.password) : [];
  } catch {
    throw new Error('MIKROTIK_SUPPORT_DEVICES_JSON is not valid JSON');
  }
};

const getDevices = async () => {
  try {
    const result = await pool.query(
      `SELECT id, protocol, host, base_url AS "baseUrl", port, username, password_enc FROM mikrotik_routers WHERE is_active=TRUE ORDER BY id`
    );
    if (result.rows && result.rows.length) {
      const devices = [];
      for (const row of result.rows) {
        try {
          const password = decryptRouterPassword(row.password_enc);
          const device = { id: row.id, protocol: row.protocol, host: row.host, baseUrl: row.baseUrl, port: row.port, username: row.username, password };
          if (device.id && (device.protocol === 'api' ? device.host : device.baseUrl) && device.username && device.password) {
            devices.push(device);
          }
        } catch (error) {
          console.warn(`[SupportSync] skipping router ${row.id}: ${error.message}`);
        }
      }
      return devices;
    }
  } catch (error) {
    if (error && error.code === '42P01') {
      console.warn('[SupportSync] mikrotik_routers table missing, falling back to env config');
    } else if (error && /could not be unlocked|application secret is missing/i.test(error.message || '')) {
      console.warn(`[SupportSync] DB credential fallback: ${error.message}`);
    } else if (error) {
      console.warn(`[SupportSync] DB device lookup failed, falling back to env config: ${error.message}`);
    }
  }
  return getDevicesFromEnv();
};

const fetchRouterData = async (device) => {
  if (device.protocol === 'api') {
    const opts = { host: device.host, port: device.port || 8728, username: device.username, password: device.password };
    const [secrets, active, sessionsRaw, vlansRaw] = await Promise.all([
      apiPrint({ ...opts, command: '/ppp/secret/print', properties: ['name','profile','comment','service','remote-address','disabled'] }),
      apiPrint({ ...opts, command: '/ppp/active/print', properties: ['name'] }),
      apiPrint({ ...opts, command: '/interface/pppoe-server/print', properties: ['user','service','interface','uptime'] }).catch((error) => { console.warn(`[SupportSync] pppoe-server session lookup degraded: ${error.message}`); return []; }),
      apiPrint({ ...opts, command: '/interface/vlan/print', properties: ['name','vlan-id','interface'] }).catch((error) => { console.warn(`[SupportSync] vlan lookup degraded: ${error.message}`); return []; })
    ]);
    const vlanByName = new Map((Array.isArray(vlansRaw) ? vlansRaw : []).map((v) => [String(v.name || ''), v['vlan-id'] != null ? String(v['vlan-id']) : null]));
    const sessionByUser = new Map((Array.isArray(sessionsRaw) ? sessionsRaw : []).map((s) => [String(s.user || ''), s]));
    const activeNames = new Set(active.map((x) => String(x.name || '')));
    return secrets.map((secret) => {
      const username = String(secret.name || '').trim();
      const session = sessionByUser.get(String(secret.name || '')) || null;
      let vlanId = null;
      let vlanName = null;
      let sessionService = null;
      let sessionUptime = null;
      if (session) {
        vlanName = session.interface ? String(session.interface) : null;
        vlanId = (vlanName && vlanByName.get(vlanName)) || null;
        sessionService = session.service ? String(session.service) : null;
        sessionUptime = session.uptime ? String(session.uptime) : null;
      }
      return { username, profile:secret.profile||null, service:secret.service||null, remoteAddress:secret['remote-address']||null, disabled:String(secret.disabled||'false')==='true', comment:secret.comment||null, online:activeNames.has(String(secret.name||'')), vlanId, vlanName, sessionService, sessionUptime };
    }).filter((row)=>row.username);
  }
  const baseUrl = String(device.baseUrl).replace(/\/$/, '');
  const headers = { Authorization: `Basic ${Buffer.from(`${device.username}:${device.password}`).toString('base64')}` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const options = { headers, signal: controller.signal };
  let secretsRes;
  let activeRes;
  try {
    [secretsRes, activeRes] = await Promise.all([
      routerJsonRequest(`${baseUrl}/rest/ppp/secret`, options),
      routerJsonRequest(`${baseUrl}/rest/ppp/active`, options)
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (!secretsRes.ok) throw new Error(`PPP Secret API returned HTTP ${secretsRes.status}`);
  const secrets = await secretsRes.json();
  const active = activeRes.ok ? await activeRes.json() : [];
  // Session + VLAN enrichment is best-effort: timeout/failure degrades to nulls, never fails the sync.
  let sessionsRaw = [];
  let vlansRaw = [];
  try {
    const extraController = new AbortController();
    const extraTimer = setTimeout(() => extraController.abort(), 15000);
    try {
      const [sessionsRes, vlansRes] = await Promise.all([
        routerJsonRequest(`${baseUrl}/rest/interface/pppoe-server`, { headers, signal: extraController.signal }),
        routerJsonRequest(`${baseUrl}/rest/interface/vlan`, { headers, signal: extraController.signal })
      ]);
      if (sessionsRes.ok) sessionsRaw = await sessionsRes.json();
      if (vlansRes.ok) vlansRaw = await vlansRes.json();
    } finally {
      clearTimeout(extraTimer);
    }
  } catch (error) {
    console.warn(`[SupportSync] session/vlan lookup degraded: ${error.message}`);
    sessionsRaw = [];
    vlansRaw = [];
  }
  const vlanByName = new Map((Array.isArray(vlansRaw) ? vlansRaw : []).map((v) => [String(v.name || ''), v['vlan-id'] != null ? String(v['vlan-id']) : (v.vlanId != null ? String(v.vlanId) : null)]));
  const sessionByUser = new Map((Array.isArray(sessionsRaw) ? sessionsRaw : []).filter((s) => s && s.user != null).map((s) => [String(s.user || ''), s]));
  const activeNames = new Set((Array.isArray(active) ? active : []).map((x) => String(x.name || '')));
  return (Array.isArray(secrets) ? secrets : []).map((secret) => {
    const username = String(secret.name || '').trim();
    const session = sessionByUser.get(String(secret.name || '')) || null;
    let vlanId = null;
    let vlanName = null;
    let sessionService = null;
    let sessionUptime = null;
    if (session) {
      vlanName = session.interface ? String(session.interface) : null;
      vlanId = (vlanName && vlanByName.get(vlanName)) || null;
      sessionService = session.service ? String(session.service) : null;
      sessionUptime = session.uptime ? String(session.uptime) : null;
    }
    return {
      username, profile: secret.profile || null, service: secret.service || null,
      remoteAddress: secret['remote-address'] || null, disabled: String(secret.disabled || 'false') === 'true',
      comment: secret.comment || null, online: activeNames.has(String(secret.name || '')),
      vlanId, vlanName, sessionService, sessionUptime
    };
  }).filter((row) => row.username);
};

const syncDevice = async (device) => {
  const run = await pool.query(`INSERT INTO mikrotik_sync_runs (router_id, status) VALUES ($1, 'running') RETURNING id`, [device.id]);
  try {
    const records = await fetchRouterData(device);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The global API timeout is intentionally short; a one-time/full cache sync needs a wider DB window.
      await client.query("SET LOCAL statement_timeout = '120s'");
      const rows = records.map((row) => {
        const parsed = parseComment(row.comment);
        return { router_id: device.id, pppoe_username: row.username, package_profile: row.profile, service: row.service, remote_address: row.remoteAddress, disabled: row.disabled, is_online: row.online, comment_raw: row.comment, phone: parsed.phone, alternate_phones: parsed.alternatePhones, address: parsed.address, parse_status: parsed.status, parse_confidence: parsed.confidence, vlan_id: row.vlanId || null, vlan_name: row.vlanName || null, session_service: row.sessionService || null };
      });
      for (let offset = 0; offset < rows.length; offset += 50) {
        await client.query({ text: `WITH source AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(router_id text,pppoe_username text,package_profile text,service text,remote_address text,disabled boolean,is_online boolean,comment_raw text,phone text,alternate_phones jsonb,address text,parse_status text,parse_confidence text,vlan_id text,vlan_name text,session_service text))
          INSERT INTO network_customers (router_id,pppoe_username,package_profile,service,remote_address,disabled,is_online,comment_raw,phone,alternate_phones,address,parse_status,parse_confidence,vlan_id,vlan_name,session_service,last_synced_at,updated_at)
          SELECT router_id,pppoe_username,package_profile,service,remote_address,disabled,is_online,comment_raw,phone,alternate_phones,address,parse_status,parse_confidence,vlan_id,vlan_name,session_service,NOW(),NOW() FROM source
          ON CONFLICT (router_id,pppoe_username) DO UPDATE SET package_profile=EXCLUDED.package_profile,service=EXCLUDED.service,remote_address=EXCLUDED.remote_address,disabled=EXCLUDED.disabled,is_online=EXCLUDED.is_online,comment_raw=EXCLUDED.comment_raw,phone=CASE WHEN network_customers.manual_phone IS NULL THEN EXCLUDED.phone ELSE network_customers.phone END,alternate_phones=EXCLUDED.alternate_phones,address=CASE WHEN network_customers.manual_address IS NULL THEN EXCLUDED.address ELSE network_customers.address END,parse_status=EXCLUDED.parse_status,parse_confidence=EXCLUDED.parse_confidence,vlan_id=CASE WHEN EXCLUDED.vlan_id IS NULL THEN network_customers.vlan_id ELSE EXCLUDED.vlan_id END,vlan_name=CASE WHEN EXCLUDED.vlan_name IS NULL THEN network_customers.vlan_name ELSE EXCLUDED.vlan_name END,session_service=CASE WHEN EXCLUDED.session_service IS NULL THEN network_customers.session_service ELSE EXCLUDED.session_service END,last_synced_at=NOW(),updated_at=NOW()`, values: [JSON.stringify(rows.slice(offset, offset + 50))], query_timeout: 120000 });
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await pool.query(`UPDATE mikrotik_sync_runs SET status='completed', records_seen=$2, records_synced=$2, completed_at=NOW() WHERE id=$1`, [run.rows[0].id, records.length]);
    return { routerId: device.id, synced: records.length };
  } catch (error) {
    await pool.query(`UPDATE mikrotik_sync_runs SET status='failed', error_message=$2, completed_at=NOW() WHERE id=$1`, [run.rows[0].id, String(error.message).slice(0, 2000)]);
    throw error;
  }
};

const recordRouterSyncStatus = async (routerId, status, errorMessage) => {
  try {
    await pool.query(
      `UPDATE mikrotik_routers SET last_synced_at=NOW(), last_sync_status=$2, last_error=$3, updated_at=NOW() WHERE id=$1`,
      [routerId, status, errorMessage ? String(errorMessage).slice(0, 2000) : null]
    );
  } catch {
    // Best-effort only: table may not exist yet on older DBs. Silently skip.
  }
};

const syncConfiguredDevices = async ({ routerId = null } = {}) => {
  const allDevices = await getDevices();
  const devices = routerId ? allDevices.filter((d) => d.id === routerId) : allDevices;
  if (!devices.length) throw new Error('No MikroTik support device configured');
  const settled = await Promise.allSettled(
    devices.map(async (device) => {
      try {
        const result = await syncDevice(device);
        await recordRouterSyncStatus(device.id, 'completed', null);
        return result;
      } catch (error) {
        await recordRouterSyncStatus(device.id, 'failed', error.message);
        throw error;
      }
    })
  );
  const synced = [];
  const failed = [];
  for (let i = 0; i < settled.length; i += 1) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') synced.push(outcome.value);
    else failed.push({ routerId: devices[i].id, error: outcome.reason ? outcome.reason.message : 'Unknown error' });
  }
  if (synced.length === 0) {
    throw new Error(`MikroTik sync failed for all routers: ${failed.map((f) => `${f.routerId}: ${f.error}`).join('; ')}`);
  }
  return { synced, failed };
};

module.exports = { parseComment, getDevices, getDevicesFromEnv, syncDevice, fetchRouterData, syncConfiguredDevices };
