const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const financialError = (status, message) => Object.assign(new Error(message), { status });
function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, Date, Intl, console: { error() {}, warn() {}, log() {} },
    __dirname: path.dirname(path.join(__dirname, '..', file)),
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.endsWith('channelFinancialLock')) return { ...require('../utilities/channelFinancialLock'), financialError, lockChannelMonth: async () => {} };
      if (name.endsWith('channelPartnerInit')) return { initChannelPartnerTables: async () => {} };
      return {};
    },
  }, { filename: file });
  return module.exports;
}
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('malformed single payment inputs cannot reach the transactional writer', async () => {
  let writes = 0;
  const controller = load('controllers/channelPartnerController.js', {
    '../utilities/channelPaymentWriter': { writeChannelPayments() { writes++; throw new Error('Unexpected write'); } },
  });
  for (const amount_paid of ['not-an-amount', '12junk', '1e3', '', null, undefined, {}, [], true, Infinity, NaN]) {
    const res = response();
    await controller.recordUserPayment({ params: { resellerId: 1 }, body: { user_id: 2, month: '2026-07', amount_paid } }, res);
    assert.equal(res.code, 400, String(amount_paid));
  }
  assert.equal(writes, 0);
});

test('bulk payment validates every amount before its first write', async () => {
  let writes = 0;
  const controller = load('controllers/channelPartnerController.js', {
    '../utilities/channelPaymentWriter': { writeChannelPayments() { writes++; } },
  });
  for (const invalid of [{ user_id: 2, amount_paid: 'abc' }, null]) {
    const res = response();
    await controller.bulkRecordPayments({ params: { resellerId: 1 }, body: { month: '2026-07', payments: [{ user_id: 1, amount_paid: 10 }, invalid] } }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(writes, 0);
});

test('explicit zero, decimal and correctly grouped amounts retain their value', async () => {
  const values = [];
  const controller = load('controllers/channelPartnerController.js', {
    '../utilities/channelPaymentWriter': { async writeChannelPayments(pool, reseller, month, payments) { values.push(payments[0].paid); throw financialError(403, 'Stop after validation'); } },
  });
  for (const amount_paid of [0, 12.5, '1,234.50']) {
    await controller.recordUserPayment({ params: { resellerId: 1 }, body: { user_id: 2, month: '2026-07', amount_paid } }, response());
  }
  assert.deepEqual(values, [0, 12.5, 1234.5]);
});

test('modern reconciliation details and PDF resolve by both reseller and record IDs', async () => {
  const calls = [];
  let rendered = 0;
  const controller = load('controllers/channelPartnerController.js', {
    '../utilities/db': { async query(sql, args) { calls.push({ sql, args }); return { rows: [] }; } },
    '../utilities/reportGenerator': { async generateReconciliationReport() { rendered++; } },
  });
  for (const fn of ['getReconciliationDetails', 'downloadReconciliationReport']) {
    const res = response();
    await controller[fn]({ params: { resellerId: '3', reconciliationId: '42' } }, res);
    assert.equal(res.code, 404);
  }
  for (const { sql, args } of calls) {
    assert.match(sql, /WHERE brl\.id = \$1 AND brl\.reseller_id = \$2/);
    assert.deepEqual(Array.from(args), ['42', '3']);
  }
  assert.equal(rendered, 0);
});

test('missing legacy reconciliation and report return 404 domain errors', async () => {
  const reconciliation = load('utilities/billingReconciliation.js', { './db': { async query() { return { rows: [] }; } } });
  await assert.rejects(reconciliation.getReconciliationStatus(42), { status: 404 });
  await assert.rejects(reconciliation.getReconciliationReport(3, new Date('2026-07-01')), { status: 404 });
});

test('repeated advance application rolls back without a second adjustment or audit write', async () => {
  const calls = [];
  let audits = 0;
  const client = { release() {}, async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT reseller_id')) return { rows: [{ reseller_id: 3, advance_month: '2026-07-01' }] };
    if (sql.startsWith('SELECT *')) return { rows: [{ settlement_status: 'adjusted' }] };
    return { rows: [] };
  } };
  const advances = load('utilities/partnerAdvanceManager.js', {
    './db': { async connect() { return client; } },
    './auditLogger': { async logFinancialTransaction() { audits++; } },
  });
  await assert.rejects(advances.applyAdvanceAdjustment(42, 1, 3), { status: 409 });
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some((sql) => /^(INSERT|UPDATE)/.test(sql)), false);
  assert.equal(audits, 0);
});

test('legacy completed reconciliation statuses cannot be reinitiated', async () => {
  for (const reconciliation_status of ['approved', 'reconciled', 'finalized']) {
    const calls = [];
    const client = { release() {}, async query(sql) { calls.push(sql); return { rows: sql.startsWith('SELECT') ? [{ reconciliation_status }] : [] }; } };
    const reconciliation = load('utilities/billingReconciliation.js', { './db': { async connect() { return client; } } });
    await assert.rejects(reconciliation.initiateReconciliation(3, new Date('2026-07-01'), 1), { status: 409 });
    assert.ok(calls.includes('ROLLBACK'));
    assert.equal(calls.some((sql) => sql.startsWith('INSERT')), false);
  }
});

