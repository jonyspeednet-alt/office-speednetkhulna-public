const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const dotenv = require('dotenv');

const envRoot = __dirname;
const modeEnvPath = path.join(envRoot, '.env');
if (fs.existsSync(modeEnvPath)) {
  dotenv.config({ path: modeEnvPath });
}

const {
  ensureClient,
  ensureSessionClient,
  reconnectClient,
  reconnectSession,
  closeClient,
  closeSession,
  disconnectSession,
  setQrListener,
  getStatus,
  getSessionStatus,
  getSessionsStatus,
  getSessionQr,
  getLatestQr,
  startSessionMonitor,
  sendApprovalNotification,
  sendTestMessage,
  sendTestImageMessage,
  sendTextMessage
} = require('./whatsappService');

const app = express();
const PORT = Number(process.env.PORT || 4010);
const apiKey = String(process.env.WHATSAPP_WORKER_API_KEY || '').trim();
// S8: never silently run without auth. In production refuse to boot;
// in dev fail closed per-request with a loud error.
if (!apiKey) {
  console.error('[Worker] FATAL: WHATSAPP_WORKER_API_KEY is not set — API auth would be disabled');
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') process.exit(1);
}
// S8: bind loopback by default; set WORKER_HOST=0.0.0.0 only if the worker
// must accept remote connections (then firewall it to the portal IP).
// Non-loopback needs explicit opt-in, mirroring the main API BIND_HOST rule.
const WORKER_HOST_RAW = String(process.env.WORKER_HOST || '127.0.0.1').trim() || '127.0.0.1';
const HOST = ['127.0.0.1', '::1', 'localhost'].includes(WORKER_HOST_RAW)
  ? WORKER_HOST_RAW
  : (String(process.env.ALLOW_PUBLIC_WORKER || '').toLowerCase() === 'true'
      ? WORKER_HOST_RAW
      : '127.0.0.1');
if (WORKER_HOST_RAW !== HOST) {
  console.error(`[Worker] FATAL: refusing unsafe WORKER_HOST=${WORKER_HOST_RAW} without ALLOW_PUBLIC_WORKER=true; using 127.0.0.1.`);
}
// Constant-time comparison on fixed-length digests (avoids length oracle)
const apiKeyDigest = apiKey ? crypto.createHash('sha256').update(apiKey, 'utf8').digest() : null;
const keysEqual = (incoming) => {
  if (!apiKeyDigest) return false;
  try {
    const d = crypto.createHash('sha256').update(String(incoming || ''), 'utf8').digest();
    return d.length === apiKeyDigest.length && crypto.timingSafeEqual(d, apiKeyDigest);
  } catch { return false; }
};
const mainPortalBaseUrl = String(process.env.MAIN_PORTAL_BASE_URL || 'https://office.speednetkhulna.com').trim().replace(/\/+$/, '');
const workerName = String(process.env.WHATSAPP_WORKER_NAME || 'office_whatsapp_worker').trim();
let stateBusy = false;

const launchClientInBackground = (session = 'leave', options = {}) => {
  ensureSessionClient(session, options).catch((error) => {
    console.error(`[Worker] Background start failed (${session}):`, error.message);
  });
};

process.on('unhandledRejection', (reason) => {
  const message = reason?.message || String(reason || 'Unknown rejection');
  console.error('[Worker] Unhandled rejection:', message);
});

process.on('uncaughtException', (error) => {
  console.error('[Worker] Uncaught exception:', error?.message || error);
});

app.use(compression());

// Restricted CORS: only allow main portal and localhost origins
// Root-trailing-dot form (`https://host.`) is the same DNS name as `https://host`
// and is the only form reachable from GP/BL mobile data — those ISPs silently
// drop any connection whose TLS SNI / HTTP Host matches `speednetkhulna.com`.
// Normalise both sides before the exact comparison; I8 still holds because the
// match stays exact on normalised values, so `office...attacker.tld` fails.
const normOrigin = (o) =>
  String(o || '').trim().replace(/\/+$/, '').toLowerCase()
    .replace(/^(https?:\/\/[^:/]+)\.(?=(:\d+)?$)/, '$1');
