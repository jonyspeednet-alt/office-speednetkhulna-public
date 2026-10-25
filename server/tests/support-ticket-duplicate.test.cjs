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
      if (name.endsWith('/branches')) return { normalizeOfficeName: (office) => office, ALLOWED_OFFICE_NAMES: new Set(['Corporate Office']) };
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

test('ticket creation rejects a customer with an unresolved ticket under a customer lock', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM network_customers WHERE id=$1 FOR UPDATE')) {
        return { rows: [{ id: 42 }], rowCount: 1 };
      }
      if (sql.includes('FROM support_tickets')) {
        return { rows: [{ ticket_no: 'TKT-100', status: 'in_progress' }], rowCount: 1 };
      }
      if (sql.includes('FROM network_customers WHERE id=$1')) {
        return { rows: [{ id: 42, pppoe_username: 'customer-42' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { connect: async () => client };
  const { createTicket } = loadController(pool);
  const res = response();

  await createTicket({
    body: { customer_id: 42, office_name: 'Corporate Office' },
    supportOfficeScope: { isHeadOffice: true, office: 'Corporate Office' },
    user: { id: 7 },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /TKT-100 \(in_progress\)/);
  const lockIndex = calls.findIndex(({ sql }) => sql.includes('FROM network_customers WHERE id=$1 FOR UPDATE'));
  const activeCheckIndex = calls.findIndex(({ sql }) => sql.includes('FROM support_tickets'));
  assert.ok(lockIndex >= 0, 'creation should lock the customer row');
  assert.ok(activeCheckIndex > lockIndex, 'active-ticket lookup should run under the customer lock');
  assert.match(calls[activeCheckIndex].sql, /status NOT IN \('closed','resolved','cancelled'\)/);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!calls.some(({ sql }) => /^\s*INSERT INTO support_tickets/i.test(sql)));
});

test('ticket cancellation requires a reason and stores it in the activity event', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, ticket_no, status FROM support_tickets')) {
        return { rows: [{ id: 12, ticket_no: 'TKT-12', status: 'in_progress' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const { deleteTicket } = loadController({ connect: async () => client });
  const res = response();

  await deleteTicket({
    params: { id: '12' },
    body: { reason: 'Duplicate ticket' },
    user: { id: 7 },
  }, res);

  assert.equal(res.statusCode, 200);
  const event = calls.find(({ sql }) => sql.includes('INSERT INTO support_ticket_events'));
  assert.ok(event, 'cancellation should be recorded in the activity history');
  assert.match(event.values[1], /Reason: Duplicate ticket/);
  assert.match(event.values[4], /"cancellation_reason":"Duplicate ticket"/);
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(calls.some(({ sql }) => sql.includes('SELECT id, ticket_no, status FROM support_tickets') && sql.includes('FOR UPDATE')));
});

test('ticket cancellation rejects a blank reason before starting a transaction', async () => {
  let connected = false;
  const { deleteTicket } = loadController({
    connect: async () => {
      connected = true;
      throw new Error('Should not connect without a cancellation reason');
    },
  });
  const res = response();

  await deleteTicket({
    params: { id: '12' },
    body: { reason: '  ' },
    user: { id: 7 },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Cancellation reason is required/);
  assert.equal(connected, false);
});

test('reopening a cancelled ticket is rejected when the customer has another unresolved ticket', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE')) {
        return {
          rows: [{ id: 12, customer_id: 42, status: 'cancelled', assigned_to: null, category_id: null, connection_type: 'Fiber', additional_technician_ids: [] }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM support_tickets') && sql.includes('id<>$2')) {
        return { rows: [{ ticket_no: 'TKT-13', status: 'assigned' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const { updateTicket } = loadController({ connect: async () => client });
  const res = response();

  await updateTicket({
    params: { id: '12' },
    body: { status: 'reopened' },
    supportOfficeScope: { isHeadOffice: true, office: 'Corporate Office' },
    user: { id: 7 },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /TKT-13 \(assigned\)/);
  const lockIndex = calls.findIndex(({ sql }) => sql.includes('FROM network_customers WHERE id=$1 FOR UPDATE'));
  const activeCheckIndex = calls.findIndex(({ sql }) => sql.includes('id<>$2'));
  assert.ok(lockIndex >= 0, 'reopen should lock the customer row');
  assert.ok(activeCheckIndex > lockIndex, 'active-ticket lookup should run under the customer lock');
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!calls.some(({ sql }) => /^\s*WITH p AS/.test(sql)));
});
