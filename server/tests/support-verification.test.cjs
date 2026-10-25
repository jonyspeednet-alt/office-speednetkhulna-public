const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeHarness({ existing = null, category = 'other', categoryId = null, isQcSupport = false, activeAttempt = null } = {}) {
  let saved = existing;
  const revisions = [];
  const queries = [];
  const attemptUpdates = [];
  const client = {
    async query(sql, values = []) {
      const params = Array.from(values);
      queries.push({ sql, values: params });
      if (sql.includes('FROM support_tickets WHERE id=$1 FOR UPDATE')) {
        return { rows: [{ status: 'resolved', office_name: 'Corporate Office', zone: 'Shonadanga Office' }], rowCount: 1 };
      }
      if (sql.includes('SELECT cat.name AS category')) {
        return { rows: [{ category, category_id: categoryId, is_qc_support: isQcSupport }], rowCount: 1 };
      }
      if (sql === 'SELECT * FROM support_verifications WHERE ticket_id=$1 FOR UPDATE') {
        return { rows: saved ? [saved] : [], rowCount: saved ? 1 : 0 };
      }
      if (sql.includes('SELECT id, caller_id, outcome') && sql.includes('support_verification_call_attempts')) {
        return { rows: activeAttempt ? [activeAttempt] : [], rowCount: activeAttempt ? 1 : 0 };
      }
      if (sql.includes('UPDATE support_verification_call_attempts')) {
        attemptUpdates.push({ sql, values: params });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO support_verification_revisions')) {
        revisions.push({ values: params });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO support_verifications')) {
        saved = {
          id: 101,
          ticket_id: params[0],
          q1_technical: params[1],
          q2_media: params[2],
          q3_customercare: params[3],
          q4_payment: params[4],
          q5_service_satisfaction: params[5],
          q6_time_satisfaction: params[6],
          q7_technician_behavior: params[7],
          feedback_remarks: params[8],
          verified_by: params[9],
          answers: params[10] !== null && params[10] !== undefined ? JSON.parse(params[10]) : null,
        };
        return { rows: [saved], rowCount: 1 };
      }
      if (sql.includes('UPDATE support_verifications SET')) {
        saved = {
          ...saved,
          q1_technical: params[1],
          q2_media: params[2],
          q3_customercare: params[3],
          q4_payment: params[4],
          q5_service_satisfaction: params[5],
          q6_time_satisfaction: params[6],
          q7_technician_behavior: params[7],
          feedback_remarks: params[8],
          verified_by: params[9],
          answers: params[10] !== null && params[10] !== undefined ? JSON.parse(params[10]) : null,
        };
        return { rows: [saved], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { connect: async () => client };
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
      if (name.endsWith('/technicianScope')) return { isFieldTechnician: () => false, blockFieldTechnician: () => false };
      if (name.endsWith('/supportVerificationRules')) return require('../utilities/supportVerificationRules');
      if (name.endsWith('/mikrotikSupportService')) return { syncConfiguredDevices: async () => {} };
      if (name.endsWith('/branches')) return { normalizeOfficeName: (office) => office, ALLOWED_OFFICE_NAMES: new Set(['Corporate Office']) };
      if (name.endsWith('/supportOfficeScope')) return { resolveSupportOffice: () => null, appendSupportOfficeScope: () => {} };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const run = (body) => module.exports.saveVerificationCall({
    body,
    user: { id: 42 },
  }, res);
  return { run, res, queries, revisions, attemptUpdates, getSaved: () => saved };
}

const validAnswers = {
  q1_technical: true,
  q2_media: false,
  q3_customercare: true,
  q4_payment: true,
  q5_service_satisfaction: true,
  q6_time_satisfaction: false,
  q7_technician_behavior: true,
  feedback_remarks: 'Customer feedback',
};

test('first verification submission is saved once', async () => {
  const h = makeHarness();
  await h.run({ ticket_id: 7, ...validAnswers });
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.getSaved().ticket_id, 7);
  assert.equal(h.getSaved().q2_media, false);
  assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), true);
  assert.equal(h.revisions.length, 0);
  const attempt = h.queries.find(({ sql }) => sql.includes('INSERT INTO support_verification_call_attempts'));
  assert.equal(attempt.values[2], 'completed');
  assert.deepEqual(attempt.values.slice(4), ['Employee #42', null, null, 'Corporate Office', 'Shonadanga Office']);
});

test('resubmission without explicit correction is rejected without overwriting', async () => {
  const original = { id: 9, ticket_id: 7, q1_technical: false, created_at: '2026-10-18T10:00:00Z' };
  const h = makeHarness({ existing: original });
  await h.run({ ticket_id: 7, ...validAnswers });
  assert.equal(h.res.statusCode, 409);
  assert.equal(h.getSaved(), original);
  assert.equal(h.revisions.length, 0);
});

test('explicit correction archives the old verification before updating it', async () => {
  const original = {
    id: 9,
    ticket_id: 7,
    q1_technical: false,
    q2_media: true,
    q3_customercare: true,
    q4_payment: false,
    q5_service_satisfaction: false,
    q6_time_satisfaction: true,
    q7_technician_behavior: false,
    feedback_remarks: 'Original feedback',
    verified_by: 12,
    created_at: '2026-10-18T10:00:00Z',
  };
  const h = makeHarness({ existing: original });
  await h.run({ ticket_id: 7, is_correction: true, ...validAnswers });
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.revisions.length, 1);
  assert.equal(h.revisions[0].values[0], 7);
  assert.equal(h.revisions[0].values[1], false);
  assert.equal(h.revisions[0].values[9], 12);
  assert.equal(h.getSaved().q1_technical, true);
  assert.equal(h.getSaved().feedback_remarks, 'Customer feedback');
  assert.ok(h.queries.findIndex(({ sql }) => sql.includes('INSERT INTO support_verification_revisions')) <
    h.queries.findIndex(({ sql }) => sql.includes('UPDATE support_verifications SET')));
  assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), true);
});

