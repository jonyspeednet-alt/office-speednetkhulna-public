const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'utilities', 'threecxCdrReceiver.js'), 'utf8');

function loadReceiver(pool = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console: { error() {}, warn() {}, log() {} },
    require(name) {
      if (name === 'node:net') return require('node:net');
      if (name.endsWith('/db')) return pool;
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

const sample = [
  'history-1',
  'call-1',
  '00:02:15',
  '2026-10-19 10:00:00',
  '2026-10-19 10:00:12',
  '2026-10-19 10:02:27',
  'Normal clearing',
  '101',
  '01712345678',
  '01712345678',
  '101 (Agent One)',
  '01712345678',
].join(',');

test('parses CDR fields including quoted values, duration, extension, and timestamps', () => {
  const { parseCdrRecord } = loadReceiver();
  const record = parseCdrRecord(sample);
  assert.equal(record.callId, 'call-1');
  assert.equal(record.historyId, 'history-1');
  assert.equal(record.durationSeconds, 135);
  assert.equal(record.extension, '101');
  assert.equal(record.dialedNumber, '01712345678');
  assert.equal(record.answeredAt, '2026-10-19T04:00:12.000Z');

  const quoted = sample.replace('Normal clearing', '"Normal, clearing"');
  assert.equal(parseCdrRecord(quoted).terminationReason, 'Normal, clearing');
});

test('rejects malformed, incomplete, or field-count-mismatched CDR rows', () => {
  const { parseCdrRecord } = loadReceiver();
  assert.throws(() => parseCdrRecord(sample.slice(0, sample.lastIndexOf(','))), /Expected 12 CDR fields/);
  assert.throws(() => parseCdrRecord(sample.replace('call-1', '')), /missing callid/);
  assert.throws(() => parseCdrRecord(sample.replace('Normal clearing', '"unterminated')), /Malformed quoted/);
});

test('requires explicit enablement, private bind address, and an allowlisted IPv4 PBX', () => {
  const { getConfig, DEFAULT_FIELDS } = loadReceiver();
  assert.equal(getConfig({}), null);
  assert.throws(() => getConfig({
    THREECX_CDR_ENABLED: 'true',
    THREECX_CDR_HOST: '0.0.0.0',
    THREECX_CDR_PORT: '9100',
    THREECX_CDR_ALLOWED_IPS: '10.0.0.5',
  }), /private IPv4/);
  assert.throws(() => getConfig({
    THREECX_CDR_ENABLED: 'true',
    THREECX_CDR_HOST: '10.0.0.2',
    THREECX_CDR_PORT: '9100',
    THREECX_CDR_ALLOWED_IPS: '',
  }), /allowlist/);
  const config = getConfig({
    THREECX_CDR_ENABLED: 'true',
    THREECX_CDR_HOST: '10.0.0.2',
    THREECX_CDR_PORT: '9100',
    THREECX_CDR_ALLOWED_IPS: '10.0.0.5',
  });
  assert.equal(config.port, 9100);
  assert.deepEqual(Array.from(config.allowedIps), ['10.0.0.5']);
  assert.deepEqual(Array.from(config.fields), Array.from(DEFAULT_FIELDS));
});

test('persists CDR fields and correlates a matching ticket handoff', async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values: Array.from(values) });
      if (sql.startsWith('INSERT INTO support_3cx_calls')) return { rows: [{ id: 33 }], rowCount: 1 };
      if (sql.startsWith('SELECT id, ticket_id FROM support_ticket_events')) {
        return { rows: [{ id: 22, ticket_id: 7 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { connect: async () => client };
  const { ingestRecord, parseCdrRecord } = loadReceiver(pool);

  await ingestRecord(parseCdrRecord(sample));
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /ON CONFLICT \(call_id, history_id\)/);
  assert.equal(queries[2].values[0], '1712345678');
  assert.equal(queries[2].values[3], '101');
  assert.match(queries[3].sql, /metadata = metadata \|\|/);
  const eventMetadata = JSON.parse(queries[3].values[2]);
  assert.equal(eventMetadata.call_status, 'answered');
  assert.equal(eventMetadata.extension, '101');
  assert.equal(eventMetadata.duration_seconds, 135);
  assert.match(queries[4].sql, /portal_user_id/);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});
