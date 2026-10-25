const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// SPEC: docs/RECURRING_BILLING_RULES_PLAN.md §2-§4.
// Target (may not exist yet if the parallel engine/controller agent has not
// delivered): server/controllers/reseller/billingRules.js
const CONTROLLER_CANDIDATES = [
  'controllers/reseller/billingRules.js',
  'controllers/reseller/billingRules.cjs',
];

function controllerRel() {
  for (const rel of CONTROLLER_CANDIDATES) {
    if (fs.existsSync(path.join(__dirname, '..', rel))) return rel;
  }
  return null;
}

// Same vm.load pattern as financial-security.test.cjs:8-15.
function load(relative, requireMock) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    module, exports: module.exports, require: requireMock, console: { ...console, error() {} },
    __dirname: path.dirname(path.join(__dirname, '..', relative)),
  }, { filename: relative });
  return module.exports;
}

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } });

// Real permission + audit helpers (same pattern as financial-security.test.cjs:16-17:
// registry gets a no-database stub for whatever it requires; the audit helper
// gets a stub db because every call under test passes an explicit mock client).
const registry = load('utilities/permissionRegistry.js', () => ({ query() { throw new Error('No database in tests'); } }));
const auditHelper = load('utilities/resellerFinancialAudit.js', (name) => {
  if (name.includes('auditLogger')) return { sanitizeValue: (value) => value };
  return { query() { throw new Error('No database in tests'); } };
});

const ADMIN = { id: 7, role_id: 3, full_name: 'Test Admin', permissions: { 'billing.generate_bill': true, 'billing.discount.add': true } };
const VIEWER = { id: 7, role_id: 3, full_name: 'Test Viewer', permissions: { 'billing.logs.view': true } };

const CREATE_NAMES = ['createRule', 'createBillingRule', 'createResellerBillingRule', 'addBillingRule', 'postBillingRule'];
const DEACTIVATE_NAMES = ['deactivateRule', 'deactivateBillingRule', 'deleteBillingRule', 'removeBillingRule', 'stopBillingRule', 'archiveBillingRule', 'updateBillingRule', 'patchBillingRule'];
const LIST_NAMES = ['listRules', 'listBillingRules', 'getBillingRules', 'getRules', 'previewBillingRules'];
const APPLY_NAMES = ['applyBillingRules', 'getActiveRulesForMonth', 'getApplicableRules', 'filterActiveRules', 'calculateWithRules'];

function mockEnv(config = {}) {
  const queries = [];
  const reseller = config.reseller !== undefined
    ? config.reseller
    : { id: 42, partner_type: 'distribution', status: 'active' };
  let selectRules = config.selectRules !== undefined ? config.selectRules : [];
  const router = async (sql, args) => {
    queries.push({ sql: String(sql), args });
    const s = String(sql);
    const up = s.trim().toUpperCase();
    if (up === 'BEGIN' || up === 'COMMIT' || up === 'ROLLBACK') return { rows: [] };
    if (/FROM\s+resellers/i.test(s)) return { rows: reseller ? [reseller] : [] };
    if (/INSERT\s+INTO\s+reseller_billing_rules/i.test(s)) {
      if (config.failInsert) {
        const err = new Error(config.failInsert.message || 'duplicate key value violates unique constraint "uq_rbr_active_reseller_type_month"');
        err.code = config.failInsert.code || '23505';
        throw err;
      }
      return { rows: [{ id: 7, reseller_id: 42, rule_type: 'discount_pct', effective_month: '2026-11-01', amount: 10, is_active: true }] };
    }
    if (/UPDATE\s+reseller_billing_rules/i.test(s)) return { rows: [{ id: 1, is_active: false }] };
    if (/FROM\s+reseller_billing_rules/i.test(s)) {
      const rows = typeof selectRules === 'function' ? selectRules(queries) : selectRules;
      return { rows };
    }
    if (/INSERT\s+INTO\s+reseller_financial_audit_logs/i.test(s)) return { rows: [] };
    return { rows: [] };
  };
  const client = { release() { this.released = true; }, query: router };
  const pool = { query: router, connect: async () => client };
  return { queries, pool, client, setSelectRules(r) { selectRules = r; } };
}

