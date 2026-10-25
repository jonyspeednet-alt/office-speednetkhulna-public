const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { success, fail, serverError } = require('../utilities/apiResponse');
const { BRANCHES, normalizeOfficeName } = require('../constants/branches');
const isFieldTechnician = (user) => Boolean(
  user?.permissions?.['support.ticket.update']
  && !user?.permissions?.['support.ticket.assign']
  && !user?.is_super_admin,
);

function loadScope() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supportOfficeScope.js'), 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (name.endsWith('/db')) return { query: async () => ({ rows: [] }) };
      if (name.endsWith('/branches')) return { BRANCHES, normalizeOfficeName };
      throw new Error(`Unexpected scope dependency ${name}`);
    },
  });
  return module.exports;
}

const { resolveSupportOffice, appendSupportOfficeScope } = loadScope();

function loadController(pool) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'supportReportController.js'), 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('/apiResponse')) return { success, fail, serverError };
      if (name.endsWith('/technicianScope')) return { isFieldTechnician };
      if (name.endsWith('/supportOfficeScope')) return { resolveSupportOffice, appendSupportOfficeScope };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const reportRows = [
  { dimension: 'userId', value: 'sn-100', label: 'sn-100', count: 3 },
  { dimension: 'connectionType', value: 'Fiber', label: 'Fiber', count: 3 },
  { dimension: 'category', value: '4', label: 'Slow speed', count: 2 },
  { dimension: 'vlan', value: '200', label: 'VLAN 200', count: 2 },
  { dimension: 'technician', value: '42', label: 'Tech One', count: 3 },
];

test('technician register returns monthly rows, totals and all grouped dimensions', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 3 }] };
      if (sql.includes('unique_users')) return { rows: [{ unique_users: 2, technicians: 1 }] };
      if (sql.includes('SELECT dimension, value, label')) return { rows: reportRows };
      return { rows: [{ ticket_id: 17, user_id: 'sn-100', phone: '01700000000' }] };
    },
  };
  const { getTechnicianSupportRegister } = loadController(pool);
  const req = {
    query: { month: '2026-09', page: '1', limit: '25' },
    user: { work_location: 'Corporate Office' },
    supportOfficeScope: resolveSupportOffice({ work_location: 'Corporate Office' }),
  };
  const res = response();

  await getTechnicianSupportRegister(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.month, '2026-09');
  assert.equal(res.body.data.summary.tickets, 3);
  assert.equal(res.body.data.summary.uniqueUsers, 2);
  assert.equal(res.body.data.summary.technicians, 1);
  assert.equal(res.body.data.totalPages, 1);
  assert.equal(res.body.data.rows[0].ticket_id, 17);
  for (const dimension of ['userId', 'connectionType', 'category', 'vlan', 'technician']) {
    assert.equal(res.body.data.groups[dimension].length, 1);
  }
  assert.equal(calls.length, 4);
  const query = calls.find((call) => call.sql.includes('SELECT dimension, value, label'));
  assert.match(query.sql, /AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(query.sql, /t\.status IN \('closed', 'resolved'\)/);
  assert.match(query.sql, /GROUP BY dimension, value, label/);
  assert.equal(query.params.length, 1);
  assert.equal(query.params[0], '2026-09');
  for (const call of calls) {
    assert.match(call.sql, /t\.status IN \('closed', 'resolved'\)/);
  }
});

