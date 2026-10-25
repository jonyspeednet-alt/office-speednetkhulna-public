const pool = require('../utilities/db');

const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const listAuditLogs = async (req, res) => {
  try {
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (req.query.user_id) {
      params.push(toInt(req.query.user_id, 0));
      conditions.push(`user_id = $${params.length}`);
    }

    if (req.query.action_type) {
      params.push(`%${escapeLike(String(req.query.action_type).trim())}%`);
      conditions.push(`action_type ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (req.query.route_path) {
      params.push(`%${escapeLike(String(req.query.route_path).trim())}%`);
      conditions.push(`route_path ILIKE $${params.length} ESCAPE '\\'`);
    }

    if (req.query.success === 'true' || req.query.success === 'false') {
      params.push(req.query.success === 'true');
      conditions.push(`success = $${params.length}`);
    }

    if (req.query.from) {
      params.push(String(req.query.from));
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (req.query.to) {
      params.push(String(req.query.to));
      conditions.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*)::int AS total FROM audit_logs ${whereSql}`;
    const countResult = await pool.query(countQuery, params);
    const total = countResult.rows[0]?.total || 0;

    const dataParams = [...params, limit, offset];
    const dataQuery = `
      SELECT
        id, created_at, user_id, user_name, role_name, action_type, http_method,
        route_path, query_params, request_body, response_status, response_body,
        ip_address, user_agent, duration_ms, success, error_message
      FROM audit_logs
      ${whereSql}
      ORDER BY id DESC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
    `;
    const dataResult = await pool.query(dataQuery, dataParams);

    return res.json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      logs: dataResult.rows,
    });
  } catch (error) {
    console.error('listAuditLogs error:', error);
    return res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
};

module.exports = {
  listAuditLogs,
};
