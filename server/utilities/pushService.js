// Push notifications (FCM) for the technician mobile app.
//
// Credentials (either one):
//   FIREBASE_SERVICE_ACCOUNT_JSON=/inline JSON of the service-account key/
//   GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json/
// If neither is set, all sends are skipped silently (SMS flow is unaffected).
const pool = require('./db');

let messaging = null;
let initAttempted = false;

const getMessaging = () => {
  if (initAttempted) return messaging;
  initAttempted = true;
  try {
    // firebase-admin v12+ modular API (admin.apps no longer exists)
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getMessaging: getFcm } = require('firebase-admin/messaging');
    if (getApps().length) {
      messaging = getFcm();
      return messaging;
    }
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (inline) {
      initializeApp({ credential: cert(JSON.parse(inline)) });
    } else if (credPath) {
      initializeApp({ credential: cert(require(credPath)) });
    } else {
      console.log('[Push] no Firebase credentials configured — push disabled');
      return null;
    }
    messaging = getFcm();
    console.log('[Push] FCM initialized');
  } catch (error) {
    console.error('[Push] init failed:', error.message);
    messaging = null;
  }
  return messaging;
};

const isPushConfigured = () => !!getMessaging();

const registerDeviceToken = async (userId, fcmToken, platform = null) => {
  const token = String(fcmToken || '').trim();
  if (!userId || !token) throw new Error('userId and fcmToken are required');
  const plat = platform ? String(platform).toLowerCase().substring(0, 20) : null;
  await pool.query(
    `INSERT INTO device_tokens (user_id, fcm_token, platform, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (fcm_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()`,
    [Number(userId), token, plat]
  );
};

const removeDeviceToken = async (fcmToken) => {
  await pool.query('DELETE FROM device_tokens WHERE fcm_token = $1', [String(fcmToken || '').trim()]);
};

const isExpoToken = (t) => String(t || '').trim().startsWith('ExponentPushToken');

const sendExpoPush = (tokens, { title, body, data = {} } = {}) => {
  const messages = tokens.map((to) => ({ to, title: String(title || 'SpeedNet'), body: String(body || ''), data }));
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const payload = JSON.stringify(messages);
      const req = https.request(
        { hostname: 'exp.host', path: '/--/api/v2/push/send', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              const receipts = Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed) ? parsed : []);
              let sent = 0;
              receipts.forEach((r) => { if (r && r.status === 'ok') sent += 1; });
              resolve({ sent, failed: messages.length - sent });
            } catch {
              resolve({ sent: 0, failed: messages.length });
            }
          });
        }
      );
      req.on('error', (err) => {
        console.error('[Push] expo send failed:', err.message);
        resolve({ sent: 0, failed: messages.length, error: err.message });
      });
      req.setTimeout(15000, () => req.destroy(new Error('Expo push timeout')));
      req.write(payload);
      req.end();
    } catch (error) {
      console.error('[Push] expo send failed:', error.message);
      resolve({ sent: 0, failed: messages.length, error: error.message });
    }
  });
};

const sendPushToTokens = async (tokens, { title, body, data = {} } = {}) => {
  const list = [...new Set((tokens || []).map((t) => String(t || '').trim()).filter(Boolean))];
  if (!list.length) return { sent: 0, failed: 0 };
  const expoTokens = list.filter(isExpoToken);
  const fcmTokens = list.filter((t) => !isExpoToken(t));
  let sent = 0;
  let failed = 0;
  // Expo Push API path (never swept as FCM dead tokens)
  if (expoTokens.length) {
    const r = await sendExpoPush(expoTokens, { title, body, data });
    sent += r.sent || 0;
    failed += r.failed || 0;
  }
  if (!fcmTokens.length) return { sent, failed };
  const svc = getMessaging();
  if (!svc) return { sent, failed, skipped: true };
  const stringData = {};
  for (const [k, v] of Object.entries(data || {})) stringData[String(k)] = String(v ?? '');
  try {
    const res = await svc.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title: String(title || 'SpeedNet'), body: String(body || '') },
      data: stringData,
    });
    // Drop dead tokens so future sends stay clean (FCM-invalid only; Expo tokens never swept here).
    const dead = [];
    (res.responses || []).forEach((r, i) => {
      if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code)) {
        dead.push(fcmTokens[i]);
      }
    });
    if (dead.length) {
      await pool.query('DELETE FROM device_tokens WHERE fcm_token = ANY($1::text[])', [dead]);
    }
    return { sent: sent + (res.successCount || 0), failed: failed + (res.failureCount || 0) };
  } catch (error) {
    console.error('[Push] send failed:', error.message);
    return { sent, failed: failed + fcmTokens.length, error: error.message };
  }
};

const sendPushToUser = async (userId, payload) => {
  if (!userId) return { sent: 0, failed: 0 };
  try {
    const r = await pool.query('SELECT fcm_token FROM device_tokens WHERE user_id = $1', [Number(userId)]);
    return sendPushToTokens(r.rows.map((x) => x.fcm_token), payload);
  } catch (error) {
    console.error('[Push] token lookup failed:', error.message);
    return { sent: 0, failed: 0, error: error.message };
  }
};

module.exports = { isPushConfigured, registerDeviceToken, removeDeviceToken, sendPushToTokens, sendPushToUser };
