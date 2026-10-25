const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { writeChannelPayments } = require('../utilities/channelPaymentWriter');

function load(relative, requireMock) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports: module.exports, require: requireMock, console: { ...console, error() {} },
    __dirname: path.dirname(path.join(__dirname, '..', relative)),
  }, { filename: relative });
  return module.exports;
}
const registry = load('utilities/permissionRegistry.js', () => ({ query() { throw new Error('No database in tests'); } }));
const authorization = load('utilities/onboardingAuthorization.js', () => registry);
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } });

function routesFor(file) {
  const routes = [];
  const gate = () => {};
  const router = new Proxy({}, { get: (_, method) => (...args) => { if (method !== 'use') routes.push({ method, args }); } });
  const permission = (permissions) => Object.assign((req, res, next) => {
    if (permissions.some((key) => registry.resolvePermission(req.user, key))) next();
    else res.status(403).json({ message: 'Not allowed' });
  }, { permissions });
  load(file, (name) => {
    if (name === 'express') return { Router: () => router };
    if (name.endsWith('checkPermission')) return { requirePermission: (key) => permission([key]), requireAnyPermission: permission };
    if (name.endsWith('uploadMiddleware')) return { upload: { single: () => gate } };
    if (name.includes('Controller')) return new Proxy({}, { get: () => gate });
    if (name === 'express-rate-limit') return Object.assign(() => gate, { ipKeyGenerator: gate });
    return new Proxy(gate, { get: () => gate });
  });
  return routes;
}

test('all channel mutations reject financial view grants while reads remain available', () => {
  const routes = routesFor('routes/channelPartnerRoutes.js');
  for (const permissions of [{ 'billing.logs.view': true }, { 'billing.monthly_summary.view': true }, { p_billing_logs: true }, { p_monthly_summary: true }]) {
    for (const route of routes.filter((route) => route.method !== 'get')) {
      const checks = route.args.filter((arg) => arg?.permissions);
      assert.ok(checks.length, `${route.method} ${route.args[0]} has a write gate`);
      for (const check of checks) {
        const res = response();
        check({ user: { id: 7, role_id: 3, permissions } }, res, () => {});
        assert.equal(res.code, 403, `${route.method} ${route.args[0]}`);
      }
    }
    const read = routes.find((route) => route.method === 'get' && route.args[0] === '/:resellerId/user-payments');
    let passed = false;
    read.args.find((arg) => arg?.permissions)({ user: { id: 7, role_id: 3, permissions } }, response(), () => { passed = true; });
    assert.ok(passed);
  }
  const write = routes.find((route) => route.method === 'post' && route.args[0] === '/products');
  for (const permissions of [{ 'billing.generate_bill': true }, { p_generate_bill: true }]) {
    let passed = false;
    write.args.find((arg) => arg?.permissions)({ user: { id: 7, role_id: 3, permissions } }, response(), () => { passed = true; });
    assert.ok(passed);
  }
});

test('reseller money mutations reject log/summary viewers and retain discount permission', () => {
  const routes = routesFor('routes/resellerRoutes.js');
  const paths = ['/billing-logs', '/resellers/:id/discounts', '/monthly-summary/next-pay-date', '/invoice/:resellerId/finalize'];
  for (const route of routes.filter((route) => route.method !== 'get' && paths.includes(route.args[0]))) {
    const check = route.args.find((arg) => arg?.permissions);
    const res = response();
    check({ user: { id: 7, role_id: 3, permissions: { 'billing.logs.view': true, 'billing.monthly_summary.view': true } } }, res, () => {});
    assert.equal(res.code, 403, route.args[0]);
  }
  const discount = routes.find((route) => route.args[0] === '/resellers/:id/discounts');
  let passed = false;
  discount.args.find((arg) => arg?.permissions)({ user: { id: 7, role_id: 3, permissions: { p_add_discount: true } } }, response(), () => { passed = true; });
  assert.ok(passed);
});

