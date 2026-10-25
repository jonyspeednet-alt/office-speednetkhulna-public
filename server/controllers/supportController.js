const pool = require('../utilities/db');
const { success, fail, notFound, serverError } = require('../utilities/apiResponse');
const { isFieldTechnician, blockFieldTechnician } = require('../middleware/technicianScope');
const { syncConfiguredDevices } = require('../services/mikrotikSupportService');
const { normalizeOfficeName, ALLOWED_OFFICE_NAMES } = require('../constants/branches');
const { resolveSupportOffice, appendSupportOfficeScope } = require('../middleware/supportOfficeScope');
const { getVerificationQuestionKeys, hasVerificationAnswers } = require('../utilities/supportVerificationRules');

const allowedStatuses = new Set(['new','assigned','in_progress','waiting_customer','waiting_vendor','resolved','verification_pending','closed','reopened','cancelled']);
const ALLOWED_CONNECTION_TYPES = ['Fiber', 'CAT', 'Conseal', 'Wireless', 'Cat6', 'Other'];
const ALLOWED_CONSEAL_SUBTYPES = ['Fiber Conseal', 'CAT Conseal'];
// SLA: priority → resolution hours (createTicket sets due_at = NOW() + interval)
const TICKET_SLA_HOURS = { critical: 4, high: 8, medium: 24, low: 72 };
const TERMINAL_STATUSES = new Set(['closed','resolved','cancelled']);
// escape % _ \ for ILIKE: parameter is still parameterized but wildcards inside value must be neutralized
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');

// BD mobile validation (E.164 local): 01[3-9] + 8 digits (11 digits total)
const BD_MOBILE_RE = /^01[3-9]\d{8}$/;
const isValidBdMobile = (v) => BD_MOBILE_RE.test(String(v || '').trim());

// WhatsApp auto-notifications (support tickets): queued for the
// whatsapp-worker (send_text job). Fail-soft — never blocks the ticket flow.
const queueTicketWhatsApp = async (to, body, kind) => {
  try {
    if (!isValidBdMobile(to) || !String(body || '').trim()) return;
    const { enqueueJob } = require('../utilities/whatsappWorkerQueue');
    await enqueueJob('send_text', { to: String(to).trim(), body: String(body).trim().substring(0, 4000), kind: kind || 'support' }, 'support');
  } catch (e) {
    console.error('[WhatsApp queue] failed:', e.message);
  }
};

// SMS guard removed per owner request — no per-user rate limit.
const STATUS_TRANSITIONS = {
  new: ['assigned','in_progress','waiting_customer','waiting_vendor','verification_pending','resolved','closed','cancelled'],
  assigned: ['in_progress','waiting_customer','waiting_vendor','verification_pending','resolved','closed','cancelled'],
  in_progress: ['waiting_customer','waiting_vendor','verification_pending','resolved','closed','cancelled'],
  waiting_customer: ['assigned','in_progress','verification_pending','resolved','closed','cancelled'],
  waiting_vendor: ['assigned','in_progress','verification_pending','resolved','closed','cancelled'],
  verification_pending: ['resolved','closed','reopened','assigned','in_progress','waiting_customer','cancelled'],
  resolved: ['closed','reopened','verification_pending'],
  closed: ['reopened'],
  reopened: ['assigned','in_progress','waiting_customer','waiting_vendor','verification_pending','resolved','closed','cancelled'],
  cancelled: ['reopened']
};

// Simple globally increasing ticket number derived from the existing BIGSERIAL ID.
// Reserve the ID first so the ticket number is available in the same INSERT.
// Example: TKT-123. Existing ticket numbers remain unchanged.
const reserveTicketId = async (client) => {
  const result = await client.query("SELECT nextval(pg_get_serial_sequence('support_tickets', 'id')) AS id");
  return result.rows[0].id;
};

const searchCustomers = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return success(res, []);
    const safe = escapeLike(q);
    // Field technicians: scope customer search to customers with tickets assigned to them
    const techScoped = isFieldTechnician(req.user);
    const techId = techScoped ? Number(req.user.id) : null;
    const rows = await pool.query(`SELECT id, router_id, pppoe_username, package_profile, service, remote_address, disabled, is_online, comment_raw, vlan_id, vlan_name, session_service,
      COALESCE(manual_phone, phone) AS phone, alternate_phones, COALESCE(manual_address, address) AS address, parse_status, last_synced_at
      FROM network_customers nc WHERE (pppoe_username ILIKE $1 ESCAPE '\\' OR COALESCE(manual_phone, phone, '') ILIKE $1 ESCAPE '\\' OR comment_raw ILIKE $1 ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM support_tickets t WHERE t.customer_id = nc.id AND COALESCE(t.customer_snapshot->>'phone','') ILIKE $1 ESCAPE '\\'))
      ${techScoped ? 'AND EXISTS (SELECT 1 FROM support_tickets t WHERE t.customer_id = nc.id AND t.assigned_to = $2)' : ''}
      ORDER BY is_online DESC, disabled ASC, pppoe_username ASC LIMIT 30`, techScoped ? [`%${safe}%`, techId] : [`%${safe}%`]);
    return success(res, rows.rows);
  } catch (error) { return serverError(res, error); }
};

