const http = require('node:http');
const https = require('node:https');

const createJsonRequester = ({ timeoutMs = 30000, maxResponseBytes = 4 * 1024 * 1024,
  transports = { 'http:': http, 'https:': https }, label = 'Upstream' } = {}) =>
  (method, urlString, body = null, extraHeaders = {}) => new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return reject(new Error('Invalid upstream URL'));
    }
    const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    let settled = false;
    let deadline;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error); else resolve(value);
    };
    const req = transports[parsed.protocol].request({
      method, hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0, ...extraHeaders },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('error', (error) => finish(error));
      res.on('aborted', () => finish(new Error(`${label} response interrupted`)));
      res.on('data', (chunk) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          const error = new Error(`${label} response exceeds size limit`);
          finish(error);
          res.destroy(error);
          req.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
        if (res.statusCode >= 200 && res.statusCode < 300) return finish(null, data);
        const error = new Error(data?.message || `${label} request failed with status ${res.statusCode}`);
        error.statusCode = res.statusCode;
        error.response = data;
        finish(error);
      });
    });
    req.on('error', (error) => finish(error));
    const timeout = () => {
      const error = new Error(`${label} request timed out`);
      finish(error);
      req.destroy(error);
    };
    req.on('timeout', timeout);
    // Absolute deadline also stops a peer that continually dribbles bytes and
    // therefore never triggers the socket's inactivity timeout.
    deadline = setTimeout(timeout, timeoutMs);
    if (payload) req.write(payload);
    req.end();
  });

module.exports = { createJsonRequester };
