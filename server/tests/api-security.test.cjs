const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = (relative, requireMock, extra = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports: module.exports, require: requireMock, console,
    __dirname: path.dirname(path.join(__dirname, '..', relative)), ...extra,
  }, { filename: relative });
  return module.exports;
};
const registry = load('utilities/permissionRegistry.js', () => ({ query: () => { throw new Error('No database access in tests'); } }));
const { onboardingStatusError } = load('utilities/onboardingAuthorization.js', () => registry);

test('create and edit cannot bypass self-approval even with approval permission', () => {
  const user = { id: 7, role_id: 3, permissions: { 'reseller.requests.approve': true } };
  for (const target of ['verified', 'approved']) {
    assert.equal(onboardingStatusError(user, 7, target)?.status, 403);
    assert.equal(onboardingStatusError(user, 7, target, 'submitted')?.status, 403);
    assert.equal(onboardingStatusError(user, 8, target), null);
    assert.equal(onboardingStatusError({ ...user, permissions: { 'reseller.add': true } }, 8, target)?.status, 403);
  }
});

test('spreadsheet timeout terminates workers before releasing bounded parser slots', async () => {
  const { EventEmitter } = require('node:events');
  const timers = [];
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(filename, options) { super(); this.options = options; workers.push(this); }
    terminate() { this.terminated = true; return Promise.resolve(1); }
  }
  const guard = load('utilities/xlsxGuard.js', (name) => name === 'node:worker_threads' ? { Worker: FakeWorker } : require(name), {
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
  });
  const file = { buffer: Buffer.from('a,b'), originalname: 'sheet.csv', mimetype: 'text/csv' };
  const first = guard.openFirstSheet(file);
  const second = guard.openFirstSheet(file);
  await assert.rejects(guard.openFirstSheet(file), (err) => err.status === 429);
  assert.equal(workers.length, 2);
  assert.equal(workers[0].options.resourceLimits.maxOldGenerationSizeMb, 64);
  timers[0](); timers[1]();
  await assert.rejects(first, /timed out/);
  await assert.rejects(second, /timed out/);
  assert.ok(workers.every((worker) => worker.terminated));
  const retry = guard.openFirstSheet(file);
  timers[2]();
  await assert.rejects(retry, /timed out/);
});

test('real spreadsheet worker parses valid rows and rejects oversized input and ranges', async () => {
  const guard = require('../utilities/xlsxGuard');
  const XLSX = require('xlsx');
  const file = (buffer) => ({ buffer, originalname: 'sheet.csv', mimetype: 'text/csv' });
  const { worksheet } = await guard.openFirstSheet(file(Buffer.from('name,amount\nAlice,12')));
  assert.equal(worksheet.A2.v, 'Alice');
  assert.equal(worksheet.B2.v, 12);
  await assert.rejects(guard.openFirstSheet(file(Buffer.alloc(5 * 1024 * 1024 + 1))), /5MB/);
  const wide = Buffer.from(Array.from({ length: 101 }, (_, i) => `column${i}`).join(','));
  await assert.rejects(guard.openFirstSheet(file(wide)), /Too many columns/);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, { A1: { t: 's', v: 'header' }, '!ref': 'A1:A5002' }, 'Sheet1');
  await assert.rejects(guard.openFirstSheet({ buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), originalname: 'rows.xlsx', mimetype: 'application/octet-stream' }), /Too many rows/);
  assert.equal({}.polluted, undefined);
});

test('read-only grants cannot set review states, legacy false values do not grant access', () => {
  for (const permissions of [{ 'employees.view': true }, { 'reseller.add': 'false' }, { all_access: 'false' }]) {
    for (const target of ['verified', 'approved', 'rejected']) {
      assert.equal(onboardingStatusError({ id: 7, role_id: 3, permissions }, 8, target)?.status, 403);
    }
  }
});

test('ordinary edits preserve existing approval; conversion requires its own endpoint', () => {
  const user = { id: 7, role_id: 3, permissions: {} };
  assert.equal(onboardingStatusError(user, 7, 'approved', 'approved'), null);
  assert.equal(onboardingStatusError(user, 7, 'submitted'), null);
  assert.equal(onboardingStatusError(user, 7, 'draft'), null);
  assert.equal(onboardingStatusError(user, 7, 'converted')?.status, 400);
  assert.equal(onboardingStatusError({ id: 7, role: 'Super Admin' }, 7, 'approved'), null);
  assert.equal(onboardingStatusError({ id: 7, role_id: 3, role: 'Admin' }, 8, 'approved')?.status, 403);
});

test('both photo endpoints share limiter before multipart storage', () => {
  const routes = [];
  const router = new Proxy({}, { get: (_, method) => (...args) => { routes.push({ method, args }); } });
  const gate = () => {};
  const limiter = () => {};
  const controller = new Proxy({}, { get: () => gate });
  load('routes/supportRoutes.js', (name) => {
    if (name === 'express') return { Router: () => router };
    if (name === 'multer') return Object.assign(() => ({ single: () => gate }), { diskStorage: () => ({}) });
    if (name === 'path' || name === 'fs') return require(name);
    if (name === 'express-rate-limit') return { rateLimit: () => limiter, ipKeyGenerator: () => 'test' };
    if (name.endsWith('checkPermission')) return { requirePermission: () => gate, requireAnyPermission: () => gate };
    if (name.endsWith('technicianScope')) return { requireOwnTicket: gate };
    if (name.includes('Controller')) return controller;
    return gate;
  });
  for (const routePath of ['/tickets/:id/attachments', '/tickets/:id/reports']) {
    const route = routes.find(({ method, args }) => method === 'post' && args[0] === routePath);
    assert.ok(route, `missing POST ${routePath}`);
    const middlewares = route.args.slice(1);
    const limiterIdx = middlewares.indexOf(limiter);
    assert.ok(limiterIdx !== -1, `${routePath}: limiter must run before multipart storage`);
    const uploadHandler = middlewares.slice(limiterIdx + 1).find((fn) => typeof fn === 'function');
    assert.equal(typeof uploadHandler, 'function');
    assert.notEqual(uploadHandler, gate);
  }
  const limiters = ['/tickets/:id/attachments', '/tickets/:id/reports'].map((routePath) => {
    const route = routes.find(({ method, args }) => method === 'post' && args[0] === routePath);
    return route.args.slice(1).find((fn) => fn === limiter);
  });
  assert.equal(limiters[0], limiter);
  assert.equal(limiters[1], limiter);
});