test('comment-only report correction saves without binding undefined legacy answers', async () => {
  const original = {
    id: 10,
    ticket_id: 7,
    q1_technical: null,
    q2_media: null,
    q3_customercare: null,
    q4_payment: null,
    q5_service_satisfaction: null,
    q6_time_satisfaction: null,
    q7_technician_behavior: null,
    feedback_remarks: 'Customer did not respond to the call.',
    verified_by: 42,
    answers: null,
  };
  const h = makeHarness({ existing: original, category: 'no_connection', categoryId: 905 });
  await h.run({ ticket_id: 7, is_correction: true, answers: {}, feedback_remarks: 'The phone number was busy.' });
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.getSaved().feedback_remarks, 'The phone number was busy.');
  assert.equal(h.getSaved().answers, null);
  const update = h.queries.find(({ sql }) => sql.includes('UPDATE support_verifications SET'));
  assert.ok(update);
  assert.equal(update.values.slice(1, 8).every((value) => value === null), true);
});

test('comment-only correction preserves existing category answers', async () => {
  const categoryAnswers = { connection_problem: false, speednet_rating: 9 };
  const original = {
    id: 12,
    ticket_id: 7,
    q1_technical: null,
    q2_media: null,
    q3_customercare: null,
    q4_payment: null,
    q5_service_satisfaction: null,
    q6_time_satisfaction: null,
    q7_technician_behavior: null,
    feedback_remarks: 'Customer feedback',
    verified_by: 42,
    answers: categoryAnswers,
  };
  const h = makeHarness({ existing: original, category: 'qc_support', categoryId: 912 });
  await h.run({
    ticket_id: 7,
    is_correction: true,
    answers: { connection_problem: null, speednet_rating: null },
    feedback_remarks: 'Customer requested a follow-up call.',
  });
  assert.equal(h.res.statusCode, 200);
  assert.deepEqual(h.getSaved().answers, categoryAnswers);
  assert.equal(h.res.body.verification_completed, true);
});

test('correction preserves legacy yes/no answers when no category answers exist', async () => {
  const original = {
    id: 11,
    ticket_id: 7,
    q1_technical: true,
    q2_media: false,
    q3_customercare: true,
    q4_payment: false,
    q5_service_satisfaction: true,
    q6_time_satisfaction: false,
    q7_technician_behavior: true,
    feedback_remarks: 'Previous note',
    verified_by: 42,
    answers: null,
  };
  const h = makeHarness({ existing: original, category: 'no_connection', categoryId: 905 });
  await h.run({ ticket_id: 7, is_correction: true, ...validAnswers });
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.getSaved().q1_technical, true);
  assert.equal(h.getSaved().q2_media, false);
});

const categoryAnswers = [
  ['shifting_connection', 915, { work_received: true, payment_made: false }],
  ['new_connection', 904, { connection_usable: true }],
  ['qc_support', 912, { connection_problem: false, speednet_rating: 8 }],
  ['no_connection', 905, { support_understood: true, payment_made: false, team_satisfied: true }],
];

