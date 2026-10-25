const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const quiet = { log() {}, warn() {}, error() {} };
const load = (relative, mocks) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports: module.exports, require: (id) => {
      if (!Object.hasOwn(mocks, id)) throw new Error(`Unexpected dependency: ${id}`);
      return mocks[id];
    }, console: quiet, process: { env: {} }, setTimeout,
    __dirname: path.dirname(path.join(__dirname, '..', relative)),
  }, { filename: relative });
  return module.exports;
};
const response = () => ({
  locals: {}, statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  setHeader() {}, cookie() { this.cookieSet = true; }, clearCookie() {},
  json(body) { this.body = body; return this; },
});
const request = (method = 'GET') => ({ method, originalUrl: '/api/protected', headers: { authorization: 'Bearer test' } });
const registry = { getEffectivePermissions: async () => ({ permissions: { 'billing.generate_bill': true }, isSuperAdmin: false }), isMasterAdminUser: () => false };
const authMocks = (db, verify = () => ({ id: 7, token_version: 0 }), permissions = registry) => ({
  '../utilities/db': db, jsonwebtoken: { verify },
  '../utilities/authSecret': { getAuthSecret: () => 'test-only-secret' },
  '../utilities/permissionRegistry': permissions, '../config/env': { requestLogEnabled: false },
});

test('in-flight authentication cannot refill cache after revocation', async () => {
  let release, started;
  const reached = new Promise((resolve) => { started = resolve; });
  let version = 0;
  const permissions = { getEffectivePermissions: async () => {
    started(); await new Promise((resolve) => { release = resolve; });
    return { permissions: {}, isSuperAdmin: false };
  } };
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }, undefined, permissions));
  const res = response(); let passed = false;
  const inflight = auth(request(), res, () => { passed = true; });
  await reached; version = 1; auth.evictAuthCache(7); release(); await inflight;
  assert.equal(passed, false); assert.equal(res.statusCode, 503);
  const retry = response(); await auth(request(), retry, () => { passed = true; });
  assert.equal(retry.statusCode, 401); assert.equal(passed, false);
});

test('writes reject revoked tokens even when another worker retains a hot cache', async () => {
  let version = 0;
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }));
  let passed = false; await auth(request(), response(), () => { passed = true; });
  assert.equal(passed, true); version = 1;
  passed = false; const res = response(); await auth(request('POST'), res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.statusCode, 401);
});

test('fresh-auth protected GET bypasses hot cache and rejects revoked sessions', async () => {
  let version = 0;
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }));
  let passed = false; await auth(request(), response(), () => { passed = true; });
  assert.equal(passed, true);
  const freshRequest = () => ({ ...request(), requireFreshAuth: true });
  passed = false; const valid = response(); await auth(freshRequest(), valid, () => { passed = true; });
  assert.equal(passed, true); assert.equal(valid.statusCode, 200);
  version = 1; passed = false; const revoked = response(); await auth(freshRequest(), revoked, () => { passed = true; });
  assert.equal(passed, false); assert.equal(revoked.statusCode, 401);
});

test('fresh-auth protected GET rechecks version after permission resolution', async () => {
  let version = 0;
  const permissions = { getEffectivePermissions: async () => {
    version = 1; return { permissions: {}, isSuperAdmin: false };
  } };
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }, undefined, permissions));
  let passed = false; const res = response();
  await auth({ ...request(), requireFreshAuth: true }, res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.statusCode, 401);
});

test('fresh-auth protected GET cannot fall back to cached reads during an outage', async () => {
  let outage = false;
  const auth = load('middleware/auth.js', authMocks({ query: async () => {
    if (outage) throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
    return { rows: [{ id: 7, token_version: 0, status: 'Active' }] };
  } }));
  await auth(request(), response(), () => {}); outage = true;
  let passed = false; const res = response();
  await auth({ ...request(), requireFreshAuth: true }, res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.statusCode, 503);
});