const listTickets = async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const q = String(req.query.q || '').trim();
    const searchBy = String(req.query.searchBy || '').trim();
    const officeRaw = String(req.query.office || req.query.zone || '').trim();
    const office = officeRaw ? normalizeOfficeName(officeRaw) : '';
    const categoryIds = String(req.query.category_id || req.query.categoryId || '')
      .split(',').map((id) => id.trim()).filter((id) => /^\d+$/.test(id)).map(Number);
    const priority = String(req.query.priority || '').trim();
    const assignee = String(req.query.assignee || '').trim();
    const creator = String(req.query.creator || '').trim();
    const myUserId = String(req.query.myUserId || req.query.my || '').trim();
    const complaintNo = String(req.query.complaintNo || req.query.complaint_no || '').trim();
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate = String(req.query.toDate || '').trim();
    const closeDate = String(req.query.closeDate || '').trim();
    const isHistory = req.query.isHistory === 'true';
    const isAllQueue = req.query.allQueue === 'true';
    // Hide old solved: solved tickets stay in "All" only until midnight
    // (Asia/Dhaka) of the day they were solved; next day they show only
    // in Solved views. Applies only when no explicit status filter is sent.
    const hideOldSolved = req.query.hideOldSolved === 'true';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitRaw = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(200, Math.max(10, limitRaw));
    const offset = (page - 1) * limit;
    const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

    const params = [];
    const where = [];
    appendSupportOfficeScope(where, params, req.supportOfficeScope || resolveSupportOffice(req.user));

    if (status) {
      const statuses = String(status).split(',').map(s=>s.trim()).filter(s=>allowedStatuses.has(s));
      if (statuses.length === 1) {
        params.push(statuses[0]);
        where.push(`t.status = $${params.length}`);
      } else if (statuses.length > 1) {
        params.push(statuses);
        where.push(`t.status = ANY($${params.length}::text[])`);
      }
    } else if (isHistory) {
      // only apply history filter when no explicit status filter
      where.push(`t.status IN ('closed', 'resolved', 'cancelled')`);
    } else {
      // The default list is the active queue; cancelled tickets remain
      // discoverable through History or an explicit status filter.
      where.push(`t.status <> 'cancelled'`);
    }

    // An explicit status list may be stale or broader than intended. The
    // All queue is never an archive view, so enforce this independently.
    if (isAllQueue && status) {
      where.push(`t.status <> 'cancelled'`);
    }

    if (hideOldSolved && (!status || isAllQueue)) {
      // Solved before today (Dhaka date) leaves the "All" list —
      // still visible via explicit solved status / history views.
      // NULL solve-dates are kept (solve day unknown, don't hide).
      where.push(`NOT (t.status IN ('closed', 'resolved') AND COALESCE(DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka'), DATE(t.resolved_at AT TIME ZONE 'Asia/Dhaka')) IS NOT NULL AND COALESCE(DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka'), DATE(t.resolved_at AT TIME ZONE 'Asia/Dhaka')) < DATE((NOW() AT TIME ZONE 'Asia/Dhaka')))`);
    }

    if (office && office !== 'All') {
      params.push(office);
      where.push(`(t.office_name = $${params.length} OR t.zone = $${params.length})`);
    }

    if (categoryIds.length) {
      params.push([...new Set(categoryIds)]);
      where.push(`t.category_id = ANY($${params.length}::int[])`);
    }

    if (priority && ['critical','high','medium','low'].includes(priority)) {
      params.push(priority);
      where.push(`t.priority = $${params.length}`);
    }

    // Mobile "my tickets": forced server-side scope to the logged-in user.
    // Takes precedence over myUserId/assignee/creator so a scoped client
    // cannot escape its own assignment by passing someone else's id.
    // Field technicians: force assigned_to = self (query override, not 403)
    const techOnly = isFieldTechnician(req.user) && req.user?.id;
    if (techOnly) {
      params.push(Number(req.user.id));
      where.push(`t.assigned_to = $${params.length}`);
    }
    const mineOnly = !techOnly && (req.query.mine === 'true' || req.query.mine === '1') && req.user?.id;
    if (techOnly) {
      // already scoped above — ignore myUserId/assignee/creator overrides
    } else if (mineOnly) {
      params.push(Number(req.user.id));
      where.push(`t.assigned_to = $${params.length}`);
    } else if (myUserId && /^\d+$/.test(myUserId)) {
      params.push(Number(myUserId));
      where.push(`(t.assigned_to = $${params.length} OR t.created_by = $${params.length})`);
    } else {
      if (assignee) {
        if (/^\d+$/.test(assignee)) {
          params.push(Number(assignee));
          where.push(`t.assigned_to = $${params.length}`);
        } else {
          params.push(`%${escapeLike(assignee)}%`);
          where.push(`au.full_name ILIKE $${params.length} ESCAPE '\\'`);
        }
      }
      if (creator) {
        if (/^\d+$/.test(creator)) {
          params.push(Number(creator));
          where.push(`t.created_by = $${params.length}`);
        } else {
          params.push(`%${escapeLike(creator)}%`);
          where.push(`cu.full_name ILIKE $${params.length} ESCAPE '\\'`);
        }
      }
    }

    if (complaintNo) {
      params.push(`%${escapeLike(complaintNo)}%`);
      where.push(`(t.complaint_no ILIKE $${params.length} ESCAPE '\\' OR t.ticket_no ILIKE $${params.length} ESCAPE '\\')`);
    }

    if (fromDate) {
      if (!isValidDate(fromDate)) return fail(res, 'Invalid fromDate format (YYYY-MM-DD)', 400);
      params.push(fromDate);
      where.push(`DATE(t.created_at AT TIME ZONE 'Asia/Dhaka') >= $${params.length}::date`);
    }
    if (toDate) {
      if (!isValidDate(toDate)) return fail(res, 'Invalid toDate format (YYYY-MM-DD)', 400);
      params.push(toDate);
      where.push(`DATE(t.created_at AT TIME ZONE 'Asia/Dhaka') <= $${params.length}::date`);
    }
    if (closeDate) {
      if (!isValidDate(closeDate)) return fail(res, 'Invalid closeDate format (YYYY-MM-DD)', 400);
      params.push(closeDate);
      where.push(`DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka') = $${params.length}::date`);
    }
    // Solve-date range (history pages): filters by closed_at, fallback resolved_at (Dhaka date)
    const solvedFrom = String(req.query.solvedFrom || '').trim();
    const solvedTo = String(req.query.solvedTo || '').trim();
    const solvedDay = `COALESCE(DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka'), DATE(t.resolved_at AT TIME ZONE 'Asia/Dhaka'))`;
    if (solvedFrom) {
      if (!isValidDate(solvedFrom)) return fail(res, 'Invalid solvedFrom format (YYYY-MM-DD)', 400);
      params.push(solvedFrom);
      where.push(`${solvedDay} >= $${params.length}::date`);
    }
    if (solvedTo) {
      if (!isValidDate(solvedTo)) return fail(res, 'Invalid solvedTo format (YYYY-MM-DD)', 400);
      params.push(solvedTo);
      where.push(`${solvedDay} <= $${params.length}::date`);
    }

    const isOnCallFilter = String(req.query.is_on_call || req.query.isOnCall || '').trim().toLowerCase();
    if (isOnCallFilter === 'true' || isOnCallFilter === '1') {
      where.push(`t.is_on_call = TRUE`);
    } else if (isOnCallFilter === 'false' || isOnCallFilter === '0') {
      where.push(`t.is_on_call = FALSE`);
    }

    if (q) {
      const safeQ = escapeLike(q);
      const like = `%${safeQ}%`;
      params.push(like);
      const p = params.length;
      if (searchBy === 'phone') {
        where.push(`(COALESCE(c.manual_phone,c.phone,'') ILIKE $${p} ESCAPE '\\' OR COALESCE(t.customer_snapshot->>'phone','') ILIKE $${p} ESCAPE '\\')`);
      } else if (searchBy === 'username') {
        where.push(`(c.pppoe_username ILIKE $${p} ESCAPE '\\' OR t.ticket_no ILIKE $${p} ESCAPE '\\')`);
      } else if (searchBy === 'customer_name') {
        where.push(`(COALESCE(t.customer_snapshot->>'pppoe_username','') ILIKE $${p} ESCAPE '\\' OR c.pppoe_username ILIKE $${p} ESCAPE '\\' OR COALESCE(c.manual_address,c.address,'') ILIKE $${p} ESCAPE '\\')`);
      } else {
        where.push(`(
          t.ticket_no ILIKE $${p} ESCAPE '\\'
          OR t.subject ILIKE $${p} ESCAPE '\\'
          OR t.description ILIKE $${p} ESCAPE '\\'
          OR t.resolution_note ILIKE $${p} ESCAPE '\\'
          OR t.complaint_no ILIKE $${p} ESCAPE '\\'
          OR c.pppoe_username ILIKE $${p} ESCAPE '\\'
          OR COALESCE(c.manual_phone,c.phone,'') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(c.manual_address,c.address,'') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(c.comment_raw,'') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'pppoe_username','') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'phone','') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'name','') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'customer_name','') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'full_name','') ILIKE $${p} ESCAPE '\\'
          OR COALESCE(t.customer_snapshot->>'address','') ILIKE $${p} ESCAPE '\\'
          OR cat.name ILIKE $${p} ESCAPE '\\'
          OR cat.name_bn ILIKE $${p} ESCAPE '\\'
          OR au.full_name ILIKE $${p} ESCAPE '\\'
          OR cu.full_name ILIKE $${p} ESCAPE '\\'
        )`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*)::int AS total FROM support_tickets t LEFT JOIN network_customers c ON c.id=t.customer_id LEFT JOIN users au ON au.id=t.assigned_to LEFT JOIN users cu ON cu.id=t.created_by LEFT JOIN support_categories cat ON cat.id=t.category_id ${whereSql}`;
    const dataSql = `SELECT t.*, c.pppoe_username, c.package_profile, COALESCE(c.manual_phone,c.phone) AS phone, COALESCE(c.manual_address,c.address) AS address, cat.name_bn AS category_name,
      v.id AS verification_id, v.is_verified, v.feedback_remarks,
      au.full_name AS assigned_to_name,
      cu.full_name AS created_by_name
      FROM support_tickets t 
      LEFT JOIN network_customers c ON c.id=t.customer_id 
      LEFT JOIN support_categories cat ON cat.id=t.category_id
      LEFT JOIN support_verifications v ON v.ticket_id=t.id
      LEFT JOIN users au ON au.id = t.assigned_to
      LEFT JOIN users cu ON cu.id = t.created_by
      ${whereSql} 
      ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, [...params, limit, offset])
    ]);
    const total = countRes.rows[0].total;
    // keep backward-compat: if client expects array, also support paginated object
    if (req.query.page || req.query.limit) {
      return success(res, { rows: dataRes.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    // legacy path without pagination params: return rows array but set header for future
    res.set('X-Total-Count', String(total));
    return success(res, dataRes.rows);
  } catch (error) { return serverError(res, error); }
};

const getDashboard = async (req, res) => {
  try {
    const officeRaw = String(req.query.office || req.query.zone || '').trim();
    const office = officeRaw ? normalizeOfficeName(officeRaw) : '';
    const params = [];
    const where = [];
    if (office && office !== 'All') {
      params.push(office);
      where.push(`(t.office_name = $1 OR t.zone = $1)`);
    }

    appendSupportOfficeScope(where, params, req.supportOfficeScope || resolveSupportOffice(req.user));

    // Field technicians see their own slice only: global counts would
    // otherwise mislead (list endpoints force assigned_to=self for them).
    if (isFieldTechnician(req.user) && req.user?.id) {
      params.push(Number(req.user.id));
      where.push(`t.assigned_to = $${params.length}`);
    }
    const scopedWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [counts, overdueRes, responseTimeRes, oldSolvedRes, categories, technicians] = await Promise.all([
      pool.query(`SELECT t.status, COUNT(*)::int AS count FROM support_tickets t ${scopedWhere} GROUP BY t.status`, params),
      pool.query(`SELECT COUNT(*)::int AS overdue FROM support_tickets t ${scopedWhere ? scopedWhere + ' AND' : 'WHERE'} t.due_at < NOW() AND t.status NOT IN ('closed','resolved','cancelled')`, params),
      pool.query(`SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at))))::int, 0) AS seconds FROM support_tickets t ${scopedWhere ? scopedWhere + ' AND' : 'WHERE'} t.first_response_at IS NOT NULL`, params),
      pool.query(`SELECT COUNT(*)::int AS old_solved FROM support_tickets t ${scopedWhere ? scopedWhere + ' AND' : 'WHERE'} t.status IN ('closed','resolved') AND COALESCE(DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka'), DATE(t.resolved_at AT TIME ZONE 'Asia/Dhaka')) IS NOT NULL AND COALESCE(DATE(t.closed_at AT TIME ZONE 'Asia/Dhaka'), DATE(t.resolved_at AT TIME ZONE 'Asia/Dhaka')) < DATE((NOW() AT TIME ZONE 'Asia/Dhaka'))`, params),
      pool.query(`SELECT id, name, name_bn, default_priority FROM support_categories WHERE is_active=TRUE ORDER BY sort_order, name`),
      pool.query(`SELECT u.id, u.full_name, u.phone, u.profile_pic FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE LOWER(u.status)='active' AND (LOWER(TRIM(u.role))='technician' OR LOWER(r.name)='technician') ORDER BY u.full_name`)
    ]);

    const statusCounts = Object.fromEntries(counts.rows.map((r) => [r.status, r.count]));
    return success(res, {
      counts: statusCounts,
      totalTickets: Object.values(statusCounts).reduce((total, count) => total + Number(count || 0), 0),
      oldSolved: Number(oldSolvedRes.rows[0]?.old_solved || 0),
      avgResponseSeconds: Number(responseTimeRes.rows[0].seconds || 0),
      overdue: overdueRes.rows[0].overdue,
      categories: categories.rows,
      technicians: technicians.rows
    });
  } catch (error) { return serverError(res, error); }
};

// "My assigned work" summary for dashboard/sidebar widgets.
// Any ticket viewer gets their own slice (assigned_to=self); office users
// see the same shape for their own assignments.
const getMySummary = async (req, res) => {
  try {
    const uid = Number(req.user?.id);
    if (!uid) return fail(res, 'Unauthorized', 401);
    const officeScope = req.supportOfficeScope || resolveSupportOffice(req.user);
    if (!officeScope) return fail(res, 'Your work location is not configured for support ticket access.', 403);
    const officeParams = [uid];
    const officeWhere = [`t.assigned_to = $1`];
    appendSupportOfficeScope(officeWhere, officeParams, officeScope);
    const scopedWhere = officeWhere.join(' AND ');
    const reportParams = [...officeParams];
    const reportWhere = [`t.assigned_to = $1`, `r.status='submitted'`];
    appendSupportOfficeScope(reportWhere, reportParams, officeScope);
    const [countsRes, recentRes, overdueRes, pendingReportsRes] = await Promise.all([
      pool.query(
        `SELECT t.status, COUNT(*)::int AS count FROM support_tickets t WHERE ${scopedWhere} GROUP BY t.status`,
        officeParams
      ),
      pool.query(
        `SELECT t.id, t.ticket_no, t.subject, t.status, t.priority, t.created_at,
                COALESCE(c.pppoe_username, t.customer_snapshot->>'pppoe_username') AS customer
         FROM support_tickets t LEFT JOIN network_customers c ON c.id=t.customer_id
         WHERE ${scopedWhere} AND t.status NOT IN ('closed','resolved','cancelled')
         ORDER BY t.created_at DESC LIMIT 5`,
        officeParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS overdue FROM support_tickets
         t WHERE ${scopedWhere} AND t.due_at < NOW() AND t.status NOT IN ('closed','resolved','cancelled')`,
        officeParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS pending FROM ticket_work_reports r
         JOIN support_tickets t ON t.id=r.ticket_id
         WHERE ${reportWhere.join(' AND ')}`,
        reportParams
      ),
    ]);
    const byStatus = Object.fromEntries(countsRes.rows.map((r) => [r.status, r.count]));
    const n = (k) => Number(byStatus[k] || 0);
    return success(res, {
      open: n('new') + n('assigned') + n('reopened'),
      inProgress: n('in_progress'),
      waiting: n('waiting_customer') + n('waiting_vendor') + n('verification_pending'),
      overdue: Number(overdueRes.rows[0]?.overdue || 0),
      pendingReports: Number(pendingReportsRes.rows[0]?.pending || 0),
      total: Object.values(byStatus).reduce((a, c) => a + Number(c || 0), 0),
      recent: recentRes.rows,
    });
  } catch (error) { return serverError(res, error); }
};

const createTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    const ALLOWED_SOURCES = new Set(['phone','email','walk_in','facebook','other']);
    const ALLOWED_PRIORITIES = new Set(['critical','high','medium','low']);
    let { customer_id, category_id, subject, description, source = 'phone', priority = 'medium', office_name = 'Corporate Office', connection_type = 'Fiber', connection_subtype = null, send_sms = false, send_whatsapp = false, complaint_no = null, zone = null, technician_ids = [], is_qc_support = false, is_on_call = false, resolution_type = null } = req.body || {};
    const officeScope = req.supportOfficeScope || resolveSupportOffice(req.user);
    if (!officeScope) return fail(res, 'Your work location is not configured for support ticket access.', 403);
    source = String(source).trim().toLowerCase();
    priority = String(priority).trim().toLowerCase();
    connection_type = String(connection_type).trim();
    if (!ALLOWED_SOURCES.has(source)) return fail(res, 'Invalid source', 400);
    if (!ALLOWED_PRIORITIES.has(priority)) return fail(res, 'Invalid priority', 400);
    if (!ALLOWED_CONNECTION_TYPES.includes(connection_type)) return fail(res, 'Invalid connection type.', 400);
    const cleanSubtype = (connection_subtype === undefined || connection_subtype === null || String(connection_subtype).trim() === '') ? null : String(connection_subtype).trim();
    if (connection_type === 'Conseal') {
      if (!cleanSubtype) return fail(res, 'Conseal subtype is required (Fiber Conseal / CAT Conseal)', 400);
      if (!ALLOWED_CONSEAL_SUBTYPES.includes(cleanSubtype)) return fail(res, 'Invalid Conseal subtype (Fiber Conseal / CAT Conseal)', 400);
    } else if (cleanSubtype) {
      return fail(res, 'connection_subtype only allowed with Conseal', 400);
    }
    // Raw blank check BEFORE normalize (normalizeOfficeName('') → 'Corporate Office' would mask it)
    const officeRaw = office_name === undefined || office_name === null ? '' : String(office_name);
    if (!officeRaw.trim()) return fail(res, 'Office/branch is required', 400);
    const normalizedOffice = normalizeOfficeName(officeRaw.trim());
    if (!ALLOWED_OFFICE_NAMES.has(normalizedOffice)) {
      return fail(res, 'Invalid Office / Branch.', 400);
    }
    if (!officeScope.isHeadOffice) {
      const requestedOffice = req.body?.office_name;
      if (requestedOffice && normalizeOfficeName(requestedOffice) !== officeScope.office) {
        return fail(res, 'You can only create tickets for your assigned office.', 403);
      }
      office_name = officeScope.office;
    }
    // CONTRACT: frontend does not send `subject` — optional, auto-generated if missing/blank.
    const rawSubject = subject !== undefined && subject !== null ? String(subject).trim() : '';
    if (rawSubject.length > 200) return fail(res, 'Subject must be <= 200 chars.', 400);
    if (String(description || '').trim().length > 2000) return fail(res, 'Description must be <= 2000 chars.', 400);
    const cleanComplaintNo = (complaint_no === undefined || complaint_no === null || String(complaint_no).trim() === '') ? null : String(complaint_no).trim();
    if (cleanComplaintNo && cleanComplaintNo.length > 50) return fail(res, 'Complaint number must be <= 50 chars.', 400);
    if (customer_id === undefined || customer_id === null || String(customer_id).trim() === '') return fail(res, 'Please select a MikroTik customer.');
    const customerIdNum = Number(customer_id);
    if (!Number.isInteger(customerIdNum)) return fail(res, 'Invalid customer.', 400);
    if (!Array.isArray(technician_ids) || technician_ids.length > 10) return fail(res, 'Select up to 10 technicians.', 400);
    const technicianIds = [...new Set(technician_ids.map(Number))].filter(Number.isInteger).filter(id => id > 0);
    if (technicianIds.length !== technician_ids.length) return fail(res, 'Invalid technician selection.', 400);
    if (technicianIds.length) {
      const validTechs = await client.query(`SELECT id FROM users WHERE id = ANY($1::int[]) AND LOWER(status)='active'`, [technicianIds]);
      if (validTechs.rowCount !== technicianIds.length) return fail(res, 'One or more technicians are inactive or unavailable.', 400);
    }
    // category_id: NaN/non-integer → 400 (never 500 from PG int cast)
    const cleanCategoryId = (category_id === undefined || category_id === null || String(category_id).trim() === '') ? null : Number(category_id);
    if (cleanCategoryId !== null && !Number.isInteger(cleanCategoryId)) return fail(res, 'Invalid category.', 400);
    // Auto-subject fallback category name: lookup display name, default 'General'.
    let autoCategoryName = 'General';
    if (cleanCategoryId !== null) {
      const cat = await client.query('SELECT id, COALESCE(NULLIF(TRIM(name_bn), \'\'), name) AS display_name FROM support_categories WHERE id=$1 AND is_active=TRUE', [cleanCategoryId]);
      if (!cat.rowCount) return fail(res, 'Invalid category.', 400);
      if (String(cat.rows[0].display_name || '').trim()) autoCategoryName = String(cat.rows[0].display_name).trim();
    }
    const customer = await client.query(`SELECT id, router_id, pppoe_username, package_profile, remote_address, disabled, is_online, comment_raw, vlan_id, vlan_name, session_service, COALESCE(manual_phone,phone) AS phone, COALESCE(manual_address,address) AS address, last_synced_at FROM network_customers WHERE id=$1`, [customerIdNum]);
    if (!customer.rowCount) return fail(res, 'Customer not found.', 404);

    const finalIsQcSupport = Boolean(is_qc_support === true || is_qc_support === 'true' || cleanCategoryId === 912);
    const finalIsOnCall = Boolean(is_on_call === true || is_on_call === 'true' || resolution_type === 'on_call' || cleanCategoryId === 918);
    const finalResolutionType = finalIsOnCall ? 'on_call' : (resolution_type || 'field_visit');

    await client.query('BEGIN');
    await client.query('SELECT id FROM network_customers WHERE id=$1 FOR UPDATE', [customerIdNum]);
    const activeTicket = await client.query(
      `SELECT ticket_no, status FROM support_tickets
       WHERE customer_id=$1 AND status NOT IN ('closed','resolved','cancelled')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [customerIdNum]
    );
    if (activeTicket.rowCount) {
      await client.query('ROLLBACK');
      const { ticket_no, status } = activeTicket.rows[0];
      return fail(res, `Customer already has unresolved ticket ${ticket_no} (${status}). Resolve or close it before opening another ticket.`, 409);
    }

    // Auto-generate subject when missing/blank: "{CategoryName} - {pppoe_username}".
    // Guarantees DB `support_tickets.subject NOT NULL` — no schema change needed.
    let finalSubject = rawSubject;
    if (!finalSubject) {
      const uname = String(customer.rows[0]?.pppoe_username || '').trim() || 'Customer';
      finalSubject = `${autoCategoryName} - ${uname}`.trim().substring(0, 200);
    }
    const slaHours = TICKET_SLA_HOURS[priority] || 24;
    const ticketId = await reserveTicketId(client);
    const ticketNo = `TKT-${ticketId}`;
    const created = await client.query(`INSERT INTO support_tickets 
      (id, ticket_no, customer_id, customer_snapshot, category_id, subject, description, source, priority, office_name, connection_type, connection_subtype, complaint_no, zone, created_by, updated_by, due_at, assigned_to, additional_technician_ids, is_qc_support, is_on_call, resolution_type)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15, NOW() + ($16::int * INTERVAL '1 hour'),$17,$18::jsonb,$19::boolean,$20::boolean,$21::varchar(30)) RETURNING *`,
      [ticketId, ticketNo, customerIdNum, JSON.stringify(customer.rows[0]), cleanCategoryId, finalSubject, String(description || '').trim() || null, source, priority, officeScope.isHeadOffice ? normalizedOffice : officeScope.office, connection_type, cleanSubtype, cleanComplaintNo, officeScope.isHeadOffice ? (String(zone || normalizedOffice).trim() || null) : officeScope.office, req.user?.id || null, slaHours, technicianIds[0] || null, JSON.stringify(technicianIds.slice(1)), finalIsQcSupport, finalIsOnCall, finalResolutionType]);
    
    await client.query(`INSERT INTO support_ticket_events (ticket_id,event_type,message,new_status,created_by) VALUES ($1,'created',$2,'new',$3)`, [created.rows[0].id, 'Ticket created', req.user?.id || null]);
    if (technicianIds.length) await client.query(`INSERT INTO support_ticket_events (ticket_id,event_type,message,created_by) VALUES ($1,'assigned',$2,$3)`, [created.rows[0].id, `Assigned team: ${(await client.query('SELECT full_name FROM users WHERE id = ANY($1::int[]) ORDER BY array_position($1::int[], id)', [technicianIds])).rows.map(x => x.full_name).join(', ')}`, req.user?.id || null]);
    if (String(description || '').trim()) {
      await client.query(`INSERT INTO support_ticket_comments (ticket_id, customer_id, comment, created_by) VALUES ($1,$2,$3,$4)`, [created.rows[0].id, customerIdNum, String(description).trim(), req.user?.id || null]);
    }
    
    await client.query('COMMIT');

    // Create-path notifications (non-blocking): SMS and WhatsApp are independent flags
    let smsSkipped = false;
    if (send_sms || send_whatsapp) {
    // Recipient fallback: complaint_no first, else MikroTik-synced customer number.
    const rawComplaint = String(cleanComplaintNo || '').trim();
    const rawCustPhone = String(customer.rows[0].phone || '').trim();
    const destPhone = isValidBdMobile(rawComplaint) ? rawComplaint : rawCustPhone;
      if (!destPhone || !isValidBdMobile(destPhone)) {
        smsSkipped = true;
        if (destPhone) console.warn('[SMS create] skipped: invalid BD mobile format');
      } else if (send_sms) {
        (async () => {
          try {
            const { sendSms, logSms } = require('../utilities/smsService');
            const createdText = await renderSystemSms('ticket_created_customer', { ticket_no: ticketNo });
            const r = await sendSms({ msisdn: destPhone, sms: createdText });
            await logSms({ recipient_phone: destPhone, message_body: `Ticket ${ticketNo} created`, status: (r.success ? 'Sent' : `Failed: ${r.data?.error_message || r.error}`).substring(0,50), sent_by: req.user?.id || null });
          } catch (e) { console.error('[SMS create] failed:', e.message); }
        })();
      }
      if (send_whatsapp) {
        (async () => {
          try {
            const createdText = await renderSystemSms('ticket_created_customer', { ticket_no: ticketNo });
            await queueTicketWhatsApp(destPhone, createdText, 'ticket_created');
          } catch (e) { console.error('[WhatsApp create] failed:', e.message); }
        })();
      }
    }

    // Non-blocking: other open tickets for the same customer (context for the UI)
    let openTickets = [];
    try {
      const openParams = [customerIdNum];
      const openWhere = ['t.customer_id=$1', `t.status NOT IN ('closed','resolved','cancelled')`];
      appendSupportOfficeScope(openWhere, openParams, officeScope);
      const ot = await pool.query(
        `SELECT t.id, t.ticket_no, t.status, t.created_at FROM support_tickets t
         WHERE ${openWhere.join(' AND ')}
         ORDER BY t.created_at DESC LIMIT 5`,
        openParams
      );
      openTickets = ot.rows;
    } catch (e) { console.error('[createTicket] open_tickets lookup failed:', e.message); }

    return success(res, smsSkipped ? { ...created.rows[0], sms_skipped: true, open_tickets: openTickets } : { ...created.rows[0], open_tickets: openTickets }, 201);
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} return serverError(res, error); } finally { client.release(); }
};

const getTicket = async (req, res) => {
  try {
    const ticket = await pool.query(`SELECT t.*, c.pppoe_username, c.package_profile, c.vlan_id, c.vlan_name, c.session_service, COALESCE(c.manual_phone,c.phone) AS phone, COALESCE(c.manual_address,c.address) AS address, cat.name AS category, cat.name_bn AS category_name,
      au.full_name AS assigned_to_name,
      cu.full_name AS created_by_name
      FROM support_tickets t 
      LEFT JOIN network_customers c ON c.id=t.customer_id 
      LEFT JOIN support_categories cat ON cat.id=t.category_id 
      LEFT JOIN users au ON au.id=t.assigned_to
      LEFT JOIN users cu ON cu.id=t.created_by
      WHERE t.id=$1`, [req.params.id]);
    if (!ticket.rowCount) return notFound(res, 'Ticket not found.');
    
    const events = await pool.query(`SELECT e.*, COALESCE(u.full_name,'') AS actor_name FROM support_ticket_events e LEFT JOIN users u ON u.id=e.created_by WHERE e.ticket_id=$1 ORDER BY e.created_at ASC`, [req.params.id]);
    const verification = await pool.query(`SELECT v.*, u.full_name AS verified_by_name
      FROM support_verifications v LEFT JOIN users u ON u.id=v.verified_by WHERE v.ticket_id=$1`, [req.params.id]);
    const verificationHistory = await pool.query(`SELECT r.*, u.full_name AS verified_by_name, ru.full_name AS revised_by_name
      FROM support_verification_revisions r
      LEFT JOIN users u ON u.id=r.verified_by
      LEFT JOIN users ru ON ru.id=r.revised_by
      WHERE r.ticket_id=$1 ORDER BY r.archived_at DESC, r.id DESC`, [req.params.id]);
    const attachments = await pool.query(
      `SELECT a.*, u.full_name AS uploaded_by_name FROM ticket_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.ticket_id=$1 ORDER BY a.created_at ASC`,
      [req.params.id]
    );
    const comments = await pool.query(
      `SELECT c.*, u.full_name AS created_by_name FROM support_ticket_comments c LEFT JOIN users u ON u.id=c.created_by WHERE c.ticket_id=$1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    const reports = await pool.query(
      `SELECT r.*, au.full_name AS author_name, ru.full_name AS reviewer_name,
              COALESCE((SELECT json_agg(a.* ORDER BY a.created_at ASC) FROM ticket_attachments a WHERE a.report_id=r.id), '[]'::json) AS photos
       FROM ticket_work_reports r
       LEFT JOIN users au ON au.id=r.author_id
       LEFT JOIN users ru ON ru.id=r.reviewer_id
       WHERE r.ticket_id=$1 ORDER BY r.created_at ASC, r.id ASC`,
      [req.params.id]
    ).catch(() => ({ rows: [] }));

    return success(res, { ticket: ticket.rows[0], events: events.rows, verification: verification.rows[0] || null, verification_history: verificationHistory.rows, attachments: attachments.rows, comments: comments.rows, reports: reports.rows });
  } catch (error) { return serverError(res, error); }
};

