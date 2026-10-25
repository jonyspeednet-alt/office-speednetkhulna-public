// server/index.js — PERN Stack Express API Server (entry point)
// Full logic is split into: config/env.js, config/cors.js,
//   middleware/index.js, routes/index.js
// This file wires everything together and starts the HTTP server.

const express = require('express');
const path = require('path');
const fs = require('fs');

const {
    PORT,
    fatalOnUnhandled,
    readyGracePeriodMs,
    readyProbeRetries,
    serverKeepAliveTimeoutMs,
    serverHeadersTimeoutMs,
    serverRequestTimeoutMs,
} = require('./config/env');

const db = require('./utilities/db');
const { initAuditLogTable } = require('./utilities/auditLogger');
const { initWhatsAppWorkerTables } = require('./utilities/whatsappWorkerQueue');
const { initChannelPartnerTables } = require('./utilities/channelPartnerInit');
const { initPartnerOnboardingTables } = require('./utilities/partnerOnboardingInit');
const { initResellerFinancialAuditTable } = require('./utilities/resellerFinancialAudit');
const { initAppErrorsTable, logAppError } = require('./utilities/errorLogger');
const { initSupportTables } = require('./utilities/supportInit');
const { start3cxCdrReceiver } = require('./utilities/threecxCdrReceiver');
const { ensureClient: ensureWhatsAppClient } = require('./services/whatsappNotificationService');
const { applyMiddleware } = require('./middleware/index');
const apiRoutes = require('./routes/index');

// ── Helpers ────────────────────────────────────────────────
const isTransientDbError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '');
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '08006', '08001'].includes(code)) return true;
    return msg.includes('connection terminated') || msg.includes('timeout') || msg.includes('database is not reachable');
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastReadySuccessAt = Date.now();
const probeDatabaseReady = async () => {
    let lastError = null;
    for (let attempt = 1; attempt <= readyProbeRetries; attempt += 1) {
        const startedAt = Date.now();
        try {
            await db.query('SELECT 1');
            return { ok: true, latencyMs: Date.now() - startedAt, attempts: attempt };
        } catch (error) {
            lastError = error;
            if (attempt < readyProbeRetries) await wait(120 * attempt);
        }
    }
    return { ok: false, error: lastError };
};

// ── App Setup ──────────────────────────────────────────────
const app = express();

