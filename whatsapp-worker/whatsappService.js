const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const qrcode = require(path.resolve(__dirname, './node_modules/qrcode-terminal'));
const { Client, LocalAuth, MessageMedia } = require(path.resolve(__dirname, './node_modules/whatsapp-web.js'));
let puppeteer = null;
try {
  puppeteer = require(path.resolve(__dirname, './node_modules/puppeteer'));
} catch (error) {
  try {
    puppeteer = require(path.resolve(__dirname, './node_modules/puppeteer-core'));
  } catch (fallbackError) {
    puppeteer = null;
  }
}

const { buildApprovalMessage, renderApprovalHtml } = require('./approvalTemplate');
const { secureRenderPage, boundedRenderClip } = require('./renderSecurity');
const { resolveBundledExecutable, detectBrowserMajor, buildWhatsAppUserAgent, enableClientBrowserCompatibility } = require('./browserCompatibility');
let resolvedBundledExecutable = null;

let clientInstance = null;
let initPromise = null;
let ready = false;
let currentHeadlessMode = true;
let latestQr = null;
let latestStatus = 'disconnected';
let latestError = null;
let latestAccount = null;

// --- Multi-session support (leave + support numbers, one worker) ---
// Each session keeps its own WhatsApp client, QR, status and reconnect
// budget. Legacy single-session exports below delegate to 'leave'.
const SESSION_DEFS = {
  leave: { clientId: 'office_leave_approvals', label: 'Leave' },
  support: { clientId: 'office_support', label: 'Support' },
};
const sessions = {};
const getSession = (name) => {
  const key = SESSION_DEFS[name] ? name : 'leave';
  if (!sessions[key]) {
    sessions[key] = {
      name: key,
      clientId: SESSION_DEFS[key].clientId,
      clientInstance: null,
      initPromise: null,
      ready: false,
      headless: true,
      qr: null,
      status: 'disconnected',
      error: null,
      account: null,
      started: false,
      lastCheckAt: null,
      reconnectAttempts: 0,
    };
  }
  return sessions[key];
};
const sessionDirFor = (rec) => path.join(authPath, `session-${rec.clientId}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Single-flight for full-Chromium launches (mirrors the portal service):
// concurrent approvals OOM the 256M worker. Serialize launches.
const { createBrowserPool, launchBrowserWithSlot } = require('./browserLifecycle');
const acquireBrowserSlot = createBrowserPool();
const tempScreenshotDir = path.join(os.tmpdir(), 'speednet-approval-letters');
const authPath = path.resolve(__dirname, '.wwebjs_auth');
const sessionDir = path.join(authPath, 'session-office_leave_approvals');

const isEnabled = () => String(process.env.WHATSAPP_GROUP_NOTIFICATIONS_ENABLED || 'false').toLowerCase() === 'true';

const applyBrowserLibraryPath = () => {
  const extraLibPath = String(process.env.WHATSAPP_LD_LIBRARY_PATH || '').trim();
  if (!extraLibPath) return;
  const current = String(process.env.LD_LIBRARY_PATH || '').trim();
  const merged = [extraLibPath, current].filter(Boolean).join(':');
  process.env.LD_LIBRARY_PATH = merged;
};

const readExecutableCandidate = (candidate) => {
  if (!candidate) return null;
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
};

const resolveBundledPuppeteerExecutable = async () => {
  if (!puppeteer) return null;
  try {
    if (typeof puppeteer.executablePath === 'function') {
      resolvedBundledExecutable = await resolveBundledExecutable(puppeteer, (candidate) => fs.existsSync(candidate));
      return resolvedBundledExecutable;
    }
  } catch (error) {
    console.warn('[Worker] puppeteer.executablePath() warning:', error.message);
  }
  return null;
};

const resolveBrowserExecutable = () => {
  const configured = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
  const configuredPath = readExecutableCandidate(configured);
  if (configuredPath) return configuredPath;

  const envCandidates = [process.env.CHROME_BIN, process.env.CHROMIUM_BIN].filter(Boolean);
  for (const entry of envCandidates) {
    const candidate = readExecutableCandidate(entry);
    if (candidate) return candidate;
  }

  const linuxCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/chromium'
  ];
  for (const candidate of linuxCandidates) {
    const resolved = readExecutableCandidate(candidate);
    if (resolved) return resolved;
  }

  const bundled = resolvedBundledExecutable;
  if (bundled) return bundled;

  return null;
};

const resolveBrowserExecutableAsync = async () => resolveBrowserExecutable() || await resolveBundledPuppeteerExecutable();

const cleanupStaleSessionLocks = (rec) => {
  const dir = rec ? sessionDirFor(rec) : sessionDir;
  const candidates = [
    path.join(dir, 'lockfile'),
    path.join(dir, 'SingletonLock'),
    path.join(dir, 'SingletonCookie'),
    path.join(dir, 'SingletonSocket'),
    path.join(dir, 'Default', 'LOCK'),
    path.join(dir, 'Default', 'LOCK.old'),
    path.join(dir, 'Default', 'SingletonLock'),
    path.join(dir, 'Default', 'SingletonCookie'),
    path.join(dir, 'Default', 'SingletonSocket'),
    path.join(dir, 'Default', 'DevToolsActivePort')
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true, recursive: true });
      }
    } catch (error) {
      console.warn('[Worker] Session lock cleanup warning:', filePath, error.message);
    }
  }
};

// Optional hook fired on every QR rotation (server.js attaches an
// immediate state push so the portal never serves a long-dead QR).
let qrListener = null;
const setQrListener = (fn) => { qrListener = typeof fn === 'function' ? fn : null; };

const ensureSessionClient = async (sessionName = 'leave', options = {}) => {
  const rec = getSession(sessionName);
  if (!isEnabled()) return null;
  if (rec.clientInstance) return rec.clientInstance;
  const requestedHeadless = options.headless !== false;
  if (rec.initPromise && rec.headless === requestedHeadless) return rec.initPromise;

  rec.status = 'connecting';
  rec.error = null;
  rec.qr = null;
  rec.started = true;
  applyBrowserLibraryPath();
  cleanupStaleSessionLocks(rec);
  const executablePath = await resolveBrowserExecutableAsync();
  // Another caller may have started the client while the bundled path resolved.
  if (rec.initPromise && rec.headless === requestedHeadless) return rec.initPromise;

  rec.initPromise = new Promise((resolve, reject) => {
    rec.headless = requestedHeadless;
    const puppeteerOptions = {
      headless: requestedHeadless ? true : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-crash-reporter',
        '--disable-breakpad'
      ]
    };
    if (executablePath) {
      puppeteerOptions.executablePath = executablePath;
    }

    // WhatsApp rejects some new pairings when whatsapp-web.js advertises its
    // legacy Chrome-101 UA. Keep the advertised major aligned with the actual
    // configured/bundled browser; operators can still supply a complete UA.
    const userAgent = buildWhatsAppUserAgent({
      override: process.env.WHATSAPP_USER_AGENT,
      executablePath,
      detectMajor: detectBrowserMajor
    });
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: rec.clientId, dataPath: authPath }),
      puppeteer: puppeteerOptions,
      userAgent
    });
    enableClientBrowserCompatibility(client);

    client.on('qr', (qr) => {
      rec.status = 'qr';
      rec.qr = qr;
      // Push immediately (the 10s timer alone can serve a dead QR for up to
      // 10s; WA rotates ~every 20s, so every second counts for scanning).
      // stateBusy in server.js coalesces bursts.
      if (qrListener) {
        try { qrListener(rec.name); } catch {}
      }
      // QR re-fires ~every 20s while unscanned; full ASCII each time grew
      // out.log to 259MB (Oct 2026). Log art once per unique payload —
      // the live QR always reaches the portal via 10s pushWorkerState.
      const hash = crypto.createHash('sha256').update(String(qr || '')).digest('hex').slice(0, 16);
      if (rec.lastLoggedQrHash !== hash) {
        rec.lastLoggedQrHash = hash;
        console.log(`[Worker:${rec.name}] Scan this QR to connect the sender (qr:${hash}):`);
        qrcode.generate(qr, { small: true });
      }
    });

    client.on('ready', () => {
      rec.ready = true;
      rec.status = 'ready';
      rec.qr = null;
      rec.error = null;
      rec.reconnectAttempts = 0;
      rec.account = {
        name: client.info?.pushname || client.info?.name || client.info?.wid?.user || null,
        number: client.info?.wid?.user || null,
        platform: client.info?.platform || null
      };
      console.log(`[Worker:${rec.name}] Client is ready.`);
      rec.clientInstance = client;
      resolve(client);
    });

    client.on('auth_failure', (msg) => {
      rec.ready = false;
      rec.status = 'auth_failure';
      rec.error = String(msg || 'Authentication failed');
      console.error(`[Worker:${rec.name}] Authentication failed:`, msg);
    });

    client.on('disconnected', (reason) => {
      rec.ready = false;
      rec.status = 'disconnected';
      rec.error = String(reason || 'Disconnected');
      rec.qr = null;
      rec.account = null;
      console.warn(`[Worker:${rec.name}] Client disconnected:`, reason);
      rec.clientInstance = null;
      rec.initPromise = null;

      // Auto-reconnect with exponential backoff (max 5 attempts: 5s, 10s, 20s, 40s, 60s)
      if (rec.reconnectAttempts < 5) {
        rec.reconnectAttempts += 1;
        const delayMs = Math.min(60000, 5000 * Math.pow(2, rec.reconnectAttempts - 1));
        console.log(`[Worker:${rec.name}] Scheduling auto-reconnect attempt ${rec.reconnectAttempts}/5 in ${delayMs / 1000}s...`);
        setTimeout(() => {
          ensureSessionClient(rec.name, { headless: rec.headless }).catch((e) => {
            console.error(`[Worker:${rec.name}] Auto-reconnect attempt ${rec.reconnectAttempts} failed:`, e.message);
          });
        }, delayMs);
      }
    });

    client.initialize().catch((error) => {
      console.error(`[Worker:${rec.name}] Initialization error:`, error);
      rec.initPromise = null;
      reject(error);
    });
  });

  return rec.initPromise;
};

// Legacy single-session API (leave session) — kept for compatibility.
const ensureClient = async (options = {}) => ensureSessionClient('leave', options);

const sessionSnapshot = (rec) => ({
  session: rec.name,
  label: SESSION_DEFS[rec.name].label,
  enabled: isEnabled(),
  connected: Boolean(rec.clientInstance) && rec.ready,
  ready: rec.ready,
  state: rec.status,
  headless: rec.headless,
  hasQr: Boolean(rec.qr),
  qr: rec.qr || null,
  error: rec.error,
  account: rec.account,
  started: rec.started,
  lastCheckAt: rec.lastCheckAt,
  reconnectAttempts: rec.reconnectAttempts,
});

const getSessionStatus = (name = 'leave') => {
  const rec = getSession(name);
  return {
    ...sessionSnapshot(rec),
    executablePath: String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim() || null,
    browserExecutable: resolveBrowserExecutable(),
    dataPath: path.resolve(__dirname, '.wwebjs_auth'),
  };
};

const getSessionsStatus = () => {
  const out = {};
  for (const name of Object.keys(SESSION_DEFS)) out[name] = sessionSnapshot(getSession(name));
  return { enabled: isEnabled(), sessions: out, monitor: monitorSnapshot() };
};

const getSessionQr = (name = 'leave') => {
  const rec = getSession(name);
  return {
    session: rec.name,
    enabled: isEnabled(),
    hasQr: Boolean(rec.qr),
    qr: rec.qr,
    state: rec.status,
    connected: Boolean(rec.clientInstance) && rec.ready,
  };
};

const getStatus = () => {
  const rec = getSession('leave');
  // keep legacy module fields in sync for any direct readers
  clientInstance = rec.clientInstance;
  initPromise = rec.initPromise;
  ready = rec.ready;
  currentHeadlessMode = rec.headless;
  latestQr = rec.qr;
  latestStatus = rec.status;
  latestError = rec.error;
  latestAccount = rec.account;
  return {
    enabled: isEnabled(),
    connected: Boolean(rec.clientInstance) && rec.ready,
    ready: rec.ready,
    state: rec.status,
    headless: rec.headless,
    hasQr: Boolean(rec.qr),
    error: rec.error,
    account: rec.account,
    executablePath: String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim() || null,
    browserExecutable: resolveBrowserExecutable(),
    dataPath: path.resolve(__dirname, '.wwebjs_auth')
  };
};

const getLatestQr = () => {
  const rec = getSession('leave');
  return {
    enabled: isEnabled(),
    hasQr: Boolean(rec.qr),
    qr: rec.qr,
    state: rec.status,
    connected: Boolean(rec.clientInstance) && rec.ready
  };
};

const reconnectSession = async (name = 'leave', options = {}) => {
  await closeSession(name);
  return ensureSessionClient(name, options);
};

const reconnectClient = async (options = {}) => reconnectSession('leave', options);

const closeSession = async (name = 'leave') => {
  const rec = getSession(name);
  if (!rec.clientInstance) return;
  try {
    await rec.clientInstance.destroy();
  } catch (error) {
    console.warn(`[Worker:${rec.name}] Client close warning:`, error.message);
  } finally {
    rec.clientInstance = null;
    rec.initPromise = null;
    rec.ready = false;
    rec.status = 'disconnected';
    rec.account = null;
  }
};

const closeClient = async () => closeSession('leave');

// --- Explicit unlink: logs the device out of WhatsApp (clears LocalAuth so
// a different number can link next) instead of merely stopping the client.
// Used by the Disconnect button on the sender maintenance cards.
const disconnectSession = async (name = 'leave') => {
  const rec = getSession(name);
  if (rec.clientInstance) {
    try {
      // logout() unlinks the companion device AND destroys the client.
      // Falls back to destroy() when already logged out server-side.
      await rec.clientInstance.logout();
      console.log(`[Worker:${rec.name}] Logged out (device unlinked).`);
    } catch (error) {
      console.warn(`[Worker:${rec.name}] Logout warning (falling back to destroy):`, error.message);
      try {
        await rec.clientInstance.destroy();
      } catch (destroyError) {
        console.warn(`[Worker:${rec.name}] Client destroy warning:`, destroyError.message);
      }
    } finally {
      rec.clientInstance = null;
      rec.initPromise = null;
    }
  }
  rec.ready = false;
  rec.status = 'disconnected';
  rec.qr = null;
  rec.lastLoggedQrHash = null;
  rec.error = null;
  rec.account = null;
  rec.started = false;
  rec.reconnectAttempts = 0;
  return { disconnected: true, session: rec.name };
};

// --- Login maintenance monitor: watches started sessions, auto-reconnects
// dropped ones (bounded attempts; QR state always needs a human scan). ---
let monitorTimer = null;
let monitorIntervalMs = 60000;
let monitorMaxAttempts = 5;
let monitorLastRunAt = null;
const monitorSnapshot = () => ({
  running: Boolean(monitorTimer),
  intervalMs: monitorIntervalMs,
  maxAutoAttempts: monitorMaxAttempts,
  lastRunAt: monitorLastRunAt,
});
const monitorTick = async () => {
  monitorLastRunAt = new Date().toISOString();
  for (const name of Object.keys(sessions)) {
    const rec = sessions[name];
    rec.lastCheckAt = monitorLastRunAt;
    try {
      if (!rec.started || rec.ready || rec.status === 'qr' || rec.status === 'connecting') continue;
      if (rec.status !== 'disconnected' && rec.status !== 'auth_failure') continue;
      if (rec.reconnectAttempts >= monitorMaxAttempts) continue;
      rec.reconnectAttempts += 1;
      console.log(`[Worker:${rec.name}] Monitor auto-reconnect attempt ${rec.reconnectAttempts}/${monitorMaxAttempts}.`);
      await reconnectSession(name).catch((e) => {
        rec.error = String(e?.message || e);
      });
    } catch (e) {
      console.warn(`[Worker:${rec.name}] Monitor tick failed:`, e.message);
    }
  }
};
const startSessionMonitor = (opts = {}) => {
  if (opts.intervalMs) monitorIntervalMs = Number(opts.intervalMs) || monitorIntervalMs;
  if (opts.maxAutoAttempts !== undefined) monitorMaxAttempts = Number(opts.maxAutoAttempts) || 0;
  if (monitorTimer) return monitorSnapshot();
  monitorTimer = setInterval(() => {
    monitorTick().catch((e) => console.warn('[Worker] Monitor error:', e.message));
  }, monitorIntervalMs);
  if (monitorTimer.unref) monitorTimer.unref();
  return monitorSnapshot();
};

const createApprovalLetterImage = async (approvalId, payload) => {
  fs.mkdirSync(tempScreenshotDir, { recursive: true });
  if (!puppeteer) {
    throw new Error('Puppeteer is not available for approval letter screenshot generation.');
  }
  applyBrowserLibraryPath();
  const executablePath = await resolveBrowserExecutableAsync();
  if (!executablePath) {
    throw new Error('Chrome/Chromium executable not found for approval letter screenshot.');
  }
  const { browser, closeBrowser } = await launchBrowserWithSlot(puppeteer, {
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad'
    ]
  }, acquireBrowserSlot);

  const filePath = path.join(tempScreenshotDir, `approval-letter-${approvalId}-${Date.now()}.png`);

  try {
    const page = await browser.newPage();
    await secureRenderPage(page);
    await page.setViewport({ width: 900, height: 1300, deviceScaleFactor: 2 });
    await page.setContent(renderApprovalHtml(payload), { waitUntil: 'networkidle0' });
    const pageElement = await page.$('.page');
    if (!pageElement) {
      throw new Error('Approval letter container not found.');
    }

    const box = await pageElement.boundingBox();
    if (!box) {
      throw new Error('Approval letter container bounds unavailable.');
    }

    const clip = boundedRenderClip(box);

    await page.screenshot({
      path: filePath,
      type: 'png',
      clip,
      omitBackground: false
    });
    return filePath;
  } finally {
    await closeBrowser();
  }
};

const sendApprovalNotification = async ({ approvalId, payload, groupName }) => {
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  const targetGroup = String(groupName || process.env.WHATSAPP_GROUP_NAME || '').trim();
  if (!targetGroup) return { skipped: true, reason: 'missing_group_name' };
  if (!payload) return { skipped: true, reason: 'missing_payload' };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const client = await ensureSessionClient('leave');
      const rec = getSession('leave');
      if (!client || !rec.ready) {
        await delay(1500);
        continue;
      }

      const chats = await client.getChats();
      const targetChat = chats.find((chat) => chat.isGroup && String(chat.name || '').trim().toLowerCase() === targetGroup.toLowerCase());
      if (!targetChat) {
        throw new Error(`WhatsApp group not found: ${targetGroup}`);
      }

      const message = buildApprovalMessage(payload, approvalId);
      const imagePath = await createApprovalLetterImage(approvalId, payload);
      try {
        const media = MessageMedia.fromFilePath(imagePath);
        await client.sendMessage(targetChat.id._serialized, media, { caption: message });
      } finally {
        try {
          fs.unlinkSync(imagePath);
        } catch (cleanupError) {
          console.warn('[Worker] Screenshot cleanup warning:', cleanupError.message);
        }
      }
      console.log(`[Worker] Leave approval notification sent for request ${approvalId} to "${targetGroup}".`);
      return { sent: true, groupName: targetGroup };
    } catch (error) {
      lastError = error;
      console.error(`[Worker] Attempt ${attempt} failed for request ${approvalId}:`, error.message);
      if (attempt < 3) {
        await delay(2000);
      }
    }
  }

  throw lastError || new Error('Unknown WhatsApp notification failure');
};

const sendTestMessage = async ({ groupName }) => {
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  const targetGroup = String(groupName || process.env.WHATSAPP_GROUP_NAME || '').trim();
  if (!targetGroup) return { skipped: true, reason: 'missing_group_name' };

  const client = await ensureSessionClient('leave');
  const rec = getSession('leave');
  if (!client || !rec.ready) {
    throw new Error('WhatsApp sender is not connected yet.');
  }

  const chats = await client.getChats();
  const targetChat = chats.find((chat) => chat.isGroup && String(chat.name || '').trim().toLowerCase() === targetGroup.toLowerCase());
  if (!targetChat) {
    throw new Error(`WhatsApp group not found: ${targetGroup}`);
  }

  const message = [
    '*WhatsApp Connection Test*',
    'Office sender is connected and ready.',
    `Checked at: ${new Date().toLocaleString('en-GB')}`
  ].join('\n');

  await client.sendMessage(targetChat.id._serialized, message);
  console.log(`[Worker] Test message sent to "${targetGroup}".`);
  return { sent: true, groupName: targetGroup };
};

const sendTestImageMessage = async ({ groupName }) => {
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  const targetGroup = String(groupName || process.env.WHATSAPP_GROUP_NAME || '').trim();
  if (!targetGroup) return { skipped: true, reason: 'missing_group_name' };

  const client = await ensureSessionClient('leave');
  const rec = getSession('leave');
  if (!client || !rec.ready) {
    throw new Error('WhatsApp sender is not connected yet.');
  }

  const chats = await client.getChats();
  const targetChat = chats.find((chat) => chat.isGroup && String(chat.name || '').trim().toLowerCase() === targetGroup.toLowerCase());
  if (!targetChat) {
    throw new Error(`WhatsApp group not found: ${targetGroup}`);
  }

  const imagePath = await createDiagnosticImage();
  try {
    const media = MessageMedia.fromFilePath(imagePath);
    await client.sendMessage(targetChat.id._serialized, media, {
      caption: ['*WhatsApp Image Test*', 'Image delivery is working for the office sender.', `Checked at: ${new Date().toLocaleString('en-GB')}`].join('\n')
    });
  } finally {
    try {
      fs.unlinkSync(imagePath);
    } catch (cleanupError) {
      console.warn('[Worker] Test image cleanup warning:', cleanupError.message);
    }
  }
  console.log(`[Worker] Test image sent to "${targetGroup}".`);
  return { sent: true, groupName: targetGroup };
};

const createDiagnosticImage = async () => {
  fs.mkdirSync(tempScreenshotDir, { recursive: true });
  if (!puppeteer) {
    throw new Error('Puppeteer is not available for test image generation.');
  }
  applyBrowserLibraryPath();
  const executablePath = await resolveBrowserExecutableAsync();
  if (!executablePath) {
    throw new Error('Chrome/Chromium executable not found for test image generation.');
  }

  const { browser, closeBrowser } = await launchBrowserWithSlot(puppeteer, {
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad'
    ]
  }, acquireBrowserSlot);

  const filePath = path.join(tempScreenshotDir, `whatsapp-test-${Date.now()}.png`);
  const html = `
    <html>
      <body style="margin:0;font-family:'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif;background:#eef4ff;">
        <div style="width:900px;height:420px;display:flex;align-items:center;justify-content:center;padding:48px;box-sizing:border-box;">
          <div style="width:100%;height:100%;border-radius:32px;background:linear-gradient(135deg,#0f172a,#2563eb);color:#fff;padding:40px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="font-size:18px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.72;">SpeedNet Khulna</div>
              <div style="font-size:44px;font-weight:800;margin-top:18px;">WhatsApp Image Test</div>
              <div style="font-size:20px;line-height:1.6;opacity:0.82;margin-top:16px;">Image delivery is working for the office sender.</div>
            </div>
            <div style="font-size:18px;opacity:0.76;">Checked at ${new Date().toLocaleString('en-GB')}</div>
          </div>
        </div>
      </body>
    </html>`;

  try {
    const page = await browser.newPage();
    await secureRenderPage(page);
    await page.setViewport({ width: 900, height: 420, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: filePath, type: 'png', omitBackground: false });
    return filePath;
  } finally {
    await closeBrowser();
  }
};

const normalizeWaNumber = (to) => {
  let p = String(to || '').replace(/[^0-9]/g, '');
  if (!p) return null;
  if (p.startsWith('880')) return p;
  if (p.startsWith('0')) return `88${p}`;
  return `880${p}`;
};

// Direct text message to a BD mobile (support ticket auto-notifications).
// Payload: { to, body }
const sendTextMessage = async ({ to, body, session }) => {
  const rec = getSession(session || 'support');
  if (!isEnabled()) return { skipped: true, reason: 'disabled' };
  const number = normalizeWaNumber(to);
  if (!number || !/^8801[3-9]\d{8}$/.test(number)) {
    throw new Error(`Invalid BD mobile for WhatsApp: ${to}`);
  }
  const text = String(body || '').trim().substring(0, 4000);
  if (!text) throw new Error('Empty WhatsApp message body');

  const client = await ensureSessionClient(rec.name);
  if (!client || !rec.ready) {
    throw new Error('WhatsApp sender is not connected yet.');
  }

  const chatId = `${number}@c.us`;
  const registered = await client.isRegisteredUser(chatId);
  if (!registered) {
    throw new Error(`Number not on WhatsApp: ${number}`);
  }

  await client.sendMessage(chatId, text);
  console.log(`[Worker:${rec.name}] Text message sent to ${number}.`);
  return { sent: true, to: number, session: rec.name };
};

module.exports = {
  ensureClient,
  ensureSessionClient,
  getSession,
  closeClient,
  closeSession,
  disconnectSession,
  setQrListener,
  reconnectClient,
  reconnectSession,
  getStatus,
  getSessionStatus,
  getSessionsStatus,
  getSessionQr,
  getLatestQr,
  startSessionMonitor,
  monitorSnapshot,
  sendApprovalNotification,
  sendTestMessage,
  sendTestImageMessage,
  sendTextMessage
};
