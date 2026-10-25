const pool = require('../utilities/db');
const { success, fail, notFound, serverError } = require('../utilities/apiResponse');
const { isFieldTechnician, blockFieldTechnician } = require('../middleware/technicianScope');
const { resolvePermission } = require('../utilities/permissionRegistry');
const { resolveSupportOffice, appendSupportOfficeScope } = require('../middleware/supportOfficeScope');
const { hasVerificationAnswers } = require('../utilities/supportVerificationRules');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const STALE_ATTEMPT_MINUTES = 30;
const VERIFICATION_TYPES = new Set(['shifting', 'new_connection', 'qc', 'support']);
const QUEUE_STATES = new Set(['pending', 'in_progress']);
const ANALYTICS_VIEWS = new Set(['daily', 'monthly', 'breakdown']);
const OUTCOME_FILTERS = new Set([
  'completed',
  'pending',
  'in_progress',
  'no_answer',
  'busy',
  'callback_requested',
  'wrong_number',
  'incomplete',
  'abandoned',
]);
const FINISH_OUTCOMES = new Set([
  'no_answer',
  'busy',
  'callback_requested',
  'wrong_number',
  'incomplete',
  'abandoned',
]);

const escapeLike = (value) => String(value).replace(/([%_\\])/g, '\\$1');
const ticketOfficeExpression = (alias) => (
  `COALESCE(NULLIF(BTRIM(${alias}.office_name), ''), NULLIF(BTRIM(${alias}.zone), ''), 'Corporate Office')`
);
const normalizePhoneSearch = (value) => {
  const digits = String(value).replace(/\D/g, '');
  if (/^88001[3-9]/.test(digits)) return `0${digits.slice(4)}`;
  if (/^8801[3-9]/.test(digits)) return `0${digits.slice(3)}`;
  if (/^881[3-9]/.test(digits)) return `0${digits.slice(2)}`;
  if (/^1[3-9]/.test(digits)) return `0${digits}`;
  return digits;
};
const normalizedPhoneExpression = (alias) => {
  const digits = `REGEXP_REPLACE(COALESCE(${alias}.phone, ''), '[^0-9]', '', 'g')`;
  return `CASE
    WHEN ${digits} ~ '^88001[3-9]' THEN '0' || SUBSTRING(${digits} FROM 5)
    WHEN ${digits} ~ '^8801[3-9]' THEN '0' || SUBSTRING(${digits} FROM 4)
    WHEN ${digits} ~ '^881[3-9]' THEN '0' || SUBSTRING(${digits} FROM 3)
    WHEN ${digits} ~ '^1[3-9]' THEN '0' || ${digits}
    ELSE ${digits}
  END`;
};