const allowedWorkerOrigins = [
  mainPortalBaseUrl,
  'http://localhost:4010',
  'http://127.0.0.1:4010',
].filter(Boolean).map(normOrigin);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    // I8: exact match only — startsWith would accept office...attacker.tld
    if (allowedWorkerOrigins.includes(normOrigin(origin))) {
      return callback(null, true);
    }
    console.error(`[Worker] CORS blocked for origin: ${origin}`);
    return callback(new Error('CORS blocked'));
  },
  credentials: true,
}));
// Authenticate before buffering/decompressing JSON. Health monitoring does not
// need a request body and remains public without entering the JSON parser.
const requireApiKey = (req, res, next) => {
  if (!apiKey) return res.status(503).json({ message: 'Worker auth not configured' });
  const incoming = String(req.headers['x-worker-api-key'] || '').trim();
  if (!incoming || !keysEqual(incoming)) {
    return res.status(401).json({ message: 'Unauthorized worker request' });
  }
  return next();
};
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'whatsapp-worker', timestamp: new Date().toISOString() });
});
app.use(requireApiKey);
app.use(bodyParser.json({ limit: '2mb' }));

const { createJsonRequester } = require('./boundedHttpJson');
const requestJson = createJsonRequester({ timeoutMs: 30000, label: 'Portal' });