test('onboarding viewers cannot mutate, creators cannot forge approval stages', () => {
  const routes = routesFor('routes/partnerOnboardingRoutes.js');
  for (const permission of ['employees.view', 'appointment_letters.generate', 'reseller.list']) {
    const user = { id: 7, role_id: 3, permissions: { [permission]: true } };
    assert.equal(authorization.canWriteOnboarding(user), false);
    for (const route of routes.filter((route) => route.method !== 'get')) {
      const res = response();
      route.args.find((arg) => arg?.permissions)({ user }, res, () => {});
      assert.equal(res.code, 403, route.args[0]);
    }
  }
  const creator = { id: 7, role_id: 3, permissions: { 'reseller.add': true } };
  const forged = [{ stage: 'Management Approval', name: 'Impersonated reviewer', status: 'approved', signDate: '03/10/2026' }];
  assert.equal(authorization.prepareOnboardingApprovals(creator, 99, forged).error.status, 403);
  assert.equal(authorization.onboardingStatusError(creator, 99, 'submitted', 'approved').status, 403);
  const reviewer = { id: 8, role_id: 3, full_name: 'Actual mock reviewer', permissions: { 'reseller.requests.approve': true } };
  assert.equal(authorization.prepareOnboardingApprovals(reviewer, 8, forged).error.status, 403);
  const prepared = authorization.prepareOnboardingApprovals(reviewer, 7, forged);
  assert.equal(prepared.approvals[0].name, 'Actual mock reviewer');
  assert.match(prepared.approvals[0].signDate, /^\d{4}-\d{2}-\d{2}$/);
  const previous = [{ stage: 'Management Approval', approver_name: 'Historical mock reviewer', status: 'approved', sign_date: '2026-10-01' }];
  const untouched = [{ stage: 'Management Approval', name: 'Historical mock reviewer', status: 'approved', signDate: '01/10/2026' }];
  assert.ok(authorization.prepareOnboardingApprovals(creator, 7, untouched, previous).approvals);
  assert.equal(authorization.prepareOnboardingApprovals(creator, 7, [{ ...untouched[0], status: 'pending' }], previous).error.status, 403);
});

function paymentPool({ users = [{ id: 100, monthly_rate: 50 }], current = [], status = 'pending', failWrite = 0 } = {}) {
  const queries = [];
  let writes = 0;
  const client = { released: false, release() { this.released = true; }, async query(sql, args) {
    queries.push({ sql, args });
    if (sql.includes('FROM billing_reconciliation_logs')) return { rows: [{ reconciliation_status: status }] };
    if (sql.includes('FROM channel_partner_users')) return { rows: users };
    if (sql.includes('SELECT user_id, reseller_id')) return { rows: current };
    if (sql.includes('INSERT INTO channel_user_payments')) {
      if (++writes === failWrite) throw new Error('Simulated write failure');
      return { rows: [{ user_id: args[1], reseller_id: args[0], amount_paid: args[5] }] };
    }
    return { rows: [] };
  } };
  return { pool: { connect: async () => client, query() { throw new Error('Transaction must use its connection'); } }, client, queries };
}
const calculate = (amountDue, paid) => ({ amountDue, billingStatus: 'mock', realized: Math.min(amountDue, paid), deferred: Math.max(0, amountDue - paid), paymentStatus: 'mock' });