// Trust proxy: only loopback by default. Any other value makes req.ip
// client-spoofable via X-Forwarded-For, silently defeating ALL rate
// limiters + audit-IP attribution. Fail closed on unknown values.
const TRUST_PROXY_ALLOW = new Set(['loopback', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
const trustProxyRaw = String(process.env.TRUST_PROXY || 'loopback').trim();
const trustProxyValue = TRUST_PROXY_ALLOW.has(trustProxyRaw) ? trustProxyRaw : 'loopback';
if (trustProxyRaw !== trustProxyValue) {
    console.error(`[FATAL] Refusing unsafe TRUST_PROXY=${trustProxyRaw}; falling back to 'loopback'.`);
}
app.set('trust proxy', trustProxyValue);

// Init DB tables (best-effort) — all additive, no existing data touched
initAuditLogTable();
initWhatsAppWorkerTables();
initChannelPartnerTables();
initPartnerOnboardingTables();
initResellerFinancialAuditTable();
initAppErrorsTable();
const supportTablesReady = initSupportTables();

// Auto-migration: add token_version column if missing (best-effort)
(async () => {
  try {
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0");
    await db.query("CREATE INDEX IF NOT EXISTS idx_users_token_version ON users (token_version)");
    console.log('[DB] token_version column verified');
  } catch (err) {
    console.warn('[DB] token_version migration skipped (manual migration may be needed):', err.message);
  }
  // Forced password change for randomly-generated reseller passwords
  try {
    await db.query("ALTER TABLE resellers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE");
    console.log('[DB] resellers.must_change_password verified');
  } catch (err) {
    console.warn('[DB] must_change_password migration skipped:', err.message);
  }
  // Same flag for employee legacy phone-as-password auto-upgrades
  try {
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE");
    console.log('[DB] users.must_change_password verified');
  } catch (err) {
    console.warn('[DB] users.must_change_password migration skipped:', err.message);
  }
  // Partner session invalidation counter (mirrors users.token_version)
  try {
    await db.query("ALTER TABLE resellers ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] resellers.token_version verified');
  } catch (err) {
    console.warn('[DB] resellers.token_version migration skipped:', err.message);
  }
  // NID privacy: existing scans lack the nid- prefix the /uploads gate keys
  // on. Rename once (best-effort, idempotent — skips missing/done files).
  try {
    const r = await db.query("SELECT id, nid_pic FROM users WHERE nid_pic IS NOT NULL AND nid_pic NOT LIKE 'nid-%'");
    if (r.rows.length) {
      const path = require('path');
      const fs = require('fs');
      const dir = path.join(__dirname, '../uploads');
      let moved = 0;
      for (const row of r.rows) {
        try {
          const base = path.basename(String(row.nid_pic || ''));
          if (!base || base.startsWith('nid-')) continue;
          const from = path.join(dir, base);
          const to = path.join(dir, 'nid-' + base);
          if (fs.existsSync(from) && !fs.existsSync(to)) {
            fs.renameSync(from, to);
            await db.query('UPDATE users SET nid_pic = $1 WHERE id = $2', ['nid-' + base, row.id]);
            moved++;
          } else if (fs.existsSync(to)) {
            await db.query('UPDATE users SET nid_pic = $1 WHERE id = $2', ['nid-' + base, row.id]);
            moved++;
          }
        } catch (_) {}
      }
      if (moved) console.log(`[DB] nid- prefix migration: ${moved} file(s) gated`);
    }
  } catch (err) {
    console.warn('[DB] nid- prefix migration skipped:', err.message);
  }
})();

// Start cron jobs — only on the primary instance (PORT 5000 local dev / 5002 prod office-api-a).
// Both PM2 apps run this same file, so without this guard every cron fires twice.
// Note: use the `PORT` constant from config/env (captured pre-dotenv), not
// process.env.PORT directly — loadEnv() overwrites process.env.PORT from
// server/.env for every instance, masking the PM2-assigned port.
if (String(PORT) === '5000' || String(PORT) === '5002') {
  const { startReconciliationCron } = require('./cron/reconciliationCron');
  startReconciliationCron();

  const { startAuditLogCleanupCron } = require('./cron/auditLogCleanupCron');
  startAuditLogCleanupCron();
  const { startErrorLogCleanupCron } = require('./cron/errorLogCleanupCron');
  startErrorLogCleanupCron();
  const { startLoginVelocityAlertCron } = require('./cron/loginVelocityAlertCron');
  startLoginVelocityAlertCron();
  const { startMikrotikSupportSyncCron } = require('./cron/mikrotikSupportSyncCron');
  startMikrotikSupportSyncCron();
  const { startMaximSyncCron } = require('./cron/maximSyncCron');
  startMaximSyncCron();

  const { startWhatsAppJobCleanupCron } = require('./cron/whatsappJobCleanupCron');
  startWhatsAppJobCleanupCron();
} else {
  console.log(`Cron jobs skipped on this instance (PORT=${PORT})`);
}

// Apply all middleware
applyMiddleware(app);

// Mount all API routes
app.use('/api', apiRoutes);

// ── Health Checks ──────────────────────────────────────────
app.get('/api/health/live', (req, res) => {
    res.json({ status: 'OK', check: 'live', timestamp: new Date().toISOString() });
});

// /ready does a live DB probe per request with no auth — cap it so one host
// can't burn the pool without ever touching the login limiters. Monitoring
// (watchdog 10s + synthetic 30s) sits far below 60/min/IP.
const { rateLimit: readyRateLimit, ipKeyGenerator: readyIpKey } = require('express-rate-limit');
const readyProbeLimiter = readyRateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => readyIpKey(req.ip),
    handler: (req, res) => res.status(429).json({ status: 'Busy', check: 'ready' }),
});

app.get('/api/health/ready', readyProbeLimiter, async (req, res) => {
    const probe = await probeDatabaseReady();
    if (probe.ok) {
        lastReadySuccessAt = Date.now();
        // No pid/port/db-internals — topology intel stays server-side.
        return res.json({ status: 'OK', check: 'ready', timestamp: new Date().toISOString() });
    }
    const elapsed = Date.now() - lastReadySuccessAt;
    if (elapsed <= readyGracePeriodMs) {
        return res.json({ status: 'DEGRADED', check: 'ready', message: 'Database probe failed, serving within readiness grace window', grace_remaining_ms: Math.max(0, readyGracePeriodMs - elapsed), timestamp: new Date().toISOString() });
    }
    return res.status(503).json({ status: 'Error', check: 'ready', message: 'Database is not reachable', timestamp: new Date().toISOString() });
});

app.get('/api/health', async (req, res) => {
    // Public liveness only — no DB/pool/env detail (see /api/health/ready for internals)
    res.json({
        status: 'OK',
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// ── Uploaded Files ─────────────────────────────────────────
// NOTE: /uploads static serving lives in middleware/index.js (hardened:
// nosniff + attachment for non-images). No second mount here — a duplicate
// unhardened express.static would bypass those headers.

// ── Static Frontend Files (host-based: office vs partner portal) ──
// partner.speednetkhulna.com is reverse-proxied to this same Node app and
// gets its own SPA build; every other host gets the office SPA.
const frontendDistPath = path.join(__dirname, '../client/dist');
const partnerDistPath = path.join(__dirname, '../client-partner/dist');
const isPartnerHost = (req) =>
    String(req.hostname || '').toLowerCase().startsWith('partner.');

const staticOpts = {
    index: false,
    maxAge: '30d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
    },
};
const officeStatic = fs.existsSync(frontendDistPath)
    ? express.static(frontendDistPath, staticOpts)
    : null;
const partnerStatic = fs.existsSync(partnerDistPath)
    ? express.static(partnerDistPath, staticOpts)
    : null;

app.use((req, res, next) => {
    if (isPartnerHost(req) && partnerStatic) return partnerStatic(req, res, next);
    if (officeStatic) return officeStatic(req, res, next);
    next();
});

// -- Well-known: security.txt (must be before SPA fallback) --
app.get('/.well-known/security.txt', (req, res) => {
    const candidates = [
        path.join(frontendDistPath, '.well-known', 'security.txt'),
        path.join(__dirname, '../client/public/.well-known/security.txt'),
        path.join(__dirname, '../client/dist/.well-known/security.txt'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try {
                const content = fs.readFileSync(p, 'utf8');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.send(content);
            } catch (e) {
                console.error('[well-known] read failed', p, e.message);
            }
        }
    }
    res.type('text/plain').send(`Contact: mailto:security@speednetkhulna.com
Contact: https://speednetkhulna.com/contact
Expires: 2027-09-03T00:00:00.000Z
Preferred-Languages: en, bn
Canonical: https://office.speednetkhulna.com/.well-known/security.txt
`);
});
app.get('/.well-known/:any', (req, res) => res.status(404).type('text/plain').send('Not Found'));

// ── Frontend SPA Fallback (host-based) ─────────────────────
const frontendIndexPath = path.join(frontendDistPath, 'index.html');
const partnerIndexPath = path.join(partnerDistPath, 'index.html');
app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/.well-known/')) return next();

    const indexPath = isPartnerHost(req) && fs.existsSync(partnerIndexPath)
        ? partnerIndexPath
        : frontendIndexPath;

    if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.sendFile(indexPath, (err) => { if (err) next(err); });
    }
    res.status(req.path === '/' ? 200 : 404).json({
        status: req.path === '/' ? 'OK' : 'Not Found',
        message: req.path === '/' ? 'Speednet Office Management API is running' : 'Endpoint not found',
        health_check: '/api/health',
    });
});

// ── Unified Error Handlers ────────────────────────────────
const { fail, serverError } = require('./utilities/apiResponse');
app.use((req, res) => fail(res, `Not Found: ${req.path}`, 404));
app.use((err, req, res, next) => {
    if (err.status === 403 && err.message === 'CORS blocked for this origin') {
        return res.status(403).json({ message: 'Origin not allowed' });
    }
    console.error('Server Error:', err);
    res.locals.auditError = err.message || 'Unhandled server error';
    logAppError('request', err, { routePath: req.originalUrl, httpMethod: req.method, userId: req.user?.id });
    // Generic in prod — never leak err.message/stack to the client
    serverError(res, err);
});

// ── Process Error Handling ─────────────────────────────────
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    logAppError('uncaughtException', err);
    if (isTransientDbError(err)) return console.warn('Transient DB error; process kept alive.');
    // Always exit on non-transient uncaught exceptions to prevent corrupted state
    setTimeout(() => process.exit(1), 50);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    logAppError('unhandledRejection', reason);
    if (isTransientDbError(reason)) return console.warn('Transient DB rejection; process kept alive.');
    // Always exit on non-transient unhandled rejections
    setTimeout(() => process.exit(1), 50);
});

