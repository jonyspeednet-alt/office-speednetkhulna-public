const http = require('node:http');
const https = require('node:https');
const { parseRouterUrl, resolveRouterTarget } = require('./routerTargetPolicy');

// Pin a validated address for the socket; retain the URL host for Host/SNI.
// Redirects are rejected rather than forwarding router credentials elsewhere.
const routerJsonRequest = async (value, { headers, signal } = {}) => {
  const url = parseRouterUrl(value);
  const target = await resolveRouterTarget(url.hostname);
  if (signal?.aborted) throw new Error('Router request aborted');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let deadline;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET', headers, agent: false,
      lookup: (_host, options, callback) => {
        const record = { address: target.address, family: target.family };
        if (typeof options === 'function') { callback = options; options = {}; }
        callback(null, options?.all ? [record] : record.address, record.family);
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.destroy(); request.destroy(); return finish(new Error('Router redirects are not allowed'));
      }
      if (Number(response.headers['content-length']) > 8 * 1024 * 1024) {
        response.destroy(); request.destroy(); return finish(new Error('Router response is too large'));
      }
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          response.destroy(); request.destroy(); return finish(new Error('Router response is too large'));
        }
        chunks.push(chunk);
      });
      response.once('error', (error) => finish(error));
      response.once('aborted', () => finish(new Error('Router response aborted')));
      response.once('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        finish(null, { status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
          json: async () => JSON.parse(body) });
      });
    });
    const abort = () => { request.destroy(); finish(new Error('Router request aborted')); };
    deadline = setTimeout(() => { request.destroy(); finish(new Error('Router request timed out')); }, 15000);
    request.setTimeout(15000, () => { request.destroy(); finish(new Error('Router request timed out')); });
    request.once('error', (error) => finish(error));
    signal?.addEventListener('abort', abort, { once: true });
    request.end();
  });
};

module.exports = { routerJsonRequest };