test('employee, profile and permissions personal-data reads set fresh auth before authentication', async () => {
  let version = 0;
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }));
  await auth(request(), response(), () => {});
  const routes = [];
  const allow = () => (req, res, next) => next();
  const authenticate = (req, res, next) => {
    assert.equal(req.requireFreshAuth, true);
    return auth(req, res, next);
  };
  let disclosed = 0;
  const metadata = (req, res) => { disclosed += 1; res.json({ privateMetadata: true }); };
  for (const file of ['employeeRoutes.js', 'profileRoutes.js', 'permissionRoutes.js']) {
    const registered = new Map();
    const router = { get: (route, ...handlers) => registered.set(route, handlers), post() {}, put() {}, patch() {} };
    const multer = Object.assign(() => ({ fields: () => () => {} }), { diskStorage: () => ({}) });
    load(`routes/${file}`, {
      express: { Router: () => router }, '../middleware/auth': authenticate,
      '../middleware/checkPermission': { requirePermission: allow, requireAnyPermission: allow },
      '../controllers/employeeController': { getEmployees: metadata, getEmployeeById: metadata },
      '../controllers/profileController': { getUserProfile: metadata },
      '../controllers/permissionController': { getManagePermissionsData: metadata },
      multer, path, fs: {},
    });
    for (const route of file === 'permissionRoutes.js' ? ['/manage'] : ['/', '/:id']) routes.push(registered.get(route));
    if (file === 'employeeRoutes.js') assert.equal(registered.get('/departments')[0], authenticate);
  }
  const execute = async (handlers) => {
    const req = request(); const res = response();
    for (const handler of handlers) {
      let continued = false;
      await handler(req, res, () => { continued = true; });
      if (!continued) break;
    }
    return res;
  };
  for (const handlers of routes) assert.equal((await execute(handlers)).statusCode, 200);
  assert.equal(disclosed, routes.length);
  version = 1;
  for (const handlers of routes) assert.equal((await execute(handlers)).statusCode, 401);
  assert.equal(disclosed, routes.length);
});

test('evicting another account does not reject unrelated in-flight authentication', async () => {
  let release, started;
  const reached = new Promise((resolve) => { started = resolve; });
  const permissions = { getEffectivePermissions: async () => {
    started(); await new Promise((resolve) => { release = resolve; });
    return { permissions: {}, isSuperAdmin: false };
  } };
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: 0, status: 'Active' }] }) }, undefined, permissions));
  let passed = false; const res = response();
  const inflight = auth(request(), res, () => { passed = true; });
  await reached; auth.evictAuthCache(8); release(); await inflight;
  assert.equal(passed, true); assert.equal(res.statusCode, 200);
});

test('in-flight generation tracking is bounded and releases capacity on completion', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const permissions = { getEffectivePermissions: async () => {
    await waiting; return { permissions: {}, isSuperAdmin: false };
  } };
  const auth = load('middleware/auth.js', authMocks({ query: async (_, params) => ({ rows: [{ id: params[0], token_version: 0, status: 'Active' }] }) },
    (token) => ({ id: Number(token), token_version: 0 }), permissions));
  const req = (id) => ({ ...request(), headers: { authorization: `Bearer ${id}` } });
  const pending = Array.from({ length: 1000 }, (_, i) => auth(req(i + 1), response(), () => {}));
  const busy = response(); await auth(req(1001), busy, () => assert.fail('capacity bypass'));
  assert.equal(busy.statusCode, 503); release(); await Promise.all(pending);
  let passed = false; await auth(req(1001), response(), () => { passed = true; });
  assert.equal(passed, true);
});

test('writes recheck token version after permission resolution', async () => {
  let version = 0;
  const permissions = { getEffectivePermissions: async () => {
    version = 1; return { permissions: {}, isSuperAdmin: false };
  } };
  const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: version, status: 'Active' }] }) }, undefined, permissions));
  let passed = false; const res = response(); await auth(request('POST'), res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(res.statusCode, 401);
});

test('valid writes succeed and temporary-password writes remain blocked', async () => {
  for (const mustChange of [false, true]) {
    const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ id: 7, token_version: 0, status: 'Active', must_change_password: mustChange }] }) }));
    let passed = false; const res = response(); await auth(request('POST'), res, () => { passed = true; });
    assert.equal(passed, !mustChange); assert.equal(res.statusCode, mustChange ? 403 : 200);
  }
});

