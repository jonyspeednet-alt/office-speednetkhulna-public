const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BRANCHES } = require('../constants/branches');

function loadScope(pool = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'middleware', 'supportOfficeScope.js'), 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('/branches')) return { BRANCHES, normalizeOfficeName: require('../constants/branches').normalizeOfficeName };
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

test('support office scope recognizes canonical office names and aliases, but fails closed when unassigned', () => {
  const { resolveSupportOffice } = loadScope();
  const corporate = resolveSupportOffice({ work_location: 'Corporate Office' });
  assert.equal(corporate.office, 'Corporate Office');
  assert.equal(corporate.isHeadOffice, true);
  const headAlias = resolveSupportOffice({ work_location: 'Head Office' });
  assert.equal(headAlias.office, 'Corporate Office');
  assert.equal(headAlias.isHeadOffice, true);
  const branch = resolveSupportOffice({ work_location: 'Shonadanga Office' });
  assert.equal(branch.office, 'Shonadanga Office');
  assert.equal(branch.isHeadOffice, false);
  assert.equal(resolveSupportOffice({ work_location: 'Somewhere' }), null);
  assert.equal(resolveSupportOffice({ work_location: '' }), null);
});

test('head office has no fixed branch SQL predicate while branch scope remains parameterized', () => {
  const { appendSupportOfficeScope, resolveSupportOffice } = loadScope();
  const headWhere = [];
  const headParams = [];
  appendSupportOfficeScope(headWhere, headParams, resolveSupportOffice({ work_location: 'Corporate Office' }));
  assert.equal(headWhere.length, 0);
  assert.equal(headParams.length, 0);

  const branchWhere = [];
  const branchParams = [];
  appendSupportOfficeScope(branchWhere, branchParams, resolveSupportOffice({ work_location: 'Shonadanga Office' }));
  assert.equal(branchWhere.length, 1);
  assert.match(branchWhere[0], /ANY\(\$\d+::text\[\]\)/);
  assert.ok(branchParams[0].includes('shonadanga office'));
  assert.ok(branchParams[1].includes('corporate office'));
});

test('branch ticket detail access denies other-office ticket IDs and allows its own office', async () => {
  let ticket = { office_name: 'Shonadanga Office', zone: 'Shonadanga Office' };
  const { requireSupportOffice, requireSupportOfficeTicket } = loadScope({
    async query() { return { rowCount: 1, rows: [ticket] }; },
  });
  const req = { user: { work_location: 'Shonadanga Office' }, params: { id: '15' } };
  const res = response();
  let continued = false;
  requireSupportOffice(req, res, () => { continued = true; });
  assert.ok(continued);
  await requireSupportOfficeTicket(req, res, () => { continued = true; });
  assert.equal(res.statusCode, 200);

  ticket = { office_name: 'Boyra Office', zone: 'Boyra Office' };
  const deniedRes = response();
  let deniedContinued = false;
  await requireSupportOfficeTicket(req, deniedRes, () => { deniedContinued = true; });
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedContinued, false);
});