const log3cxCallHandoff = async (req, res) => {
  try {
    const ticketId = Number.parseInt(req.params.id, 10);
    const source = String(req.body?.source || '');
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return fail(res, 'Invalid ticket ID', 400);
    if (!['ticket', 'verification'].includes(source)) return fail(res, 'Invalid call source', 400);

    const ticket = await pool.query(
      `SELECT t.id,
              COALESCE(NULLIF(TRIM(c.manual_phone), ''), NULLIF(TRIM(c.phone), ''),
                       NULLIF(TRIM(t.customer_snapshot->>'phone'), '')) AS phone
       FROM support_tickets t
       LEFT JOIN network_customers c ON c.id = t.customer_id
       WHERE t.id = $1`,
      [ticketId]
    );
    if (!ticket.rowCount) return notFound(res, 'Ticket not found');
    const phone = String(ticket.rows[0].phone || '').replace(/[^\d+]/g, '');
    if (!/^\+?\d{6,20}$/.test(phone)) return fail(res, 'Ticket does not have a valid customer phone number', 409);

    const phoneExtension = await pool.query(
      `SELECT extension FROM office_phones
       WHERE assign_to::text = $1 AND NULLIF(TRIM(extension), '') IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`,
      [String(req.user?.id || '')]
    );
    const event = await pool.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, metadata, created_by)
       VALUES ($1, 'call_handoff', '3CX dialer opened; call outcome not verified', $2::jsonb, $3)
       RETURNING id, ticket_id, event_type, message, metadata, created_at`,
      [ticketId, JSON.stringify({
        provider: '3cxphone',
        phone,
        source,
        outcome: 'not_verified',
        extension: phoneExtension.rows[0]?.extension || null,
      }), req.user?.id || null]
    );
    return success(res, event.rows[0], 201);
  } catch (error) { return serverError(res, error); }
};

// Structured technician work report (Standard fields: work done, materials,
// time spent + optional site photo). Append-only: rejected reports stay in
// history, technician submits a new one. Route-level requireOwnTicket scopes
// field technicians to their own tickets.
const REPORT_STATUSES = new Set(['submitted', 'approved', 'rejected']);
const submitWorkReport = async (req, res) => {
  const client = await pool.connect();
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return fail(res, 'Invalid ticket ID');
    const workDone = String(req.body?.work_done || '').trim();
    const materialsUsed = req.body?.materials_used != null ? String(req.body.materials_used).trim().slice(0, 1000) : null;
    const timeSpent = req.body?.time_spent_minutes;
    if (!workDone) return fail(res, 'Work done is required', 400);
    if (workDone.length > 2000) return fail(res, 'Work done must be <= 2000 chars.', 400);
    let minutes = null;
    if (timeSpent !== undefined && timeSpent !== null && timeSpent !== '') {
      minutes = Number(timeSpent);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 10080) {
        return fail(res, 'Time spent must be 0–10080 minutes.', 400);
      }
      minutes = Math.round(minutes);
    }
    const t = await client.query('SELECT id, ticket_no, status FROM support_tickets WHERE id=$1', [ticketId]);
    if (!t.rowCount) return notFound(res, 'Ticket not found');
    if (TERMINAL_STATUSES.has(t.rows[0].status)) {
      return fail(res, `Cannot report on ${t.rows[0].status} ticket. Reopen first.`, 409);
    }
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO ticket_work_reports (ticket_id, author_id, work_done, materials_used, time_spent_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ticketId, req.user?.id || null, workDone, materialsUsed || null, minutes]
    );
    const report = ins.rows[0];
    if (req.file) {
      await client.query(
        `INSERT INTO ticket_attachments (ticket_id, file_name, file_path, file_size, mime_type, uploaded_by, report_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ticketId, req.file.originalname || req.file.filename, `/uploads/ticket_attachments/${req.file.filename}`,
         req.file.size || null, req.file.mimetype || null, req.user?.id || null, report.id]
      );
    }
    const summary = `Work report submitted${minutes != null ? ` (${minutes}m)` : ''}${req.file ? ' + photo' : ''}`;
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, metadata, created_by)
       VALUES ($1,'report',$2,$3,$4)`,
      [ticketId, `${summary}: ${workDone.slice(0, 80)}`, JSON.stringify({ report_id: report.id }), req.user?.id || null]
    );
    await client.query('COMMIT');
    const enriched = await pool.query(
      `SELECT r.*, au.full_name AS author_name, ru.full_name AS reviewer_name
       FROM ticket_work_reports r LEFT JOIN users au ON au.id=r.author_id LEFT JOIN users ru ON ru.id=r.reviewer_id
       WHERE r.id=$1`,
      [report.id]
    );
    return success(res, enriched.rows[0], 201);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return serverError(res, error);
  } finally { client.release(); }
};

// Review a work report: approve or reject with note.
// Reviewers = anyone holding support.ticket.assign (route-level). A reject
// requires a review note so the technician knows what to redo.
const reviewWorkReport = async (req, res) => {
  const client = await pool.connect();
  try {
    const ticketId = parseInt(req.params.id, 10);
    const reportId = parseInt(req.params.reportId, 10);
    if (isNaN(ticketId) || isNaN(reportId)) return fail(res, 'Invalid ticket or report ID');
    const decision = String(req.body?.status || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) {
      return fail(res, 'Status must be approved or rejected', 400);
    }
    const reviewNote = req.body?.review_note != null ? String(req.body.review_note).trim().slice(0, 1000) : '';
    if (decision === 'rejected' && !reviewNote) {
      return fail(res, 'A review note is required when rejecting', 400);
    }
    const cur = await client.query(
      'SELECT * FROM ticket_work_reports WHERE id=$1 AND ticket_id=$2', [reportId, ticketId]
    );
    if (!cur.rowCount) return notFound(res, 'Work report not found');
    if (cur.rows[0].status !== 'submitted') {
      return fail(res, `Report already ${cur.rows[0].status}`, 409);
    }
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE ticket_work_reports SET status=$1, reviewer_id=$2, review_note=$3, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$4 AND ticket_id=$5 RETURNING *`,
      [decision, req.user?.id || null, reviewNote || null, reportId, ticketId]
    );
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, metadata, created_by)
       VALUES ($1,'report_reviewed',$2,$3,$4)`,
      [ticketId, `Work report ${decision}${reviewNote ? `: ${reviewNote.slice(0, 80)}` : ''}`,
       JSON.stringify({ report_id: reportId, decision }), req.user?.id || null]
    );
    await client.query('COMMIT');
    const enriched = await pool.query(
      `SELECT r.*, au.full_name AS author_name, ru.full_name AS reviewer_name
       FROM ticket_work_reports r LEFT JOIN users au ON au.id=r.author_id LEFT JOIN users ru ON ru.id=r.reviewer_id
       WHERE r.id=$1`,
      [reportId]
    );
    return success(res, enriched.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    return serverError(res, error);
  } finally { client.release(); }
};

const updateTicket = async (req, res) => {
  const client = await pool.connect();
  try {
    let { status, assigned_to, additional_technician_ids, note, resolution_note, priority, category_id, description, send_sms, send_whatsapp, subject, complaint_no, is_qc_support, is_on_call, resolution_type } = req.body || {};
    const officeScope = req.supportOfficeScope || resolveSupportOffice(req.user);
    if (!officeScope) return fail(res, 'Your work location is not configured for support ticket access.', 403);
    if (!officeScope.isHeadOffice && req.body?.office_name &&
        normalizeOfficeName(req.body.office_name) !== officeScope.office) {
      return fail(res, 'You can only keep tickets within your assigned office.', 403);
    }
    if (status && !allowedStatuses.has(status)) return fail(res, 'Invalid ticket status');
    if (priority && !['critical','high','medium','low'].includes(priority)) return fail(res, 'Invalid priority');
    if (subject !== undefined && subject !== null && String(subject).trim().length > 200) return fail(res, 'Subject must be <= 200 chars.', 400);
    if (description !== undefined && description !== null && String(description).trim().length > 2000) return fail(res, 'Description must be <= 2000 chars.', 400);
    if (complaint_no !== undefined && complaint_no !== null && String(complaint_no).trim().length > 50) return fail(res, 'Complaint number must be <= 50 chars.', 400);
    if (req.body.office_name && !ALLOWED_OFFICE_NAMES.has(normalizeOfficeName(req.body.office_name))) return fail(res, 'Invalid Office / Branch.', 400);
    if (req.body.connection_type && !ALLOWED_CONNECTION_TYPES.includes(String(req.body.connection_type).trim())) return fail(res, 'Invalid connection type.', 400);
    if (category_id) {
      const catChk = await pool.query('SELECT id FROM support_categories WHERE id=$1 AND is_active=TRUE', [Number(category_id)]);
      if (!catChk.rowCount) return fail(res, 'Invalid category.', 400);
    }
    
    // Resolve assigned_to: frontend sends full_name or id — validate FK and scope to active technicians
    let assignedUserId = null;
    let assignFailed = false;
    if (assigned_to !== undefined && assigned_to !== null && String(assigned_to).trim() !== '') {
      const raw = String(assigned_to).trim();
      if (/^\d+$/.test(raw)) {
        const chk = await client.query(`SELECT id FROM users WHERE id=$1 AND LOWER(status)='active'`, [Number(raw)]);
        if (chk.rowCount) assignedUserId = Number(raw);
        else assignFailed = true;
      } else {
        // Exact-match technician resolve: escape LIKE wildcards so %/_ in
        // the name can't act as patterns (wildcard assignee hijack).
        const found = await client.query(`SELECT id FROM users WHERE TRIM(full_name) ILIKE TRIM($1) ESCAPE '\\' AND LOWER(status)='active' ORDER BY id ASC LIMIT 1`, [raw.replace(/([%_\\])/g, '\\$1')]);
        if (found.rowCount) assignedUserId = found.rows[0].id;
        else assignFailed = true;
      }
      if (!assignedUserId && !assignFailed) assignedUserId = null;
    } else if (assigned_to === '') {
      assignedUserId = null;
    }
    if (assignFailed) {
      return fail(res, `Technician "${assigned_to}" not found or inactive.`);
    }
    let additionalTechnicianIds = null;
    if (additional_technician_ids !== undefined) {
      if (!Array.isArray(additional_technician_ids) || additional_technician_ids.length > 9) return fail(res, 'Additional technicians must be a list of up to 9 users.', 400);
      const parsed = [...new Set(additional_technician_ids.map(Number))].filter(Number.isInteger).filter(id => id > 0);
      if (parsed.length > 0) {
        const valid = await client.query(`SELECT id FROM users WHERE id = ANY($1::int[]) AND LOWER(status)='active'`, [parsed]);
        additionalTechnicianIds = valid.rows.map(r => Number(r.id));
      } else {
        additionalTechnicianIds = [];
      }
    }

    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found.');
    }
    const row = existing.rows[0];
    let newStatus = status || row.status;
    const isReassigned = assignedUserId !== null && assignedUserId !== row.assigned_to;
    const isUnassignAttempt = req.body.assigned_to === '';

    if (row.status === 'cancelled' && newStatus === 'reopened' && row.customer_id) {
      await client.query('SELECT id FROM network_customers WHERE id=$1 FOR UPDATE', [row.customer_id]);
      const activeTicket = await client.query(
        `SELECT ticket_no, status FROM support_tickets
         WHERE customer_id=$1 AND id<>$2 AND status NOT IN ('closed','resolved','cancelled')
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [row.customer_id, row.id]
      );
      if (activeTicket.rowCount) {
        await client.query('ROLLBACK');
        const { ticket_no, status: activeStatus } = activeTicket.rows[0];
        return fail(res, `Cannot reopen this cancelled ticket: customer already has unresolved ticket ${ticket_no} (${activeStatus}). Work on that ticket or resolve it first.`, 409);
      }
    }

    // Field technicians work their own tickets only: no re-assign/unassign.
    // (Route-level requireOwnTicket already guarantees the ticket is theirs.)
    if (isFieldTechnician(req.user) && (isReassigned || isUnassignAttempt)) {
      await client.query('ROLLBACK');
      return fail(res, 'Field technicians cannot re-assign tickets', 403);
    }

    // --- Manual customer contact override (pending/processing only; terminal guard below blocks solved/closed) ---
    const rawManualPhone = req.body.manual_phone;
    const rawManualAddress = req.body.manual_address;
    const wantManualPhone = rawManualPhone !== undefined && rawManualPhone !== null;
    const wantManualAddress = rawManualAddress !== undefined && rawManualAddress !== null;
    let cleanManualPhone = null, cleanManualAddress = null;
    if (wantManualPhone) {
      const v = String(rawManualPhone).trim();
      if (v !== '' && !isValidBdMobile(v)) {
        await client.query('ROLLBACK');
        return fail(res, 'Invalid mobile number. Use 11-digit BD format (01XXXXXXXXX).', 400);
      }
      cleanManualPhone = v === '' ? null : v;
    }
    if (wantManualAddress) {
      const v = String(rawManualAddress).trim();
      if (v.length > 500) {
        await client.query('ROLLBACK');
        return fail(res, 'Address must be <= 500 chars.', 400);
      }
      cleanManualAddress = v === '' ? null : v;
    }

    // --- Terminal guard: closed/cancelled cannot be edited without reopen; resolved->closed allowed ---
    // Note: blank/missing subject counts as "no touch" (COALESCE keeps old value) — not an edit.
    const hasEditFields = !!(priority || (category_id !== undefined && Number(category_id || 0) !== Number(row.category_id || 0)) || (description !== undefined && description !== null && String(description).trim() !== String(row.description || '').trim()) || req.body.office_name || req.body.connection_type || req.body.connection_subtype || (complaint_no !== undefined && String(complaint_no || '').trim() !== String(row.complaint_no || '').trim()) || (subject !== undefined && subject !== null && String(subject).trim() !== '') || resolution_note || wantManualPhone || wantManualAddress || is_qc_support !== undefined || is_on_call !== undefined || resolution_type !== undefined);
    if (TERMINAL_STATUSES.has(row.status)) {
      const isResolvedToClosed = row.status === 'resolved' && newStatus === 'closed';
      if (newStatus !== row.status && newStatus !== 'reopened' && !isResolvedToClosed) {
        await client.query('ROLLBACK');
        return fail(res, `Ticket already ${row.status}. Only ${row.status === 'resolved' ? 'close or reopen' : 'reopen'} is allowed.`, 409);
      }
      if (newStatus === row.status && (isReassigned || isUnassignAttempt || hasEditFields)) {
        await client.query('ROLLBACK');
        return fail(res, `Solved/Closed ticket cannot be edited or re-assigned. Please reopen first.`, 409);
      }
      // resolved->closed is allowed with a closing report (resolution_note/note) but
      // must not carry re-assign or other field-edit side-effects
      const hasNonReportEdits = !!(priority || (category_id !== undefined && Number(category_id || 0) !== Number(row.category_id || 0)) || (description !== undefined && description !== null && String(description).trim() !== String(row.description || '').trim()) || req.body.office_name || req.body.connection_type || req.body.connection_subtype || (complaint_no !== undefined && String(complaint_no || '').trim() !== String(row.complaint_no || '').trim()) || (subject !== undefined && subject !== null && String(subject).trim() !== '') || wantManualPhone || wantManualAddress || is_qc_support !== undefined);
      if (isResolvedToClosed && (isReassigned || isUnassignAttempt || hasNonReportEdits)) {
        await client.query('ROLLBACK');
        return fail(res, `Cannot edit/re-assign while closing a resolved ticket. Close first, or reopen to edit.`, 409);
      }
    }

    // Field technicians: view + work report + mark done only.
