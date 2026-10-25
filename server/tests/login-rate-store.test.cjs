const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const load = (query) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utilities/loginRateStore.js'), 'utf8'), {
    module, require: (id) => id === './db' ? { query } : require(id), Date,
  });
  return module.exports;
};

test('shared stores use atomic database counters and namespace hashed keys', async () => {
  const counts = new Map(); let ddl = 0;
  const { LoginRateStore } = load(async (sql, params) => {
    if (sql.startsWith('CREATE')) { ddl++; return { rows: [] }; }
    if (sql.includes('INSERT INTO')) {
      assert.match(sql, /ON CONFLICT \(key\) DO UPDATE/);
      assert.match(params[0], /^[a-f0-9]{64}$/);
      counts.set(params[0], (counts.get(params[0]) || 0) + 1);
      return { rows: [{ hits: counts.get(params[0]), reset_at: new Date(Date.now() + params[1]) }] };
    }
    return { rows: [] };
  });
  const a = new LoginRateStore('account'), b = new LoginRateStore('account'), ip = new LoginRateStore('ip');
  for (const store of [a, b, ip]) store.init({ windowMs: 900000 });
  assert.equal((await a.increment('account:7')).totalHits, 1);
  assert.equal((await b.increment('account:7')).totalHits, 2);
  assert.equal((await ip.increment('account:7')).totalHits, 1);
  assert.equal(ddl, 2);
});

test('shared store initialization failures can retry and counters fail closed', async () => {
  let failed = false;
  const { LoginRateStore } = load(async (sql) => {
    if (!failed) { failed = true; throw Error('database unavailable'); }
    if (sql.includes('INSERT INTO')) return { rows: [{ hits: 1, reset_at: new Date() }] };
    return { rows: [] };
  });
  const store = new LoginRateStore('account'); store.init({ windowMs: 1000 });
  await assert.rejects(store.increment('7'), /database unavailable/);
  assert.equal((await store.increment('7')).totalHits, 1);
});

test('account resolution normalizes aliases with bound parameters', async () => {
  const calls = [];
  const { resolveLoginAccount } = load(async (sql, params) => {
    calls.push({ sql, params }); return { rows: [{ id: 7 }] };
  });
  assert.equal(await resolveLoginAccount('+8801700000000'), 7);
  assert.equal(calls[0].params[1], '01700000000');
  assert.match(calls[0].sql, /LOWER\(TRIM\(COALESCE\(employee_id/);
  assert.equal(await resolveLoginAccount(''), null);
  assert.equal(calls.length, 1);
});
