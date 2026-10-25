const test = require('node:test');
const assert = require('node:assert/strict');
const { financialMonth, lockChannelMonth } = require('../utilities/channelFinancialLock');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const middleware = (query) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/reconciliationLock.js'), 'utf8'), {
    module, console: { error() {} },
    require: (name) => name.endsWith('/db') ? { query } : require('../utilities/channelFinancialLock'),
  });
  return module.exports;
};
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('PostgreSQL date at Bangladesh midnight keeps the same business month', () => {
  assert.equal(financialMonth(new Date('2026-09-01T00:00:00+06:00')), '2026-09');
  assert.equal(financialMonth(new Date('2026-09-01T00:00:00Z')), '2026-09');
  assert.throws(() => financialMonth(new Date('invalid')), error => error.status === 400);
});

test('current and historical completed reconciliation statuses lock financial writes', async () => {
  for (const status of ['approved', 'reconciled', 'finalized']) {
    let scope;
    const client = { async query(sql, args) {
      if (sql.includes('pg_advisory_xact_lock')) scope = args[0];
      return { rows: sql.includes('FROM billing_reconciliation_logs') ? [{ reconciliation_status: status }] : [] };
    } };
    await assert.rejects(lockChannelMonth(client, 42, new Date('2026-09-01T00:00:00+06:00')), error => error.status === 403);
    assert.equal(scope, '42:2026-09');
  }
});

test('pending/draft reconciliation remains writable after the month lock', async () => {
  for (const status of ['pending', 'draft', 'rejected']) {
    const client = { async query(sql) { return { rows: sql.includes('FROM billing_reconciliation_logs') ? [{ reconciliation_status: status }] : [] }; } };
    assert.equal(await lockChannelMonth(client, 42, '2026-09'), '2026-09');
  }
});

test('commission middleware returns a controlled validation failure for invalid months', async () => {
  const guard = middleware(() => assert.fail('invalid month reached SQL'));
  const res = response();
  await guard.checkCommissionMonthLock({ params: { resellerId: 42 }, body: { month: '2026-13' } }, res, () => assert.fail('invalid month accepted'));
  assert.equal(res.statusCode, 400);
});

test('legacy advance date guard queries its actual Bangladesh service month', async () => {
  const guard = middleware(async (sql, args) => {
    if (sql.includes('FROM channel_partner_advances')) return { rows: [{ reseller_id: 42, advance_month: new Date('2026-09-01T00:00:00+06:00') }] };
    assert.equal(args[1], '2026-09');
    assert.match(sql, /reconciliation_status IN \('approved','reconciled','finalized'\)/);
    return { rows: [{}] };
  });
  const res = response();
  await guard.checkAdvanceOwnershipAndLock({ params: { resellerId: 42, advanceId: 7 } }, res, () => assert.fail('legacy locked advance accepted'));
  assert.equal(res.statusCode, 403);
});

test('modifiable reconciliation guard enforces reseller scope before state checks', async () => {
  const guard = middleware(async (sql, args) => {
    assert.match(sql, /WHERE id = \$1 AND reseller_id = \$2/);
    assert.equal(args[1], 99);
    return { rows: [] };
  });
  const res = response();
  await guard.checkReconciliationModifiable({ params: { resellerId: 99, reconciliationId: 7 } }, res, () => assert.fail('foreign scope accepted'));
  assert.equal(res.statusCode, 404);
});