const controllerMocks = (db) => ({
  '../utilities/db': db, jsonwebtoken: { sign: () => 'test-session' }, bcrypt: { hash: async () => '$2b$test-hash' },
  '../utilities/authSecret': { getAuthSecret: () => 'test-only-secret' }, '../utilities/permissionRegistry': registry,
  '../middleware/auth': { evictAuthCache() {} },
});
test('plaintext password rows cannot authenticate or issue a session', async () => {
  const controller = load('controllers/authController.js', controllerMocks({ query: async () => ({
    rows: [{ id: 7, status: 'Active', password: 'legacy-password', token_version: 0 }],
  }) }));
  const res = response();
  await controller.login({ headers: {}, body: { identifier: 'EMP-X', password: 'legacy-password' } }, res);
  assert.equal(res.statusCode, 401); assert.equal(!!res.cookieSet, false);
});

test('case variants share account limiter keys while phone and email normalization remain stable', () => {
  const options = [];
  const router = { post() {}, get() {} };
  load('routes/auth.js', {
    express: { Router: () => router }, '../controllers/authController': {}, '../middleware/auth': () => {},
    '../utilities/loginRateStore': { LoginRateStore: class {}, resolveLoginAccount: async () => null },
    '../middleware/checkPermission': { requireAnyPermission: () => () => {} },
    'express-rate-limit': { rateLimit: (settings) => { options.push(settings); return () => {}; }, ipKeyGenerator: (ip) => ip },
  });
  const key = (identifier) => options[0].keyGenerator({ body: { identifier }, ip: 'test' });
  assert.equal(key('EMP-X'), key('emp-x'));
  assert.equal(key('User@Example.com'), key('user@example.com'));
  assert.equal(key('+8801700000000'), key('01700000000'));
  assert.notEqual(key('EMP-X'), key('EMP-Y'));
});

test('expired employee logout accepts current versions and rejects revoked versions', async () => {
  for (const version of [0, 1]) {
    const verify = (_, __, options) => {
      if (!options.ignoreExpiration) throw Object.assign(new Error('expired'), { name: 'TokenExpiredError' });
      return { id: 7, token_version: 0, exp: Date.now() / 1000 - 60 };
    };
    const auth = load('middleware/auth.js', authMocks({ query: async () => ({ rows: [{ token_version: version }] }) }, verify));
    const req = { ...request('POST'), originalUrl: '/api/auth/logout' };
    let passed = false; const res = response(); await auth(req, res, () => { passed = true; });
    assert.equal(passed, version === 0); if (version) assert.equal(res.statusCode, 401);
  }
});

test('partner loose logout does not attach revoked, missing-version or ancient sessions', async () => {
  for (const token of [
    { token_version: 0, exp: Date.now() / 1000 - 60 },
    { token_version: 1, exp: Date.now() / 1000 - 60 },
    { exp: Date.now() / 1000 - 60 },
    { token_version: 0, exp: Date.now() / 1000 - 90000 },
  ]) {
    const auth = load('middleware/partnerAuth.js', {
      jsonwebtoken: { verify: () => ({ type: 'partner', reseller_id: 7, ...token }) },
      '../utilities/db': { query: async () => ({ rows: [{ id: 7, token_version: 0 }] }) },
      '../utilities/authSecret': { getAuthSecret: () => 'test-only-secret' },
    });
    const req = request('POST'); let passed = false; await auth.requirePartnerLoose(req, response(), () => { passed = true; });
    assert.equal(passed, true); assert.equal(!!req.reseller, token.token_version === 0 && token.exp > Date.now() / 1000 - 86400);
  }
});

test('employee logout version bump is conditional on the authenticated session version', async () => {
  let query, params;
  const controller = load('controllers/authController.js', controllerMocks({ query: async (sql, values) => { query = sql; params = values; return { rowCount: 0 }; } }));
  await controller.logout({ user: { id: 7, token_version: 3 } }, response());
  assert.match(query, /WHERE id = \$1 AND token_version = \$2/);
  assert.equal(params[0], 7); assert.equal(params[1], 3);
});