test('office and field-technician scope stay in the parameterized report query', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 28 }] };
      if (sql.includes('unique_users')) return { rows: [{ unique_users: 4, technicians: 2 }] };
      if (sql.includes('SELECT dimension, value, label')) return { rows: [] };
      return { rows: [] };
    },
  };
  const { getTechnicianSupportRegister } = loadController(pool);
  const req = {
    query: { month: '2026-10', page: '4', limit: '999', category: '4', technician: '91', sortBy: 'createdDate', sortDirection: 'asc' },
    user: { id: 77, work_location: 'Shonadanga Office', permissions: { 'support.ticket.update': true } },
    supportOfficeScope: resolveSupportOffice({ work_location: 'Shonadanga Office' }),
  };
  const res = response();

  await getTechnicianSupportRegister(req, res);

  assert.equal(res.statusCode, 200);
  const countQuery = calls.find((call) => call.sql.includes('COUNT(*)::int AS total'));
  assert.match(countQuery.sql, /t\.created_at >=/);
  assert.match(countQuery.sql, /t\.status IN \('closed', 'resolved'\)/);
  assert.match(countQuery.sql, /LOWER\(TRIM\(COALESCE/);
  assert.match(countQuery.sql, /t\.assigned_to = \$4/);
  assert.match(countQuery.sql, /b\.category_id = \$5/);
  assert.match(countQuery.sql, /\$6 = ANY\(COALESCE\(b\.technician_ids/);
  assert.equal(countQuery.params[0], '2026-10');
  assert.deepEqual(Array.from(countQuery.params[1]), ['shonadanga office', 'sonadanga office', 'sonadanga branch', 'shonadanga branch']);
  assert.deepEqual(Array.from(countQuery.params[2]), ['corporate office', 'head office', 'head office (corporate office)', 'khulna head office']);
  assert.equal(countQuery.params[3], 77);

  const rowsQuery = calls.find((call) => call.sql.includes('LIMIT $'));
  assert.match(rowsQuery.sql, /ORDER BY b\.created_date ASC NULLS LAST, b\.id DESC/);
  assert.equal(rowsQuery.params[6], 200);
  assert.equal(rowsQuery.params[7], 600);
  assert.equal(res.body.data.limit, 200);
  assert.equal(res.body.data.page, 4);
});

test('additional technicians are parsed only from JSON arrays and only numeric IDs are cast', () => {
  const { buildReportQuery } = loadController({ query: async () => ({ rows: [] }) });
  const query = buildReportQuery({
    query: { month: '2026-04' },
    user: { work_location: 'Corporate Office' },
    supportOfficeScope: resolveSupportOffice({ work_location: 'Corporate Office' }),
  });
  assert.match(query.rowsSql, /jsonb_typeof\(t\.additional_technician_ids\) = 'array'/);
  assert.match(query.rowsSql, /extra\.user_id ~ '\^\[0-9\]\{1,18\}\$'/);
  assert.match(query.rowsSql, /extra\.user_id::bigint/);
  assert.match(query.rowsSql, /customer_snapshot->>'phone'.*manual_phone/s);
  assert.match(query.rowsSql, /customer_snapshot->>'vlan_name'/);
});

test('invalid month and invalid technician return 400 without querying', async () => {
  let queryCount = 0;
  const { getTechnicianSupportRegister } = loadController({
    async query() { queryCount += 1; return { rows: [] }; },
  });
  const scope = resolveSupportOffice({ work_location: 'Corporate Office' });

  const invalidMonth = response();
  await getTechnicianSupportRegister({ query: { month: '2026-13' }, user: {}, supportOfficeScope: scope }, invalidMonth);
  assert.equal(invalidMonth.statusCode, 400);
  assert.match(invalidMonth.body.message, /valid month/);

  const invalidTechnician = response();
  await getTechnicianSupportRegister({ query: { month: '2026-10', technician: '91 OR TRUE' }, user: {}, supportOfficeScope: scope }, invalidTechnician);
  assert.equal(invalidTechnician.statusCode, 400);
  assert.match(invalidTechnician.body.message, /technician/);
  assert.equal(queryCount, 0);
});

test('pagination, sort fields, and search values remain bounded and parameterized', () => {
  const { buildReportQuery } = loadController({ query: async () => ({ rows: [] }) });
  const query = buildReportQuery({
    query: { month: '2026-01', page: '999999999', limit: '5000', sortBy: 'created_at; DROP TABLE users', q: '50%_off\\' },
    user: { work_location: 'Corporate Office' },
    supportOfficeScope: resolveSupportOffice({ work_location: 'Corporate Office' }),
  });

  assert.equal(query.page, 10000);
  assert.equal(query.limit, 200);
  assert.equal(query.sortBy, 'createdDate');
  assert.equal(query.rowsParams.at(-2), 200);
  assert.match(query.countSql, /ILIKE \$2/);
  assert.equal(query.params[1], '%50\\%\\_off\\\\%');
});