test('PDF month normalizes PostgreSQL DATE strings and Date objects in Dhaka', () => {
  const report = load('utilities/reportGenerator.js', {});
  assert.equal(report.normalizeReconciliationMonth('2026-07'), '2026-07');
  assert.equal(report.normalizeReconciliationMonth('2026-07-01'), '2026-07');
  assert.equal(report.normalizeReconciliationMonth(new Date('2026-06-30T18:00:00Z')), '2026-07');
  assert.throws(() => report.normalizeReconciliationMonth('2026-13-01'), { status: 400 });
  assert.throws(() => report.normalizeReconciliationMonth(new Date('invalid')), { status: 400 });
});

test('missing reseller finalization returns a domain 404 before bill calculation', async () => {
  const billing = load('controllers/reseller/billing.js', {
    './utils': { monthInfo: () => ({ monthStartStr: '2026-07-01' }) },
  });
  const client = { async query() { return { rows: [] }; } };
  await assert.rejects(billing.finalizeResellerBill(client, { resellerId: 123, monthYm: '2026-07' }), { status: 404 });
});

test('finalize endpoint controls invalid ID/month and propagates missing reseller status', async () => {
  let finalized = 0;
  const client = { async query() { return { rows: [] }; }, release() {} };
  const controller = load('controllers/resellerController.js', {
    '../utilities/db': { async connect() { return client; } },
    './reseller/dbSetup': { initialize: async () => {} },
    './reseller/utils': { getDhakaMonthYm: () => '2026-07', parseAmount: () => 0 },
    '../utilities/resellerFinancialAudit': { getActor: () => ({}), getReqMeta: () => ({}) },
    './reseller/billing': { async finalizeResellerBill() { finalized++; throw financialError(404, 'Reseller not found'); } },
  });
  for (const [resellerId, month] of [['1junk', '2026-07'], ['3', '2026-13'], ['3', '2026-07-15']]) {
    const res = response();
    await controller.finalizeInvoice({ params: { resellerId }, body: { month } }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(finalized, 0);
  const res = response();
  await controller.finalizeInvoice({ params: { resellerId: '123' }, body: { month: '2026-07' } }, res);
  assert.equal(res.code, 404);
});

test('transaction deduction queries reuse the held connection with a single-slot pool', async () => {
  let fallbackQueries = 0;
  const helper = load('utilities/channelProductHelpers.js', {
    './db': { query() { fallbackQueries++; throw new Error('Pool max=1: connection already held'); } },
  });
  const sqls = [];
  const heldClient = { async query(sql) {
    sqls.push(sql);
    return { rows: sql.includes('manual_product_charges') ? [] : [{ total: '12.50' }] };
  } };
  assert.equal(await helper.getProductDeductionForMonth(3, '2026-07', heldClient), 12.5);
  assert.equal(fallbackQueries, 0);
  assert.equal(sqls.length, 2);
  const manualClient = { async query() { return { rows: [{ amount: '20.00' }] }; } };
  assert.equal(await helper.getProductDeductionForMonth(3, '2026-07', manualClient), 20);
  assert.equal(fallbackQueries, 0);
});

test('reconciliation transaction passes its held client into deduction helper', async () => {
  let usedHeldClient = false;
  const client = { release() {}, async query(sql) {
    if (sql.includes('SELECT id, reconciliation_status')) return { rows: [] };
    if (sql.includes('COUNT(*)')) return { rows: [{ total_users: 1 }] };
    if (sql.includes('FROM resellers')) return { rows: [{ partner_type: 'channel_partner' }] };
    return { rows: [{}] };
  } };
  const helpers = load('utilities/channelProductHelpers.js', { './db': { query() { throw new Error('Pool max=1 already held'); } } });
  const reconciliation = load('utilities/billingReconciliation.js', {
    './db': { async connect() { return client; }, query() { throw new Error('Unexpected pool acquisition'); } },
    './channelProductHelpers': { async getProductDeductionForMonth(id, month, passedClient) {
      assert.equal(passedClient, client);
      usedHeldClient = true;
      // Independent deduction subqueries must use this transaction's client.
      return helpers.getProductDeductionForMonth(id, month, passedClient);
    } },
  });
  await reconciliation.initiateReconciliation(3, new Date('2026-07-01'), 1);
  assert.equal(usedHeldClient, true);
});

test('PDF URL is a protected scoped route and download streams a private PDF', async () => {
  const reconciliation = { id: 42, reseller_id: 3 };
  const controller = load('controllers/channelPartnerController.js', {
    path,
    '../utilities/db': { async query() { return { rows: [reconciliation] }; } },
    '../utilities/reportGenerator': { async generateReconciliationReport() { return '/reports/reconciliation_3_202607.pdf'; } },
  });
  const params = { resellerId: '3', reconciliationId: '42' };
  const metadata = response();
  await controller.downloadReconciliationReport({ params, query: {} }, metadata);
  assert.equal(metadata.body.pdf_url, '/api/channel-partners/3/reconciliation/42/report?download=1');
  let sent;
  const download = { ...response(), sendFile(filename, options, callback) { sent = { filename, options }; callback(); } };
  await controller.downloadReconciliationReport({ params, query: { download: '1' } }, download);
  assert.equal(path.basename(sent.filename), 'reconciliation_3_202607.pdf');
  assert.equal(sent.options.headers['Content-Type'], 'application/pdf');
  assert.equal(sent.options.headers['Cache-Control'], 'private, no-store');
  assert.equal(download.body, undefined);
});
