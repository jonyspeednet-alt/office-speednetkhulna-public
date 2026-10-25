const { spawnSync } = require('child_process');

// Puppeteer 25 makes executablePath asynchronous and replaces isConnected()
// with connected. Keep compatibility at our SDK boundary, never in node_modules.
const resolveBundledExecutable = async (puppeteer, exists) => {
  if (typeof puppeteer?.executablePath !== 'function') return null;
  const candidate = await puppeteer.executablePath();
  return typeof candidate === 'string' && candidate && exists(candidate) ? candidate : null;
};

const detectBrowserMajor = (executablePath, run = spawnSync) => {
  if (typeof executablePath !== 'string' || !executablePath) return null;
  try {
    const result = run(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (result.error || result.status !== 0) return null;
    const version = `${result.stdout || ''}\n${result.stderr || ''}`;
    return version.match(/(?:Google Chrome|Chrome(?: for Testing)?|Chromium)\s+(\d+)\./i)?.[1] || null;
  } catch {
    return null;
  }
};

const buildWhatsAppUserAgent = ({ override, executablePath, detectMajor = detectBrowserMajor }) => {
  const configured = String(override || '').trim();
  if (configured) return configured;
  const major = detectMajor(executablePath);
  if (!major) throw new Error('Unable to determine the Chrome version for WhatsApp pairing.');
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
};

const enableClientBrowserCompatibility = (client) => {
  const logout = client.logout;
  if (typeof logout !== 'function') return client;
  client.logout = function (...args) {
    const browser = this.pupBrowser;
    if (browser && typeof browser.isConnected !== 'function') {
      browser.isConnected = () => browser.connected === true;
    }
    return logout.apply(this, args);
  };
  return client;
};

module.exports = { resolveBundledExecutable, detectBrowserMajor, buildWhatsAppUserAgent, enableClientBrowserCompatibility };
