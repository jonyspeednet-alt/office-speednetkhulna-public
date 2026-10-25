const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadController(pool) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'supportController.js'), 'utf8'), {
    module,
    exports: module.exports,
    console: { error() {} },
    require(name) {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('/apiResponse')) {
        return {
          success: (res, body) => res.json(body),
          fail: (res, message, status) => res.status(status).json({ message }),
          notFound: (res, message) => res.status(404).json({ message }),
          serverError: (res) => res.status(500).json({ message: 'Server error' }),
        };
      }
      if (name.endsWith('/technicianScope')) return { isFieldTechnician: () => false, blockFieldTechnician: () => {} };
      if (name.endsWith('/mikrotikSupportService')) return { syncConfiguredDevices: async () => {} };
      if (name.endsWith('/branches')) return { normalizeOfficeName: (office) => office, ALLOWED_OFFICE_NAMES: [] };
      if (name.endsWith('/supportOfficeScope')) {
        return { resolveSupportOffice: () => null, appendSupportOfficeScope: () => {} };
      }
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

test('ticket search runs before pagination and returns matching result totals', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values: Array.from(values) });
      return /COUNT\(\*\)/.test(sql)
        ? { rows: [{ total: 31 }] }
        : { rows: [{ id: 22, ticket_no: 'TKT-22' }] };
    },
  };
  const { listTickets } = loadController(pool);
  const res = response();

  await listTickets({
    query: { status: 'closed,resolved', page: '3', limit: '15', q: 'Alice%_' },
    user: { id: 9, role: 'Super Admin' },
  }, res);

  assert.equal(calls.length, 2);
  const [countQuery, dataQuery] = calls;
  for (const field of [
    't.ticket_no',
    't.description',
    't.resolution_note',
    'c.pppoe_username',
    'c.comment_raw',
    "t.customer_snapshot->>'name'",
    'cat.name',
    'au.full_name',
    'cu.full_name',
  ]) {
    assert.ok(countQuery.sql.includes(field), `search should include ${field}`);
  }
  assert.ok(countQuery.sql.includes("ILIKE $2 ESCAPE '\\'"));
  assert.equal(countQuery.values[1], '%Alice\\%\\_%');
  assert.deepEqual(dataQuery.values.slice(0, countQuery.values.length), countQuery.values);
  assert.deepEqual(dataQuery.values.slice(-2), [15, 30]);
  assert.match(dataQuery.sql, /ORDER BY t\.created_at DESC, t\.id DESC LIMIT/);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), {
    rows: [{ id: 22, ticket_no: 'TKT-22' }],
    total: 31,
    page: 3,
    limit: 15,
    totalPages: 3,
  });
});

test('default ticket queue excludes cancelled tickets', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values: Array.from(values) });
      return /COUNT\(\*\)/.test(sql) ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const { listTickets } = loadController(pool);
  const res = response();

  await listTickets({ query: {}, user: { id: 9, role: 'Super Admin' } }, res);

  assert.ok(calls.every(({ sql }) => sql.includes("t.status <> 'cancelled'")));
});

test('all queue request excludes cancelled tickets even if the status list includes them, and keeps solved-at-midnight cutoff', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values: Array.from(values) });
      return /COUNT\(\*\)/.test(sql) ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const { listTickets } = loadController(pool);
  const statuses = ['new', 'assigned', 'in_progress', 'waiting_customer', 'waiting_vendor', 'resolved', 'verification_pending', 'closed', 'reopened', 'cancelled'];

  await listTickets({
    query: { status: statuses.join(','), hideOldSolved: 'true', allQueue: 'true', page: '1', limit: '10' },
    user: { id: 9, role: 'Super Admin' },
  }, response());

  assert.ok(calls.every(({ sql }) => sql.includes('t.status = ANY($1::text[])')));
  assert.ok(calls.every(({ values }) => JSON.stringify(values[0]) === JSON.stringify(statuses)));
  assert.ok(calls.every(({ sql }) => sql.includes("t.status <> 'cancelled'")));
  assert.ok(calls.every(({ sql }) => sql.includes("t.status IN ('closed', 'resolved')")));
  assert.ok(calls.every(({ sql }) => sql.includes("DATE((NOW() AT TIME ZONE 'Asia/Dhaka'))")));
});

test('history and explicit cancelled status remain searchable', async () => {
  const makePool = () => {
    const calls = [];
    return {
      calls,
      async query(sql, values) {
        calls.push({ sql, values: Array.from(values) });
        return /COUNT\(\*\)/.test(sql) ? { rows: [{ total: 0 }] } : { rows: [] };
      },
    };
  };

  const historyPool = makePool();
  const { listTickets: listHistory } = loadController(historyPool);
  await listHistory({ query: { isHistory: 'true' }, user: { id: 9, role: 'Super Admin' } }, response());
  assert.ok(historyPool.calls.every(({ sql }) => sql.includes("t.status IN ('closed', 'resolved', 'cancelled')")));

  const cancelledPool = makePool();
  const { listTickets: listCancelled } = loadController(cancelledPool);
  await listCancelled({ query: { status: 'cancelled', q: 'TKT-12' }, user: { id: 9, role: 'Super Admin' } }, response());
  assert.ok(cancelledPool.calls.every(({ sql }) => !sql.includes("t.status <> 'cancelled'")));
  assert.ok(cancelledPool.calls.every(({ sql }) => sql.includes('t.status = $1')));
});