test('single and mixed bulk reject foreign users before any payment write', async () => {
  for (const payments of [[{ user_id: 999, paid: 10 }], [{ user_id: 100, paid: 10 }, { user_id: 999, paid: 10 }]]) {
    const mock = paymentPool({ users: payments.length === 1 ? [] : [{ id: 100, monthly_rate: 50 }] });
    await assert.rejects(writeChannelPayments(mock.pool, 42, '2026-10', payments, calculate), (error) => error.status === 403);
    assert.ok(mock.queries.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(!mock.queries.some(({ sql }) => sql.includes('INSERT INTO')));
    assert.ok(mock.client.released);
  }
});

test('reconciliation is rechecked and locked inside payment transaction; stale foreign payment rejected', async () => {
  for (const config of [{ status: 'approved' }, { current: [{ user_id: 100, reseller_id: 99, amount_due: 50 }] }]) {
    const mock = paymentPool(config);
    await assert.rejects(writeChannelPayments(mock.pool, 42, '2026-10', [{ user_id: 100, paid: 10 }], calculate), (error) => error.status === 403);
    const check = mock.queries.find(({ sql }) => sql.includes('FROM billing_reconciliation_logs'));
    assert.match(check.sql, /FOR UPDATE/);
    assert.equal(mock.queries[0].sql, 'BEGIN');
    assert.ok(!mock.queries.some(({ sql }) => sql.includes('INSERT INTO')));
  }
});

test('successful payments use reseller-qualified upsert and bulk errors rollback atomically', async () => {
  const mock = paymentPool();
  const rows = await writeChannelPayments(mock.pool, 42, '2026-10', [{ user_id: 100, paid: 10 }], calculate);
  assert.equal(rows[0].reseller_id, 42);
  assert.match(mock.queries.find(({ sql }) => sql.includes('INSERT INTO')).sql, /WHERE channel_user_payments.reseller_id=EXCLUDED.reseller_id/);
  assert.ok(mock.queries.some(({ sql }) => sql === 'COMMIT'));
  const failure = paymentPool({ users: [{ id: 100, monthly_rate: 50 }, { id: 101, monthly_rate: 60 }], failWrite: 2 });
  await assert.rejects(writeChannelPayments(failure.pool, 42, '2026-10', [{ user_id: 100, paid: 10 }, { user_id: 101, paid: 10 }], calculate), /Simulated write failure/);
  assert.ok(failure.queries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!failure.queries.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(failure.client.released);
});

test('initialized zero due is preserved instead of replaced with monthly rate', async () => {
  const mock = paymentPool({ current: [{ user_id: 100, reseller_id: 42, amount_due: 0 }] });
  await writeChannelPayments(mock.pool, 42, '2026-10', [{ user_id: 100, paid: 10 }], calculate);
  assert.equal(mock.queries.find(({ sql }) => sql.includes('INSERT INTO')).args[4], 0);
  assert.ok(mock.client.released);
});

test('month advisory lock closes the absent reconciliation row race with approval', async () => {
  const { withChannelMonthTransaction } = require('../utilities/channelFinancialLock');
  let busy = false;
  const queue = [];
  let approved = false;
  let paymentAtUsers;
  const reachedUsers = new Promise((resolve) => { paymentAtUsers = resolve; });
  let resumePayment;
  const pausePayment = new Promise((resolve) => { resumePayment = resolve; });
  let approvalWaiting;
  const waiting = new Promise((resolve) => { approvalWaiting = resolve; });
  let first = true;
  const pool = { async connect() {
    let ownsLock = false;
    return { release() {}, async query(sql, args) {
      if (sql.includes('pg_advisory_xact_lock')) {
        assert.equal(args[0], '42:2026-10');
        if (busy) { approvalWaiting(); await new Promise((resolve) => queue.push(resolve)); }
        busy = true; ownsLock = true; return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        if (ownsLock) { ownsLock = false; busy = false; queue.shift()?.(); }
        return { rows: [] };
      }
      if (sql.includes('FROM billing_reconciliation_logs')) return { rows: approved ? [{ reconciliation_status: 'approved' }] : [] };
      if (sql.includes('FROM channel_partner_users')) {
        if (first) { first = false; paymentAtUsers(); await pausePayment; }
        return { rows: [{ id: 100, monthly_rate: 50 }] };
      }
      if (sql.includes('INSERT INTO channel_user_payments')) return { rows: [{ user_id: 100, reseller_id: 42 }] };
      return { rows: [] };
    } };
  } };
  const payment = writeChannelPayments(pool, 42, '2026-10', [{ user_id: 100, paid: 10 }], calculate);
  await reachedUsers;
  let approvalRan = false;
  const approval = withChannelMonthTransaction(pool, 42, '2026-10', async () => { approvalRan = true; approved = true; });
  await waiting;
  assert.equal(approvalRan, false);
  resumePayment();
  await payment; await approval;
  assert.equal(approvalRan, true);
  await assert.rejects(writeChannelPayments(pool, 42, '2026-10', [{ user_id: 100, paid: 10 }], calculate), (error) => error.status === 403);
});

function advanceManager(config = {}) {
  const queries = [];
  const client = { release() { this.released = true; }, async query(sql, args) {
    queries.push({ sql, args });
    if (sql.includes('FROM billing_reconciliation_logs')) return { rows: config.locked ? [{ reconciliation_status: 'approved' }] : [] };
    if (sql.includes('FROM channel_partner_users')) return { rows: config.foreign ? [] : [{ id: 100 }] };
    if (sql.includes('SELECT reseller_id, advance_month')) return { rows: config.foreign ? [] : [{ reseller_id: 42, advance_month: '2026-10-01' }] };
    if (sql.includes('SELECT * FROM channel_partner_advances')) return { rows: [{ id: 1, reseller_id: 42, advance_month: '2026-10-01', advance_amount: 10, settlement_status: 'pending_adjustment' }] };
    if (sql.includes('INSERT INTO channel_partner_advances')) return { rows: [{ id: 1, advance_amount: 10 }] };
    return { rows: [] };
  } };
  const manager = load('utilities/partnerAdvanceManager.js', (name) => {
    if (name === './db') return { connect: async () => client };
    if (name === './auditLogger') return { logFinancialTransaction: async () => {} };
    if (name === './channelFinancialLock') return require('../utilities/channelFinancialLock');
    throw new Error(name);
  });
  return { manager, queries, client };
}

test('single and bulk advances validate positive finite amounts and bounded batches', async () => {
  for (const amount of [-1, NaN, Infinity, 0]) {
    const mock = advanceManager();
    await assert.rejects(mock.manager.recordAdvance(42, 100, '2026-10-01', amount, 'self_paid', 7), (error) => error.status === 400);
    assert.ok(!mock.queries.some(({ sql }) => sql.includes('INSERT')));
    assert.ok(mock.client.released);
  }
  for (const advances of [[{ user_id: 100, advance_amount: -1 }], [null], [{ user_id: 100, advance_amount: 1, advance_type: 'unsupported' }], Array.from({ length: 201 }, () => ({ user_id: 100, advance_amount: 1 }))]) {
    const mock = advanceManager();
    await assert.rejects(mock.manager.recordBulkAdvances(42, advances, 7), (error) => error.status === 400);
    assert.ok(!mock.queries.some(({ sql }) => sql.includes('INSERT')));
  }
});

test('foreign and locked advances cannot insert or transition after route prechecks', async () => {
  for (const config of [{ foreign: true }, { locked: true }]) {
    const mock = advanceManager(config);
    await assert.rejects(mock.manager.recordAdvance(42, 100, '2026-10-01', 10, 'self_paid', 7));
    await assert.rejects(mock.manager.recordBulkAdvances(42, [{ user_id: 100, advance_amount: 10 }], 7));
    await assert.rejects(mock.manager.applyAdvanceAdjustment(1, 7, 42));
    await assert.rejects(mock.manager.disputeAdvance(1, 7, 'Mock reason', 42));
    await assert.rejects(mock.manager.reverseAdvance(1, 7, 'Mock reason', 42));
    assert.ok(!mock.queries.some(({ sql }) => /^(INSERT|UPDATE)/.test(sql.trim())));
    assert.ok(mock.queries.some(({ sql }) => sql === 'ROLLBACK'));
  }
});

test('product transaction rechecks month and owner before deleting or inserting usage', async () => {
  for (const foreign of [false, true]) {
    const queries = [];
    const client = { release() {}, async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes('FROM billing_reconciliation_logs')) return { rows: foreign ? [] : [{ reconciliation_status: 'approved' }] };
      if (sql.includes('FROM channel_commission_logs')) return { rows: [] };
      if (sql.includes('FROM channel_partner_users')) return { rows: [] };
      return { rows: [] };
    } };
    const controller = load('controllers/channelProductController.js', (name) => {
      if (name.endsWith('/db')) return { connect: async () => client };
      if (name.endsWith('channelPartnerInit')) return { initChannelPartnerTables: async () => {} };
      if (name.endsWith('channelFinancialLock')) return require('../utilities/channelFinancialLock');
      if (name.endsWith('channelProductHelpers')) return { monthToServiceDate: () => '2026-10-01', isCommissionMonthLocked: async () => false, roundAmount: Number };
      return {};
    });
    const res = response();
    await controller.saveUserProducts({ params: { resellerId: 42, userId: 100 }, body: { month: '2026-10', items: [{ product_id: 1, quantity: 1 }] }, user: { id: 7 } }, res);
    assert.equal(res.code, foreign ? 404 : 403);
    assert.ok(!queries.some(({ sql }) => /^(DELETE|INSERT)/.test(sql.trim())));
    assert.ok(queries.some(({ sql }) => sql === 'ROLLBACK'));
  }
});

