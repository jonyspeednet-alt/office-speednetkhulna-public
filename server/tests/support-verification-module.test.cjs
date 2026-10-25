const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  getVerificationQuestionKeys,
  hasVerificationAnswers,
} = require('../utilities/supportVerificationRules');

const controllerSource = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'supportVerificationController.js'),
  'utf8'
);

const defaultTicket = {
  id: 7,
  ticket_no: 'TKT-7',
  status: 'resolved',
  office_name: 'Corporate Office',
  zone: 'Boyra Office',
  solved_at: '2020-10-02T10:00:00.000Z',
  queue_started_at: '2026-10-01T00:00:00.000Z',
};

function makeResponse() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers = { ...(this.headers || {}), [name]: value }; return this; },
    type(value) { this.contentType = value; return this; },
    attachment(value) { this.attachmentName = value; return this; },
    send(body) { this.body = body; return this; },
  };
}

function makeController({
  queryHandler = async () => ({ rows: [], rowCount: 0 }),
  clientHandler = async () => ({ rows: [], rowCount: 1 }),
} = {}) {
  const pool = {
    query: queryHandler,
    connect: async () => ({ query: clientHandler, release() {} }),
  };
  const module = { exports: {} };
  vm.runInNewContext(controllerSource, {
    module,
    exports: module.exports,
    console: { error() {} },
    require(name) {
      if (name.endsWith('/db')) return pool;
      if (name.endsWith('/apiResponse')) {
        return {
          success: (res, body, status = 200) => res.status(status).json({ success: true, data: body }),
          fail: (res, message, status = 400) => res.status(status).json({ success: false, message }),
          notFound: (res, message) => res.status(404).json({ success: false, message }),
          serverError: (res) => res.status(500).json({ success: false, message: 'Server error' }),
        };
      }
      if (name.endsWith('/technicianScope')) {
        return { isFieldTechnician: () => false, blockFieldTechnician: () => false };
      }
      if (name.endsWith('/permissionRegistry')) {
        return { resolvePermission: (user, permission) => Boolean(user?.permissions?.[permission]) };
      }
      if (name.endsWith('/supportOfficeScope')) {
        return {
          resolveSupportOffice: () => ({ isHeadOffice: true }),
          appendSupportOfficeScope: () => {},
        };
      }
      if (name.endsWith('/supportVerificationRules')) return { hasVerificationAnswers };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
}

const headOfficeRequest = (query = {}) => ({
  query,
  params: { id: '7', attemptId: '31' },
  user: { id: 42, full_name: 'Call Operator', employee_id: 'EMP-42', permissions: { 'support.ticket.update': true } },
  supportOfficeScope: { isHeadOffice: true },
});

test('category answer keys follow the verification categories', () => {
  assert.deepEqual(getVerificationQuestionKeys({ category_id: 915 }), ['work_received', 'payment_made']);
  assert.deepEqual(getVerificationQuestionKeys({ category_id: 904 }), ['connection_usable']);
  assert.deepEqual(getVerificationQuestionKeys({ category_id: 912 }), ['connection_problem', 'speednet_rating']);
  assert.deepEqual(getVerificationQuestionKeys({ category_name: 'Slow Connection' }), ['support_understood', 'payment_made', 'team_satisfied']);
});

test('feedback-only records remain pending while legacy answers count as complete', () => {
  assert.equal(hasVerificationAnswers({ answers: null, q1_technical: null }), false);
  assert.equal(hasVerificationAnswers({ answers: {}, q1_technical: null }), false);
  assert.equal(hasVerificationAnswers({ answers: { connection_usable: true } }), true);
  assert.equal(hasVerificationAnswers({ answers: null, q1_technical: false }), true);
});

test('report filters reject invalid category, date, caller, and outcome', () => {
  const controller = makeController();
  assert.match(controller.parseFilters({ query: { category: 'unknown' } }, 'queue').error, /category/i);
  assert.equal(controller.parseFilters({ query: {} }, 'queue').filters.queueType, 'first');
  assert.equal(controller.parseFilters({ query: { state: 'pending' } }, 'queue').filters.state, 'pending');
  assert.equal(controller.parseFilters({ query: { queue_type: 'follow_up' } }, 'queue').filters.queueType, 'follow_up');
  assert.equal(controller.parseFilters({ query: { office: 'Boyra Office' } }, 'queue').filters.office, 'Boyra Office');
  assert.match(controller.parseFilters({ query: { office: 'o'.repeat(121) } }, 'queue').error, /office/i);
  assert.match(controller.parseFilters({ query: { queue_type: 'invalid' } }, 'queue').error, /queue type/i);
  assert.match(controller.parseFilters({ query: { state: 'completed' } }, 'queue').error, /state/i);
  assert.match(controller.parseFilters({ query: { from: '2026-02-30' } }, 'report').error, /date/i);
  assert.match(controller.parseFilters({ query: { caller_id: '0' } }, 'report').error, /caller/i);
  assert.match(controller.parseFilters({ query: { outcome: 'unexpected' } }, 'report').error, /outcome/i);
});

test('queue query includes all solved history, deterministic oldest-first order, and answer-based completion', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ category: 'qc', q: 'TKT-7' }),
    'queue',
    { page: 1, limit: 25, category: 'qc', query: 'TKT-7', from: '', to: '' }
  );
  assert.match(built.query, /t\.status IN \('closed', 'resolved'\)/);
  assert.match(built.query, /t\.complaint_no/);
  assert.doesNotMatch(built.query, /queue_started_at|support_verification_queue_settings|COALESCE\(t\.resolved_at, t\.closed_at\) >=/);
  assert.match(built.query, /v\.answers <> '\{\}'::jsonb/);
  assert.match(built.query, /ORDER BY solved_at ASC, id ASC/);
  assert.match(built.query, /verification_state IN \('pending', 'in_progress'\)/);
  assert.doesNotMatch(built.query, /AS attempt_history/);
  assert.deepEqual(Array.from(built.params), ['qc', '%TKT-7%', '%TKT-7%', 25, 0]);
  assert.match(built.query, /category_filtered AS \(\s+SELECT b\.\* FROM classified b WHERE \(\s+b\.ticket_no ILIKE \$3/);
  assert.match(built.query, /category_stats AS \([\s\S]*FROM category_filtered/);
});

test('queue search matches mobile numbers across Bangladesh phone formats', () => {
  const controller = makeController();
  const query = '+880 1712-345678';
  const built = controller.buildReportQuery(
    headOfficeRequest({ q: query }),
    'queue',
    { page: 1, limit: 20, category: '', query, from: '', to: '', office: '', state: '', queueType: 'first' }
  );
  assert.match(built.query, /REGEXP_REPLACE\(COALESCE\(b\.phone, ''\), '\[\^0-9\]', '', 'g'\)/);
  assert.match(built.query, /SUBSTRING\(REGEXP_REPLACE\(COALESCE\(b\.phone, ''\), '\[\^0-9\]', '', 'g'\) FROM 4\)/);
  assert.deepEqual(Array.from(built.params), [
    `%${query}%`,
    '%01712345678%',
    `%${query}%`,
    '%01712345678%',
    20,
    0,
  ]);

  const localPrefixQuery = '880 01712 345678';
  const localPrefixSearch = controller.buildReportQuery(
    headOfficeRequest({ q: localPrefixQuery }),
    'queue',
    { page: 1, limit: 20, category: '', query: localPrefixQuery, from: '', to: '', office: '', state: '', queueType: 'first' }
  );
  assert.deepEqual(Array.from(localPrefixSearch.params), [
    `%${localPrefixQuery}%`,
    '%01712345678%',
    `%${localPrefixQuery}%`,
    '%01712345678%',
    20,
    0,
  ]);
});

test('queue status filters rows server-side without changing category-wide progress', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ state: 'pending' }),
    'queue',
    { page: 1, limit: 20, category: '', query: '', from: '', to: '', state: 'pending' }
  );
  assert.match(built.query, /target_rows AS \(\s+SELECT \* FROM filtered WHERE verification_state = \$1 AND attempt_count = 0/);
  assert.match(built.query, /category_stats AS \([\s\S]*FROM category_filtered/);
  assert.deepEqual(Array.from(built.params), ['pending', 20, 0]);
});

