const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const response = () => ({ locals: {}, code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const load = (file, mocks, env = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    __dirname: path.dirname(path.join(__dirname, '..', file)), process: { env }, console: { error() {} },
  });
  return module.exports;
};
const runUpdate = async (body, { self = false, manager = true, privileged = false } = {}) => {
  let update;
  const controller = load('controllers/employeeController.js', {
    '../utilities/db': { query: async (sql, values) => {
      if (sql.startsWith('SELECT id, employee_id')) return { rows: [{
        id: 8, employee_id: 'E8', full_name: 'Target', role: 'Staff', role_id: 22,
        role_name: 'NOC Executive', can_take_action: 1, status: 'Active',
        blood_group: 'O+', designation: 'Technician', token_version: 3,
      }] };
      if (sql.startsWith('SELECT id, name')) return { rows: [{ id: 23, name: values[0], permissions: {} }] };
      if (sql.startsWith('UPDATE')) update = { sql, values };
      return { rows: [], rowCount: 1 };
    } },
    '../utilities/permissionRegistry': {
      resolvePermission: (_, permission) => permission === 'system.all_access' ? privileged : permission === 'users.manage' ? manager : true,
      isTruthyPermission: v => v === true || v === 1,
      getEffectivePermissions: async () => ({ permissions: {} }),
    },
    '../middleware/auth': { evictAuthCache() {} },
  });
  const res = response();
  await controller.updateEmployee({ user: { id: self ? 8 : 7 }, params: { id: '8' }, body }, res);
  return { res, update };
};

test('profile edits preserve canonical role, role ID, legacy action flag and designation', async () => {
  for (const body of [{ blood_group: ' ab+ ' }, { role: 'NOC Executive', blood_group: 'B-' }]) {
    const { res, update } = await runUpdate(body);
    assert.equal(res.code, 200);
    assert.equal(update.values[8], 'NOC Executive');
    assert.equal(update.values[9], 22);
    assert.equal(update.values[11], 1);
    assert.equal(update.values[3], 'Technician');
    assert.equal(update.values[16], body.blood_group.trim().toUpperCase());
    assert.doesNotMatch(update.sql, /token_version = COALESCE/);
  }
});

test('explicit role changes invalidate sessions; self and HR profile edits preserve assignment', async () => {
  const changed = await runUpdate({ role: 'HR' });
  assert.equal(changed.res.code, 200);
  assert.equal(changed.update.values[8], 'HR');
  assert.equal(changed.update.values[9], 23);
  assert.match(changed.update.sql, /token_version = COALESCE/);
  const legacyName = await runUpdate({ role: 'Staff' });
  assert.equal(legacyName.update.values[8], 'Staff');
  assert.equal(legacyName.update.values[9], 23);
  const own = await runUpdate({ role: 'HR', blood_group: 'A+' }, { self: true });
  assert.equal(own.update.values[8], 'NOC Executive');
  assert.equal(own.update.values[9], 22);
  const hr = await runUpdate({ role: 'HR', blood_group: 'B-' }, { manager: false });
  assert.equal(hr.res.code, 200);
  assert.doesNotMatch(hr.update.sql, /role=/);
  assert.equal(hr.update.values[11], 'B-');
  const denied = await runUpdate({ role: 'Admin' });
  assert.equal(denied.res.code, 403);
  assert.equal(denied.update, undefined);
});

test('profile and employee detail queries include blood group and edit contact fields', async () => {
  for (const [file, method, expected] of [
    ['controllers/profileController.js', 'getUserProfile', ['blood_group', 'role_name', 'work_location', 'employment_type']],
    ['controllers/employeeController.js', 'getEmployeeById', ['blood_group', 'emergency_phone', 'role_name']],
  ]) {
    let sql;
    const controller = load(file, {
      '../utilities/db': { query: async query => { sql = query; return { rows: [{ id: 8, blood_group: 'AB-', role: 'Staff', role_id: 22, role_name: 'NOC Executive' }] }; } },
      '../utilities/permissionRegistry': { resolvePermission: (_, permission) => permission === 'users.edit.any', isTruthyPermission: Boolean },
    });
    const res = response();
    await controller[method]({ user: { id: 7 }, params: { id: '8' }, query: {} }, res);
    assert.equal(res.code, 200);
    for (const field of expected) assert.ok(sql.includes(field), field);
    const row = res.body.user || res.body;
    assert.equal(row.blood_group, 'AB-');
    assert.equal(row.role, 'NOC Executive');
  }
});