test('racing reconciliation approval or rejection cannot overwrite a changed status', async () => {
  for (const method of ['approveReconciliation', 'rejectReconciliation']) {
    const queries = [];
    const client = { release() {}, async query(sql, args) {
      queries.push({ sql, args });
      if (sql.includes('FROM billing_reconciliation_logs')) return { rows: [{ id: 1, reseller_id: 42, reconciliation_month: '2026-10-01', reconciliation_status: 'approved' }] };
      return { rows: [] };
    } };
    const pool = { connect: async () => client, async query(sql, args) {
      queries.push({ sql, args });
      if (/UPDATE billing_reconciliation_logs/.test(sql)) {
        assert.match(sql, /reconciliation_status IN \('pending','draft'\)/);
        return { rows: [] };
      }
      return { rows: [{ id: 1, reseller_id: 42, reconciliation_month: '2026-10-01', reconciliation_status: 'pending' }] };
    } };
    const controller = load('controllers/channelPartnerController.js', (name) => {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('channelPartnerInit')) return { initChannelPartnerTables: async () => {} };
      if (name.endsWith('channelFinancialLock')) return require('../utilities/channelFinancialLock');
      return {};
    });
    const res = response();
    await controller[method]({ params: { resellerId: 42, reconciliationId: 1 }, body: { reason: 'Mock reason' }, user: { id: 7 } }, res);
    assert.equal(res.code, 409);
    if (method === 'approveReconciliation') {
      assert.ok(!queries.some(({ sql }) => /UPDATE billing_reconciliation_logs/.test(sql)));
      assert.ok(queries.some(({ sql }) => sql === 'ROLLBACK'));
    }
  }
});