function loadController(env) {
  const rel = controllerRel();
  if (!rel) {
    throw new Error(
      `[billing-rules] controller missing: none of ${CONTROLLER_CANDIDATES.join(', ')} exists yet `
      + `(parallel engine/controller agent has not delivered). SPEC: docs/RECURRING_BILLING_RULES_PLAN.md §2-§4. `
      + `Expected require path: ../controllers/reseller/billingRules`,
    );
  }
  return load(rel, (name) => {
    if (name === './db' || name.endsWith('utilities/db')) return env.pool;
    if (name.includes('resellerFinancialAudit')) return auditHelper;
    if (name.includes('permissionRegistry')) return registry;
    if (name.endsWith('dbSetup')) return { initialize: async () => {} };
    if (name === './utils' || name.endsWith('reseller/utils')) {
      const bwMap = { IIG: 'IIG', BDIX: 'BDIX', GGC: 'GGC', FNA: 'FNA', CDN: 'CDN', BCDN: 'BCDN', NTTN: 'NTTN' };
      return {
        normalizeBillBwType: (raw) => bwMap[String(raw || '').toUpperCase().trim()] || '',
        BILL_BW_MAP: { IIG: {}, BDIX: {}, GGC: {}, FNA: {}, CDN: {}, BCDN: {}, NTTN: {} },
      };
    }
    if (name.endsWith('/service') || name.endsWith('reseller/service')) {
      return { calculateMonthlyBillBreakdown: async () => ({ total: 0, items: [] }) };
    }
    const gate = () => {};
    return new Proxy(gate, { get: () => gate });
  });
}

function requireHandler(mod, names, what) {
  for (const name of names) {
    if (typeof mod[name] === 'function') return { name, fn: mod[name] };
  }
  throw new Error(
    `[billing-rules] ${what} handler missing: controller exports [${Object.keys(mod).join(', ') || 'nothing'}]; looked for ${names.join(', ')}`,
  );
}

function reqFor({ user, body, params, query, method }) {
  return {
    params: { id: 42, resellerId: 42, ruleId: 1, ...(params || {}) },
    body: body || {},
    query: query || {},
    user,
    originalUrl: '/api/resellers/resellers/42/billing-rules',
    method: method || 'POST',
    ip: '127.0.0.1',
    headers: {},
  };
}

const validRule = () => ({ rule_type: 'discount_fixed', effective_month: '2026-11-01', amount: 1000, note: 'test rule' });
const validBwRule = () => ({ rule_type: 'bw_billable', bw_type: 'GGC', effective_month: '2026-11-01', amount: 50, note: 'bill 50 of GGC' });
const hadRuleInsert = (queries) => queries.some((q) => /INSERT\s+INTO\s+reseller_billing_rules/i.test(q.sql));

test('POST rule without permission → 403 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: VIEWER, body: validRule() }), res);
  assert.equal(res.code, 403);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT on 403');
});

test('retired rule_type (discount_pct) → 400 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: { rule_type: 'discount_pct', effective_month: '2026-11-01', amount: 10 } }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT on retired type');
});

test('bw_billable without bw_type → 400 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: { ...validBwRule(), bw_type: undefined } }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT without bw_type');
});

test('bw_billable with invalid bw_type → 400 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: { ...validBwRule(), bw_type: 'XYZ' } }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT on invalid bw_type');
});

test('bw_billable with negative billable → 400 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: { ...validBwRule(), amount: -5 } }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT on negative billable');
});

test('bw_billable create stores bw_type', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: validBwRule() }), res);
  assert.ok(res.code === 200 || res.code === 201, `create should succeed, got ${res.code}`);
  const insert = env.queries.find((q) => /INSERT\s+INTO\s+reseller_billing_rules/i.test(q.sql));
  assert.ok(insert, 'expected a reseller_billing_rules INSERT');
  assert.ok(/bw_type/i.test(insert.sql), 'INSERT must include bw_type column');
});

test('non-01 effective_month → 400 with no INSERT', async () => {
  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: { ...validRule(), effective_month: '2026-11-15' } }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT on non-truncated month');
});

test('overlapping active rule → 409 (unique-violation mapping)', async () => {
  // Overlap is enforced by uq_rbr_active_reseller_type_month: an INSERT for an
  // already-covered (reseller, rule_type, month) raises 23505 inside the txn,
  // which must surface as a friendly 409 (SPEC §4) — never a 500, never COMMIT.
  const env = mockEnv({ failInsert: { code: '23505' } });
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: validRule() }), res);
  assert.equal(res.code, 409);
  assert.ok(env.queries.some(({ sql }) => sql === 'ROLLBACK'), 'overlap must ROLLBACK');
  assert.ok(!env.queries.some(({ sql }) => sql === 'COMMIT'), 'overlap must not COMMIT');
  assert.ok(!env.queries.some((q) => /INSERT\s+INTO\s+reseller_financial_audit_logs/i.test(q.sql)), 'no audit row on failed create');
});

test('channel_partner reseller → 400 with no INSERT', async () => {
  const env = mockEnv({ reseller: { id: 42, partner_type: 'channel_partner', status: 'active' } });
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: validRule() }), res);
  assert.equal(res.code, 400);
  assert.ok(!hadRuleInsert(env.queries), 'no reseller_billing_rules INSERT for channel_partner');
});

