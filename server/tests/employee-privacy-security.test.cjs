const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const load = (file, mocks) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    __dirname: path.dirname(path.join(__dirname, '..', file)), process: { env: {} },
    console: { error() {} },
  });
  return module.exports;
};
const response = () => ({ locals: {}, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('directory profile viewers cannot read others private leave reasons', async () => {
  for (const [own, manage] of [[false, false], [false, true], [true, false]]) {
    let historyQueries = 0;
    const controller = load('controllers/profileController.js', {
      '../utilities/db': { query: async (sql) => {
        if (sql.includes('FROM leave_requests')) {
          historyQueries += 1;
          return { rows: [{ id: 3, reason: 'private medical reason', status: 'Pending' }] };
        }
        return { rows: [{ id: own ? 7 : 8, full_name: 'Target', nid_number: 'private-nid', nid_pic: 'private-scan', present_address: 'private-address' }] };
      } },
      '../utilities/permissionRegistry': { resolvePermission: (_, permission) => permission === 'employees.view' || (permission === 'leave.manage' && manage) },
    });
    const res = response(); await controller.getUserProfile({ user: { id: 7 }, params: { id: own ? '7' : '8' }, query: {} }, res);
    assert.equal(res.code, 200); assert.equal(historyQueries, own || manage ? 1 : 0);
    assert.equal(res.body.leaves.length, own || manage ? 1 : 0);
    if (!own) { assert.equal(res.body.user.nid_number, null); assert.equal(res.body.user.nid_pic, null); }
  }
});

const employee = (targetPrivileged, actorPrivileged, events, concurrentReset = false) => load('controllers/employeeController.js', {
  '../utilities/db': { query: async (sql, params) => {
    events.push(sql);
    if (sql.startsWith('SELECT id, employee_id') || sql.startsWith('SELECT id, full_name')) {
      return { rows: [{ id: 8, employee_id: 'E8', full_name: 'Target', role: 'Staff', status: 'Active', password: '$2b$test', token_version: 0 }] };
    }
    if (concurrentReset && sql.startsWith('UPDATE')) {
      assert.match(sql, /AND COALESCE\(token_version, 0\) = \$\d+$/);
      assert.equal(params.at(-1), 0);
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  } },
  bcrypt: { hash: async () => '$2b$replacement' },
  '../utilities/permissionRegistry': {
    resolvePermission: (_, permission) => permission === 'system.all_access' ? actorPrivileged : true,
    isTruthyPermission: (value) => value === true || value === 1 || value === '1',
    getEffectivePermissions: async () => ({ permissions: { all_access: targetPrivileged }, isSuperAdmin: false }),
  },
  '../middleware/auth': { evictAuthCache() {} },
});

test('employee directory orders active employees before inactive across both list modes', async () => {
  const queries = [];
  const controller = load('controllers/employeeController.js', {
    '../utilities/db': { query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith('SELECT COUNT(*)')) return { rows: [{ total: 1 }] };
      return { rows: [] };
    } },
    '../utilities/permissionRegistry': {
      resolvePermission: () => false,
      isTruthyPermission: Boolean,
      getEffectivePermissions: async () => ({ permissions: {} }),
    },
  });
  const legacyResponse = response();
  await controller.getEmployees({ user: { id: 7 }, query: {} }, legacyResponse);
  const paginatedResponse = response();
  await controller.getEmployees({ user: { id: 7 }, query: { page: '1', limit: '50' } }, paginatedResponse);

  const dataQueries = queries.filter((sql) => sql.startsWith('SELECT id, employee_id'));
  assert.equal(dataQueries.length, 2);
  for (const sql of dataQueries) {
    assert.match(sql, /ORDER BY CASE WHEN LOWER\(TRIM\(COALESCE\(status, ''\)\)\) = 'active' THEN 0 ELSE 1 END, id DESC/);
  }
  assert.equal(legacyResponse.code, 200);
  assert.equal(paginatedResponse.code, 200);
});

test('delegated users managers cannot take over or demote all-access accounts', async () => {
  for (const body of [{ password: 'replacement-password' }, { status: 'Inactive' }, { employee_id: 'changed-id' }]) {
    const events = []; const res = response();
    await employee(true, false, events).updateEmployee({ user: { id: 7 }, params: { id: '8' }, body }, res);
    assert.equal(res.code, 403); assert.equal(events.some((sql) => sql.startsWith('UPDATE')), false);
  }
  const events = []; const res = response();
  await employee(true, false, events).toggleEmployeeStatus({ user: { id: 7 }, params: { id: '8' } }, res);
  assert.equal(res.code, 403); assert.equal(events.some((sql) => sql.startsWith('UPDATE')), false);
});

test('ordinary resets and all-access administrators remain authorized', async () => {
  for (const [targetPrivileged, actorPrivileged] of [[false, false], [true, true]]) {
    const events = []; const res = response();
    await employee(targetPrivileged, actorPrivileged, events).updateEmployee({ user: { id: 7 }, params: { id: '8' }, body: { password: 'replacement-password' } }, res);
    assert.equal(res.code, 200); assert.equal(events.some((sql) => sql.startsWith('UPDATE')), true);
  }
});

test('concurrent security changes prevent restoring stale employee snapshots', async () => {
  const events = []; const res = response();
  await employee(false, false, events, true).updateEmployee({ user: { id: 7 }, params: { id: '8' }, body: { password: 'replacement-password' } }, res);
  assert.equal(res.code, 409); assert.equal(res.locals.auditAction, undefined);
  const toggle = response();
  await employee(false, false, [], true).toggleEmployeeStatus({ user: { id: 7 }, params: { id: '8' } }, toggle);
  assert.equal(toggle.code, 409);
});