test('follow-up queue contains only previously attempted active tickets', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ queue_type: 'follow_up' }),
    'queue',
    { page: 1, limit: 20, category: '', query: '', from: '', to: '', state: '', queueType: 'follow_up' }
  );
  assert.match(built.query, /target_rows AS \(\s+SELECT \* FROM filtered WHERE verification_state IN \('pending', 'in_progress'\) AND attempt_count > 0/);
  assert.deepEqual(Array.from(built.params), [20, 0]);
});

test('office filter applies to queue rows and returns available offices for the selected queue type', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ office: 'Boyra Office' }),
    'queue',
    { page: 1, limit: 20, category: '', query: '', from: '', to: '', office: 'Boyra Office', state: '', queueType: 'first' }
  );
  assert.match(built.query, /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.office_name\), ''\), NULLIF\(BTRIM\(b\.zone\), ''\), 'Corporate Office'\)\) = LOWER\(BTRIM\(\$1\)\)/);
  assert.match(built.query, /office_options AS \([\s\S]*SELECT DISTINCT COALESCE\(NULLIF\(BTRIM\(b\.office_name\), ''\), NULLIF\(BTRIM\(b\.zone\), ''\), 'Corporate Office'\) AS office_name/);
  assert.match(built.query, /AND attempt_count = 0/);
  assert.deepEqual(Array.from(built.params), ['Boyra Office', 'Boyra Office', 20, 0]);
});