test('deactivate is soft-delete and subsequent calc excludes the rule', async () => {
  const current = { id: 1, reseller_id: 42, rule_type: 'bw_billable', bw_type: 'GGC', effective_month: '2026-11-01', end_month: null, amount: 50, note: 'x', is_active: true, deleted_at: null };
  const env = mockEnv({ selectRules: [current] });
  const mod = loadController(env);
  const deact = requireHandler(mod, DEACTIVATE_NAMES, 'deactivate');
  const isUpdateStyle = /update|patch/i.test(deact.name);
  const res = response();
  await deact.fn(reqFor({
    user: ADMIN,
    method: 'DELETE',
    body: isUpdateStyle ? { is_active: false } : {},
  }), res);
  assert.ok(res.code < 400, `deactivate should succeed, got ${res.code}`);
  assert.ok(
    env.queries.some((q) => /UPDATE\s+reseller_billing_rules/i.test(q.sql) && /is_active|deleted_at/i.test(q.sql)),
    'deactivate must soft-delete (UPDATE … is_active / deleted_at)',
  );
  assert.ok(
    !env.queries.some((q) => /^\s*DELETE\s+FROM\s+reseller_billing_rules/i.test(q.sql)),
    'hard DELETE FROM reseller_billing_rules is forbidden (breaks finalized-bill reproducibility)',
  );

  // Subsequent calc must exclude the deactivated rule.
  const apply = APPLY_NAMES.map((n) => (typeof mod[n] === 'function' ? { name: n, fn: mod[n] } : null)).find(Boolean);
  if (apply) {
    const out = await apply.fn(42, '2026-11', [
      { id: 1, rule_type: 'bw_billable', bw_type: 'GGC', amount: 50, is_active: false, deleted_at: '2026-11-02T00:00:00Z' },
      { id: 2, rule_type: 'discount_fixed', amount: 5, is_active: true, deleted_at: null },
    ]);
    const text = JSON.stringify(out);
    assert.ok(!text.includes('"id":1'), `${apply.name} must exclude the deactivated rule`);
    assert.ok(text.includes('"id":2'), `${apply.name} must keep the active rule`);
  } else {
    // SQL-filtered path: the rule-lookup SELECT must carry an active predicate,
    // and a post-deactivation list must not return the stopped rule.
    const list = requireHandler(mod, LIST_NAMES, 'list');
    env.setSelectRules([{ id: 2, rule_type: 'discount_fixed', amount: 5, is_active: true }]);
    const listRes = response();
    await list.fn(reqFor({ user: ADMIN, method: 'GET', query: { month: '2026-11' } }), listRes);
    assert.ok(listRes.code < 400, `list should succeed, got ${listRes.code}`);
    const lookups = env.queries.filter((q) => /^SELECT/i.test(q.sql.trim()) && /FROM\s+reseller_billing_rules/i.test(q.sql));
    assert.ok(lookups.length > 0, 'expected a SELECT FROM reseller_billing_rules lookup');
    assert.ok(lookups.some((q) => /is_active|deleted_at/i.test(q.sql)), 'rule lookup must filter is_active / deleted_at');
    assert.ok(!JSON.stringify(listRes.value ?? {}).includes('"id":1'), 'deactivated rule id=1 must be absent after deactivate');
  }
});

test('update cannot change bw_type → 400 with no UPDATE', async () => {
  const current = { id: 1, reseller_id: 42, rule_type: 'bw_billable', bw_type: 'GGC', effective_month: '2026-11-01', end_month: null, amount: 50, note: 'x', is_active: true, deleted_at: null };
  const env = mockEnv({ selectRules: [current] });
  const mod = loadController(env);
  const update = requireHandler(mod, ['updateRule', 'updateBillingRule', 'patchBillingRule'], 'update');
  const res = response();
  await update.fn(reqFor({ user: ADMIN, method: 'PATCH', body: { amount: 60, bw_type: 'BDIX' } }), res);
  assert.equal(res.code, 400);
  assert.ok(!env.queries.some((q) => /UPDATE\s+reseller_billing_rules/i.test(q.sql)), 'no UPDATE on bw_type change attempt');
});

test('audit row written on create', async () => {  const env = mockEnv();
  const create = requireHandler(loadController(env), CREATE_NAMES, 'create');
  const res = response();
  await create.fn(reqFor({ user: ADMIN, body: validRule() }), res);
  assert.ok(res.code === 200 || res.code === 201, `create should succeed, got ${res.code}`);
  const auditQueries = env.queries.filter((q) => /INSERT\s+INTO\s+reseller_financial_audit_logs/i.test(q.sql));
  assert.ok(auditQueries.length > 0, 'expected a reseller_financial_audit_logs INSERT on create');
  const text = JSON.stringify(auditQueries.map((q) => q.args));
  assert.match(text, /reseller_billing_rules/, 'audit must reference reseller_billing_rules');
  assert.match(text, /BILLING_RULE_CREATE/, 'audit action must be BILLING_RULE_CREATE');
});
