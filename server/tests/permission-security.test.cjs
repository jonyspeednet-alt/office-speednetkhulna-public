const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const load = (file, mocks) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, require: (name) => mocks[name], console: { error() {} },
  });
  return module.exports;
};
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('canonical revoke persists deny for inherited grants and invalidates only after commit', async () => {
  const events = [];
  const client = { query: async (sql, params) => {
    events.push({ sql, params });
    if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 7 }] };
    if (sql.startsWith('SELECT id FROM permissions')) { assert.equal(params[0], 'p_reports'); return { rows: [{ id: 5 }] }; }
    return { rows: [] };
  }, release() { events.push({ sql: 'RELEASE' }); } };
  const controller = load('controllers/permissionController.js', {
    '../utilities/db': { connect: async () => client },
    '../utilities/permissionRegistry': { resolvePermission: () => true, CANONICAL_TO_LEGACY: { 'reports.view': ['p_reports'] } },
    '../middleware/auth': { evictAuthCache: () => events.push({ sql: 'EVICT' }) },
  });
  const res = response(); await controller.updatePermission({ user: {}, body: { user_id: 7, column: 'reports.view', value: 0 } }, res);
  assert.equal(res.code, 200);
  assert.equal(events.find((event) => event.sql.startsWith('INSERT INTO user_permission_overrides')).params[2], 'deny');
  assert(events.findIndex((e) => e.sql === 'COMMIT') < events.findIndex((e) => e.sql === 'EVICT'));
});

test('failed normalized permission mutation rolls back without invalidating sessions', async () => {
  const events = [];
  const client = { query: async (sql) => {
    events.push(sql);
    if (sql.startsWith('SELECT')) return { rows: [{ id: 7 }] };
    if (sql.startsWith('INSERT INTO user_permission_overrides')) throw new Error('write failed');
    return { rows: [] };
  }, release() {} };
  const controller = load('controllers/permissionController.js', {
    '../utilities/db': { connect: async () => client },
    '../utilities/permissionRegistry': { resolvePermission: () => true, CANONICAL_TO_LEGACY: {} },
    '../middleware/auth': { evictAuthCache: () => assert.fail('uncommitted invalidation') },
  });
  const res = response(); await controller.updatePermission({ user: {}, body: { user_id: 7, column: 'p_reports', value: 0 } }, res);
  assert.equal(res.code, 500); assert(events.includes('ROLLBACK')); assert(!events.includes('COMMIT'));
});

test('explicit denial removes legacy defaults from effective permissions', async () => {
  const registry = load('utilities/permissionRegistry.js', { './db': { query: async (sql) => ({
    rows: sql.includes('v_effective_user_permissions') ? [] : [{ legacy_key: 'p_apply_leave' }],
  }) } });
  const { permissions } = await registry.getEffectivePermissions({ id: 7, role: 'Staff' });
  assert.equal(registry.resolvePermission({ role: 'Staff', permissions }, 'leave.apply'), false);
  assert.equal(registry.resolvePermission({ role: 'Staff', permissions }, 'leave.my'), true);
});