// ── Start Server ───────────────────────────────────────────
// Bind loopback by default — nginx proxies via 127.0.0.1 on the same host.
// Direct-to-5002/5003 bypasses all nginx layers, so never expose 0.0.0.0
// unless behind a firewall. Non-loopback needs explicit opt-in.
const BIND_HOST_RAW = String(process.env.BIND_HOST || '127.0.0.1').trim();
const BIND_HOST = ['127.0.0.1', '::1', 'localhost'].includes(BIND_HOST_RAW)
  ? BIND_HOST_RAW
  : (String(process.env.ALLOW_PUBLIC_BIND || '').toLowerCase() === 'true'
      ? BIND_HOST_RAW
      : '127.0.0.1');
if (BIND_HOST_RAW !== BIND_HOST) {
    console.error(`[FATAL] Refusing unsafe BIND_HOST=${BIND_HOST_RAW} without ALLOW_PUBLIC_BIND=true; using 127.0.0.1.`);
}
const server = app.listen(PORT, BIND_HOST, () => {
    console.log(`\n✅ Express API Server running on http://localhost:${PORT}`);
    console.log(`📊 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`⚛️  React Frontend: http://localhost:5173\n`);
});

supportTablesReady.then(() => start3cxCdrReceiver()).catch((error) => {
    console.error('[3CX CDR] receiver was not started:', error.message);
});

server.keepAliveTimeout = serverKeepAliveTimeoutMs;
server.headersTimeout = serverHeadersTimeoutMs;
if ('requestTimeout' in server) server.requestTimeout = serverRequestTimeoutMs;

// B21: one LocalAuth dir must be owned by ONE process. office-api-a (:5000) is
// the primary — instance B (:5001) must not launch a second Chromium on the
// same session (profile corruption + 2× memory against the 512 MB cap).
// Override explicitly with WHATSAPP_LOCAL_PRIMARY=true when needed.
const whatsappLocalPrimary =
  String(process.env.WHATSAPP_LOCAL_PRIMARY || '').toLowerCase() === 'true' ||
  String(process.env.PORT || '5000') === '5000';
if (String(process.env.WHATSAPP_GROUP_NOTIFICATIONS_ENABLED || 'false').toLowerCase() === 'true') {
    if (!whatsappLocalPrimary) {
      console.log('[WhatsApp] Auto-init skipped: not the primary instance (PORT 5000).');
    } else {
      console.log('[WhatsApp] Auto-init enabled. Starting approval notification client...');
      ensureWhatsAppClient().catch((err) => console.error('[WhatsApp] Startup init failed:', err.message));
    }
}

// ── Graceful Shutdown ─────────────────────────────────────
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    server.close(async () => {
        console.log('HTTP server closed.');
        try {
            await db.end();
            console.log('Database pool closed.');
        } catch (err) {
            console.error('Error closing database pool:', err.message);
        }
        process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