// Allowed: status forward to in_progress / waiting_customer / resolved,
// plus note / resolution_note / send_sms. Blocked: every field edit,
// re-assign (above), closing (office verifies & closes), and all other
// status targets (reopen/cancel/vendor/verification are office actions).
// NOTE: hasNonReportEdits is scoped inside the terminal-guard block above,
// so the same expression is recomputed here for the non-terminal path.
const TECH_ALLOWED_STATUSES = new Set(['in_progress', 'waiting_customer', 'resolved']);
if (isFieldTechnician(req.user)) {
  const techFieldEdit = !!(priority || (category_id !== undefined && Number(category_id || 0) !== Number(row.category_id || 0)) || (description !== undefined && description !== null && String(description).trim() !== String(row.description || '').trim()) || req.body.office_name || req.body.connection_type || req.body.connection_subtype || (complaint_no !== undefined && String(complaint_no || '').trim() !== String(row.complaint_no || '').trim()) || (subject !== undefined && subject !== null && String(subject).trim() !== '') || wantManualPhone || wantManualAddress || is_qc_support !== undefined);
  if (techFieldEdit) {
    await client.query('ROLLBACK');
    return fail(res, 'Field technicians cannot edit ticket fields. Only status and notes can be updated.', 403);
  }
  if (newStatus === 'closed') {
    await client.query('ROLLBACK');
    return fail(res, 'Only office staff can close tickets. Mark it resolved instead.', 403);
  }
  if (newStatus !== row.status && !TECH_ALLOWED_STATUSES.has(newStatus)) {
    await client.query('ROLLBACK');
    return fail(res, `Field technicians cannot move tickets to ${newStatus}.`, 403);
  }
}