test('edit form submits only changed editable fields and preserves masked/private values', async () => {
  const { buildEmployeeUpdate, normalizeEmployeeForm } = await import('../../client/src/utils/employeeForm.js');
  const initial = normalizeEmployeeForm({ id: 8, role: 'Staff', role_name: 'NOC Executive', blood_group: ' ab+ ', status: 'active', present_address: null, work_location: 'Sonadanga Office' });
  assert.equal(initial.blood_group, 'AB+');
  assert.equal(initial.status, 'Active');
  assert.equal(initial.work_location, 'Shonadanga Office');
  const privileges = { canEditProfile: true, canManageAccount: true, isOwnProfile: false };
  assert.deepEqual([...buildEmployeeUpdate(initial, initial, privileges)], []);
  const edited = { ...initial, blood_group: 'O-', emergency_phone: '01700000000', role_id: 999 };
  assert.deepEqual([...buildEmployeeUpdate(edited, initial, privileges)], [['emergency_phone', '01700000000'], ['blood_group', 'O-']]);
  const branchChange = buildEmployeeUpdate({ ...initial, work_location: 'Boyra Office' }, initial, privileges);
  assert.deepEqual([...branchChange], [['work_location', 'Boyra Office']]);
  const nonManagerBranchChange = buildEmployeeUpdate({ ...initial, work_location: 'Boyra Office' }, initial, { ...privileges, canManageAccount: false });
  assert.equal(nonManagerBranchChange.has('work_location'), false);
  const own = buildEmployeeUpdate({ ...initial, role: 'Admin', employee_id: 'new', status: 'Inactive' }, initial, { ...privileges, isOwnProfile: true });
  assert.deepEqual([...own], []);
  const hr = buildEmployeeUpdate({ ...edited, role: 'Admin', password: 'ignored' }, initial, { ...privileges, canManageAccount: false });
  assert.equal(hr.has('role'), false);
  assert.equal(hr.has('password'), false);
});

test('new employees must be assigned a recognized office', async () => {
  const controller = load('controllers/employeeController.js', {
    '../utilities/db': { query: async () => { throw new Error('Database must not be queried for invalid input'); } },
    '../utilities/permissionRegistry': {
      resolvePermission: (_, permission) => permission === 'users.manage',
      isTruthyPermission: Boolean,
      getEffectivePermissions: async () => ({ permissions: {} }),
    },
  });
  for (const work_location of [undefined, 'Unknown Office']) {
    const res = response();
    await controller.addEmployee({
      user: { id: 7 },
      body: { full_name: 'Test Employee', phone: '01712345678', department: 'NOC', work_location },
    }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.field, 'work_location');
  }
});