for (const [category, categoryId, answers] of categoryAnswers) {
  test(`category-specific verification answers are saved for ${category}`, async () => {
    const h = makeHarness({ category, categoryId });
    await h.run({ ticket_id: 7, answers });
    assert.equal(h.res.statusCode, 200);
    assert.deepEqual(h.getSaved().answers, answers);
    assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), true);
  });
}

test('QC flag selects QC answers even when the ticket category is different', async () => {
  const h = makeHarness({ category: 'no_connection', categoryId: 905, isQcSupport: true });
  const answers = { connection_problem: true, speednet_rating: 0 };
  await h.run({ ticket_id: 7, answers });
  assert.equal(h.res.statusCode, 200);
  assert.deepEqual(h.getSaved().answers, answers);
});

test('category verification can be submitted with a call outcome comment and no answers', async () => {
  const h = makeHarness({ category: 'qc_support', categoryId: 912 });
  await h.run({ ticket_id: 7, answers: {}, feedback_remarks: 'Customer did not respond to the call.' });
  assert.equal(h.res.statusCode, 200);
  assert.deepEqual(h.getSaved().answers, null);
  assert.equal(h.getSaved().feedback_remarks, 'Customer did not respond to the call.');
  assert.equal(h.res.body.verification_completed, false);
  assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), true);
  const attempt = h.queries.find(({ sql }) => sql.includes('INSERT INTO support_verification_call_attempts'));
  assert.equal(attempt.values[2], 'incomplete');
});

test('partial category answers cannot be saved as a feedback-only attempt', async () => {
  const h = makeHarness({ category: 'qc_support', categoryId: 912 });
  await h.run({
    ticket_id: 7,
    answers: { connection_problem: true },
    feedback_remarks: 'A follow-up call is required.',
  });
  assert.equal(h.res.statusCode, 400);
  assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), false);
});

test('module attempt is completed atomically with category answers', async () => {
  const h = makeHarness({
    category: 'shifting_connection',
    categoryId: 915,
    activeAttempt: { id: 31, caller_id: 42, outcome: 'in_progress' },
  });
  await h.run({
    ticket_id: 7,
    verification_attempt_id: 31,
    answers: { work_received: true, payment_made: false },
  });
  assert.equal(h.res.statusCode, 200);
  assert.equal(h.attemptUpdates.length, 1);
  assert.equal(h.attemptUpdates[0].values[0], 'completed');
  assert.equal(h.attemptUpdates[0].values[2], 31);
  assert.equal(h.queries.some(({ sql }) => sql.includes('INSERT INTO support_verification_call_attempts')), false);
  assert.equal(h.queries.some(({ sql }) => sql === 'COMMIT'), true);
});

test('module attempt cannot be submitted by another caller', async () => {
  const h = makeHarness({
    category: 'shifting_connection',
    categoryId: 915,
    activeAttempt: { id: 31, caller_id: 99, outcome: 'in_progress' },
  });
  await h.run({
    ticket_id: 7,
    verification_attempt_id: 31,
    answers: { work_received: true, payment_made: false },
  });
  assert.equal(h.res.statusCode, 403);
  assert.equal(h.getSaved(), null);
  assert.equal(h.queries.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('category verification still rejects missing answers without a report comment', async () => {
  const h = makeHarness({ category: 'qc_support', categoryId: 912 });
  await h.run({ ticket_id: 7, answers: {} });
  assert.equal(h.res.statusCode, 400);
  assert.equal(h.queries.some(({ sql }) => sql.includes('INSERT INTO support_verifications')), false);
  assert.equal(h.queries.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('category verification rejects missing answers without saving', async () => {
  const h = makeHarness({ category: 'qc_support', categoryId: 912 });
  await h.run({ ticket_id: 7, answers: { connection_problem: false } });
  assert.equal(h.res.statusCode, 400);
  assert.equal(h.queries.some(({ sql }) => sql.includes('INSERT INTO support_verifications')), false);
  assert.equal(h.queries.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('category verification rejects invalid rating values without saving', async () => {
  const h = makeHarness({ category: 'qc_support', categoryId: 912 });
  await h.run({ ticket_id: 7, answers: { connection_problem: false, speednet_rating: 11 } });
  assert.equal(h.res.statusCode, 400);
  assert.equal(h.queries.some(({ sql }) => sql.includes('INSERT INTO support_verifications')), false);
  assert.equal(h.queries.some(({ sql }) => sql === 'ROLLBACK'), true);
});