// --- Status transition validation ---
    if (newStatus !== row.status) {
      const allowed = STATUS_TRANSITIONS[row.status] || [];
      if (!allowed.includes(newStatus)) {
        await client.query('ROLLBACK');
        return fail(res, `Invalid status transition: ${row.status} → ${newStatus}`, 409);
      }
    }

    // Workflow: NOC creates Pending (new) → Manager assigns → Processing (assigned) — auto if still pending
    if (isReassigned && ['new','waiting_customer','reopened'].includes(row.status) && (!status || status === row.status)) {
      newStatus = 'assigned';
    }

    const cleanId = parseInt(req.params.id, 10);
    const cleanUserId = req.user?.id ? parseInt(req.user.id, 10) : null;
    const cleanCatId = category_id ? parseInt(category_id, 10) : null;
    const cleanAssigned = assignedUserId ? parseInt(assignedUserId, 10) : null;
    const isUnassign = isUnassignAttempt;
    const normalizedOffice = req.body.office_name ? normalizeOfficeName(req.body.office_name) : null;
    const connType = req.body.connection_type ? String(req.body.connection_type).trim() : null;
    const rawSubtype = req.body.connection_subtype;
    const connSubtype = (rawSubtype === undefined || rawSubtype === null || String(rawSubtype).trim() === '') ? null : String(rawSubtype).trim();
    const effectiveType = connType || row.connection_type;
    let clearSubtype = false;
    if (effectiveType === 'Conseal') {
      const effectiveSubtype = connSubtype || row.connection_subtype;
      if (connSubtype && !ALLOWED_CONSEAL_SUBTYPES.includes(connSubtype)) {
        await client.query('ROLLBACK');
        return fail(res, 'Invalid Conseal subtype (Fiber Conseal / CAT Conseal)', 400);
      }
      if (!effectiveSubtype) {
        await client.query('ROLLBACK');
        return fail(res, 'Conseal subtype is required (Fiber Conseal / CAT Conseal)', 400);
      }
    } else {
      if (connSubtype) {
        await client.query('ROLLBACK');
        return fail(res, 'connection_subtype only allowed with Conseal', 400);
      }
      // Switching away from Conseal → clear stale subtype
      if (connType && row.connection_subtype) clearSubtype = true;
    }
    const cleanSubject = subject !== undefined && String(subject).trim() !== '' ? String(subject).trim() : null;
    const cleanComplaintNo = complaint_no !== undefined && String(complaint_no).trim() !== '' ? String(complaint_no).trim() : null;
    const shouldIncrementReopen = newStatus === 'reopened' && row.status !== 'reopened' && row.status !== 'cancelled';

    const effectiveCategoryId = category_id !== undefined ? cleanCatId : Number(row.category_id || 0);
    const isOnCallCategory = effectiveCategoryId === 918;
    const requestedResolutionType = resolution_type == null ? '' : String(resolution_type).trim().toLowerCase();
    const currentResolutionType = String(row.resolution_type || '').trim().toLowerCase();
    let finalIsOnCall = Boolean(row.is_on_call);
    if (isOnCallCategory) {
      finalIsOnCall = true;
    } else if (is_on_call !== undefined && is_on_call !== null) {
      finalIsOnCall = is_on_call === true || is_on_call === 'true';
    } else if (resolution_type !== undefined && resolution_type !== null) {
      finalIsOnCall = requestedResolutionType === 'on_call';
    } else if (is_on_call === undefined && ['closed', 'resolved'].includes(newStatus) && !row.assigned_to && !cleanAssigned) {
      finalIsOnCall = true;
    }

    const finalResolutionType = finalIsOnCall
      ? 'on_call'
      : (requestedResolutionType && requestedResolutionType !== 'on_call'
        ? requestedResolutionType
        : (currentResolutionType && currentResolutionType !== 'on_call' ? currentResolutionType : 'field_visit'));
    const finalIsQcSupport = is_qc_support === undefined || is_qc_support === null
      ? Boolean(row.is_qc_support || Number(row.category_id) === 912)
      : is_qc_support === true || is_qc_support === 'true';

    const updated = await client.query(`WITH p AS (
      SELECT $1::int AS id, $2::varchar(30) AS status, $3::int AS assigned_to, $9::boolean AS is_unassign,
             $4::varchar(20) AS priority, $5::int AS category_id,
             $6::text AS description, $7::text AS resolution_note, $8::int AS user_id,
             $10::varchar(100) AS office_name, $11::varchar(30) AS connection_type, $12::boolean AS inc_reopen,
             $13::varchar(200) AS subject, $14::varchar(50) AS complaint_no,
             $15::varchar(30) AS connection_subtype, $16::boolean AS clear_subtype, $17::jsonb AS additional_technician_ids,
             $18::boolean AS description_provided, $19::boolean AS complaint_no_provided, $20::boolean AS category_provided,
             $21::boolean AS is_on_call, $22::varchar(30) AS resolution_type, $23::boolean AS is_qc_support
    )
    UPDATE support_tickets AS t SET 
      status=p.status, 
      assigned_to=CASE WHEN p.is_unassign THEN NULL ELSE COALESCE(p.assigned_to,t.assigned_to) END, 
      priority=COALESCE(p.priority,t.priority), 
      category_id=CASE WHEN p.category_provided THEN p.category_id ELSE t.category_id END,
      subject=COALESCE(p.subject,t.subject),
      complaint_no=CASE WHEN p.complaint_no_provided THEN p.complaint_no ELSE t.complaint_no END,
      description=CASE WHEN p.description_provided THEN p.description ELSE t.description END,
      resolution_note=COALESCE(p.resolution_note,t.resolution_note),
      office_name=COALESCE(p.office_name,t.office_name),
      zone=COALESCE(p.office_name,t.zone),
      connection_type=COALESCE(p.connection_type,t.connection_type),
      connection_subtype=CASE WHEN p.clear_subtype THEN NULL ELSE COALESCE(p.connection_subtype,t.connection_subtype) END,
      additional_technician_ids=COALESCE(p.additional_technician_ids,t.additional_technician_ids),
      is_qc_support=p.is_qc_support,
      is_on_call=p.is_on_call,
      resolution_type=p.resolution_type,
      first_response_at=CASE WHEN t.first_response_at IS NULL AND p.status <> 'new' THEN NOW() ELSE t.first_response_at END,
      resolved_at=CASE WHEN p.status='reopened' THEN NULL WHEN p.status IN ('resolved','closed') AND t.resolved_at IS NULL THEN NOW() ELSE t.resolved_at END,
      closed_at=CASE WHEN p.status='reopened' THEN NULL WHEN p.status='closed' AND t.closed_at IS NULL THEN NOW() ELSE t.closed_at END, 
      reopen_count=CASE WHEN p.inc_reopen THEN t.reopen_count + 1 ELSE t.reopen_count END,
      updated_by=p.user_id, 
      updated_at=NOW() FROM p WHERE t.id=p.id RETURNING t.*`, 
      [cleanId, String(newStatus), cleanAssigned, priority || null, cleanCatId, description === undefined || description === null ? null : String(description).trim(), resolution_note || null, cleanUserId, isUnassign, normalizedOffice, connType, shouldIncrementReopen, cleanSubject, cleanComplaintNo, connSubtype, clearSubtype, additionalTechnicianIds === null ? null : JSON.stringify(additionalTechnicianIds), description !== undefined && description !== null, complaint_no !== undefined && complaint_no !== null, category_id !== undefined, finalIsOnCall, finalResolutionType, finalIsQcSupport]);

    // Apply manual contact override to customer + refresh ticket snapshot
    if ((wantManualPhone || wantManualAddress) && row.customer_id) {
      if (wantManualPhone) {
        await client.query('UPDATE network_customers SET manual_phone=$1, updated_at=NOW() WHERE id=$2', [cleanManualPhone, row.customer_id]);
      }
      if (wantManualAddress) {
        await client.query('UPDATE network_customers SET manual_address=$1, updated_at=NOW() WHERE id=$2', [cleanManualAddress, row.customer_id]);
      }
      const eff = await client.query('SELECT COALESCE(manual_phone,phone) AS phone, COALESCE(manual_address,address) AS address FROM network_customers WHERE id=$1', [row.customer_id]);
      if (eff.rowCount) {
        await client.query(`UPDATE support_tickets SET customer_snapshot = COALESCE(customer_snapshot,'{}'::jsonb) || jsonb_build_object('phone',$2::text,'address',$3::text) WHERE id=$1`, [cleanId, eff.rows[0].phone, eff.rows[0].address]);
      }
    }

    // Build a complete before/after record for every field changed in this save.
    const changes = {};
    const hasStatusChange = newStatus !== row.status;
    const track = (field, oldVal, newVal) => {
      const from = oldVal == null || String(oldVal) === '' ? '—' : String(oldVal);
      const to = newVal == null || String(newVal) === '' ? '—' : String(newVal);
      if (from !== to) changes[field] = { from, to };
    };
    if (priority !== undefined && priority !== row.priority) track('priority', row.priority, priority);
    if (category_id !== undefined && Number(category_id || 0) !== Number(row.category_id || 0)) {
      const categoryIds = [...new Set([row.category_id, cleanCatId].filter(Boolean).map(Number))];
      const categoryRows = categoryIds.length ? await client.query("SELECT id, COALESCE(NULLIF(TRIM(name_bn),''),name) AS label FROM support_categories WHERE id=ANY($1::int[])", [categoryIds]) : { rows: [] };
      const categoryLabels = new Map(categoryRows.rows.map((category) => [Number(category.id), category.label]));
      track('category', row.category_id ? categoryLabels.get(Number(row.category_id)) || `Category ${row.category_id}` : null, cleanCatId ? categoryLabels.get(Number(cleanCatId)) || `Category ${cleanCatId}` : null);
    }
    if (cleanSubject && cleanSubject !== row.subject) track('subject', row.subject, cleanSubject);
    if (finalIsQcSupport !== Boolean(row.is_qc_support || Number(row.category_id) === 912)) {
      track('is_qc_support', Boolean(row.is_qc_support || Number(row.category_id) === 912), finalIsQcSupport);
    }
    if (complaint_no !== undefined && String(complaint_no || '').trim() !== String(row.complaint_no || '').trim()) track('complaint_no', row.complaint_no, String(complaint_no || '').trim());
    if (description !== undefined && description !== null && String(description).trim() !== String(row.description || '').trim()) track('description', String(row.description || '').trim(), String(description).trim());
    if (resolution_note !== undefined && resolution_note !== null && String(resolution_note).trim() !== String(row.resolution_note || '').trim()) track('resolution_note', row.resolution_note, String(resolution_note).trim());
    if (req.body.office_name && normalizeOfficeName(req.body.office_name) !== row.office_name) track('office', row.office_name, normalizeOfficeName(req.body.office_name));
    if (connType && connType !== row.connection_type) track('connection_type', row.connection_type, connType);
    if (clearSubtype && row.connection_subtype) track('connection_subtype', row.connection_subtype, null);
    else if (connSubtype && connSubtype !== row.connection_subtype) track('connection_subtype', row.connection_subtype, connSubtype);
    if (wantManualPhone) track('mobile', row.customer_snapshot?.phone, cleanManualPhone);
    if (wantManualAddress) track('address', row.customer_snapshot?.address, cleanManualAddress);

    const assignmentChanged = isReassigned || (isUnassignAttempt && row.assigned_to !== null);
    const assignmentIds = [...new Set([row.assigned_to, assignedUserId].filter(Boolean).map(Number))];
    const assignmentUsers = assignmentIds.length ? await client.query('SELECT id, full_name FROM users WHERE id=ANY($1::int[])', [assignmentIds]) : { rows: [] };
    const assignmentNames = new Map(assignmentUsers.rows.map((user) => [Number(user.id), user.full_name]));
    if (assignmentChanged) {
      const previousName = row.assigned_to ? assignmentNames.get(Number(row.assigned_to)) || `User ${row.assigned_to}` : null;
      const nextName = assignedUserId ? assignmentNames.get(Number(assignedUserId)) || `User ${assignedUserId}` : null;
      track('assigned_to', previousName, nextName);
    }

    const previousTeamIds = Array.isArray(row.additional_technician_ids) ? row.additional_technician_ids.map(Number) : [];
    let teamChanged = false;
    if (additionalTechnicianIds !== null) {
      teamChanged = previousTeamIds.length !== additionalTechnicianIds.length || previousTeamIds.some((id) => !additionalTechnicianIds.includes(id));
      if (teamChanged) {
        const allTeamIds = [...new Set([...previousTeamIds, ...additionalTechnicianIds])];
        const teamUsers = allTeamIds.length ? await client.query('SELECT id, full_name FROM users WHERE id=ANY($1::int[])', [allTeamIds]) : { rows: [] };
        const teamNames = new Map(teamUsers.rows.map((user) => [Number(user.id), user.full_name]));
        const beforeNames = previousTeamIds.map((id) => teamNames.get(id) || `User ${id}`);
        const afterNames = additionalTechnicianIds.map((id) => teamNames.get(id) || `User ${id}`);
        track('additional_technicians', beforeNames.join(', '), afterNames.join(', '));
      }
    }

    if (hasStatusChange) track('status', row.status, newStatus);
    const fieldChanges = Object.fromEntries(Object.entries(changes).filter(([field]) => !['assigned_to', 'additional_technicians', 'status'].includes(field)));
    const hasFieldChanges = Object.keys(fieldChanges).length > 0;
    const hasNote = String(note || '').trim().length > 0;

    if (assignmentChanged) {
      const oldName = row.assigned_to ? assignmentNames.get(Number(row.assigned_to)) || `User ${row.assigned_to}` : 'Unassigned';
      const newName = assignedUserId ? assignmentNames.get(Number(assignedUserId)) || `User ${assignedUserId}` : 'Unassigned';
      const eventType = !assignedUserId ? 'unassigned' : row.assigned_to ? 'reassigned' : 'assigned';
      const msg = !assignedUserId ? `Unassigned technician: ${oldName}` : `${eventType === 'reassigned' ? 'Re-assigned' : 'Assigned'} technician: ${newName}${row.assigned_to ? ` (was ${oldName})` : ' (was Unassigned)'}`;
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [cleanId, eventType, msg, row.status, newStatus, JSON.stringify({ changes: { assigned_to: changes.assigned_to }, note: note || null }), cleanUserId]
      );
    }
    if (hasStatusChange) {
      let msg = `Status: ${row.status} → ${newStatus}`;
      if (note) msg += ` — ${String(note).trim()}`;
      if (resolution_note && newStatus === 'closed') msg += ` — Report: ${String(resolution_note).trim().substring(0, 80)}`;
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,'status_changed',$2,$3,$4,$5::jsonb,$6)`,
        [cleanId, msg, row.status, newStatus, JSON.stringify({ changes: { status: changes.status }, note: note || null }), cleanUserId]
      );
    }
    if (hasNote || (resolution_note && !hasStatusChange)) {
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,'note',$2,$3,$4,$5::jsonb,$6)`,
        [cleanId, String(note || resolution_note).trim(), row.status, newStatus, JSON.stringify({ note: note || null, resolution_note: resolution_note || null }), cleanUserId]
      );
    }
    if (teamChanged) {
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,'team_updated',$2,$3,$4,$5::jsonb,$6)`,
        [cleanId, `Additional technicians: ${changes.additional_technicians?.to || 'None'}`, row.status, newStatus, JSON.stringify({ changes: { additional_technicians: changes.additional_technicians } }), cleanUserId]
      );
    }
    if (hasFieldChanges) {
      const keys = Object.keys(fieldChanges);
      const editMessage = keys.length === 1 && keys[0] === 'description' ? 'Edited remarks' : `Edited: ${keys.join(', ')}`;
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,'edited',$2,$3,$4,$5::jsonb,$6)`,
        [cleanId, editMessage, row.status, newStatus, JSON.stringify({ changes: fieldChanges }), cleanUserId]
      );
    }
    
    await client.query('COMMIT'); 

    // Auto notifications (non-blocking) — SMS and WhatsApp are independent flags.
    // Each channel sends on explicit true, or on auto-events unless explicitly false.
    const isCloseTransition = ['resolved', 'closed'].includes(newStatus) && !['resolved', 'closed'].includes(row.status);
    const smsOn = send_sms === true || ((isReassigned || isCloseTransition) && send_sms !== false);
    const waOn = send_whatsapp === true || ((isReassigned || isCloseTransition) && send_whatsapp !== false);
    if (smsOn || waOn) {
      (async () => {
        try {
          const { sendSms, logSms } = require('../utilities/smsService');
          // Recipient fallback (same as create): complaint_no first, else MikroTik-synced customer number.
          const updComplaint = String(updated.rows[0].complaint_no || row.complaint_no || '').trim();
          const updSnapshotPhone = String(updated.rows[0].customer_snapshot?.phone || row.customer_snapshot?.phone || '').trim();
          const customerPhone = isValidBdMobile(updComplaint) ? updComplaint : updSnapshotPhone;
          const techPhoneRow = cleanAssigned ? await pool.query('SELECT phone FROM users WHERE id=$1', [cleanAssigned]) : null;
          const techPhone = techPhoneRow?.rows?.[0]?.phone;
          const waTechOn = waOn && isReassigned;
          const waCustOn = waOn && isCloseTransition;
          if (isReassigned && (send_sms !== false || waTechOn) && techPhone && isValidBdMobile(techPhone)) {
            const snap = updated.rows[0].customer_snapshot || row.customer_snapshot || {};
            const trunc = (v, n) => String(v || '').trim().substring(0, n) || '-';
            // Mob: complaint_no first, else MikroTik-synced number (same fallback as customerPhone above)
            const techCustPhone = updComplaint || updSnapshotPhone || '-';
            const pppoeVal = String(snap.pppoe_username || '').trim() || '-';
            // OLT: MikroTik comment has full port path incl. Vlan (e.g. OLT4-Port0/7-GPON/...-Vlan847); fall back to vlan fields
            const oltVal = String(snap.comment_raw || '').trim()
              || String(snap.vlan_name || '').trim()
              || (snap.vlan_id !== undefined && snap.vlan_id !== null ? String(snap.vlan_id).trim() : '')
              || '-';
            // Subject auto-format is "{Category} - {pppoe}" → strip trailing pppoe to avoid showing it twice
            let cleanSubj = trunc(updated.rows[0].subject, 100);
            if (pppoeVal !== '-' && cleanSubj.length > pppoeVal.length && cleanSubj.endsWith(pppoeVal)) {
              const stripped = cleanSubj.substring(0, cleanSubj.length - pppoeVal.length).replace(/[-–—:|\s]+$/, '').trim();
              if (stripped) cleanSubj = stripped;
            }
            const assignedText = await renderSystemSms('ticket_assigned_technician', {
              ticket_no: row.ticket_no,
              priority: String(updated.rows[0].priority || row.priority || 'medium').toUpperCase(),
              pppoe: pppoeVal,
              phone: techCustPhone,
              olt: trunc(oltVal, 80),
              vlan: snap.vlan_name || (snap.vlan_id !== undefined && snap.vlan_id !== null ? String(snap.vlan_id) : '') || '-',
              address: trunc(snap.address, 80),
              subject: cleanSubj,
              description: trunc(updated.rows[0].description || row.description, 100),
              zone: updated.rows[0].zone || row.zone || updated.rows[0].office_name || '',
            });
            if (send_sms !== false) {
              const r = await sendSms({ msisdn: techPhone, sms: assignedText });
              await logSms({ recipient_phone: techPhone, message_body: `Assigned ${row.ticket_no}`, status: (r.success ? 'Sent' : `Failed: ${r.data?.error_message || r.error}`).substring(0,50), sent_by: cleanUserId });
            }
            if (waTechOn) await queueTicketWhatsApp(techPhone, assignedText, 'ticket_assigned');
          }
          if ((isCloseTransition || send_sms === true || send_whatsapp === true) && (send_sms !== false || waCustOn) && customerPhone && isValidBdMobile(customerPhone)) {
            const statusText = await renderSystemSms('ticket_status_customer', { ticket_no: row.ticket_no, status: newStatus });
            if (send_sms !== false) {
              const r2 = await sendSms({ msisdn: customerPhone, sms: statusText });
              await logSms({ recipient_phone: customerPhone, message_body: `Ticket ${row.ticket_no} ${newStatus}`, status: (r2.success ? 'Sent' : `Failed: ${r2.data?.error_message || r2.error}`).substring(0,50), sent_by: cleanUserId });
            }
            if (waCustOn) await queueTicketWhatsApp(customerPhone, statusText, 'ticket_status');
          }
          // FCM push to the assigned technician's app (non-blocking, fail-soft)
          if (isReassigned && cleanAssigned) {
            try {
              const { sendPushToUser } = require('../utilities/pushService');
              await sendPushToUser(cleanAssigned, {
                title: 'New ticket assigned',
                body: `${row.ticket_no} — ${updated.rows[0].subject || 'Support ticket'}`,
                data: { type: 'ticket_assigned', ticketId: String(cleanId), ticket_no: row.ticket_no },
              });
            } catch (e) { console.error('[Push assign] failed:', e.message); }
          }
        } catch (e) { console.error('[SMS auto] failed:', e.message); }
      })();
    }

    return success(res, updated.rows[0]);
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} return serverError(res, error); } finally { client.release(); }
};