const parsePositiveInteger = (value) => {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const parseFilters = (req, mode) => {
  const rawPage = Number.parseInt(req.query.page, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1;
  const rawLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) ? Math.max(10, Math.min(rawLimit, MAX_LIMIT)) : DEFAULT_LIMIT;
  const category = String(req.query.category || '').trim().toLowerCase();
  const query = String(req.query.q || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const office = String(req.query.office || '').trim();

  if (category && !VERIFICATION_TYPES.has(category)) return { error: 'Invalid verification category.' };
  if (query.length > 120) return { error: 'Search must be 120 characters or fewer.' };
  if (office.length > 120) return { error: 'Office must be 120 characters or fewer.' };
  if (from && !isValidDate(from)) return { error: 'A valid start date is required (YYYY-MM-DD).' };
  if (to && !isValidDate(to)) return { error: 'A valid end date is required (YYYY-MM-DD).' };
  if (from && to && from > to) return { error: 'Start date must be on or before end date.' };

  const filters = { page, limit, category, query, from, to, office, state: '', callerId: null, outcome: '' };
  if (mode === 'queue') {
    const state = String(req.query.state || '').trim().toLowerCase();
    const queueType = String(req.query.queue_type || 'first').trim().toLowerCase();
    if (state && !QUEUE_STATES.has(state)) return { error: 'Invalid queue state.' };
    if (!['first', 'follow_up'].includes(queueType)) return { error: 'Invalid queue type.' };
    filters.state = state;
    filters.queueType = queueType;
  }
  if (mode === 'report') {
    const rawCallerId = String(req.query.caller_id || '').trim();
    const outcome = String(req.query.outcome || '').trim().toLowerCase();
    if (rawCallerId) {
      filters.callerId = parsePositiveInteger(rawCallerId);
      if (!filters.callerId) return { error: 'Invalid caller.' };
    }
    if (outcome && !OUTCOME_FILTERS.has(outcome)) return { error: 'Invalid verification outcome.' };
    filters.outcome = outcome;
  }
  return { filters };
};

const parseAnalyticsFilters = (req, mode) => {
  if (!ANALYTICS_VIEWS.has(mode)) return { error: 'Invalid call analytics view.' };
  if (mode === 'daily') {
    const date = String(req.query.date || '').trim();
    if (!isValidDate(date)) return { error: 'A valid report date is required (YYYY-MM-DD).' };
    const nextDate = new Date(`${date}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    return { filters: { mode, startDate: date, endDate: nextDate.toISOString().slice(0, 10), period: date } };
  }

  const month = String(req.query.month || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { error: 'A valid report month is required (YYYY-MM).' };
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonth = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return {
    filters: {
      mode,
      startDate: `${month}-01`,
      endDate: nextMonth,
      period: month,
    },
  };
};

const buildAnalyticsRowsCte = (req, filters, params) => {
  params.push(filters.startDate, filters.endDate);
  const where = [
    `s.started_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Dhaka')`,
    `s.started_at < ($2::date::timestamp AT TIME ZONE 'Asia/Dhaka')`,
  ];
  const scope = req.supportOfficeScope || resolveSupportOffice(req.user);
  if (!scope) throw new Error('Support office scope is not available.');
  appendSupportOfficeScope(where, params, scope, 's');

  return `WITH attempt_rows AS (
    SELECT
      a.id,
      a.ticket_id,
      a.caller_id,
      COALESCE(
        NULLIF(BTRIM(a.caller_name_snapshot), ''),
        NULLIF(BTRIM(u.full_name), ''),
        CASE WHEN a.caller_id IS NULL THEN 'Unassigned' ELSE 'Employee #' || a.caller_id::text END
      ) AS caller_name,
      COALESCE(NULLIF(BTRIM(a.caller_employee_id_snapshot), ''), NULLIF(BTRIM(u.employee_id), '')) AS caller_employee_id,
      COALESCE(NULLIF(BTRIM(a.office_name_snapshot), ''), NULLIF(BTRIM(t.office_name), ''), 'Corporate Office') AS office_name,
      COALESCE(NULLIF(BTRIM(a.zone_snapshot), ''), NULLIF(BTRIM(t.zone), ''), '') AS zone,
      a.caller_office_snapshot,
      u.work_location AS caller_office_current,
      CASE
        WHEN LOWER(TRIM(COALESCE(NULLIF(a.office_name_snapshot, ''), NULLIF(t.office_name, ''), 'Corporate Office'))) IN ('corporate office', 'head office', 'head office (corporate office)', 'khulna head office')
          AND NULLIF(BTRIM(COALESCE(a.zone_snapshot, t.zone, '')), '') IS NOT NULL
          AND LOWER(TRIM(COALESCE(a.zone_snapshot, t.zone, ''))) NOT IN ('corporate office', 'head office')
          THEN COALESCE(NULLIF(BTRIM(a.zone_snapshot), ''), NULLIF(BTRIM(t.zone), ''))
        ELSE COALESCE(NULLIF(BTRIM(a.office_name_snapshot), ''), NULLIF(BTRIM(t.office_name), ''), NULLIF(BTRIM(a.zone_snapshot), ''), NULLIF(BTRIM(t.zone), ''), 'Corporate Office')
      END AS ticket_office,
      a.outcome,
      a.note,
      a.source,
      a.started_at,
      a.ended_at,
      t.ticket_no,
      t.complaint_no
    FROM support_verification_call_attempts a
    JOIN support_tickets t ON t.id = a.ticket_id
    LEFT JOIN users u ON u.id = a.caller_id
  ),
  legacy_verification_rows AS (
    SELECT
      v.id,
      v.ticket_id,
      v.verified_by AS caller_id,
      COALESCE(NULLIF(BTRIM(u.full_name), ''), 'Employee #' || v.verified_by::text) AS caller_name,
      NULLIF(BTRIM(u.employee_id), '') AS caller_employee_id,
      COALESCE(NULLIF(BTRIM(t.office_name), ''), 'Corporate Office') AS office_name,
      COALESCE(NULLIF(BTRIM(t.zone), ''), '') AS zone,
      u.work_location AS caller_office_snapshot,
      u.work_location AS caller_office_current,
      CASE
        WHEN LOWER(TRIM(COALESCE(NULLIF(t.office_name, ''), 'Corporate Office'))) IN ('corporate office', 'head office', 'head office (corporate office)', 'khulna head office')
          AND NULLIF(BTRIM(t.zone), '') IS NOT NULL
          AND LOWER(TRIM(t.zone)) NOT IN ('corporate office', 'head office')
          THEN BTRIM(t.zone)
        ELSE COALESCE(NULLIF(BTRIM(t.office_name), ''), NULLIF(BTRIM(t.zone), ''), 'Corporate Office')
      END AS ticket_office,
      'completed'::varchar(30) AS outcome,
      v.feedback_remarks AS note,
      'legacy_verification'::varchar(30) AS source,
      v.created_at AS started_at,
      v.created_at AS ended_at,
      t.ticket_no,
      t.complaint_no
    FROM support_verifications v
    JOIN support_tickets t ON t.id = v.ticket_id
    LEFT JOIN users u ON u.id = v.verified_by
    WHERE v.verified_by IS NOT NULL
      AND (
        (jsonb_typeof(v.answers) = 'object' AND v.answers <> '{}'::jsonb)
        OR v.q1_technical IS NOT NULL
        OR v.q2_media IS NOT NULL
        OR v.q3_customercare IS NOT NULL
        OR v.q4_payment IS NOT NULL
        OR v.q5_service_satisfaction IS NOT NULL
        OR v.q6_time_satisfaction IS NOT NULL
        OR v.q7_technician_behavior IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM support_verification_call_attempts a WHERE a.ticket_id = v.ticket_id
      )
  ),
  all_call_rows AS (
    SELECT * FROM attempt_rows
    UNION ALL
    SELECT * FROM legacy_verification_rows
  ),
  scoped_attempts AS (
    SELECT
      s.*,
      COALESCE(NULLIF(BTRIM(s.caller_office_snapshot), ''), NULLIF(BTRIM(s.caller_office_current), ''), s.ticket_office) AS report_office
    FROM all_call_rows s WHERE ${where.join(' AND ')}
  )`;
};

const buildAnalyticsQuery = (req, filters) => {
  const params = [];
  const cte = buildAnalyticsRowsCte(req, filters, params);
  const grouping = filters.mode === 'breakdown'
    ? 'report_office, caller_id, caller_name'
    : 'caller_id, caller_name';
  const officeSelect = filters.mode === 'breakdown' ? 'report_office AS office_name,' : '';
  const officeOrder = filters.mode === 'breakdown' ? 'office_name ASC, ' : '';
  return {
    query: `${cte}
      SELECT
        ${officeSelect}
        caller_id,
        caller_name,
        caller_employee_id,
        COUNT(*)::int AS total_calls,
        COUNT(DISTINCT ticket_id)::int AS unique_tickets,
        COUNT(*) FILTER (WHERE outcome = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE outcome = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE outcome = 'no_answer')::int AS no_answer,
        COUNT(*) FILTER (WHERE outcome = 'busy')::int AS busy,
        COUNT(*) FILTER (WHERE outcome = 'callback_requested')::int AS callback_requested,
        COUNT(*) FILTER (WHERE outcome = 'wrong_number')::int AS wrong_number,
        COUNT(*) FILTER (WHERE outcome = 'incomplete')::int AS incomplete,
        COUNT(*) FILTER (WHERE outcome = 'abandoned')::int AS abandoned
      FROM scoped_attempts
      GROUP BY ${grouping}, caller_employee_id
      ORDER BY ${officeOrder}total_calls DESC, caller_name ASC`,
    params,
  };
};

const buildAnalyticsExportQuery = (req, filters) => {
  const params = [];
  const cte = buildAnalyticsRowsCte(req, filters, params);
  return {
    query: `${cte}
      SELECT id, started_at, ended_at, caller_id, caller_name, caller_employee_id,
             report_office AS office_name,
             ticket_office, ticket_no, complaint_no, outcome, note, source
      FROM scoped_attempts
      ORDER BY started_at ASC, id ASC`,
    params,
  };
};

const buildBaseCte = (req, params) => {
  const where = [`t.status IN ('closed', 'resolved')`];
  const scope = req.supportOfficeScope || resolveSupportOffice(req.user);
  if (!scope) throw new Error('Support office scope is not available.');
  appendSupportOfficeScope(where, params, scope, 't');

  if (isFieldTechnician(req.user) && req.user?.id) {
    params.push(Number(req.user.id));
    where.push(`t.assigned_to = $${params.length}`);
  }

  return `WITH eligible AS (
    SELECT
      t.id,
      t.ticket_no,
      t.complaint_no,
      t.customer_id,
      t.category_id,
      t.subject,
      t.status,
      t.office_name,
      t.zone,
      COALESCE(t.resolved_at, t.closed_at) AS solved_at,
      COALESCE(
        NULLIF(BTRIM(t.customer_snapshot->>'pppoe_username'), ''),
        NULLIF(BTRIM(nc.pppoe_username), '')
      ) AS pppoe_username,
      COALESCE(
        NULLIF(BTRIM(t.customer_snapshot->>'name'), ''),
        NULLIF(BTRIM(t.customer_snapshot->>'customer_name'), ''),
        NULLIF(BTRIM(nc.pppoe_username), ''),
        t.customer_id::text,
        'Unknown'
      ) AS customer_name,
      COALESCE(
        NULLIF(BTRIM(t.customer_snapshot->>'phone'), ''),
        NULLIF(BTRIM(nc.manual_phone), ''),
        NULLIF(BTRIM(nc.phone), '')
      ) AS phone,
      COALESCE(NULLIF(BTRIM(cat.name_bn), ''), NULLIF(BTRIM(cat.name), ''), NULLIF(BTRIM(t.subject), ''), 'Uncategorized') AS category_name,
      CASE
        WHEN t.category_id = 915 OR LOWER(COALESCE(cat.name, '')) LIKE '%shift%' THEN 'shifting'
        WHEN t.category_id = 904 OR LOWER(COALESCE(cat.name, '')) LIKE '%new_connection%' THEN 'new_connection'
        WHEN t.category_id = 912 OR COALESCE(t.is_qc_support, FALSE) OR LOWER(COALESCE(cat.name, '')) LIKE '%qc%' THEN 'qc'
        ELSE 'support'
      END AS verification_type,
      v.id AS verification_id,
      v.answers AS verification_answers,
      jsonb_build_object(
        'q1_technical', v.q1_technical,
        'q2_media', v.q2_media,
        'q3_customercare', v.q3_customercare,
        'q4_payment', v.q4_payment,
        'q5_service_satisfaction', v.q5_service_satisfaction,
        'q6_time_satisfaction', v.q6_time_satisfaction,
        'q7_technician_behavior', v.q7_technician_behavior
      ) AS legacy_answers,
      v.feedback_remarks,
      v.verified_by,
      vu.full_name AS verified_by_name,
      v.created_at AS verified_at,
      CASE WHEN v.id IS NOT NULL
        AND NOT COALESCE(
          jsonb_typeof(v.answers) = 'object' AND v.answers <> '{}'::jsonb,
          FALSE
        )
        AND (
          v.q1_technical IS NOT NULL
          OR v.q2_media IS NOT NULL
          OR v.q3_customercare IS NOT NULL
          OR v.q4_payment IS NOT NULL
          OR v.q5_service_satisfaction IS NOT NULL
          OR v.q6_time_satisfaction IS NOT NULL
          OR v.q7_technician_behavior IS NOT NULL
        ) THEN TRUE ELSE FALSE END AS is_legacy,
      CASE WHEN v.id IS NOT NULL AND (
        (jsonb_typeof(v.answers) = 'object' AND v.answers <> '{}'::jsonb)
        OR v.q1_technical IS NOT NULL
        OR v.q2_media IS NOT NULL
        OR v.q3_customercare IS NOT NULL
        OR v.q4_payment IS NOT NULL
        OR v.q5_service_satisfaction IS NOT NULL
        OR v.q6_time_satisfaction IS NOT NULL
        OR v.q7_technician_behavior IS NOT NULL
      ) THEN TRUE ELSE FALSE END AS is_verification_complete,
      latest.id AS latest_attempt_id,
      latest.outcome AS latest_outcome,
      latest.note AS latest_attempt_note,
      latest.caller_id AS latest_caller_id,
      latest.caller_name AS latest_caller_name,
      latest.started_at AS latest_started_at,
      latest.ended_at AS latest_ended_at,
      COALESCE(attempt_totals.attempt_count, 0)::int AS attempt_count,
      COALESCE(revision_totals.correction_count, 0)::int AS correction_count
    FROM support_tickets t
    LEFT JOIN support_categories cat ON cat.id = t.category_id
    LEFT JOIN network_customers nc ON nc.id = t.customer_id
    LEFT JOIN support_verifications v ON v.ticket_id = t.id
    LEFT JOIN users vu ON vu.id = v.verified_by
    LEFT JOIN LATERAL (
      SELECT a.id, a.outcome, a.note, a.caller_id, u.full_name AS caller_name, a.started_at, a.ended_at
      FROM support_verification_call_attempts a
      LEFT JOIN users u ON u.id = a.caller_id
      WHERE a.ticket_id = t.id
      ORDER BY a.started_at DESC, a.id DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS attempt_count
      FROM support_verification_call_attempts a
      WHERE a.ticket_id = t.id
    ) attempt_totals ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS correction_count
      FROM support_verification_revisions r
      WHERE r.ticket_id = t.id
    ) revision_totals ON TRUE
    WHERE ${where.join(' AND ')}
  ),
  classified AS (
    SELECT eligible.*,
      CASE
        WHEN is_verification_complete THEN 'completed'
        WHEN latest_outcome = 'in_progress'
          AND latest_started_at >= NOW() - INTERVAL '${STALE_ATTEMPT_MINUTES} minutes' THEN 'in_progress'
        ELSE 'pending'
      END AS verification_state,
      COALESCE(verified_at, latest_started_at) AS report_date,
      CASE WHEN is_verification_complete THEN 'completed' ELSE latest_outcome END AS outcome,
      CASE WHEN latest_attempt_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', latest_attempt_id,
        'outcome', latest_outcome,
        'note', latest_attempt_note,
        'caller_id', latest_caller_id,
        'caller_name', latest_caller_name,
        'started_at', latest_started_at,
        'ended_at', latest_ended_at
      ) END AS latest_attempt
    FROM eligible
  )`;
};

const appendFilters = (req, params, filters, mode) => {
  const where = [];
  if (filters.category) {
    params.push(filters.category);
    where.push(`b.verification_type = $${params.length}`);
  }
  if (mode === 'queue' && filters.office) {
    params.push(filters.office);
    where.push(`LOWER(${ticketOfficeExpression('b')}) = LOWER(BTRIM($${params.length}))`);
  }
  if (filters.query) {
    const search = `%${escapeLike(filters.query)}%`;
    params.push(search);
    const placeholder = `$${params.length}`;
    const searchFields = [`
      b.ticket_no ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(b.pppoe_username, '') ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(b.customer_name, '') ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(b.phone, '') ILIKE ${placeholder} ESCAPE '\\'
      OR COALESCE(b.category_name, '') ILIKE ${placeholder} ESCAPE '\\'`];
    const normalizedPhone = normalizePhoneSearch(filters.query);
    if (normalizedPhone.length >= 7) {
      params.push(`%${normalizedPhone}%`);
      searchFields.push(`${normalizedPhoneExpression('b')} LIKE $${params.length}`);
    }
    where.push(`(${searchFields.join('\n      OR ')})`);
  }
  const dateExpression = mode === 'queue' ? 'b.solved_at' : 'b.report_date';
  if (filters.from) {
    params.push(filters.from);
    where.push(`${dateExpression} >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`${dateExpression} < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (mode === 'report' && filters.callerId) {
    params.push(filters.callerId);
    where.push(`b.latest_caller_id = $${params.length}`);
  }
  if (mode === 'report') where.push('(b.attempt_count > 0 OR b.is_verification_complete)');
  if (mode === 'report' && filters.outcome) {
    if (filters.outcome === 'completed' || filters.outcome === 'pending' || filters.outcome === 'in_progress') {
      params.push(filters.outcome);
      where.push(`b.verification_state = $${params.length}`);
    } else {
      params.push(filters.outcome);
      where.push(`b.latest_outcome = $${params.length}`);
    }
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
};

const buildReportQuery = (req, mode, filters) => {
  const params = [];
  const baseCte = buildBaseCte(req, params);
  const filterSql = appendFilters(req, params, filters, mode);
  const queueMode = mode === 'queue';
  const categoryStatsSql = queueMode
    ? appendFilters(req, params, { ...filters, category: '' }, mode)
    : filterSql;
  let queueStateFilter = '';
  let officeOptionsCte = '';
  if (queueMode) {
    const queueFilters = [];
    if (filters.state) {
      params.push(filters.state);
      queueFilters.push(`verification_state = $${params.length}`);
    } else {
      queueFilters.push(`verification_state IN ('pending', 'in_progress')`);
    }
    if ((filters.queueType || 'first') === 'follow_up') {
      queueFilters.push('attempt_count > 0');
    } else {
      queueFilters.push('attempt_count = 0');
    }
    queueStateFilter = `WHERE ${queueFilters.join(' AND ')}`;
    const queueAttemptFilter = (filters.queueType || 'first') === 'follow_up'
      ? 'attempt_count > 0'
      : 'attempt_count = 0';
    officeOptionsCte = `,
    office_options AS (
      SELECT COALESCE(jsonb_agg(office_name ORDER BY office_name), '[]'::jsonb) AS offices
      FROM (
        SELECT DISTINCT ${ticketOfficeExpression('b')} AS office_name
        FROM classified b
        WHERE verification_state IN ('pending', 'in_progress')
          AND ${queueAttemptFilter}
      ) available_offices
    )`;
  }
  params.push(filters.limit, (filters.page - 1) * filters.limit);
  const limitPlaceholder = `$${params.length - 1}`;
  const offsetPlaceholder = `$${params.length}`;
  const rowOrder = queueMode ? 'solved_at ASC, id ASC' : 'report_date DESC, id DESC';
  const pageRowsCte = queueMode
    ? `page_rows AS (
      SELECT * FROM target_rows ORDER BY ${rowOrder} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    )`
    : `page_targets AS (
      SELECT * FROM target_rows ORDER BY ${rowOrder} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
    ),
    page_rows AS (
      SELECT page_targets.*,
        COALESCE(attempt_history.attempt_history, '[]'::jsonb) AS attempt_history
      FROM page_targets
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', a.id,
          'outcome', a.outcome,
          'note', a.note,
          'caller_name', u.full_name,
          'started_at', a.started_at,
          'ended_at', a.ended_at
        ) ORDER BY a.started_at DESC, a.id DESC), '[]'::jsonb) AS attempt_history
        FROM support_verification_call_attempts a
        LEFT JOIN users u ON u.id = a.caller_id
        WHERE a.ticket_id = page_targets.id
      ) attempt_history ON TRUE
    )`;

  const query = `${baseCte},
    filtered AS (
      SELECT b.* FROM classified b ${filterSql}
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS eligible,
        COUNT(*) FILTER (WHERE verification_state = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE verification_state = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE verification_state = 'in_progress')::int AS in_progress
      FROM filtered
    ),
    ${queueMode ? `category_filtered AS (
      SELECT b.* FROM classified b ${categoryStatsSql}
    ),` : ''}
    category_stats AS (
      SELECT
        verification_type,
        CASE verification_type
          WHEN 'shifting' THEN 'Shifting'
          WHEN 'new_connection' THEN 'New Connection'
          WHEN 'qc' THEN 'QC'
          ELSE 'Support'
        END AS category_name,
        COUNT(*)::int AS eligible,
        COUNT(*) FILTER (WHERE verification_state = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE verification_state = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE verification_state = 'in_progress')::int AS in_progress
      FROM ${queueMode ? 'category_filtered' : 'filtered'}
      GROUP BY verification_type
    ),
    category_summary AS (
      SELECT COALESCE(jsonb_agg(to_jsonb(category_stats) ORDER BY category_name), '[]'::jsonb) AS by_category
      FROM category_stats
    )${officeOptionsCte},
    target_rows AS (
      SELECT * FROM filtered ${queueStateFilter}
    ),
    ${pageRowsCte},
    page_json AS (
      SELECT COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY ${rowOrder}), '[]'::jsonb) AS rows
      FROM page_rows
    ),
    target_count AS (
      SELECT COUNT(*)::int AS total FROM target_rows
    )
    SELECT
      summary.eligible,
      summary.completed,
      summary.pending,
      summary.in_progress,
      CASE WHEN summary.eligible = 0 THEN 0
        ELSE ROUND(100.0 * summary.completed / summary.eligible, 1)
      END AS completion_rate,
      category_summary.by_category,
      ${queueMode ? 'office_options.offices AS office_options,' : ''}
      page_json.rows,
      target_count.total
    FROM summary
    CROSS JOIN category_summary
    ${queueMode ? 'CROSS JOIN office_options' : ''}
    CROSS JOIN page_json
    CROSS JOIN target_count`;
  return { query, params };
};

const hasCallPermission = (user) => (
  !isFieldTechnician(user) &&
  (resolvePermission(user, 'support.ticket.update') || resolvePermission(user, 'support.ticket.assign'))
);

const listVerificationCallQueue = async (req, res) => {
  try {
    const parsed = parseFilters(req, 'queue');
    if (parsed.error) return fail(res, parsed.error, 400);
    const { query, params } = buildReportQuery(req, 'queue', parsed.filters);
    const result = await pool.query(query, params);
    const row = result.rows[0] || {};
    const summary = {
      eligible: Number(row.eligible || 0),
      completed: Number(row.completed || 0),
      pending: Number(row.pending || 0),
      in_progress: Number(row.in_progress || 0),
      completion_rate: Number(row.completion_rate || 0),
      by_category: row.by_category || [],
    };
    const canCall = hasCallPermission(req.user);
    const rows = row.rows || [];
    return success(res, {
      can_call: canCall,
      summary,
      office_options: row.office_options || [],
      rows: canCall ? rows : rows.map(({ phone, ...ticket }) => ticket),
      total: Number(row.total || 0),
      page: parsed.filters.page,
      limit: parsed.filters.limit,
      totalPages: Math.max(1, Math.ceil(Number(row.total || 0) / parsed.filters.limit)),
    });
  } catch (error) {
    return serverError(res, error);
  }
};

const listVerificationCallReport = async (req, res) => {
  try {
    const parsed = parseFilters(req, 'report');
    if (parsed.error) return fail(res, parsed.error, 400);
    const { query, params } = buildReportQuery(req, 'report', parsed.filters);
    const result = await pool.query(query, params);
    const row = result.rows[0] || {};
    const summary = {
      eligible: Number(row.eligible || 0),
      completed: Number(row.completed || 0),
      pending: Number(row.pending || 0),
      in_progress: Number(row.in_progress || 0),
      completion_rate: Number(row.completion_rate || 0),
      by_category: row.by_category || [],
    };
    return success(res, {
      can_call: hasCallPermission(req.user),
      summary,
      rows: (row.rows || []).map(({ phone, ...ticket }) => ticket),
      total: Number(row.total || 0),
      page: parsed.filters.page,
      limit: parsed.filters.limit,
      totalPages: Math.max(1, Math.ceil(Number(row.total || 0) / parsed.filters.limit)),
    });
  } catch (error) {
    return serverError(res, error);
  }
};

const listVerificationCallAnalytics = async (req, res) => {
  try {
    const mode = String(req.query.view || '').trim().toLowerCase();
    const parsed = parseAnalyticsFilters(req, mode);
    if (parsed.error) return fail(res, parsed.error, 400);
    const { query, params } = buildAnalyticsQuery(req, parsed.filters);
    const result = await pool.query(query, params);
    return success(res, { view: mode, period: parsed.filters.period, rows: result.rows || [] });
  } catch (error) {
    return serverError(res, error);
  }
};

const escapeCsvCell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const exportVerificationCallMonth = async (req, res) => {
  try {
    const parsed = parseAnalyticsFilters({ ...req, query: { ...req.query, view: 'monthly' } }, 'monthly');
    if (parsed.error) return fail(res, parsed.error, 400);
    const { query, params } = buildAnalyticsExportQuery(req, parsed.filters);
    const result = await pool.query(query, params);
    const headers = [
      'Attempt ID',
      'Started At',
      'Ended At',
      'Employee ID',
      'Employee',
      'Employee Number',
      'Employee Office',
      'Ticket Office',
      'Ticket No',
      'Complaint No',
      'Outcome',
      'Call Note',
      'Source',
    ];
    const rows = (result.rows || []).map((row) => [
      row.id,
      row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
      row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at,
      row.caller_id,
      row.caller_name,
      row.caller_employee_id,
      row.office_name,
      row.ticket_office,
      row.ticket_no,
      row.complaint_no,
      row.outcome,
      row.note,
      row.source,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`verification-call-details-${parsed.filters.period}.csv`);
    return res.send(csv);
  } catch (error) {
    return serverError(res, error);
  }
};

const startVerificationCallAttempt = async (req, res) => {
  if (blockFieldTechnician(req, res)) return;
  const ticketId = parsePositiveInteger(req.params.id);
  if (!ticketId) return fail(res, 'Invalid ticket ID.', 400);
  const callerId = parsePositiveInteger(req.user?.id);
  if (!callerId) return fail(res, 'Authenticated caller is required.', 403);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const ticketResult = await client.query(
      `SELECT t.id, t.ticket_no, t.status, t.office_name, t.zone
       FROM support_tickets t
       WHERE t.id = $1
       FOR UPDATE OF t`,
      [ticketId]
    );
    if (!ticketResult.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found.');
    }
    const ticket = ticketResult.rows[0];
    if (!['closed', 'resolved'].includes(ticket.status)) {
      await client.query('ROLLBACK');
      return fail(res, 'Only solved or closed tickets can enter the verification queue.', 409);
    }

    const verificationResult = await client.query(
      'SELECT * FROM support_verifications WHERE ticket_id = $1 FOR UPDATE',
      [ticketId]
    );
    const verification = verificationResult.rows[0] || null;
    if (hasVerificationAnswers(verification)) {
      await client.query('ROLLBACK');
      return fail(res, 'This ticket already has a completed verification.', 409);
    }

    const activeResult = await client.query(
      `SELECT id, caller_id, outcome, started_at,
              started_at <= NOW() - INTERVAL '${STALE_ATTEMPT_MINUTES} minutes' AS is_stale
       FROM support_verification_call_attempts
       WHERE ticket_id = $1 AND outcome = 'in_progress'
       ORDER BY started_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [ticketId]
    );
    const activeAttempt = activeResult.rows[0];
    if (activeAttempt) {
      const isStale = Boolean(activeAttempt.is_stale);
      if (!isStale && Number(activeAttempt.caller_id) === callerId) {
        await client.query('COMMIT');
        return success(res, { attempt: activeAttempt, resumed: true });
      }
      if (!isStale) {
        await client.query('ROLLBACK');
        return fail(res, 'Another caller already has this ticket in progress.', 409);
      }
      await client.query(
        `UPDATE support_verification_call_attempts
         SET outcome = 'abandoned', ended_at = NOW(),
             note = COALESCE(note, 'Automatically closed after inactivity timeout')
         WHERE id = $1 AND outcome = 'in_progress'`,
        [activeAttempt.id]
      );
    }

    const attemptResult = await client.query(
      `INSERT INTO support_verification_call_attempts
        (ticket_id, caller_id, source, outcome, caller_name_snapshot, caller_employee_id_snapshot, caller_office_snapshot,
         office_name_snapshot, zone_snapshot)
       VALUES ($1, $2, 'queue', 'in_progress', $3, $4, $5, $6, $7)
       RETURNING id, ticket_id, caller_id, source, outcome, note, started_at, ended_at`,
      [
        ticketId,
        callerId,
        req.user?.full_name || req.user?.name || `Employee #${callerId}`,
        req.user?.employee_id || null,
        req.user?.work_location || null,
        ticket.office_name || null,
        ticket.zone || null,
      ]
    );
    const attempt = attemptResult.rows[0];
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, metadata, created_by)
       VALUES ($1, 'verification_call_attempt', 'Verification call started', $2::jsonb, $3)`,
      [ticketId, JSON.stringify({ attempt_id: attempt.id, outcome: 'in_progress' }), callerId]
    );
    await client.query('COMMIT');
    return success(res, { attempt, resumed: false }, 201);
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    if (error?.code === '23505') {
      return fail(res, 'Another caller already has this ticket in progress.', 409);
    }
    return serverError(res, error);
  } finally {
    if (client) client.release();
  }
};

const finishVerificationCallAttempt = async (req, res) => {
  if (blockFieldTechnician(req, res)) return;
  const ticketId = parsePositiveInteger(req.params.id);
  const attemptId = parsePositiveInteger(req.params.attemptId);
  const callerId = parsePositiveInteger(req.user?.id);
  const outcome = String(req.body?.outcome || '').trim().toLowerCase();
  const note = req.body?.note == null ? null : String(req.body.note).trim().slice(0, 1000) || null;
  if (!ticketId || !attemptId) return fail(res, 'Invalid ticket or attempt ID.', 400);
  if (!callerId) return fail(res, 'Authenticated caller is required.', 403);
  if (!FINISH_OUTCOMES.has(outcome)) return fail(res, 'Invalid call outcome.', 400);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const ticketResult = await client.query(
      'SELECT id, ticket_no FROM support_tickets WHERE id = $1 FOR UPDATE',
      [ticketId]
    );
    if (!ticketResult.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found.');
    }
    const attemptResult = await client.query(
      `SELECT id, caller_id, outcome
       FROM support_verification_call_attempts
       WHERE id = $1 AND ticket_id = $2
       FOR UPDATE`,
      [attemptId, ticketId]
    );
    const attempt = attemptResult.rows[0];
    if (!attempt || attempt.outcome !== 'in_progress') {
      await client.query('ROLLBACK');
      return fail(res, 'This call attempt is no longer active.', 409);
    }
    if (Number(attempt.caller_id) !== callerId) {
      await client.query('ROLLBACK');
      return fail(res, 'Only the caller who started this attempt can complete it.', 403);
    }
    const updated = await client.query(
      `UPDATE support_verification_call_attempts
       SET outcome = $1, note = COALESCE($2, note), ended_at = NOW()
       WHERE id = $3 AND ticket_id = $4 AND outcome = 'in_progress'
       RETURNING id, ticket_id, caller_id, source, outcome, note, started_at, ended_at`,
      [outcome, note, attemptId, ticketId]
    );
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, metadata, created_by)
       VALUES ($1, 'verification_call_attempt', $2, $3::jsonb, $4)`,
      [ticketId, `Verification call outcome: ${outcome}`, JSON.stringify({ attempt_id: attemptId, outcome, note }), callerId]
    );
    await client.query('COMMIT');
    return success(res, { attempt: updated.rows[0] });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    return serverError(res, error);
  } finally {
    if (client) client.release();
  }
};

module.exports = {
  listVerificationCallQueue,
  listVerificationCallReport,
  listVerificationCallAnalytics,
  exportVerificationCallMonth,
  startVerificationCallAttempt,
  finishVerificationCallAttempt,
  parseFilters,
  parseAnalyticsFilters,
  buildAnalyticsQuery,
  buildAnalyticsExportQuery,
  buildReportQuery,
};
