const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeHarness({ ticket = { id: 7, phone: '+8801712345678' } } = {}) {
  const queries = [];
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values: Array.from(values) });
      if (sql.includes('FROM support_tickets t') && sql.includes('LEFT JOIN network_customers')) {
        return ticket ? { rows: [ticket], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM office_phones')) return { rows: [{ extension: '101' }], rowCount: 1 };
      if (sql.includes('INSERT INTO support_ticket_events')) {
        return {
          rows: [{
            id: 91,
            ticket_id: values[0],
            event_type: 'call_handoff',
            message: '3CX dialer opened; call outcome not verified',
            metadata: JSON.parse(values[1]),
            created_at: '2026-10-19T10:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'controllers', 'supportController.js'), 'utf8'),
    {
      module,
      exports: module.exports,
      console: { error() {} },
      require(name) {
        if (name.endsWith('/db')) return pool;
        if (name.endsWith('/apiResponse')) {
          return {
            success: (res, body, status) => res.status(status || 200).json(body),
            fail: (res, message, status) => res.status(status || 400).json({ message }),
            notFound: (res, message) => res.status(404).json({ message }),
            serverError: (res) => res.status(500).json({ message: 'Server error' }),
          };
        }
        if (name.endsWith('/technicianScope')) return { isFieldTechnician: () => false, blockFieldTechnician: () => {} };
        if (name.endsWith('/mikrotikSupportService')) return { syncConfiguredDevices: async () => {} };
        if (name.endsWith('/branches')) return { normalizeOfficeName: (office) => office, ALLOWED_OFFICE_NAMES: new Set(['Corporate Office']) };
        if (name.endsWith('/supportOfficeScope')) return { resolveSupportOffice: () => null, appendSupportOfficeScope: () => {} };
        if (name.endsWith('/permissionRegistry')) return { isSuperAdmin: () => false, resolvePermission: () => true };
        throw new Error(`Unexpected dependency ${name}`);
      },
    }
  );
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return {
    queries,
    res,
    run: (id = '7', body = { source: 'ticket' }) =>
      module.exports.log3cxCallHandoff({ params: { id }, body, user: { id: 42 } }, res),
  };
}

test('3CX handoff logs the ticket phone and explicitly marks the call outcome unknown', async () => {
  const h = makeHarness();
  await h.run();

  assert.equal(h.res.statusCode, 201);
  assert.equal(h.res.body.event_type, 'call_handoff');
  assert.equal(h.res.body.metadata.phone, '+8801712345678');
  assert.equal(h.res.body.metadata.source, 'ticket');
  assert.equal(h.res.body.metadata.outcome, 'not_verified');
  assert.equal(h.res.body.metadata.extension, '101');
  assert.equal(h.queries[2].values[2], 42);
});

test('3CX handoff rejects invalid IDs and sources without querying the database', async () => {
  const badId = makeHarness();
  await badId.run('0');
  assert.equal(badId.res.statusCode, 400);
  assert.equal(badId.queries.length, 0);

  const badSource = makeHarness();
  await badSource.run('7', { source: 'external' });
  assert.equal(badSource.res.statusCode, 400);
  assert.equal(badSource.queries.length, 0);
});

test('3CX handoff rejects tickets without a usable phone number', async () => {
  const h = makeHarness({ ticket: { id: 7, phone: null } });
  await h.run();
  assert.equal(h.res.statusCode, 409);
  assert.equal(h.queries.length, 1);
});
