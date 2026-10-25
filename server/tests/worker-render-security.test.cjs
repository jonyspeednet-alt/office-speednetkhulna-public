const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderApprovalHtml, buildApprovalMessage } = require('../../whatsapp-worker/approvalTemplate');
const { isAllowedRenderUrl, safeRasterDataUri, secureRenderPage } = require('../../whatsapp-worker/renderSecurity');

test('worker rejects unauthenticated JSON before parsing while health stays public', () => {
  const layers = [];
  let parsed = 0;
  const app = { use: (handler) => layers.push({ handler }),
    get: (route, ...handlers) => layers.push({ method: 'GET', route, handlers }),
    post: (route, ...handlers) => layers.push({ method: 'POST', route, handlers }), listen() {} };
  const noop = () => (_req, _res, next) => next();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../whatsapp-worker/server.js'), 'utf8'), {
    __dirname: path.join(__dirname, '../../whatsapp-worker'), console, Buffer, URL,
    process: { env: { WHATSAPP_WORKER_API_KEY: 'test-worker-key' }, on() {}, exit() { throw new Error('Unexpected exit'); } },
    require: (name) => {
      if (name === 'express') return () => app;
      if (name === 'fs') return { existsSync: () => false };
      if (name === 'compression' || name === 'cors') return noop;
      if (name === 'body-parser') return { json: (opts) => {
        assert.equal(opts.limit, '2mb');
        return (req, res, next) => { parsed++; try { req.body = JSON.parse(req.raw); next(); } catch { res.status(400).json({}); } };
      } };
      if (name === 'dotenv') return {};
      if (name === './whatsappService') return new Proxy({}, { get: () => () => {} });
      if (name === './boundedHttpJson') return require('../../whatsapp-worker/boundedHttpJson');
      return require(name);
    },
  });
  const request = (method, route, key) => {
    const req = { method, path: route, headers: key ? { 'x-worker-api-key': key } : {}, raw: '{invalid-json' };
    const res = { code: 200, ended: false, status(code) { this.code = code; return this; }, json() { this.ended = true; } };
    const handlers = layers.flatMap((layer) => layer.handler ? [layer.handler] :
      layer.method === method && layer.route === route ? layer.handlers : []);
    let index = 0;
    const next = () => { if (!res.ended && handlers[index]) handlers[index++](req, res, next); };
    next();
    return res.code;
  };
  assert.equal(request('POST', '/api/whatsapp/start'), 401);
  assert.equal(parsed, 0);
  assert.equal(request('GET', '/health'), 200);
  assert.equal(parsed, 0);
  assert.equal(request('POST', '/api/whatsapp/start', 'test-worker-key'), 400);
  assert.equal(parsed, 1);
});

test('approval HTML escapes stored text and rejects URL or SVG image embeds', () => {
  const injected = '<img src="http://127.0.0.1/private" onerror="attack()">';
  const payload = { info: { id: injected, full_name: injected, designation: injected, department: injected, admin_name: injected },
    leaves: [{ type_name: injected, day_count: injected, start_date: '2026-10-03', end_date: '2026-10-04' }],
    assets: { logoDataUri: '"/><script>attack()</script>', sealDataUri: 'http://127.0.0.1/private' } };
  const html = renderApprovalHtml(payload);
  assert.equal(html.includes(injected), false);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('src="http://127.0.0.1'), false);
  assert.match(html, /&lt;img/);
  assert.equal(buildApprovalMessage(payload).includes(injected), true); // Plain-text messages stay plain text.
  assert.equal(safeRasterDataUri('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.equal(safeRasterDataUri('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
});

test('static render pages disable JavaScript and block internal/external requests except font resources', async () => {
  for (const url of ['http://127.0.0.1/private', 'http://169.254.169.254/', 'file:///etc/passwd',
    'https://attacker.example/image.png', 'https://fonts.googleapis.com.attacker.example/css2',
    'https://user:pass@fonts.gstatic.com/s/a.woff2', 'https://fonts.googleapis.com:444/css2',
    'data:text/html;base64,PHNjcmlwdD4=', 'https://fonts.googleapis.com/other']) {
    assert.equal(isAllowedRenderUrl(url), false);
  }
  for (const url of ['about:blank', 'https://fonts.googleapis.com/css2?family=Hind+Siliguri',
    'https://fonts.gstatic.com/s/hindsiliguri/v1/font.woff2', 'data:image/png;base64,aGVsbG8=']) {
    assert.equal(isAllowedRenderUrl(url), true);
  }
  let handler;
  const page = { async setJavaScriptEnabled(value) { assert.equal(value, false); },
    async setRequestInterception(value) { assert.equal(value, true); }, on(event, fn) { assert.equal(event, 'request'); handler = fn; } };
  await secureRenderPage(page);
  let aborted = 0;
  handler({ url: () => 'http://127.0.0.1/private', abort: async () => { aborted++; }, continue: async () => { assert.fail('must not continue'); } });
  assert.equal(aborted, 1);
});