const deleteTicket = async (req, res) => {
  let client;
  try {
    if (blockFieldTechnician(req, res)) return;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return fail(res, 'Invalid ticket ID');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return fail(res, 'Cancellation reason is required.', 400);
    if (reason.length > 500) return fail(res, 'Cancellation reason must be 500 characters or fewer.', 400);

    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, ticket_no, status FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found');
    }
    const oldStatus = existing.rows[0].status;
    if (oldStatus === 'cancelled') {
      await client.query('ROLLBACK');
      return fail(res, 'Ticket already cancelled.', 409);
    }
    if (TERMINAL_STATUSES.has(oldStatus)) {
      await client.query('ROLLBACK');
      return fail(res, `Solved/Closed ticket (${oldStatus}) cannot be cancelled. Reopen first.`, 409);
    }
    const allowedToCancel = STATUS_TRANSITIONS[oldStatus] || [];
    if (!allowedToCancel.includes('cancelled')) {
      await client.query('ROLLBACK');
      return fail(res, `Invalid status transition: ${oldStatus} → cancelled`, 409);
    }
    await client.query('UPDATE support_tickets SET status=$1, updated_by=$2, updated_at=NOW() WHERE id=$3', ['cancelled', req.user?.id || null, id]);
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by)
       VALUES ($1,'status_changed',$2,$3,$4,$5::jsonb,$6)`,
      [id, `Status: ${oldStatus} → cancelled — Reason: ${reason}`, oldStatus, 'cancelled', JSON.stringify({ cancellation_reason: reason }), req.user?.id || null]
    );
    await client.query('COMMIT');
    return success(res, { message: `Ticket ${existing.rows[0].ticket_no} moved to Cancelled (history preserved)` });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    return serverError(res, error);
  } finally { if (client) client.release(); }
};

// Admin-only undo for a wrongly solved/closed ticket. Restores the status the
// ticket had immediately before it was resolved/closed (from the event log),
// clears resolution/solved timestamps and logs a 'reverted' audit event.
const SUPPORT_ADMIN_ROLES = new Set(['admin', 'super admin', 'superadmin']);
const isSupportAdmin = (user) => {
  if (!user) return false;
  if (user.is_super_admin === true) return true;
  if (user.all_access === true || user['system.all_access'] === true) return true;
  const perms = user.permissions || {};
  if (perms.all_access === true || perms['system.all_access'] === true) return true;
  return SUPPORT_ADMIN_ROLES.has(String(user.role_name || user.role || '').trim().toLowerCase());
};

const revertSolvedTicket = async (req, res) => {
  if (!isSupportAdmin(req.user)) {
    return fail(res, 'Only an admin can revert a solved/closed ticket.', 403);
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return fail(res, 'Invalid ticket ID', 400);
  const reason = String(req.body?.reason || '').trim();
  if (reason.length > 300) return fail(res, 'Reason must be 300 characters or fewer.', 400);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found.');
    }
    const row = found.rows[0];
    if (!['resolved', 'closed'].includes(row.status)) {
      await client.query('ROLLBACK');
      return fail(res, `Only solved/closed tickets can be reverted (current: ${row.status}).`, 409);
    }

    const prev = await client.query(
      `SELECT old_status FROM support_ticket_events
        WHERE ticket_id=$1 AND event_type='status_changed'
          AND new_status = ANY($2::text[])
          AND old_status IS NOT NULL
          AND old_status NOT IN ('resolved','closed','cancelled')
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [id, ['resolved', 'closed']]
    );
    let revertStatus = prev.rows[0]?.old_status;
    if (!revertStatus || !allowedStatuses.has(revertStatus) || TERMINAL_STATUSES.has(revertStatus)) {
      revertStatus = row.assigned_to ? 'assigned' : 'new';
    }

    const updated = await client.query(
      `UPDATE support_tickets
          SET status=$1, resolved_at=NULL, closed_at=NULL, resolution_note=NULL,
              updated_by=$2, updated_at=NOW()
        WHERE id=$3
        RETURNING *`,
      [revertStatus, req.user?.id || null, id]
    );

    await client.query(
      `INSERT INTO support_ticket_events
         (ticket_id, event_type, message, old_status, new_status, metadata, created_by)
       VALUES ($1,'reverted',$2,$3,$4,$5::jsonb,$6)`,
      [
        id,
        `Admin reverted solved ticket: ${row.status} → ${revertStatus}${reason ? ` — ${reason}` : ''}`,
        row.status,
        revertStatus,
        JSON.stringify({
          reverted_by_admin: true,
          reason: reason || null,
          changes: { status: { from: row.status, to: revertStatus } },
          cleared: ['resolved_at', 'closed_at', 'resolution_note'],
        }),
        req.user?.id || null,
      ]
    );

    await client.query('COMMIT');
    return success(res, updated.rows[0]);
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    return serverError(res, error);
  } finally { if (client) client.release(); }
};