test('partner logout version bump cannot revoke a newer session after verification', async () => {
  let query, params;
  const controller = load('controllers/partner/authController.js', {
    '../../utilities/db': { query: async (sql, values) => { query = sql; params = values; return { rowCount: 0 }; } },
    bcrypt: {}, '../../middleware/partnerAuth': { partnerCookieOptions: () => ({}), PARTNER_COOKIE: 'partner_token' },
  });
  await controller.logout({ reseller: { id: 7, token_version: 3 } }, response());
  assert.match(query, /WHERE id = \$1 AND token_version = \$2/);
  assert.equal(params[0], 7); assert.equal(params[1], 3);
});

test('cookie refresh never exposes a JWT when app-version is spoofed; native bearer refresh remains compatible', async () => {
  for (const headers of [
    { 'x-app-version': 'spoof' },
    { 'x-app-version': 'spoof', origin: 'https://office.speednetkhulna.com', authorization: 'Bearer test' },
    { 'x-app-version': 'spoof', 'sec-fetch-site': 'same-origin', authorization: 'Bearer test' },
    { 'x-app-version': 'native', authorization: 'Bearer test' },
  ]) {
    const controller = load('controllers/authController.js', {
      ...controllerMocks({ query: async () => ({ rows: [{ token_version: 0, status: 'active' }] }) }),
      jsonwebtoken: { decode: () => ({ session_start: Date.now() }), sign: () => 'new-session' },
    });
    const res = response();
    await controller.refreshToken({ user: { id: 7, token_version: 0 }, headers, cookies: { token: 'test' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(!!res.body.token, headers['x-app-version'] === 'native');
  }
});

test('refresh limits JWT and cookie lifetime to remaining absolute session time', async () => {
  for (const ageDays of [29.9, 30.1]) {
    let expiry, cookieAge;
    const controller = load('controllers/authController.js', {
      ...controllerMocks({ query: async () => ({ rows: [{ token_version: 0, status: 'active' }] }) }),
      jsonwebtoken: {
        decode: () => ({ session_start: Date.now() - ageDays * 86400000 }),
        sign: (_, __, options) => { expiry = options.expiresIn; return 'new-session'; },
      },
    });
    const res = response(); res.cookie = (_, __, options) => { cookieAge = options.maxAge; };
    await controller.refreshToken({ user: { id: 7, token_version: 0 }, headers: {}, cookies: { token: 'test' } }, res);
    assert.equal(res.statusCode, ageDays > 30 ? 401 : 200);
    if (ageDays < 30) {
      assert.ok(expiry > 0 && expiry <= 8640);
      assert.equal(cookieAge, expiry * 1000);
    } else assert.equal(expiry, undefined);
  }
});

test('absolute session age is enforced before cached or database authentication', async () => {
  const auth = load('middleware/auth.js', authMocks({ query: async () => { throw Error('DB must not run'); } },
    () => ({ id: 7, token_version: 0, session_start: Date.now() - 31 * 86400000 })));
  const res = response(); let passed = false;
  await auth(request(), res, () => { passed = true; });
  assert.equal(res.statusCode, 401); assert.equal(passed, false);
});

test('account limiter shares a canonical account key across aliases and uses shared stores', () => {
  const options = [], handlers = [];
  load('routes/auth.js', {
    express: { Router: () => ({ post: (...args) => handlers.push(args), get() {} }) },
    '../controllers/authController': {}, '../middleware/auth': () => {},
    '../middleware/checkPermission': { requireAnyPermission: () => () => {} },
    '../utilities/loginRateStore': { LoginRateStore: class { constructor(namespace) { this.namespace = namespace; } }, resolveLoginAccount: async () => 7 },
    'express-rate-limit': { rateLimit: (settings) => { options.push(settings); return () => {}; }, ipKeyGenerator: (ip) => ip },
  });
  const key = (identifier) => options[0].keyGenerator({ loginAccountId: 7, body: { identifier }, ip: 'test' });
  assert.equal(key('EMP-X'), key('user@example.com'));
  assert.equal(key('EMP-X'), key('01700000000'));
  assert.equal(options[0].store.namespace, 'account');
  assert.equal(options[1].store.namespace, 'ip');
});
