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
      if (name.endsWith('/permissionRegistry')) return { isSuperAdmin: () => false, resolvePermission: () => true };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

function makeHarness(existingTicket, body) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const params = Array.from(values);
      calls.push({ sql, values: params });
      if (sql.includes('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE')) {
        return { rows: [existingTicket], rowCount: 1 };
      }
      if (sql.includes('UPDATE support_tickets AS t SET')) {
        return {
          rows: [{ ...existingTicket, is_on_call: params[20], resolution_type: params[21], is_qc_support: params[22] }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { connect: async () => client };
  const { updateTicket } = loadController(pool);
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(responseBody) { this.body = responseBody; return this; },
  };

  return {
    calls,
    res,
    run: () => updateTicket({
      params: { id: '7' },
      body,
      user: { id: 42, role: 'Super Admin' },
      supportOfficeScope: { isHeadOffice: true, office: 'Corporate Office' },
    }, res),
  };
}

function makeCreateHarness(body) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const params = Array.from(values);
      calls.push({ sql, values: params });
      if (sql.includes("SELECT id, COALESCE(NULLIF(TRIM(name_bn)")) {
        return { rows: [{ id: 905, display_name: 'No Connection' }], rowCount: 1 };
      }
      if (sql.includes('FROM network_customers WHERE id=$1')) {
        return { rows: [{ id: 15, pppoe_username: 'customer-15', phone: null, address: null }], rowCount: 1 };
      }
      if (sql.includes('SELECT nextval(pg_get_serial_sequence')) return { rows: [{ id: 88 }], rowCount: 1 };
      if (sql.includes('INSERT INTO support_tickets')) {
        return { rows: [{ id: 88, ticket_no: 'TKT-88', ...body }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
    query: async () => ({ rows: [], rowCount: 0 }),
  };
  const { createTicket } = loadController(pool);
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(responseBody) { this.body = responseBody; return this; },
  };

  return {
    calls,
    res,
    run: () => createTicket({
      body: {
        customer_id: 15,
        category_id: 905,
        office_name: 'Corporate Office',
        ...body,
      },
      user: { id: 42, role: 'Super Admin' },
      supportOfficeScope: { isHeadOffice: true, office: 'Corporate Office' },
    }, res),
  };
}

const ticket = (overrides = {}) => ({
  id: 7,
  status: 'new',
  assigned_to: null,
  additional_technician_ids: [],
  category_id: 12,
  is_qc_support: false,
  is_on_call: false,
  resolution_type: 'field_visit',
  ...overrides,
});

function persistedCallState(calls) {
  return calls.find(({ sql }) => sql.includes('UPDATE support_tickets AS t SET'));
}

test('turning On-Call on always stores the matching resolution type', async () => {
  const harness = makeHarness(ticket(), { is_on_call: true, resolution_type: 'field_visit' });

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[20], true);
  assert.equal(update.values[21], 'on_call');
});

test('turning On-Call off clears a stale on_call resolution type', async () => {
  const harness = makeHarness(
    ticket({ is_on_call: true, resolution_type: 'on_call' }),
    { is_on_call: false }
  );

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[20], false);
  assert.equal(update.values[21], 'field_visit');
});

test('category 918 remains forced On-Call even when an off selection is submitted', async () => {
  const harness = makeHarness(
    ticket({ category_id: 918, is_on_call: true, resolution_type: 'on_call' }),
    { is_on_call: false, resolution_type: 'field_visit' }
  );

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[20], true);
  assert.equal(update.values[21], 'on_call');
});

test('QC Support can be enabled without changing On-Call', async () => {
  const harness = makeHarness(ticket(), { is_qc_support: true });

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[22], true);
  assert.equal(update.values[20], false);
  assert.equal(update.values[21], 'field_visit');

  const editEvent = harness.calls.find(({ sql, values }) =>
    sql.includes("INSERT INTO support_ticket_events") && sql.includes("'edited'")
  );
  assert.ok(editEvent, 'QC toggle should create an edited audit event');
  assert.deepEqual(JSON.parse(editEvent.values[4]).changes.is_qc_support, { from: 'false', to: 'true' });
});

test('QC Support and On-Call can both be enabled independently', async () => {
  const harness = makeHarness(ticket(), {
    is_qc_support: true,
    is_on_call: true,
    resolution_type: 'on_call',
  });

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[22], true);
  assert.equal(update.values[20], true);
  assert.equal(update.values[21], 'on_call');
});

test('legacy category 912 is inferred as QC without being rewritten', async () => {
  const harness = makeHarness(ticket({ category_id: 912 }), {});

  await harness.run();

  const update = persistedCallState(harness.calls);
  assert.ok(update, 'ticket update should be issued');
  assert.equal(update.values[22], true);
  assert.equal(update.values[19], false, 'category_id is not overwritten');
});

test('ticket creation persists QC independently from On-Call', async () => {
  const harness = makeCreateHarness({ is_qc_support: true });

  await harness.run();

  const insert = harness.calls.find(({ sql }) => sql.includes('INSERT INTO support_tickets'));
  assert.ok(insert, 'ticket insert should be issued');
  assert.equal(insert.values[18], true);
  assert.equal(insert.values[19], false);
  assert.equal(insert.values[20], 'field_visit');
});

test('ticket creation persists both supplementary flags together', async () => {
  const harness = makeCreateHarness({ is_qc_support: true, is_on_call: true });

  await harness.run();

  const insert = harness.calls.find(({ sql }) => sql.includes('INSERT INTO support_tickets'));
  assert.ok(insert, 'ticket insert should be issued');
  assert.equal(insert.values[18], true);
  assert.equal(insert.values[19], true);
  assert.equal(insert.values[20], 'on_call');
});