// --- Verification Call Handlers ---
const saveVerificationCall = async (req, res) => {
  let client;
  try {
    if (blockFieldTechnician(req, res)) return;
    const {
      ticket_id,
      is_correction,
      verification_attempt_id,
      q1_technical,
      q2_media,
      q3_customercare,
      q4_payment,
      q5_service_satisfaction,
      q6_time_satisfaction,
      q7_technician_behavior,
      feedback_remarks,
      answers,
    } = req.body || {};
    if (!ticket_id) return fail(res, 'Ticket ID required');
    const attemptId = verification_attempt_id == null || verification_attempt_id === ''
      ? null
      : Number(verification_attempt_id);
    if (attemptId !== null && (!Number.isSafeInteger(attemptId) || attemptId <= 0)) {
      return fail(res, 'Invalid verification attempt ID.', 400);
    }
    const answerValues = [q1_technical, q2_media, q3_customercare, q4_payment, q5_service_satisfaction, q6_time_satisfaction, q7_technician_behavior];
    client = await pool.connect();
    await client.query('BEGIN');
    const ticketCheck = await client.query(
      'SELECT status, office_name, zone FROM support_tickets WHERE id=$1 FOR UPDATE',
      [ticket_id]
    );
    if (!ticketCheck.rowCount) {
      await client.query('ROLLBACK');
      return notFound(res, 'Ticket not found');
    }
    if (!['closed','resolved'].includes(ticketCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      return fail(res, 'Verification is allowed only for Solved/Closed tickets.', 409);
    }

    let expectedAnswers;
    const cleanFeedback = feedback_remarks === undefined || feedback_remarks === null
      ? null
      : String(feedback_remarks).trim().substring(0, 1000) || null;
    const hasFeedbackOnlyOutcome = Boolean(cleanFeedback);
    if (answers !== undefined) {
      const categoryResult = await client.query(`SELECT cat.name AS category, t.category_id, t.is_qc_support FROM support_tickets t LEFT JOIN support_categories cat ON cat.id=t.category_id WHERE t.id=$1`, [ticket_id]);
      const categoryRow = categoryResult.rows[0] || {};
      const questionKeys = getVerificationQuestionKeys(categoryRow);
      const isAnswersObject = answers && typeof answers === 'object' && !Array.isArray(answers);
      const isFeedbackOnlyReport = hasFeedbackOnlyOutcome && (
        answers === null ||
        (isAnswersObject &&
          Object.keys(answers).every((key) => questionKeys.includes(key)) &&
          Object.values(answers).every((value) => value === null || value === undefined))
      );
      if (!isFeedbackOnlyReport && (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).some((key) => !questionKeys.includes(key)) || questionKeys.some((key) => !Object.prototype.hasOwnProperty.call(answers, key)))) {
        await client.query('ROLLBACK');
        return fail(res, 'Please answer every verification question for this category.', 400);
      }
      const invalidAnswer = !isFeedbackOnlyReport && questionKeys.some((key) => key === 'speednet_rating'
        ? !Number.isInteger(answers[key]) || answers[key] < 0 || answers[key] > 10
        : typeof answers[key] !== 'boolean');
      if (invalidAnswer) {
        await client.query('ROLLBACK');
        return fail(res, 'Invalid verification answer.', 400);
      }
      expectedAnswers = isFeedbackOnlyReport ? null : answers;
    } else if (answerValues.some((answer) => typeof answer !== 'boolean')) {
      await client.query('ROLLBACK');
      return fail(res, 'All verification questions require a yes/no answer.', 400);
    }

    const existingResult = await client.query('SELECT * FROM support_verifications WHERE ticket_id=$1 FOR UPDATE', [ticket_id]);
    const existing = existingResult.rows[0];
    if (existing && is_correction !== true) {
      await client.query('ROLLBACK');
      return fail(res, 'Verification already submitted. Explicit correction is required.', 409);
    }
    if (!existing && is_correction === true) {
      await client.query('ROLLBACK');
      return fail(res, 'No previous verification exists to correct.', 409);
    }
    let activeAttempt = null;
    if (attemptId !== null) {
      const attemptResult = await client.query(
        `SELECT id, caller_id, outcome
         FROM support_verification_call_attempts
         WHERE id = $1 AND ticket_id = $2
         FOR UPDATE`,
        [attemptId, ticket_id]
      );
      activeAttempt = attemptResult.rows[0];
      if (!activeAttempt || activeAttempt.outcome !== 'in_progress') {
        await client.query('ROLLBACK');
        return fail(res, 'This verification call attempt is no longer active.', 409);
      }
      if (Number(activeAttempt.caller_id) !== Number(req.user?.id)) {
        await client.query('ROLLBACK');
        return fail(res, 'Only the caller who started this attempt can submit it.', 403);
      }
    }

    // A comment-only correction updates the call note, not the answers already recorded.
    const legacyAnswers = answers === undefined
      ? answerValues
      : expectedAnswers
        ? answerValues
        : existing && !existing.answers
        ? [existing.q1_technical, existing.q2_media, existing.q3_customercare, existing.q4_payment,
          existing.q5_service_satisfaction, existing.q6_time_satisfaction, existing.q7_technician_behavior]
        : answerValues.map(() => null);
    const answersToSave = expectedAnswers === null && existing?.answers
      ? existing.answers
      : expectedAnswers;
    const legacyAnswerValues = [...legacyAnswers, cleanFeedback, req.user?.id || null];
    if (existing) {
      await client.query(`INSERT INTO support_verification_revisions
        (ticket_id, q1_technical, q2_media, q3_customercare, q4_payment, q5_service_satisfaction,
         q6_time_satisfaction, q7_technician_behavior, feedback_remarks, verified_by, verified_at, revised_by, answers)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [existing.ticket_id, existing.q1_technical, existing.q2_media, existing.q3_customercare, existing.q4_payment,
        existing.q5_service_satisfaction, existing.q6_time_satisfaction, existing.q7_technician_behavior,
        existing.feedback_remarks, existing.verified_by, existing.created_at, req.user?.id || null,
        existing.answers ? JSON.stringify(existing.answers) : null]);
    }
    const result = existing
      ? await client.query(`UPDATE support_verifications SET
          q1_technical=$2, q2_media=$3, q3_customercare=$4, q4_payment=$5,
          q5_service_satisfaction=$6, q6_time_satisfaction=$7, q7_technician_behavior=$8,
          feedback_remarks=$9, verified_by=$10, created_at=NOW(), answers=$11::jsonb
        WHERE ticket_id=$1 RETURNING *`, [ticket_id, ...legacyAnswerValues, answersToSave ? JSON.stringify(answersToSave) : null])
      : await client.query(`INSERT INTO support_verifications
          (ticket_id, q1_technical, q2_media, q3_customercare, q4_payment, q5_service_satisfaction,
           q6_time_satisfaction, q7_technician_behavior, feedback_remarks, verified_by, answers)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`, [ticket_id, ...legacyAnswerValues, answersToSave ? JSON.stringify(answersToSave) : null]);

    const verificationCompleted = answers === undefined || expectedAnswers !== null;
    if (activeAttempt) {
      await client.query(
        `UPDATE support_verification_call_attempts
         SET outcome = $1, note = COALESCE($2, note), ended_at = NOW()
         WHERE id = $3 AND ticket_id = $4 AND outcome = 'in_progress'`,
        [verificationCompleted ? 'completed' : 'incomplete', cleanFeedback, attemptId, ticket_id]
      );
    } else if (!hasVerificationAnswers(existing)) {
      await client.query(
        `INSERT INTO support_verification_call_attempts
          (ticket_id, caller_id, source, outcome, note, started_at, ended_at,
           caller_name_snapshot, caller_employee_id_snapshot, caller_office_snapshot, office_name_snapshot, zone_snapshot)
         VALUES ($1, $2, 'direct', $3, $4, NOW(), NOW(), $5, $6, $7, $8, $9)`,
        [
          ticket_id,
          req.user?.id || null,
          verificationCompleted ? 'completed' : 'incomplete',
          cleanFeedback,
          req.user?.full_name || req.user?.name || (req.user?.id ? `Employee #${req.user.id}` : null),
          req.user?.employee_id || null,
          req.user?.work_location || null,
          ticketCheck.rows[0].office_name || null,
          ticketCheck.rows[0].zone || null,
        ]
      );
    }

    // History event so who/when is visible on the timeline
    const v = result.rows[0];
    const yesCount = expectedAnswers ? Object.values(expectedAnswers).filter((x) => x === true).length : legacyAnswers.filter((x) => x === true).length;
    const fb = String(v.feedback_remarks || '').trim();
    const vMsg = `Verification call ${existing ? 'corrected' : 'completed'} (${expectedAnswers ? `${Object.keys(expectedAnswers).length} category answers recorded` : `${yesCount}/7 positive`})` + (fb ? ` — ${fb.substring(0, 120)}` : '');
    const vStatus = ticketCheck.rows[0].status;
    await client.query(
      `INSERT INTO support_ticket_events (ticket_id,event_type,message,old_status,new_status,metadata,created_by) VALUES ($1,'verification',$2,$3,$3,$4::jsonb,$5)`,
      [ticket_id, vMsg, vStatus, JSON.stringify({ verification_id: v.id, yes_count: yesCount, answers: expectedAnswers || null, feedback: v.feedback_remarks || null }), req.user?.id || null]
    );

    await client.query('COMMIT');
    return success(res, {
      ...result.rows[0],
      verification_completed: hasVerificationAnswers(result.rows[0]),
    });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    return serverError(res, error);
  } finally {
    if (client) client.release();
  }
};

// --- Mobile device tokens (FCM push) ---
const registerDeviceToken = async (req, res) => {
  try {
    const { fcm_token, platform } = req.body || {};
    if (!fcm_token || !String(fcm_token).trim()) return fail(res, 'fcm_token is required', 400);
    const pushSvc = require('../utilities/pushService');
    await pushSvc.registerDeviceToken(req.user.id, fcm_token, platform);
    return success(res, { message: 'Device registered', push_configured: pushSvc.isPushConfigured() });
  } catch (error) { return serverError(res, error); }
};

const unregisterDeviceToken = async (req, res) => {
  try {
    const { fcm_token } = req.body || {};
    if (!fcm_token || !String(fcm_token).trim()) return fail(res, 'fcm_token is required', 400);
    // Scoped delete: a user can only remove their OWN token (prevents deleting others' tokens)
    await pool.query('DELETE FROM device_tokens WHERE fcm_token=$1 AND user_id=$2', [String(fcm_token).trim(), Number(req.user.id)]);
    return success(res, { message: 'Device unregistered' });
  } catch (error) { return serverError(res, error); }
};

// --- SMS Portal & Template Handlers ---
// System auto-SMS formats (ticket created / assigned / status change).
// Editable from SMS Portal; {placeholders} are filled at send time.
const SYSTEM_SMS_DEFAULTS = {
  ticket_created_customer: 'Your support ticket {ticket_no} created. SpeedNet will contact you soon.',
  ticket_assigned_technician: 'SpeedNet New Ticket {ticket_no} [{priority}]\nPPPoE:{pppoe} Mob:{phone}\nOLT:{olt}\nAddr:{address}\nIssue:{subject}\nNote:{description}\nPlz call customer & update portal.',
  ticket_status_customer: 'Your support ticket {ticket_no} is now {status}. SpeedNet - Thank you.',
};
const renderSystemSms = async (key, vars = {}) => {
  const fallback = SYSTEM_SMS_DEFAULTS[key] || '';
  try {
    const r = await pool.query('SELECT message_body FROM sms_templates WHERE template_name=$1 LIMIT 1', [key]);
    const tpl = r.rows[0]?.message_body || fallback;
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
  } catch {
    return String(fallback).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
  }
};
const validateSmsTemplate = (body) => {
  const name = body?.template_name !== undefined && body?.template_name !== null ? String(body.template_name).trim() : '';
  const msg = body?.message_body !== undefined && body?.message_body !== null ? String(body.message_body).trim() : '';
  if (!name) return { error: 'Template name is required' };
  if (name.length > 100) return { error: 'Template name must be <= 100 chars' };
  if (!msg) return { error: 'Message body is required' };
  if (msg.length > 1000) return { error: 'Message body must be <= 1000 chars' };
  return { values: { template_name: name, message_body: msg } };
};
const getSmsTemplates = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM sms_templates ORDER BY id DESC LIMIT 200`);
    return success(res, result.rows);
  } catch (error) { return serverError(res, error); }
};

const createSmsTemplate = async (req, res) => {
  try {
    const v = validateSmsTemplate(req.body);
    if (v.error) return fail(res, v.error, 400);
    // 'System' type is reserved for seed rows — creators cannot mint
    // undeletable System rows. template_type from body is ignored.
    const { template_type = 'Custom' } = req.body || {};

    const result = await pool.query(`INSERT INTO sms_templates (template_name, template_type, message_body, created_by)
      VALUES ($1, $2, $3, $4) RETURNING *`, [v.values.template_name, 'Custom', v.values.message_body, req.user?.id || null]);
    return success(res, result.rows[0], 201);
  } catch (error) { return serverError(res, error); }
};

const deleteSmsTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return fail(res, 'Invalid template ID', 400);
    const existing = await pool.query('SELECT template_type FROM sms_templates WHERE id=$1', [id]);
    if (!existing.rowCount) return notFound(res, 'Template not found');
    if (existing.rows[0].template_type === 'System') return fail(res, 'System auto-SMS format cannot be deleted (you can edit it).', 400);
    const result = await pool.query(`DELETE FROM sms_templates WHERE id=$1 RETURNING id`, [id]);
    if (!result.rowCount) return notFound(res, 'Template not found');
    return success(res, { message: 'Template deleted' });
  } catch (error) { return serverError(res, error); }
};

const updateSmsTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return fail(res, 'Invalid template ID', 400);
    const v = validateSmsTemplate(req.body);
    if (v.error) return fail(res, v.error, 400);
    const { template_type = 'Custom' } = req.body || {};
    const existing = await pool.query('SELECT id, template_name, template_type FROM sms_templates WHERE id=$1', [id]);
    if (!existing.rowCount) return notFound(res, 'Template not found');
    // Custom rows stay Custom: promoting to System would make them
    // undeletable (deleteSmsTemplate refuses System rows).
    if (existing.rows[0].template_type !== 'System' && String(template_type).trim() === 'System') {
      return fail(res, 'template_type System is reserved.', 400);
    }
    if (existing.rows[0].template_type === 'System') {
      if (v.values.template_name !== existing.rows[0].template_name) return fail(res, 'System template name cannot be changed.', 400);
      if (String(template_type).trim() && String(template_type).trim() !== 'System') return fail(res, 'System template type cannot be changed.', 400);
    }
    const result = await pool.query(
      `UPDATE sms_templates SET template_name=$1, template_type=$2, message_body=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [v.values.template_name, String(template_type).trim() || 'Custom', v.values.message_body, id]
    );
    return success(res, result.rows[0]);
  } catch (error) { return serverError(res, error); }
};

const getSmsTemplate = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return fail(res, 'Invalid template ID', 400);
    const result = await pool.query('SELECT * FROM sms_templates WHERE id=$1', [id]);
    if (!result.rowCount) return notFound(res, 'Template not found');
    return success(res, result.rows[0]);
  } catch (error) { return serverError(res, error); }
};

const addTicketComment = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return fail(res, 'Invalid ticket ID');
    const { comment, is_internal } = req.body || {};
    if (!comment || !String(comment).trim()) return fail(res, 'Comment is required');
    const ticket = await pool.query('SELECT id, customer_id, status FROM support_tickets WHERE id=$1', [ticketId]);
    if (!ticket.rowCount) return notFound(res, 'Ticket not found');
    if (TERMINAL_STATUSES.has(ticket.rows[0].status)) {
      return fail(res, `Cannot comment on ${ticket.rows[0].status} ticket. Reopen first.`, 409);
    }
    const row = await pool.query(
      `INSERT INTO support_ticket_comments (ticket_id, customer_id, comment, is_internal, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ticketId, ticket.rows[0].customer_id, String(comment).trim(), !!is_internal, req.user?.id || null]
    );
    const enriched = await pool.query(
      `SELECT c.*, u.full_name AS created_by_name FROM support_ticket_comments c LEFT JOIN users u ON u.id=c.created_by WHERE c.id=$1`,
      [row.rows[0].id]
    );
    return success(res, enriched.rows[0]);
  } catch (error) { return serverError(res, error); }
};

const listTicketComments = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return fail(res, 'Invalid ticket ID');
    const ticket = await pool.query('SELECT id, customer_id FROM support_tickets WHERE id=$1', [ticketId]);
    if (!ticket.rowCount) return notFound(res, 'Ticket not found');
    const comments = await pool.query(
      `SELECT c.*, u.full_name AS created_by_name, 'comment'::text AS kind FROM support_ticket_comments c LEFT JOIN users u ON u.id=c.created_by WHERE c.ticket_id=$1 ORDER BY c.created_at ASC, c.id ASC`,
      [ticketId]
    );
    const events = await pool.query(
      `SELECT e.*, u.full_name AS created_by_name, 'event'::text AS kind FROM support_ticket_events e LEFT JOIN users u ON u.id=e.created_by WHERE e.ticket_id=$1 ORDER BY e.created_at ASC, e.id ASC`,
      [ticketId]
    );
    const verifications = await pool.query(`SELECT v.*, u.full_name AS verified_by_name FROM support_verifications v LEFT JOIN users u ON u.id=v.verified_by WHERE v.ticket_id=$1`, [ticketId]);
    const timeline = [...comments.rows, ...events.rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return success(res, { comments: comments.rows, events: events.rows, verifications: verifications.rows, timeline });
  } catch (error) { return serverError(res, error); }
};

// Work photo attached from the technician mobile app (multer puts the file
// on req.file; route-level requireOwnTicket scopes techs to their tickets).
const addTicketAttachment = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return fail(res, 'Invalid ticket ID');
    if (!req.file) return fail(res, 'Photo file is required (field: photo)', 400);
    const ticket = await pool.query('SELECT id, status FROM support_tickets WHERE id=$1', [ticketId]);
    if (!ticket.rowCount) return notFound(res, 'Ticket not found');
    if (TERMINAL_STATUSES.has(ticket.rows[0].status)) {
      return fail(res, `Cannot attach photo to ${ticket.rows[0].status} ticket. Reopen first.`, 409);
    }
    const row = await pool.query(
      `INSERT INTO ticket_attachments (ticket_id, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ticketId, req.file.originalname || req.file.filename, `/uploads/ticket_attachments/${req.file.filename}`,
       req.file.size || null, req.file.mimetype || null, req.user?.id || null]
    );
    await pool.query(
      `INSERT INTO support_ticket_events (ticket_id, event_type, message, created_by) VALUES ($1,'note',$2,$3)`,
      [ticketId, `Photo attached: ${req.file.originalname || req.file.filename}`, req.user?.id || null]
    );
    // Respond with the authenticated serve path (not the direct /uploads public path)
    const served = { ...row.rows[0], file_path: `/api/support/tickets/${ticketId}/attachments/${req.file.filename}` };
    return success(res, served, 201);
  } catch (error) { return serverError(res, error); }
};