test('admin password reset hashes the temporary password and forces a change', async () => {
  const queries = [];
  const evicted = [];
  const controller = load('controllers/employeeController.js', {
    '../utilities/db': { query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT id, full_name')) {
        return { rows: [{ id: 8, full_name: 'Target', role: 'Staff', token_version: 4 }] };
      }
      return { rows: [], rowCount: 1 };
    } },
    bcrypt: { hash: async (password, rounds) => {
      assert.equal(password, '123456');
      assert.equal(rounds, 10);
      return '$2b$hashed-temporary-password';
    } },
    '../utilities/permissionRegistry': {
      resolvePermission: (_, permission) => permission === 'users.manage',
      isTruthyPermission: value => value === true || value === 1,
      getEffectivePermissions: async () => ({ isSuperAdmin: false, permissions: {} }),
    },
    '../middleware/auth': { evictAuthCache: id => evicted.push(id) },
  }, { DEFAULT_RESET_PASSWORD: '123456' });
  const res = response();
  await controller.resetEmployeePassword({ user: { id: 7 }, params: { id: '8' } }, res);

  assert.equal(res.code, 200);
  assert.match(res.body.message, /must change it after logging in/);
  assert.equal(res.locals.auditAction, 'ADMIN_PASSWORD_RESET');
  assert.equal(res.locals.auditUserId, 8);
  assert.deepEqual(evicted, [8]);
  const update = queries.find(({ sql }) => sql.startsWith('UPDATE users'));
  assert.ok(update);
  assert.ok(update.sql.includes('must_change_password'));
  assert.ok(update.sql.includes('TRUE'));
  assert.match(update.sql, /token_version = COALESCE\(token_version, 0\) \+ 1/);
  assert.deepEqual([...update.values], ['$2b$hashed-temporary-password', 7, 8, 4]);
});

test('password reset rejects non-admins, self-reset, and delegated resets of all-access accounts', async () => {
  const createController = ({ manager, privileged = false }) => {
    const queries = [];
    const controller = load('controllers/employeeController.js', {
      '../utilities/db': { query: async sql => {
        queries.push(sql);
        return { rows: [{ id: 8, full_name: 'Target', role: 'Staff', token_version: 0 }] };
      } },
      bcrypt: { hash: async () => '$2b$hashed' },
      '../utilities/permissionRegistry': {
        resolvePermission: (_, permission) => permission === 'users.manage' ? manager : privileged,
        isTruthyPermission: value => value === true || value === 1,
        getEffectivePermissions: async () => ({ isSuperAdmin: true, permissions: {} }),
      },
    }, { DEFAULT_RESET_PASSWORD: '123456' });
    return { controller, queries };
  };

  const nonAdmin = createController({ manager: false });
  const denied = response();
  await nonAdmin.controller.resetEmployeePassword({ user: { id: 7 }, params: { id: '8' } }, denied);
  assert.equal(denied.code, 403);
  assert.equal(nonAdmin.queries.length, 0);

  const own = createController({ manager: true });
  const selfDenied = response();
  await own.controller.resetEmployeePassword({ user: { id: 8 }, params: { id: '8' } }, selfDenied);
  assert.equal(selfDenied.code, 400);
  assert.equal(own.queries.length, 0);

  const delegated = createController({ manager: true });
  const privilegedDenied = response();
  await delegated.controller.resetEmployeePassword({ user: { id: 7 }, params: { id: '8' } }, privilegedDenied);
  assert.equal(privilegedDenied.code, 403);
  assert.equal(delegated.queries.some(sql => sql.startsWith('UPDATE')), false);
});

test('concurrent password reset changes return conflict without success audit', async () => {
  const controller = load('controllers/employeeController.js', {
    '../utilities/db': { query: async sql => sql.startsWith('SELECT id, full_name')
      ? { rows: [{ id: 8, full_name: 'Target', role: 'Staff', token_version: 2 }] }
      : { rows: [], rowCount: 0 } },
    bcrypt: { hash: async () => '$2b$hashed' },
    '../utilities/permissionRegistry': {
      resolvePermission: (_, permission) => permission === 'users.manage',
      isTruthyPermission: value => value === true || value === 1,
      getEffectivePermissions: async () => ({ isSuperAdmin: false, permissions: {} }),
    },
    '../middleware/auth': { evictAuthCache() { assert.fail('must not evict on failed update'); } },
  }, { DEFAULT_RESET_PASSWORD: '123456' });
  const res = response();
  await controller.resetEmployeePassword({ user: { id: 7 }, params: { id: '8' } }, res);
  assert.equal(res.code, 409);
  assert.equal(res.locals.auditAction, undefined);
});