test('queue category counts ignore selected category and retain the office filter', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ category: 'shifting', office: 'Boyra Office' }),
    'queue',
    { page: 1, limit: 20, category: 'shifting', query: '', from: '', to: '', office: 'Boyra Office', state: '', queueType: 'first' }
  );
  assert.match(built.query, /filtered AS \(\s+SELECT b\.\* FROM classified b WHERE b\.verification_type = \$1 AND LOWER\([\s\S]*?\) = LOWER\(BTRIM\(\$2\)\)/);
  assert.match(built.query, /category_filtered AS \(\s+SELECT b\.\* FROM classified b WHERE LOWER\([\s\S]*?\) = LOWER\(BTRIM\(\$3\)\)/);
  assert.doesNotMatch(built.query.match(/category_filtered AS \([\s\S]*?\n    \),\s*category_stats/)[0], /verification_type =/);
  assert.match(built.query, /category_stats AS \([\s\S]*FROM category_filtered/);
  assert.deepEqual(Array.from(built.params), ['shifting', 'Boyra Office', 'Boyra Office', 20, 0]);
});

test('analytics filters validate Bangladesh-local daily and monthly periods', () => {
  const controller = makeController();
  assert.deepEqual(
    { ...controller.parseAnalyticsFilters({ query: { view: 'daily', date: '2026-10-22' } }, 'daily').filters },
    { mode: 'daily', startDate: '2026-10-22', endDate: '2026-10-23', period: '2026-10-22' }
  );
  assert.deepEqual(
    { ...controller.parseAnalyticsFilters({ query: { month: '2026-12' } }, 'monthly').filters },
    { mode: 'monthly', startDate: '2026-12-01', endDate: '2027-01-01', period: '2026-12' }
  );
  assert.match(controller.parseAnalyticsFilters({ query: { view: 'daily', date: '2026-02-30' } }, 'daily').error, /date/i);
  assert.match(controller.parseAnalyticsFilters({ query: { month: '2026-13' } }, 'monthly').error, /month/i);
});

test('analytics groups calls by employee or office and employee using local-time boundaries', () => {
  const controller = makeController();
  const monthly = controller.parseAnalyticsFilters({ query: { month: '2026-10' } }, 'monthly').filters;
  const employeeQuery = controller.buildAnalyticsQuery(headOfficeRequest(), monthly);
  assert.match(employeeQuery.query, /AT TIME ZONE 'Asia\/Dhaka'/);
  assert.match(employeeQuery.query, /GROUP BY caller_id, caller_name/);
  assert.match(employeeQuery.query, /COUNT\(\*\) FILTER \(WHERE outcome = 'in_progress'\)/);
  assert.match(employeeQuery.query, /a\.caller_office_snapshot/);
  assert.match(employeeQuery.query, /caller_employee_id/);
  assert.match(employeeQuery.query, /a\.caller_employee_id_snapshot/);
  assert.match(employeeQuery.query, /legacy_verification_rows AS/);
  assert.match(employeeQuery.query, /v\.verified_by AS caller_id/);
  assert.match(employeeQuery.query, /UNION ALL\s+SELECT \* FROM legacy_verification_rows/);
  assert.match(employeeQuery.query, /NOT EXISTS \(\s+SELECT 1 FROM support_verification_call_attempts a WHERE a\.ticket_id = v\.ticket_id/);
  assert.deepEqual(Array.from(employeeQuery.params), ['2026-10-01', '2026-11-01']);

  const breakdown = controller.buildAnalyticsQuery(
    headOfficeRequest(),
    { ...monthly, mode: 'breakdown' }
  );
  assert.match(breakdown.query, /GROUP BY report_office, caller_id, caller_name/);
  assert.match(breakdown.query, /report_office AS office_name/);
});

test('monthly export query returns individual call attempts in chronological order', () => {
  const controller = makeController();
  const filters = controller.parseAnalyticsFilters({ query: { month: '2026-10' } }, 'monthly').filters;
  const built = controller.buildAnalyticsExportQuery(headOfficeRequest(), filters);
  assert.match(built.query, /SELECT id, started_at, ended_at, caller_id, caller_name, caller_employee_id,\s+report_office AS office_name/);
  assert.match(built.query, /ORDER BY started_at ASC, id ASC/);
});

test('monthly analytics export returns a downloadable CSV attachment', async () => {
  const controller = makeController({
    queryHandler: async () => ({
      rows: [{
        id: 3,
        started_at: '2026-10-02T04:00:00.000Z',
        caller_name: '=Unsafe',
        office_name: 'Boyra Office',
        ticket_no: 'TKT-3',
        outcome: 'no_answer',
      }],
      rowCount: 1,
    }),
  });
  const res = makeResponse();
  await controller.exportVerificationCallMonth(headOfficeRequest({ month: '2026-10' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(res.attachmentName, 'verification-call-details-2026-10.csv');
  assert.match(res.body, /"'=Unsafe"/);
  assert.match(res.body, /TKT-3/);
});

test('report query filters to actual verification activity and groups category progress by verification type', () => {
  const controller = makeController();
  const built = controller.buildReportQuery(
    headOfficeRequest({ caller_id: '42', outcome: 'no_answer' }),
    'report',
    { page: 1, limit: 20, category: '', query: '', from: '', to: '', callerId: 42, outcome: 'no_answer' }
  );
  assert.match(built.query, /b\.latest_caller_id = \$1/);
  assert.match(built.query, /b\.latest_outcome = \$2/);
  assert.match(built.query, /b\.attempt_count > 0 OR b\.is_verification_complete/);
  assert.match(built.query, /GROUP BY verification_type/);
  assert.match(built.query, /page_targets AS \(\s+SELECT \* FROM target_rows ORDER BY report_date DESC, id DESC LIMIT \$3 OFFSET \$4/);
  assert.match(built.query, /jsonb_agg\(jsonb_build_object\(\s+'id', a\.id,\s+'outcome', a\.outcome/);
  assert.match(built.query, /'caller_name', u\.full_name/);
  assert.match(built.query, /ORDER BY a\.started_at DESC, a\.id DESC/);
  assert.doesNotMatch(built.query, /OR EXISTS \(\s*SELECT 1 FROM support_verification_call_attempts/);
});

test('queue response reports filtered progress and page metadata', async () => {
  let listQuery;
  const controller = makeController({
    queryHandler: async (sql) => {
      listQuery = sql;
      return {
        rows: [{
          eligible: 8,
          completed: 3,
          pending: 4,
          in_progress: 1,
          completion_rate: '37.5',
          by_category: [{ verification_type: 'qc', eligible: 2 }],
          office_options: ['Boyra Office', 'Corporate Office'],
          rows: [{ id: 7, complaint_no: 'CMP-007', verification_state: 'pending' }],
          total: 5,
        }],
        rowCount: 1,
      };
    },
  });
  const res = makeResponse();
  await controller.listVerificationCallQueue(headOfficeRequest({ page: '2', limit: '10' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.summary.eligible, 8);
  assert.equal(res.body.data.summary.pending, 4);
  assert.equal(res.body.data.summary.completion_rate, 37.5);
  assert.equal(res.body.data.page, 2);
  assert.equal(res.body.data.totalPages, 1);
  assert.equal(res.body.data.can_call, true);
  assert.deepEqual(res.body.data.office_options, ['Boyra Office', 'Corporate Office']);
  assert.equal(res.body.data.rows[0].complaint_no, 'CMP-007');
  assert.equal(Object.hasOwn(res.body.data, 'cutoff_at'), false);
  assert.match(listQuery, /ORDER BY solved_at ASC, id ASC/);
  assert.doesNotMatch(listQuery, /support_verification_queue_settings|resolved_at, t\.closed_at\) >=/);
});

test('read-only queue access does not return customer phone numbers', async () => {
  const controller = makeController({
    queryHandler: async () => ({
        rows: [{
          eligible: 1,
          completed: 0,
          pending: 1,
          in_progress: 0,
          completion_rate: '0',
          by_category: [],
          rows: [{ id: 7, verification_state: 'pending', phone: '01700000000' }],
          total: 1,
        }],
        rowCount: 1,
      }),
  });
  const res = makeResponse();
  const req = {
    ...headOfficeRequest(),
    user: { id: 42, permissions: { 'support.ticket.view': true } },
  };
  await controller.listVerificationCallQueue(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.can_call, false);
  assert.equal(Object.hasOwn(res.body.data.rows[0], 'phone'), false);
});

test('report preserves per-attempt history while suppressing customer phone numbers', async () => {
  const attempts = [{
    id: 31,
    outcome: 'no_answer',
    note: 'Try again tomorrow',
    caller_name: 'Call operator',
    started_at: '2026-10-02T10:00:00.000Z',
    ended_at: '2026-10-02T10:01:00.000Z',
  }];
  const controller = makeController({
    queryHandler: async () => ({
        rows: [{
          eligible: 1,
          completed: 0,
          pending: 1,
          in_progress: 0,
          completion_rate: '0',
          by_category: [],
          rows: [{ id: 7, phone: '01700000000', attempt_history: attempts }],
          total: 1,
        }],
        rowCount: 1,
      }),
  });
  const req = {
    ...headOfficeRequest(),
    user: { id: 42, permissions: { 'support.ticket.view': true } },
  };
  const res = makeResponse();
  await controller.listVerificationCallReport(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(res.body.data.rows[0], 'phone'), false);
  assert.equal(JSON.stringify(res.body.data.rows[0].attempt_history), JSON.stringify(attempts));
});

test('historical solved tickets can start a call despite the former queue cutoff', async () => {
  const queries = [];
  const controller = makeController({
    clientHandler: async (sql, values = []) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT t.id, t.ticket_no')) return { rows: [defaultTicket], rowCount: 1 };
      if (sql.includes('SELECT * FROM support_verifications')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT id, caller_id, outcome')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO support_verification_call_attempts')) {
        return { rows: [{ id: 31, ticket_id: 7, caller_id: 42, outcome: 'in_progress' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const res = makeResponse();
  await controller.startVerificationCallAttempt(headOfficeRequest(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.attempt.id, 31);
  assert.equal(queries.some(({ sql }) => sql === 'BEGIN'), true);
  assert.equal(queries.some(({ sql }) => sql === 'COMMIT'), true);
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO support_ticket_events')), true);
  const ticketQuery = queries.find(({ sql }) => sql.includes('SELECT t.id, t.ticket_no'));
  assert.doesNotMatch(ticketQuery.sql, /queue_started_at|support_verification_queue_settings/);
  const attemptInsert = queries.find(({ sql }) => sql.includes('INSERT INTO support_verification_call_attempts'));
  assert.deepEqual(Array.from(attemptInsert.values).slice(2), ['Call Operator', 'EMP-42', null, 'Corporate Office', 'Boyra Office']);
});

test('completed tickets cannot be claimed again from the queue', async () => {
  const queries = [];
  const controller = makeController({
    clientHandler: async (sql, values = []) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT t.id, t.ticket_no')) return { rows: [defaultTicket], rowCount: 1 };
      if (sql.includes('SELECT * FROM support_verifications')) {
        return { rows: [{ answers: { work_received: true } }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const res = makeResponse();
  await controller.startVerificationCallAttempt(headOfficeRequest(), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already has a completed verification/i);
  assert.equal(queries.some(({ sql }) => sql.includes('INSERT INTO support_verification_call_attempts')), false);
  assert.equal(queries.some(({ sql }) => sql === 'ROLLBACK'), true);
});

test('finishing an active attempt saves its outcome and caller note', async () => {
  const queries = [];
  const controller = makeController({
    clientHandler: async (sql, values = []) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT id, ticket_no FROM support_tickets')) return { rows: [{ id: 7, ticket_no: 'TKT-7' }], rowCount: 1 };
      if (sql.includes('SELECT id, caller_id, outcome') && sql.includes('WHERE id = $1 AND ticket_id = $2')) {
        return { rows: [{ id: 31, caller_id: 42, outcome: 'in_progress' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE support_verification_call_attempts')) {
        return { rows: [{ id: 31, outcome: values[0], note: values[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  const res = makeResponse();
  const req = headOfficeRequest();
  req.body = { outcome: 'callback_requested', note: 'Call after 6 PM' };
  await controller.finishVerificationCallAttempt(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.attempt.outcome, 'callback_requested');
  assert.equal(res.body.data.attempt.note, 'Call after 6 PM');
  assert.equal(queries.some(({ sql }) => sql === 'COMMIT'), true);
});
