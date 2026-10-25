const pool = require('../utilities/db');
const { success, fail, serverError } = require('../utilities/apiResponse');
const { isFieldTechnician } = require('../middleware/technicianScope');
const { resolveSupportOffice, appendSupportOfficeScope } = require('../middleware/supportOfficeScope');

const SORT_COLUMNS = {
  createdDate: 'b.created_date',
  userId: 'b.user_id',
  connectionType: 'b.connection_type',
  phone: 'b.phone',
  category: 'b.category_name',
  vlan: 'b.vlan_label',
  supportedBy: 'b.supported_by',
};

const escapeLike = (value) => String(value).replace(/([%_\\])/g, '\\$1');

const validMonth = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const [year, monthNumber] = month.split('-').map(Number);
  return year >= 1900 && year <= 9999 && monthNumber >= 1 && monthNumber <= 12;
};

const buildReportQuery = (req) => {
  const month = String(req.query.month || '').trim();
  if (!validMonth(month)) return { error: 'A valid month is required (YYYY-MM).' };

  const pageRaw = Number.parseInt(req.query.page, 10);
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 10000) : 1;
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(limitRaw) ? Math.max(10, Math.min(limitRaw, 200)) : 50;
  const requestedSort = String(req.query.sortBy || 'createdDate');
  const sortBy = Object.prototype.hasOwnProperty.call(SORT_COLUMNS, requestedSort) ? requestedSort : 'createdDate';
  const sortDirection = String(req.query.sortDirection || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const params = [month];
  const where = [
    `t.created_at >= (($1 || '-01')::date::timestamp AT TIME ZONE 'Asia/Dhaka')`,
    `t.created_at < ((($1 || '-01')::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Dhaka')`,
    `t.status IN ('closed', 'resolved')`,
  ];

  appendSupportOfficeScope(where, params, req.supportOfficeScope || resolveSupportOffice(req.user), 't');

  if (isFieldTechnician(req.user) && req.user?.id) {
    params.push(Number(req.user.id));
    where.push(`t.assigned_to = $${params.length}`);
  }

  const userId = String(req.query.userId || '').trim();
  const connectionType = String(req.query.connectionType || '').trim();
  const category = String(req.query.category || '').trim();
  const vlan = String(req.query.vlan || '').trim();
  const technician = String(req.query.technician || '').trim();
  const search = String(req.query.q || '').trim();
  const textFilters = { userId, connectionType, category, vlan, search };
  if (Object.values(textFilters).some((value) => value.length > 120)) {
    return { error: 'Filter values must be 120 characters or fewer.' };
  }
  if (userId) {
    if (userId === '__unknown') where.push('b.user_id IS NULL');
    else {
      params.push(userId);
      where.push(`b.user_id = $${params.length}`);
    }
  }
  if (connectionType) {
    if (connectionType === '__unspecified') {
      where.push(`(b.connection_type IS NULL OR BTRIM(b.connection_type) = '')`);
    } else {
      params.push(connectionType);
      where.push(`b.connection_type = $${params.length}`);
    }
  }
  if (category) {
    if (category === '__uncategorized') where.push('b.category_id IS NULL');
    else if (/^\d+$/.test(category) && Number(category) <= 2147483647) {
      params.push(Number(category));
      where.push(`b.category_id = $${params.length}`);
    } else return { error: 'Invalid problem category.' };
  }
  if (vlan) {
    if (vlan === '__unknown') where.push('b.vlan_value IS NULL');
    else {
      params.push(vlan);
      where.push(`b.vlan_value = $${params.length}`);
    }
  }
  if (technician) {
    if (technician === '__unassigned') {
      where.push(`COALESCE(array_length(b.technician_ids, 1), 0) = 0`);
    } else {
      if (!/^\d+$/.test(technician) || Number(technician) <= 0 || Number(technician) > 2147483647) return { error: 'Invalid technician.' };
      params.push(Number(technician));
      where.push(`$${params.length} = ANY(COALESCE(b.technician_ids, ARRAY[]::integer[]))`);
    }
  }
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    const p = `$${params.length}`;
    where.push(`(
      b.user_id ILIKE ${p} ESCAPE '\\'
      OR b.connection_type ILIKE ${p} ESCAPE '\\'
      OR b.phone ILIKE ${p} ESCAPE '\\'
      OR b.category_name ILIKE ${p} ESCAPE '\\'
      OR b.vlan_label ILIKE ${p} ESCAPE '\\'
      OR b.supported_by ILIKE ${p} ESCAPE '\\'
      OR b.subject ILIKE ${p} ESCAPE '\\'
      OR b.description ILIKE ${p} ESCAPE '\\'
      OR b.resolution_note ILIKE ${p} ESCAPE '\\'
    )`);
  }

  // The month, solved status, office, and technician predicates are applied
  // before any customer joins/aggregates; remaining filters use the stable row CTE.
  const baseWhere = [
    `t.created_at >= (($1 || '-01')::date::timestamp AT TIME ZONE 'Asia/Dhaka')`,
    `t.created_at < ((($1 || '-01')::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Dhaka')`,
    `t.status IN ('closed', 'resolved')`,
  ];
  const baseParams = [month];
  appendSupportOfficeScope(baseWhere, baseParams, req.supportOfficeScope || resolveSupportOffice(req.user), 't');
  if (isFieldTechnician(req.user) && req.user?.id) {
    baseParams.push(Number(req.user.id));
    baseWhere.push(`t.assigned_to = $${baseParams.length}`);
  }

  const filterWhere = where.slice(baseWhere.length);
  const filterParams = params.slice(baseParams.length);
  const finalParams = [...baseParams, ...filterParams];
  const cte = `
    WITH ticket_base AS (
      SELECT
        t.id,
        t.created_at,
        DATE(t.created_at AT TIME ZONE 'Asia/Dhaka') AS created_date,
        t.assigned_to,
        COALESCE(NULLIF(BTRIM(t.customer_snapshot->>'pppoe_username'), ''), NULLIF(BTRIM(c.pppoe_username), '')) AS user_id,
        t.connection_type,
        COALESCE(NULLIF(BTRIM(t.customer_snapshot->>'phone'), ''), NULLIF(BTRIM(c.manual_phone), ''), NULLIF(BTRIM(c.phone), '')) AS phone,
        t.category_id,
        COALESCE(NULLIF(BTRIM(cat.name_bn), ''), NULLIF(BTRIM(cat.name), ''), 'Uncategorized') AS category_name,
        COALESCE(NULLIF(BTRIM(t.customer_snapshot->>'vlan_id'), ''), NULLIF(BTRIM(t.customer_snapshot->>'vlan_name'), ''), c.vlan_id::text, NULLIF(BTRIM(c.vlan_name), '')) AS vlan_value,
        COALESCE(
          NULLIF(BTRIM(t.customer_snapshot->>'vlan_name'), ''),
          CASE WHEN NULLIF(BTRIM(t.customer_snapshot->>'vlan_id'), '') IS NOT NULL THEN 'VLAN ' || BTRIM(t.customer_snapshot->>'vlan_id') END,
          NULLIF(BTRIM(c.vlan_name), ''),
          CASE WHEN c.vlan_id IS NOT NULL THEN 'VLAN ' || c.vlan_id::text END,
          'Unknown'
        ) AS vlan_label,
        COALESCE(NULLIF(BTRIM(t.customer_snapshot->>'vlan_id'), ''), c.vlan_id::text) AS vlan_id,
        COALESCE(NULLIF(BTRIM(t.customer_snapshot->>'vlan_name'), ''), NULLIF(BTRIM(c.vlan_name), '')) AS vlan_name,
        t.subject,
        t.description,
        t.resolution_note,
        tech.supported_by,
        tech.technician_ids
      FROM support_tickets t
      LEFT JOIN network_customers c ON c.id = t.customer_id
      LEFT JOIN support_categories cat ON cat.id = t.category_id
      LEFT JOIN LATERAL (
        SELECT
          string_agg(DISTINCT u.full_name, ', ' ORDER BY u.full_name) AS supported_by,
          array_agg(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS technician_ids
        FROM (
          SELECT t.assigned_to AS user_id WHERE t.assigned_to IS NOT NULL
          UNION
          SELECT CASE WHEN extra.user_id ~ '^[0-9]{1,18}$' THEN extra.user_id::bigint ELSE NULL END AS user_id
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(t.additional_technician_ids) = 'array' THEN t.additional_technician_ids ELSE '[]'::jsonb END
          ) AS extra(user_id)
        ) resolved_ids
        JOIN users u ON u.id = resolved_ids.user_id
      ) tech ON TRUE
      WHERE ${baseWhere.join(' AND ')}
    ),
    filtered AS (
      SELECT b.*
      FROM ticket_base b
      WHERE ${filterWhere.length ? filterWhere.join(' AND ') : 'TRUE'}
    )
  `;
  const groupSql = `${cte}
    SELECT dimension, value, label, COUNT(DISTINCT ticket_id)::int AS count
    FROM (
      SELECT 'userId'::text AS dimension, COALESCE(user_id, '__unknown') AS value, COALESCE(user_id, 'Unknown user') AS label, id AS ticket_id FROM filtered
      UNION ALL
      SELECT 'connectionType', COALESCE(NULLIF(connection_type, ''), '__unspecified'), COALESCE(NULLIF(connection_type, ''), 'Unspecified'), id FROM filtered
      UNION ALL
      SELECT 'category', COALESCE(category_id::text, '__uncategorized'), category_name, id FROM filtered
      UNION ALL
      SELECT 'vlan', COALESCE(vlan_value, '__unknown'), vlan_label, id FROM filtered
      UNION ALL
      SELECT 'technician', COALESCE(u.id::text, '__unassigned'), COALESCE(u.full_name, 'Unassigned'), f.id
      FROM filtered f
      LEFT JOIN LATERAL unnest(COALESCE(f.technician_ids, ARRAY[]::integer[])) AS assigned(technician_id) ON TRUE
      LEFT JOIN users u ON u.id = assigned.technician_id
    ) dimensions
    GROUP BY dimension, value, label
    ORDER BY dimension, count DESC, label ASC
  `;

  const summarySql = `${cte}
    SELECT
      COUNT(DISTINCT f.id)::int AS tickets,
      COUNT(DISTINCT f.user_id)::int AS unique_users,
      COUNT(DISTINCT assigned.technician_id)::int AS technicians
    FROM filtered f
    LEFT JOIN LATERAL unnest(COALESCE(f.technician_ids, ARRAY[]::integer[])) AS assigned(technician_id) ON TRUE
  `;
  const rowsParams = [...finalParams, limit, (page - 1) * limit];
  const rowsSql = `${cte}
    SELECT id AS ticket_id, created_date, user_id, connection_type, phone, category_id,
      category_name, vlan_id, vlan_name, vlan_label AS vlan, supported_by
    FROM filtered b
    ORDER BY ${SORT_COLUMNS[sortBy]} ${sortDirection} NULLS LAST, b.id DESC
    LIMIT $${finalParams.length + 1} OFFSET $${finalParams.length + 2}
  `;

  return {
    params: finalParams,
    rowsParams,
    rowsSql,
    countSql: `${cte} SELECT COUNT(*)::int AS total FROM filtered`,
    summarySql,
    groupSql,
    page,
    limit,
    sortBy,
    sortDirection: sortDirection.toLowerCase(),
    month,
  };
};

const getTechnicianSupportRegister = async (req, res) => {
  try {
    const query = buildReportQuery(req);
    if (query.error) return fail(res, query.error, 400);

    const [countResult, summaryResult, groupResult, rowsResult] = await Promise.all([
      pool.query(query.countSql, query.params),
      pool.query(query.summarySql, query.params),
      pool.query(query.groupSql, query.params),
      pool.query(query.rowsSql, query.rowsParams),
    ]);
    const total = Number(countResult.rows[0]?.total || 0);
    const groups = {
      userId: [],
      connectionType: [],
      category: [],
      vlan: [],
      technician: [],
    };
    for (const row of groupResult.rows || []) {
      groups[row.dimension].push({
        value: row.value,
        label: row.label,
        count: Number(row.count || 0),
      });
    }

    return success(res, {
      month: query.month,
      summary: {
        tickets: total,
        uniqueUsers: Number(summaryResult.rows[0]?.unique_users || 0),
        technicians: Number(summaryResult.rows[0]?.technicians || 0),
      },
      groups,
      rows: rowsResult.rows,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    });
  } catch (error) {
    return serverError(res, error);
  }
};

module.exports = { getTechnicianSupportRegister, buildReportQuery };