const portalUrl = (endpoint) => `${mainPortalBaseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
const portalHeaders = () => apiKey ? { 'x-worker-api-key': apiKey } : {};

const pushWorkerState = async () => {
  if (stateBusy || !mainPortalBaseUrl || !apiKey) return;
  stateBusy = true;
  try {
    const status = getStatus();
    const qr = getLatestQr();
    await requestJson('POST', portalUrl('/api/internal/whatsapp-worker/state'), {
      ...status,
      hasQr: Boolean(qr?.hasQr),
      qr: qr?.qr || null,
      state: qr?.state || status.state
    }, portalHeaders());
    // Per-session states (leave + support) for the maintenance dashboard.
    const all = getSessionsStatus();
    for (const name of Object.keys(all.sessions || {})) {
      const s = all.sessions[name];
      await requestJson('POST', portalUrl('/api/internal/whatsapp-worker/state'), {
        ...s,
        session: name,
        hasQr: Boolean(s.hasQr),
        qr: s.qr || null,
      }, portalHeaders());
    }
  } catch (error) {
    console.error('[Worker] State sync failed:', error.message);
  } finally {
    stateBusy = false;
  }
};

const processJob = async (job) => {
  if (!job) return;
  const jobType = String(job.job_type || '');
  const payload = job.payload || {};

  if (jobType === 'start') {
    launchClientInBackground(payload.session || 'leave', { headless: payload.headless !== false });
    return;
  }
  if (jobType === 'ensure_session') {
    await ensureSessionClient(payload.session || 'support', { headless: payload.headless !== false });
    return;
  }
  if (jobType === 'reconnect') {
    await reconnectSession(payload.session || 'leave', { headless: payload.headless !== false }).catch((error) => {
      console.error('[Worker] Background reconnect failed:', error.message);
    });
    return;
  }
  if (jobType === 'stop') {
    await closeClient();
    return;
  }
  if (jobType === 'disconnect_session') {
    await disconnectSession(payload.session || 'leave');
    return;
  }
  if (jobType === 'send_approval') {
    await sendApprovalNotification(payload);
    return;
  }
  if (jobType === 'send_test') {
    await sendTestMessage(payload);
    return;
  }
  if (jobType === 'send_test_image') {
    await sendTestImageMessage(payload);
    return;
  }
  if (jobType === 'send_text') {
    await sendTextMessage(payload);
    return;
  }

  throw new Error(`Unknown worker job type: ${jobType}`);
};

const pollQueue = async (queue) => {
  const response = await requestJson('GET', portalUrl(`/api/internal/whatsapp-worker/jobs/next?worker=${encodeURIComponent(workerName)}&queue=${encodeURIComponent(queue)}`), null, portalHeaders());
  const job = response?.job || null;
  if (!job) return;
  try {
    await processJob(job);
    await requestJson('POST', portalUrl(`/api/internal/whatsapp-worker/jobs/${job.id}/complete`), {}, portalHeaders());
  } catch (error) {
    await requestJson('POST', portalUrl(`/api/internal/whatsapp-worker/jobs/${job.id}/fail`), {
      error: error.message || 'Worker job failed',
      retry: false
    }, portalHeaders());
    console.error('[Worker] Job processing failed:', error.message);
  }
};

const pollBusyByQueue = {};

const pollQueueGuarded = async (queue) => {
  if (pollBusyByQueue[queue]) return;
  pollBusyByQueue[queue] = true;
  try {
    await pollQueue(queue);
  } catch (error) {
    console.error(`[Worker] Job poll failed (${queue}):`, error.message);
  } finally {
    pollBusyByQueue[queue] = false;
    await pushWorkerState();
  }
};

const pollNextJob = async () => {
  if (!mainPortalBaseUrl || !apiKey) return;
  // Support lane stays responsive even while a slow leave job is processing.
  await Promise.allSettled([pollQueueGuarded('support'), pollQueueGuarded('leave')]);
};

app.get('/api/whatsapp/status', requireApiKey, async (req, res) => {
  try {
    if (req.query.session) return res.json(getSessionStatus(String(req.query.session)));
    res.json(getStatus());
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load status' });
  }
});

app.get('/api/whatsapp/sessions', requireApiKey, async (req, res) => {
  try {
    res.json(getSessionsStatus());
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load sessions' });
  }
});

app.get('/api/whatsapp/qr', requireApiKey, async (req, res) => {
  try {
    if (req.query.session) return res.json(getSessionQr(String(req.query.session)));
    res.json(getLatestQr());
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load QR' });
  }
});

app.post('/api/whatsapp/start', requireApiKey, async (req, res) => {
  try {
    const session = String(req.body?.session || req.query?.session || 'leave');
    await ensureSessionClient(session, { headless: req.body?.headless !== false });
    res.json({ message: 'WhatsApp connect started', status: getSessionStatus(session) });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to start WhatsApp client' });
  }
});

app.post('/api/whatsapp/reconnect', requireApiKey, async (req, res) => {
  try {
    const session = String(req.body?.session || req.query?.session || 'leave');
    await reconnectSession(session, { headless: req.body?.headless !== false });
    res.json({ message: 'WhatsApp reconnect started', status: getSessionStatus(session) });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to reconnect WhatsApp' });
  }
});

app.post('/api/whatsapp/stop', requireApiKey, async (req, res) => {
  try {
    const session = String(req.body?.session || req.query?.session || 'leave');
    await closeSession(session);
    res.json({ message: 'WhatsApp client stopped', status: getSessionStatus(session) });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to stop WhatsApp client' });
  }
});

app.post('/api/whatsapp/send-approval', requireApiKey, async (req, res) => {
  try {
    const approvalId = Number(req.body?.approvalId || 0);
    const payload = req.body?.payload || null;
    const groupName = req.body?.groupName || process.env.WHATSAPP_GROUP_NAME || '';
    if (!approvalId) {
      return res.status(400).json({ message: 'approvalId is required' });
    }
    const result = await sendApprovalNotification({ approvalId, payload, groupName });
    res.json({ message: 'Approval notification sent', result });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to send approval notification' });
  }
});

app.post('/api/whatsapp/send-test', requireApiKey, async (req, res) => {
  try {
    const groupName = req.body?.groupName || process.env.WHATSAPP_GROUP_NAME || '';
    const result = await sendTestMessage({ groupName });
    res.json({ message: 'Test message sent', result });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to send test message' });
  }
});

app.post('/api/whatsapp/send-test-image', requireApiKey, async (req, res) => {
  try {
    const groupName = req.body?.groupName || process.env.WHATSAPP_GROUP_NAME || '';
    const result = await sendTestImageMessage({ groupName });
    res.json({ message: 'Test image sent', result });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to send test image' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

app.listen(PORT, HOST, async () => {
  console.log(`[Worker] WhatsApp worker listening on http://${HOST}:${PORT}`);
  startSessionMonitor({ intervalMs: 60000, maxAutoAttempts: 5 });
  // Fresh QRs reach the portal within ~1s of rotation (not next 10s tick).
  setQrListener(() => {
    pushWorkerState().catch((error) => {
      console.error('[Worker] QR push error:', error.message);
    });
  });
  if (String(process.env.WHATSAPP_GROUP_NOTIFICATIONS_ENABLED || 'false').toLowerCase() === 'true') {
    launchClientInBackground('leave', { headless: true });
  }
  try {
    await pushWorkerState();
    console.log('[Worker] initial state push ok');
  } catch (error) {
    console.error('[Worker] initial state push failed:', error.message);
  }
  setInterval(() => {
    pollNextJob().catch((error) => {
      console.error('[Worker] Poll loop error:', error.message);
    });
  }, 5000);
  setInterval(() => {
    pushWorkerState().catch((error) => {
      console.error('[Worker] State loop error:', error.message);
    });
  }, 10000);
});

// Graceful shutdown: destroy WhatsApp clients first so Chromium releases
// SingletonLock/port before PM2's kill_timeout (30s). Without this, SIGKILL
// orphaned Chrome and the next boot hit stale-lock recovery.
let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] ${signal} received, destroying clients...`);
  try {
    const { closeSession } = require('./whatsappService');
    if (typeof closeSession === 'function') {
      await closeSession('leave').catch(() => {});
      await closeSession('support').catch(() => {});
    }
  } catch (error) {
    console.error('[Worker] shutdown destroy failed:', error.message);
  }
  process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
