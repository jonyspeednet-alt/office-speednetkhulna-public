const pool = require('./db');

const SMS_API_URL = 'https://smsplus.sslwireless.com/api/v3/send-sms';
const BALANCE_API_URL = 'https://smsplus.sslwireless.com/api/v3/balance';
// Balance cache: the gateway is the source of truth, but the SMS tab polls
// this — avoid hammering the provider on every render.
const BALANCE_TTL_MS = 5 * 60 * 1000;
let balanceCache = { at: 0, data: null };

function gatewayCreds() {
  // Read live env (not only module-load consts) so a reloaded env file
  // is honored without a process restart where possible.
  return {
    token: (process.env.SMS_API_TOKEN || API_TOKEN || '').trim(),
    sid: process.env.SMS_SID || SID,
  };
}

function httpsGetJson(url) {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get(
      url,
      { headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ data: JSON.parse(body) });
          } catch (e) {
            resolve({ error: `Parse error: ${e.message}` });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(15000, () => req.destroy(new Error('Balance request timeout')));
  });
}

// Prepaid credit for the configured SID. Cached 5 min; on transient failure
// serves the last good value (marked stale) so the UI doesn't flap.
async function getSmsBalance({ force = false } = {}) {
  const now = Date.now();
  if (!force && balanceCache.data && now - balanceCache.at < BALANCE_TTL_MS) {
    return { ...balanceCache.data, cached: true };
  }
  const { token, sid } = gatewayCreds();
  if (!token) {
    return { available: false, balance: null, sid, error: 'SMS gateway not configured' };
  }
  const url = `${BALANCE_API_URL}?api_token=${encodeURIComponent(token)}&sid=${encodeURIComponent(sid)}`;
  const { data, error } = await httpsGetJson(url);
  if (error || !data || data.status !== 'SUCCESS') {
    if (balanceCache.data) return { ...balanceCache.data, cached: true, stale: true };
    return {
      available: false,
      balance: null,
      sid,
      error: String(error || data?.error_message || 'Balance check failed').substring(0, 120),
    };
  }
  const result = {
    available: true,
    balance: Number(data.balance),
    sid: data.sid || sid,
    checked_at: new Date().toISOString(),
  };
  balanceCache = { at: now, data: result };
  return { ...result, cached: false };
}
const SID = process.env.SMS_SID || 'SPEEDNET';
// Secret must come from env only — never hard-code a fallback (S3).
// Set SMS_API_TOKEN in secrets/.env / production env. Fail closed if missing.
const API_TOKEN = (process.env.SMS_API_TOKEN || '').trim();

function normalizeMsisdn(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[^0-9]/g, '');
  if (p.startsWith('880')) return p;
  if (p.startsWith('0')) return '88' + p;
  if (p.length === 10 || p.length === 11) return '880' + p.replace(/^0/, '');
  return '880' + p;
}

function genCsmsId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function sendSms({ msisdn, sms }) {
  if (!API_TOKEN) {
    console.error('[SMS] SMS_API_TOKEN is not configured — refusing to send');
    return { success: false, error: 'SMS gateway not configured', msisdn: msisdn || null };
  }
  const normalized = normalizeMsisdn(msisdn);
  if (!normalized) throw new Error('Invalid phone number');
  const csms_id = genCsmsId();
  const payload = JSON.stringify({
    api_token: API_TOKEN,
    sid: SID,
    msisdn: normalized,
    sms: String(sms).substring(0, 1000),
    csms_id,
  });
  return new Promise((resolve) => {
    const url = new URL(SMS_API_URL);
    const https = require('https');
    const req = https.request(
      { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const success = data.status === 'SUCCESS' && data.smsinfo?.[0]?.sms_status === 'SUCCESS';
            resolve({ success, data, csms_id, msisdn: normalized });
          } catch (e) {
            resolve({ success: false, error: `Parse error: ${e.message}`, data: body, csms_id, msisdn: normalized });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('[SMS] https error:', err.message);
      resolve({ success: false, error: err.message, csms_id, msisdn: normalized });
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('SMS request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function logSms({ recipient_phone, message_body, status, sent_by, reference_id }) {
  try {
    await pool.query(
      `INSERT INTO sms_logs (recipient_phone, message_body, status, sent_by) VALUES ($1,$2,$3,$4)`,
      [recipient_phone, message_body, status, sent_by || null]
    );
  } catch (e) {
    console.error('[SMS] logSms failed:', e.message);
  }
}

module.exports = { sendSms, logSms, normalizeMsisdn, getSmsBalance, SID, API_TOKEN };
