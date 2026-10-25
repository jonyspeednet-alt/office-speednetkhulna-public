const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Engine: server/controllers/reseller/service.js pure rule helpers.
// service.js requires ../../utilities/db, ./utils and ./dbSetup — all mocked
// except utils, which is loaded REAL (with stub db/registry) so
// normalizeBillBwType / BILL_BW_MAP / monthInfo match production.
function load(relative, requireMock) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports: module.exports, require: requireMock, process, console: { ...console, error() {} },
    __dirname: path.dirname(path.join(__dirname, '..', relative)),
  }, { filename: relative });
  return module.exports;
}

const poolStub = { query() { throw new Error('No database in tests'); } };
const registry = load('utilities/permissionRegistry.js', () => poolStub);
const utils = load('controllers/reseller/utils.js', (name) => {
  if (name.includes('permissionRegistry')) return registry;
  return poolStub;
});
const service = load('controllers/reseller/service.js', (name) => {
  if (name.endsWith('utilities/db')) return poolStub;
  if (name === './utils' || name.endsWith('/utils')) return utils;
  if (name.endsWith('reseller/dbSetup')) {
    return { joiningDateExpr: '', hasResellerOtcAppliedMonthColumn: () => false };
  }
  const gate = () => {};
  return new Proxy(gate, { get: () => gate });
});

// Screenshot case: NTTN 1500 Mbps, 01-06 Oct @0.00, 07-31 Oct @8.00,
// bw_billable 500. Discount must split per period at each period's own rate
// (no blended 6.45 line), and the total must stay exact.
test('bw_billable splits per period at period rates', () => {
  const items = [
    { desc: 'NTTN', bw: 1500, rate: 0, days: 6, total: 0, from_day_num: 1, to_day_num: 6, date_range: '01 Oct - 06 Oct', change_type: 'standard' },
    { desc: 'NTTN', bw: 1500, rate: 8, days: 25, total: 9677.42, from_day_num: 7, to_day_num: 31, date_range: '07 Oct - 31 Oct', change_type: 'standard' },
  ];
  const totals = service.sumTypeTotalsFromItems(items);
  const out = service.applyBwBillableRules(
    totals,
    [{ id: 5, rule_type: 'bw_billable', bw_type: 'NTTN', amount: 500, note: 'promo' }],
    { windowDays: 31, daysInMonth: 31 },
  );
  assert.equal(out.waived, 6451.61);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].desc, 'NTTN discount');
  assert.equal(out.items[0].rate, 8);
  assert.equal(out.items[0].days, 25);
  assert.equal(out.items[0].total, -6451.61);
  assert.equal(out.items[0].from_day_num, 7);
  assert.equal(out.items[0].to_day_num, 31);
});

// Two rated periods: lines must sum exactly to the proportional waiver.
test('bw_billable per-period lines sum exactly (rounding absorbed)', () => {
  const items = [
    { desc: 'GGC', bw: 400, rate: 100, days: 10, total: 12903.23, from_day_num: 1, to_day_num: 10, date_range: '01 Oct - 10 Oct', change_type: 'standard' },
    { desc: 'GGC', bw: 400, rate: 110, days: 21, total: 29709.68, from_day_num: 11, to_day_num: 31, date_range: '11 Oct - 31 Oct', change_type: 'standard' },
  ];
  const totals = service.sumTypeTotalsFromItems(items);
  const out = service.applyBwBillableRules(
    totals,
    [{ id: 6, rule_type: 'bw_billable', bw_type: 'GGC', amount: 50 }],
    { windowDays: 31, daysInMonth: 31 },
  );
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].rate, 100);
  assert.equal(out.items[1].rate, 110);
  const sum = Math.round(out.items.reduce((a, i) => a + i.total, 0) * 100) / 100;
  assert.equal(sum, -out.waived);
});

// billable >= average: no waiver lines at all.
test('bw_billable with billable above usage emits nothing', () => {
  const items = [
    { desc: 'GGC', bw: 400, rate: 100, days: 31, total: 40000, from_day_num: 1, to_day_num: 31, change_type: 'standard' },
  ];
  const out = service.applyBwBillableRules(
    service.sumTypeTotalsFromItems(items),
    [{ id: 7, rule_type: 'bw_billable', bw_type: 'GGC', amount: 500 }],
    { windowDays: 31, daysInMonth: 31 },
  );
  assert.equal(out.waived, 0);
  assert.equal(out.items.length, 0);
});