// Authenticated attachment serve (replaces direct-public /uploads/ticket_attachments).
// Route-level requireOwnTicket scopes techs; filename strictly whitelisted.
const ATTACHMENT_FILE_RE = /^ticket-\d+-\d+\.(jpg|png|webp|gif)$/;
const getTicketAttachment = async (req, res) => {
  try {
    const ticketId = parseInt(req.params.id, 10);
    if (isNaN(ticketId)) return fail(res, 'Invalid ticket ID', 400);
    const file = String(req.params.file || '');
    if (!ATTACHMENT_FILE_RE.test(file)) return fail(res, 'Invalid attachment filename', 400);
    const att = await pool.query(
      `SELECT file_path FROM ticket_attachments WHERE ticket_id=$1`, [ticketId]
    );
    const names = att.rows.map((r) => String(r.file_path || '').split('/').pop());
    if (!names.includes(file)) return notFound(res, 'Attachment not found.');
    const path = require('path');
    const fs = require('fs');
    const abs = path.join(__dirname, '..', 'uploads', 'ticket_attachments', file);
    if (!fs.existsSync(abs)) return notFound(res, 'Attachment not found.');
    const ext = file.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    res.set('Content-Type', mime);
    res.set('Content-Disposition', 'inline');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, no-cache, must-revalidate');
    return res.sendFile(abs);
  } catch (error) { return serverError(res, error); }
};

const listCustomerComments = async (req, res) => {
  try {
    const customerId = parseInt(req.params.customerId, 10);
    if (isNaN(customerId)) return fail(res, 'Invalid customer ID');
    const officeScope = req.supportOfficeScope || resolveSupportOffice(req.user);
    if (!officeScope) return fail(res, 'Your work location is not configured for support ticket access.', 403);
    // Field technicians may only read customers they are assigned to —
    // otherwise any viewer could pull arbitrary customers' full history.
    if (isFieldTechnician(req.user)) {
      const ownParams = [customerId, req.user.id];
      const ownWhere = ['customer_id=$1', 'assigned_to=$2'];
      appendSupportOfficeScope(ownWhere, ownParams, officeScope);
      const own = await pool.query(
        `SELECT 1 FROM support_tickets t WHERE ${ownWhere.join(' AND ')} LIMIT 1`,
        ownParams
      );
      if (!own.rowCount) return fail(res, 'Access denied: customer is not assigned to you', 403);
    }
    const commentParams = [customerId];
    const commentWhere = ['c.customer_id=$1'];
    appendSupportOfficeScope(commentWhere, commentParams, officeScope, 't');
    const rows = await pool.query(
      `SELECT c.*, t.ticket_no, t.status, t.subject, u.full_name AS created_by_name
       FROM support_ticket_comments c
       LEFT JOIN support_tickets t ON t.id=c.ticket_id
       LEFT JOIN users u ON u.id=c.created_by
       WHERE ${commentWhere.join(' AND ')} ORDER BY c.created_at DESC LIMIT 100`,
      commentParams
    );
    // also include ticket-level history for the customer
    const ticketParams = [customerId];
    const ticketWhere = ['t.customer_id=$1'];
    appendSupportOfficeScope(ticketWhere, ticketParams, officeScope);
    const tickets = await pool.query(
      `SELECT t.id, t.ticket_no, t.status, t.subject, t.description, t.resolution_note,
              t.priority, t.office_name, t.created_at, t.resolved_at, t.closed_at,
              t.is_on_call, t.resolution_type,
              creator.full_name AS created_by_name, technician.full_name AS assigned_to_name,
              category.name_bn AS category_name
       FROM support_tickets t
       LEFT JOIN users creator ON creator.id=t.created_by
       LEFT JOIN users technician ON technician.id=t.assigned_to
       LEFT JOIN support_categories category ON category.id=t.category_id
       WHERE ${ticketWhere.join(' AND ')} ORDER BY t.created_at ASC, t.id ASC LIMIT 20`,
      ticketParams
    );
    const openTicketParams = [customerId];
    const openTicketWhere = ['t.customer_id=$1', `t.status NOT IN ('closed','resolved','cancelled')`];
    appendSupportOfficeScope(openTicketWhere, openTicketParams, officeScope);
    const openTickets = await pool.query(
      `SELECT t.id, t.ticket_no, t.status, t.created_at, (COUNT(*) OVER ())::int AS total_count
       FROM support_tickets t WHERE ${openTicketWhere.join(' AND ')}
       ORDER BY t.created_at DESC, t.id DESC LIMIT 5`,
      openTicketParams
    );
    const eventParams = [customerId];
    const eventWhere = ['st.customer_id=$1'];
    appendSupportOfficeScope(eventWhere, eventParams, officeScope, 'st');
    const events = await pool.query(
      `SELECT e.*, t.ticket_no, u.full_name AS created_by_name FROM support_ticket_events e
       LEFT JOIN support_tickets t ON t.id=e.ticket_id
       LEFT JOIN users u ON u.id=e.created_by
       WHERE e.ticket_id IN (SELECT st.id FROM support_tickets st WHERE ${eventWhere.join(' AND ')}) ORDER BY e.created_at ASC LIMIT 100`,
      eventParams
    );
    return success(res, { comments: rows.rows, tickets: tickets.rows, open_tickets: openTickets.rows, events: events.rows });
  } catch (error) { return serverError(res, error); }
};

const listSmsLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitRaw = parseInt(req.query.limit, 10) || 50;
    const limit = Math.min(200, Math.max(1, limitRaw));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const params = [];
    let whereSql = '';
    if (q) {
      params.push(`%${escapeLike(q)}%`);
      whereSql = `WHERE recipient_phone ILIKE $1 ESCAPE '\\'`;
    }
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM sms_logs ${whereSql}`, params),
      pool.query(`SELECT * FROM sms_logs ${whereSql} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    ]);
    const total = countRes.rows[0].total;
    return success(res, { rows: dataRes.rows, total, page, limit });
  } catch (error) { return serverError(res, error); }
};

// Prepaid gateway credit for the configured SID (cached 5 min server-side).
// Lets the portal surface "balance zero" BEFORE sending, since the gateway
// answers SUCCESS even with no credit (nothing gets delivered).
const getSmsBalance = async (req, res) => {
  try {
    const { getSmsBalance: fetchBalance } = require('../utilities/smsService');
    const result = await fetchBalance({ force: req.query.refresh === '1' });
    return success(res, result);
  } catch (error) { return serverError(res, error); }
};

const sendSmsPortal = async (req, res) => {
  try {
    const { send_to, message_body } = req.body || {};
    if (!send_to || !message_body) return fail(res, 'Phone number and message are required');
    const dest = String(send_to).trim();
    if (!isValidBdMobile(dest)) return fail(res, 'Invalid BD mobile number. Use 01XXXXXXXXX format.', 400);
    if (String(message_body).trim().length > 1000) return fail(res, 'Message body must be <= 1000 chars.', 400);
    const { sendSms, getSmsBalance } = require('../utilities/smsService');
    // Fail fast on zero balance: the gateway still answers SUCCESS but
    // delivers nothing (seen 2026-10-15), so block with a clear message.
    try {
      const bal = await getSmsBalance();
      if (bal.available && Number(bal.balance) <= 0) {
        await pool.query(`INSERT INTO sms_logs (recipient_phone, message_body, status, sent_by)
          VALUES ($1, $2, $3, $4)`, [dest, String(message_body).trim(), 'Blocked: zero balance', req.user?.id || null]);
        return fail(res, 'SMS balance is zero. Please recharge the SPEEDNET account, then try again.', 402);
      }
    } catch {}
    const result = await sendSms({ msisdn: dest, sms: String(message_body).trim() });
    const status = (result.success ? 'Sent' : `Failed: ${result.data?.error_message || result.error || 'Unknown'}`).substring(0, 50);
    const log = await pool.query(`INSERT INTO sms_logs (recipient_phone, message_body, status, sent_by)
      VALUES ($1, $2, $3, $4) RETURNING *`, [dest, String(message_body).trim(), status, req.user?.id || null]);
    if (!result.success) return fail(res, 'SMS failed. Please try again later.', 500);
    return success(res, { success: true, message: 'SMS Sent Successfully', log: log.rows[0], provider: { csms_id: result.csms_id || null, msisdn: result.msisdn || null } });
  } catch (error) { return serverError(res, error); }
};

// --- WhatsApp sender numbers (login maintenance dashboard) ---
const getWhatsAppSessions = async (req, res) => {
  try {
    const { getSessionState } = require('../utilities/whatsappWorkerQueue');
    const [leave, support] = await Promise.all([getSessionState('leave'), getSessionState('support')]);
    return success(res, { sessions: { leave, support } });
  } catch (error) { return serverError(res, error); }
};
const reconnectWhatsAppSession = async (req, res) => {
  try {
    const session = String(req.body?.session || req.query?.session || 'support').trim();
    if (!['leave', 'support'].includes(session)) return fail(res, 'Invalid session (leave/support)', 400);
    const { enqueueJob } = require('../utilities/whatsappWorkerQueue');
    const job = await enqueueJob('ensure_session', { session }, session);
    return success(res, { message: `${session} WhatsApp connect queued`, jobId: job.id });
  } catch (error) { return serverError(res, error); }
};
// Unlink the sender device (logout + clear auth) so a different number can
// link next. Queued per-session like reconnect; worker pushes fresh state.
const disconnectWhatsAppSession = async (req, res) => {
  try {
    const session = String(req.body?.session || req.query?.session || 'support').trim();
    if (!['leave', 'support'].includes(session)) return fail(res, 'Invalid session (leave/support)', 400);
    const { enqueueJob } = require('../utilities/whatsappWorkerQueue');
    const job = await enqueueJob('disconnect_session', { session }, session);
    return success(res, { message: `${session} WhatsApp disconnect queued`, jobId: job.id });
  } catch (error) { return serverError(res, error); }
};

const syncMikrotik = async (req, res) => {
  try {
    const result = await syncConfiguredDevices();
    // Partial shape (Agent A contract): { synced, failed }. All-fail keeps the
    // old 503 behavior; partial success returns 200 with a warning.
    if (result && typeof result === 'object' && !Array.isArray(result) && ('synced' in result || 'failed' in result)) {
      const synced = Array.isArray(result.synced) ? result.synced : [];
      const failed = Array.isArray(result.failed) ? result.failed : [];
      if (failed.length && !synced.length) {
        return fail(res, `MikroTik sync failed for all ${failed.length} router(s).`, 503, { failed });
      }
      if (failed.length) {
        return success(res, { synced, failed, warning: `${failed.length} of ${synced.length + failed.length} router(s) failed to sync.` });
      }
      return success(res, result);
    }
    return success(res, result);
  } catch (error) { console.error('[MikroTik] sync failed:', error); return fail(res, 'MikroTik sync failed. Please try again later.', 503); }
};
const getSyncRuns = async (req, res) => {
  try {
    const routerId = String(req.query.router_id || req.query.routerId || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitRaw = parseInt(req.query.limit, 10) || 30;
    const limit = Math.min(200, Math.max(1, limitRaw));
    const offset = (page - 1) * limit;
    const params = [];
    const where = [];
    if (routerId) {
      params.push(routerId);
      where.push(`router_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRes, r] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM mikrotik_sync_runs ${whereSql}`, params),
      pool.query(`SELECT router_id,status,records_seen,records_synced,error_message,started_at,completed_at
        FROM mikrotik_sync_runs ${whereSql} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]),
    ]);
    const total = countRes.rows[0].total;
    if (req.query.page || req.query.limit || routerId) {
      return success(res, { rows: r.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    }
    return success(res, r.rows);
  } catch (error) { return serverError(res, error); }
};

// Mobile app config (any authenticated user, no permission check).
// Env-driven; defaults match technician-app/app.json version '1.0.0'.
const getAppConfig = async (req, res) => {
  try {
    const DEFAULT_VERSION = '1.0.0';
    const minVersion = String(process.env.MIN_APP_VERSION || '').trim() || DEFAULT_VERSION;
    return success(res, {
      min_version: minVersion,
      latest_version: String(process.env.LATEST_APP_VERSION || '').trim() || minVersion,
      apk_url: String(process.env.APP_APK_URL || '').trim() || null,
      message: String(process.env.APP_MESSAGE || '').trim() || null,
    });
  } catch (error) { return serverError(res, error); }
};

module.exports = { 
  searchCustomers, listTickets, getDashboard, getMySummary, createTicket, getTicket, updateTicket, deleteTicket,
  revertSolvedTicket,
  log3cxCallHandoff,
  addTicketComment, listTicketComments, listCustomerComments, addTicketAttachment, getTicketAttachment,
  submitWorkReport, reviewWorkReport,
  saveVerificationCall, registerDeviceToken, unregisterDeviceToken,
  getSmsTemplates, getSmsTemplate, createSmsTemplate, updateSmsTemplate, deleteSmsTemplate, sendSmsPortal, listSmsLogs, getSmsBalance,
  getWhatsAppSessions, reconnectWhatsAppSession, disconnectWhatsAppSession,
  syncMikrotik, getSyncRuns, getAppConfig 
};
