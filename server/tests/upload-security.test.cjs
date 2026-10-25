const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('identity scans require auth even with encoded names; malformed paths fail closed', () => {
  const uses = [];
  let authenticated = 0;
  let staticOptions;
  const noop = () => () => {};
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/index.js'), 'utf8'), {
    module, console, __dirname: path.join(__dirname, '../middleware'),
    require: (name) => {
      if (name === 'path') return path;
      if (name === 'express') return { static: (_, opts) => { staticOptions = opts; return () => {}; } };
      if (name === 'body-parser') return { json: noop, urlencoded: noop };
      if (name === '../config/env') return { requestLogEnabled: false };
      if (name === '../utilities/auditLogger') return { auditLogMiddleware: () => {} };
      if (name === './auth') return (_, res) => { authenticated++; res.status(401).json({}); };
      return noop;
    },
  });
  module.exports.applyMiddleware({ use: (...args) => uses.push(args) });
  const gate = uses.find(([route]) => route === '/uploads')[1];
  let next = 0;
  const res = { code: 0, status(code) { this.code = code; return this; }, json() {} };
  for (const url of ['/nid-scan.jpg', '/%6eid-scan.jpg', '/%6E%69%64-scan.jpg']) {
    gate({ path: url }, res, () => next++);
    assert.equal(res.code, 401);
  }
  assert.equal(authenticated, 3);
  assert.equal(next, 0);
  gate({ path: '/%ZZ' }, res, () => next++);
  assert.equal(res.code, 400);
  gate({ path: '/profile.jpg' }, res, () => next++);
  assert.equal(next, 1);
  const headers = {};
  staticOptions.setHeaders({ set: (key, value) => { headers[key] = value; } }, '/uploads/nid-scan.jpg');
  assert.equal(headers['Cache-Control'], 'private, no-store');
});

test('private identity scans allow the owner or manager, reject other employees and DB failures', async () => {
  let queries = 0;
  let fail = false;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/nidAccess.js'), 'utf8'), {
    module,
    require: (name) => name.endsWith('/db') ? {
      query: async (_, [id, filename]) => {
        queries++;
        if (fail) throw new Error('private database details');
        return { rows: id === 7 && filename === 'nid-own.jpg' ? [{ '?column?': 1 }] : [] };
      },
    } : { resolvePermission: (user, key) => key === 'users.manage' && user.manager === true },
  });
  const res = { code: 0, body: null, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  let allowed = 0;
  await module.exports({ user: { id: 7 }, path: '/%6eid-own.jpg' }, res, () => allowed++);
  assert.equal(allowed, 1);
  await module.exports({ user: { id: 8 }, path: '/nid-own.jpg' }, res, () => allowed++);
  assert.equal(res.code, 403);
  assert.equal(allowed, 1);
  const before = queries;
  await module.exports({ user: { id: 8, manager: true }, path: '/nid-own.jpg' }, res, () => allowed++);
  assert.equal(allowed, 2);
  assert.equal(queries, before);
  fail = true;
  await module.exports({ user: { id: 7 }, path: '/nid-own.jpg' }, res, () => allowed++);
  assert.equal(res.code, 503);
  assert.equal(JSON.stringify(res.body).includes('private database'), false);
  assert.equal(allowed, 2);
});
