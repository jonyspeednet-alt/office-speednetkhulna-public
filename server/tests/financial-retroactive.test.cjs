const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModule(file, mocks = {}) {
  const mod = { exports: {} };
  const fullPath = path.join(__dirname, '..', file);
  const code = fs.readFileSync(fullPath, 'utf8');
  vm.runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    Date,
    Intl,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    parseInt,
    parseFloat,
    console: { error() {}, warn() {}, log() {} },
    __dirname: path.dirname(fullPath),
    require(reqPath) {
      if (reqPath in mocks) return mocks[reqPath];
      for (const [key, val] of Object.entries(mocks)) {
        if (reqPath.endsWith(key) || key.endsWith(reqPath)) return val;
      }
      return require(reqPath);
    },
  }, { filename: fullPath });
  return mod.exports;
}

const mockResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.body = data;
    return this;
  },
});

test('previewRetroactiveCorrection rejects missing or invalid inputs', async () => {
  const retroactive = loadModule('controllers/reseller/retroactiveCorrection.js', {
    '../../utilities/db': { query: async () => ({ rows: [] }) },
    './utils': require('../controllers/reseller/utils'),
    './service': { calculateMonthlyBillBreakdown: async () => ({ total: 1000, items: [] }) },
    '../../utilities/resellerFinancialAudit': { getActor: () => ({}), getReqMeta: () => ({}) },
  });

  // Invalid reseller ID
  const res1 = mockResponse();
  await retroactive.previewRetroactiveCorrection({ params: { resellerId: 'invalid' }, body: {} }, res1);
  assert.equal(res1.statusCode, 400);

  // Missing or invalid bandwidth type
  const res2 = mockResponse();
  await retroactive.previewRetroactiveCorrection({
    params: { resellerId: 31 },
    body: { bw_type: 'INVALID_BW', change_type: 'increase', amount: 500, effective_date: '2026-08-12' },
  }, res2);
  assert.equal(res2.statusCode, 400);

  // Negative or zero amount
  const res3 = mockResponse();
  await retroactive.previewRetroactiveCorrection({
    params: { resellerId: 31 },
    body: { bw_type: 'NTTN', change_type: 'increase', amount: 0, effective_date: '2026-08-12' },
  }, res3);
  assert.equal(res3.statusCode, 400);

  // Missing effective date
  const res4 = mockResponse();
  await retroactive.previewRetroactiveCorrection({
    params: { resellerId: 31 },
    body: { bw_type: 'NTTN', change_type: 'increase', amount: 500, effective_date: '' },
  }, res4);
  assert.equal(res4.statusCode, 400);
});

test('applyRetroactiveCorrection requires mandatory admin note', async () => {
  const retroactive = loadModule('controllers/reseller/retroactiveCorrection.js', {
    '../../utilities/db': {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
    },
    './utils': require('../controllers/reseller/utils'),
    './service': { calculateMonthlyBillBreakdown: async () => ({ total: 1000, items: [] }) },
    '../../utilities/resellerFinancialAudit': { getActor: () => ({}), getReqMeta: () => ({}) },
  });

  const res = mockResponse();
  await retroactive.applyRetroactiveCorrection({
    params: { resellerId: 31 },
    body: {
      bw_type: 'NTTN',
      change_type: 'increase',
      amount: 500,
      effective_date: '2026-08-12',
      admin_note: '   ', // empty string after trim
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Admin note.*required/i);
});

test('retroactive correction rejects channel partner accounts', async () => {
  const mockPool = {
    query: async (sql) => {
      if (sql.includes('FROM resellers')) {
        return {
          rows: [{
            id: 31,
            partner_type: 'channel_partner',
            reseller_name: 'CP Reseller',
          }],
        };
      }
      return { rows: [] };
    },
  };

  const retroactive = loadModule('controllers/reseller/retroactiveCorrection.js', {
    '../../utilities/db': mockPool,
    './utils': require('../controllers/reseller/utils'),
    './service': { calculateMonthlyBillBreakdown: async () => ({ total: 1000, items: [] }) },
    '../../utilities/resellerFinancialAudit': { getActor: () => ({}), getReqMeta: () => ({}) },
  });

  const res = mockResponse();
  await retroactive.previewRetroactiveCorrection({
    params: { resellerId: 31 },
    body: {
      bw_type: 'NTTN',
      change_type: 'increase',
      amount: 500,
      effective_date: '2026-08-12',
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Channel Partners use commission billing/i);
});
