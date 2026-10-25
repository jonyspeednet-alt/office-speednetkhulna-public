// routeVisitController.js — Offline marketing Route Visit module (ISP standard) v2
// Per-type dynamic fields: common columns + details JSONB + promoted money/date columns.
// Tables: marketing_routes, marketing_visits, marketing_targets (see migrations/20261009_route_visit_module.sql
// + 20261010_rv_pertype_fields.sql). Runtime ensure-schema is the primary creator (migrations are gitignored).
// Pattern: auth-only CRUD + ownership scoping; verify/targets gated on route_visit.verify.

const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

const VISIT_TYPES = new Set(['prospect', 'survey', 'close', 'form', 'bill_submit', 'bill_collect', 'corporate', 'branding', 'competitor']);
const OUTCOMES = new Set(['pending', 'interested', 'hot', 'closed', 'lost', 'done']);
const STATUSES = new Set(['pending', 'verified', 'rejected']);
const PURPOSES = new Set(['sales', 'branding', 'collection', 'corporate', 'other']);

// Per-type rules: required flat-body keys, allowed outcomes, photo gate, auto-set columns.
const TYPE_RULES = {
  prospect: { outcomes: ['pending', 'interested', 'hot', 'lost'], required: ['decision_maker', 'package_discussed'], photo: false },
  survey: { outcomes: ['done', 'lost'], required: ['nearest_ot_dp', 'fiber_distance_m', 'pole_count', 'feasibility'], photo: true },
  close: { outcomes: ['closed'], forceOutcome: 'closed', required: ['package_selected', 'advance_paid', 'installation_date'], photoIfAdvance: true, auto: { day_sale: 1 } },
  form: { outcomes: ['done'], forceOutcome: 'done', required: ['form_serial_no', 'nid_number'], photo: true, auto: { forms_filled: 1 } },
  bill_submit: { outcomes: ['done'], forceOutcome: 'done', required: ['bill_month', 'bill_amount', 'submitted_to'], photo: true },
  bill_collect: { outcomes: ['done', 'pending'], required: ['bill_month', 'amount_due', 'collection_amount', 'receipt_no', 'payment_mode'], photo: true },
  corporate: { outcomes: ['pending', 'interested', 'hot', 'closed', 'lost'], required: ['contact_person', 'requirement', 'deal_value', 'mou_stage', 'followup_date'], photo: false },
  branding: {
    outcomes: ['done'], forceOutcome: 'done', required: ['branding_subtype'], photo: true,
    subtypeRequired: {
      leaflet: ['leaflet_qty'],
      banner: ['banner_qty', 'install_location'],
      miking: ['miking_hours', 'miking_area'],
      booth: ['booth_location', 'booth_hours'],
      wall_paint: ['wall_count', 'wall_location'],
    },
  },
  competitor: { outcomes: ['done'], forceOutcome: 'done', required: ['competitor_name', 'competitor_price'], photo: true },
};
const BRANDING_SUBTYPES = new Set(['leaflet', 'banner', 'miking', 'booth', 'wall_paint']);

// Long-tail per-type keys packed into details JSONB (write-once/read-rare).
const DETAIL_KEYS = new Set([
  'current_isp', 'monthly_budget', 'decision_maker', 'building_type',
  'nearest_ot_dp', 'fiber_distance_m', 'pole_count', 'cable_needed_m', 'install_estimate',
  'pay_method', 'onu_router', 'form_serial_no', 'nid_number', 'docs_nid', 'docs_photo', 'docs_bill', 'applicant_matches_nid',
  'submitted_to', 'submission_ref', 'amount_due', 'due_left',
  'contact_person', 'contact_designation', 'contact_email', 'users_count', 'requirement', 'mou_stage', 'mou_no', 'expected_close_date',
  'competitor_name', 'competitor_package', 'competitor_price', 'competitor_install', 'competitor_offer', 'competitor_source',
  'branding_subtype', 'miking_hours', 'miking_area', 'booth_location', 'booth_hours', 'leads_collected',
  'wall_count', 'wall_location', 'wall_sqft', 'banner_size', 'install_location',
]);

// Runtime safety net: migration is primary, this keeps fresh envs working (idempotent).
let schemaReadyPromise = null;
const ensureRouteVisitSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS marketing_routes (
        id BIGSERIAL PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        route_date DATE NOT NULL, area TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'sales', target_visits INTEGER NOT NULL DEFAULT 0,
        plan_text TEXT NOT NULL DEFAULT '', created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(staff_id, route_date, area))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketing_visits (
        id BIGSERIAL PRIMARY KEY, route_id BIGINT NULL REFERENCES marketing_routes(id) ON DELETE SET NULL,
        staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        customer_id INTEGER NULL, visit_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Dhaka')::date,
        area TEXT NOT NULL, shop_name TEXT NOT NULL DEFAULT '', owner_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
        visit_type TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'pending',
        package_discussed TEXT NOT NULL DEFAULT '', leaflet_qty INTEGER NOT NULL DEFAULT 0,
        banner_qty INTEGER NOT NULL DEFAULT 0, forms_filled INTEGER NOT NULL DEFAULT 0,
        day_sale INTEGER NOT NULL DEFAULT 0, collection_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        photo_url TEXT NULL, gps_lat DOUBLE PRECISION NULL, gps_lng DOUBLE PRECISION NULL,
        followup_date DATE NULL, lost_reason TEXT NULL, competitor_note TEXT NOT NULL DEFAULT '',
        verified_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL, verified_at TIMESTAMPTZ NULL,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      // v2 additive columns (idempotent — safe on tables created by v1).
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS bill_month TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS bill_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS receipt_no TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS package_selected TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS advance_paid NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS installation_date DATE NULL`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS feasibility TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS branding_subtype TEXT NOT NULL DEFAULT ''`);
      await pool.query(`ALTER TABLE marketing_visits ADD COLUMN IF NOT EXISTS deal_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketing_targets (
        id BIGSERIAL PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month CHAR(7) NOT NULL, target_visits INTEGER NOT NULL DEFAULT 0, target_leads INTEGER NOT NULL DEFAULT 0,
        target_closes INTEGER NOT NULL DEFAULT 0, target_collection NUMERIC(14,2) NOT NULL DEFAULT 0,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(staff_id, month))`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rv_visits_date_staff ON marketing_visits(visit_date, staff_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rv_visits_status ON marketing_visits(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rv_visits_followup ON marketing_visits(followup_date) WHERE followup_date IS NOT NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rv_visits_type ON marketing_visits(visit_type)`);
    })().catch((e) => { schemaReadyPromise = null; throw e; });
  }
  return schemaReadyPromise;
};

const canVerify = (user) =>
  resolvePermission(user, 'route_visit.verify') || resolvePermission(user, 'route_visit.manage');

// Convert Bengali digits to ASCII for phone/numbers (rule 10).
const bnToEn = (v) => String(v ?? '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const toCoord = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toInt = (v, d = 0) => { const n = parseInt(bnToEn(v), 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const toNum = (v, d = 0) => { const n = parseFloat(bnToEn(v)); return Number.isFinite(n) && n >= 0 ? n : d; };
const isPresent = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const scopeStaff = (req) => {
  // Managers (verify perm) may query any staff; field staff see only own rows.
  if (canVerify(req.user)) return null;
  return req.user.id;
};

const validateVisitInput = (b, photoUrl) => {
  if (!b || !String(b.area || '').trim()) return 'area is required';
  if (!VISIT_TYPES.has(b.visit_type)) return 'valid visit_type is required (9 fixed types)';
  const rule = TYPE_RULES[b.visit_type];
  const outcome = rule.forceOutcome || b.outcome || 'pending';
  if (!OUTCOMES.has(outcome)) return 'invalid outcome';
  if (!rule.outcomes.includes(outcome)) return `outcome '${outcome}' not allowed for ${b.visit_type}`;
  for (const k of rule.required) {
    if (!isPresent(b[k])) return `${k} is required for ${b.visit_type}`;
  }
  if (b.visit_type === 'branding' && isPresent(b.branding_subtype)) {
    if (!BRANDING_SUBTYPES.has(b.branding_subtype)) return 'invalid branding_subtype';
    for (const k of (rule.subtypeRequired[b.branding_subtype] || [])) {
      if (!isPresent(b[k])) return `${k} is required for branding/${b.branding_subtype}`;
    }
  }
  if (outcome === 'hot' && !b.followup_date) return 'hot lead needs followup_date';
  if (outcome === 'lost' && !String(b.lost_reason || '').trim()) return 'lost lead needs lost_reason';
  if (rule.photo && !photoUrl) return `Photo proof is required for ${b.visit_type}`;
  if (rule.photoIfAdvance && toNum(b.advance_paid) > 0 && !photoUrl) return 'Money-receipt photo is required when advance is paid';
  if ((toNum(b.collection_amount) > 0 || toInt(b.leaflet_qty) + toInt(b.banner_qty) > 0) && !photoUrl) {
    return 'Photo proof is required for collection/branding quantities';
  }
  return null;
};

const photoUrlFromReq = (req, bodyPhoto) => {
  if (req.body && req.body.imageFilename) return `/uploads/route_visits/${req.body.imageFilename}`;
  if (bodyPhoto && String(bodyPhoto).trim()) return String(bodyPhoto).trim();
  return null;
};

// Pack long-tail keys into details; compute due_left for bill_collect.
const collectDetails = (b) => {
  const d = {};
  for (const k of DETAIL_KEYS) {
    if (isPresent(b[k])) d[k] = String(b[k]).trim();
  }
  if (b.visit_type === 'bill_collect' && isPresent(b.amount_due)) {
    d.due_left = String(Math.max(0, toNum(b.amount_due) - toNum(b.collection_amount)));
  }
  return d;
};

// ── Routes (plans) ────────────────────────────────────────────
const listRoutes = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const { from, to, staff_id } = req.query;
    const own = scopeStaff(req);
    const conds = [];
    const vals = [];
    if (own) { vals.push(own); conds.push(`r.staff_id = $${vals.length}`); }
    else if (staff_id) { vals.push(Number(staff_id)); conds.push(`r.staff_id = $${vals.length}`); }
    if (from) { vals.push(from); conds.push(`r.route_date >= $${vals.length}`); }
    if (to) { vals.push(to); conds.push(`r.route_date <= $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT r.*, u.full_name AS staff_name FROM marketing_routes r
       LEFT JOIN users u ON u.id = r.staff_id ${where} ORDER BY r.route_date DESC, r.id DESC LIMIT 500`, vals);
    res.json(rows);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const createRoute = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const { route_date, area, purpose = 'sales', target_visits = 0, plan_text = '', staff_id } = req.body || {};
    if (!route_date || !String(area || '').trim()) return res.status(400).json({ message: 'route_date and area are required' });
    if (purpose && !PURPOSES.has(purpose)) return res.status(400).json({ message: 'Invalid purpose' });
    const owner = canVerify(req.user) && staff_id ? Number(staff_id) : req.user.id;
    const { rows } = await pool.query(
      `INSERT INTO marketing_routes (staff_id, route_date, area, purpose, target_visits, plan_text, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (staff_id, route_date, area) DO UPDATE SET purpose=EXCLUDED.purpose,
         target_visits=EXCLUDED.target_visits, plan_text=EXCLUDED.plan_text RETURNING *`,
      [owner, route_date, String(area).trim(), purpose, toInt(target_visits), String(plan_text || ''), req.user.id]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

// ── Visits ────────────────────────────────────────────────────
const listVisits = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const { from, to, area, staff_id, status, visit_type } = req.query;
    const own = scopeStaff(req);
    const conds = [];
    const vals = [];
    if (own) { vals.push(own); conds.push(`v.staff_id = $${vals.length}`); }
    else if (staff_id) { vals.push(Number(staff_id)); conds.push(`v.staff_id = $${vals.length}`); }
    if (from) { vals.push(from); conds.push(`v.visit_date >= $${vals.length}`); }
    if (to) { vals.push(to); conds.push(`v.visit_date <= $${vals.length}`); }
    if (area) { vals.push(area); conds.push(`v.area = $${vals.length}`); }
    if (status && STATUSES.has(status)) { vals.push(status); conds.push(`v.status = $${vals.length}`); }
    if (visit_type && VISIT_TYPES.has(visit_type)) { vals.push(visit_type); conds.push(`v.visit_type = $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT v.*, u.full_name AS staff_name FROM marketing_visits v
       LEFT JOIN users u ON u.id = v.staff_id ${where} ORDER BY v.visit_date DESC, v.id DESC LIMIT 1000`, vals);
    res.json(rows);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const createVisit = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const b = req.body || {};
    const photoUrl = photoUrlFromReq(req, b.photo_url);
    const err = validateVisitInput(b, photoUrl);
    if (err) return res.status(400).json({ message: err });
    const rule = TYPE_RULES[b.visit_type];
    const outcome = rule.forceOutcome || b.outcome || 'pending';
    const auto = rule.auto || {};
    const owner = canVerify(req.user) && b.staff_id ? Number(b.staff_id) : req.user.id;
    const { rows } = await pool.query(
      `INSERT INTO marketing_visits (route_id, staff_id, customer_id, visit_date, area, shop_name, owner_name, phone,
        address, visit_type, outcome, package_discussed, leaflet_qty, banner_qty, forms_filled, day_sale,
        collection_amount, photo_url, gps_lat, gps_lng, followup_date, lost_reason, competitor_note,
        details, bill_month, bill_amount, receipt_no, payment_mode, package_selected, advance_paid,
        installation_date, feasibility, branding_subtype, deal_value, created_by)
       VALUES ($1,$2,$3,COALESCE($4,(NOW() AT TIME ZONE 'Asia/Dhaka')::date),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       RETURNING *`,
      [b.route_id || null, owner, b.customer_id || null, b.visit_date || null, String(b.area).trim(),
        String(b.shop_name || '').trim(), String(b.owner_name || '').trim(), bnToEn(b.phone || '').trim(),
        String(b.address || '').trim(), b.visit_type, outcome, String(b.package_discussed || ''),
        toInt(b.leaflet_qty), toInt(b.banner_qty), toInt(b.forms_filled, auto.forms_filled || 0), toInt(b.day_sale, auto.day_sale || 0),
        toNum(b.collection_amount), photoUrl, toCoord(b.gps_lat), toCoord(b.gps_lng),
        b.followup_date || null, b.lost_reason ? String(b.lost_reason).trim() : null,
        String(b.competitor_note || '').trim(), JSON.stringify(collectDetails(b)),
        String(b.bill_month || '').trim(), toNum(b.bill_amount), String(b.receipt_no || '').trim(),
        String(b.payment_mode || '').trim(), String(b.package_selected || '').trim(), toNum(b.advance_paid),
        b.installation_date || null, String(b.feasibility || '').trim(), String(b.branding_subtype || '').trim(),
        toNum(b.deal_value), req.user.id]);
    // Rule 8: duplicate phone warning (non-blocking).
    let warning = null;
    if (rows[0].phone) {
      const dup = await pool.query(`SELECT COUNT(*)::int c FROM marketing_visits WHERE phone = $1 AND id <> $2`, [rows[0].phone, rows[0].id]);
      if (dup.rows[0].c > 0) warning = { duplicate_phone: true, prior_visits: dup.rows[0].c };
    }
    res.status(201).json({ ...rows[0], warning });
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const updateVisit = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const id = Number(req.params.id);
    const cur = await pool.query(`SELECT * FROM marketing_visits WHERE id = $1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Not found' });
    const row = cur.rows[0];
    const manager = canVerify(req.user);
    if (!manager && row.staff_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    if (!manager && row.status === 'verified') return res.status(403).json({ message: 'Verified visit is locked' });
    const b = { ...row, ...(req.body || {}) };
    // details merge: keep old keys not re-sent.
    let oldDetails = {};
    try { oldDetails = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}); } catch { oldDetails = {}; }
    const photoUrl = photoUrlFromReq(req, b.photo_url) || row.photo_url;
    const err = validateVisitInput(b, photoUrl);
    if (err) return res.status(400).json({ message: err });
    const rule = TYPE_RULES[b.visit_type];
    const outcome = rule.forceOutcome || b.outcome || 'pending';
    const mergedDetails = { ...oldDetails, ...collectDetails(b) };
    const { rows } = await pool.query(
      `UPDATE marketing_visits SET route_id=$2, customer_id=$3, visit_date=$4, area=$5, shop_name=$6, owner_name=$7,
        phone=$8, address=$9, visit_type=$10, outcome=$11, package_discussed=$12, leaflet_qty=$13, banner_qty=$14,
        forms_filled=$15, day_sale=$16, collection_amount=$17, photo_url=$18, gps_lat=$19, gps_lng=$20,
        followup_date=$21, lost_reason=$22, competitor_note=$23, details=$24, bill_month=$25, bill_amount=$26,
        receipt_no=$27, payment_mode=$28, package_selected=$29, advance_paid=$30, installation_date=$31,
        feasibility=$32, branding_subtype=$33, deal_value=$34, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, b.route_id || null, b.customer_id || null, b.visit_date || row.visit_date, String(b.area).trim(),
        String(b.shop_name || ''), String(b.owner_name || ''), bnToEn(b.phone || '').trim(), String(b.address || ''),
        b.visit_type, outcome, String(b.package_discussed || ''), toInt(b.leaflet_qty),
        toInt(b.banner_qty), toInt(b.forms_filled), toInt(b.day_sale), toNum(b.collection_amount), photoUrl,
        toCoord(b.gps_lat), toCoord(b.gps_lng),
        b.followup_date || null, b.lost_reason ? String(b.lost_reason).trim() : null, String(b.competitor_note || ''),
        JSON.stringify(mergedDetails), String(b.bill_month ?? row.bill_month ?? '').trim(), toNum(b.bill_amount),
        String(b.receipt_no ?? row.receipt_no ?? '').trim(), String(b.payment_mode ?? row.payment_mode ?? '').trim(),
        String(b.package_selected ?? row.package_selected ?? '').trim(), toNum(b.advance_paid),
        b.installation_date || null, String(b.feasibility ?? row.feasibility ?? '').trim(),
        String(b.branding_subtype ?? row.branding_subtype ?? '').trim(), toNum(b.deal_value)]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const verifyVisit = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const id = Number(req.params.id);
    const action = String((req.body || {}).action || 'verify').toLowerCase();
    if (!['verify', 'reject'].includes(action)) return res.status(400).json({ message: 'action must be verify|reject' });
    const status = action === 'verify' ? 'verified' : 'rejected';
    const { rows } = await pool.query(
      `UPDATE marketing_visits SET status=$2, verified_by=$3, verified_at=NOW(), updated_at=NOW()
       WHERE id=$1 RETURNING *`, [id, status, req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

// ── Reports (verified rows drive money/counts) ────────────────
const dailyReport = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
    const { rows } = await pool.query(
      `SELECT v.staff_id, u.full_name AS staff_name,
         COUNT(*)::int AS visits,
         COUNT(*) FILTER (WHERE v.status='verified')::int AS verified,
         COUNT(*) FILTER (WHERE v.visit_type='prospect' AND v.phone <> '' AND v.status='verified')::int AS leads,
         COUNT(*) FILTER (WHERE v.outcome='hot' AND v.status='verified')::int AS hot,
         COUNT(*) FILTER (WHERE v.visit_type='close' AND v.outcome='closed' AND v.status='verified')::int AS closes,
         COALESCE(SUM(v.day_sale) FILTER (WHERE v.status='verified'),0)::int AS day_sale,
         COALESCE(SUM(v.forms_filled) FILTER (WHERE v.status='verified'),0)::int AS forms,
         COUNT(*) FILTER (WHERE v.visit_type='bill_collect' AND v.status='verified')::int AS coll_n,
         COALESCE(SUM(v.collection_amount) FILTER (WHERE v.visit_type='bill_collect' AND v.status='verified'),0) AS coll_amt,
         COALESCE(SUM(v.bill_amount) FILTER (WHERE v.visit_type='bill_submit' AND v.status='verified'),0) AS submitted_amt,
         COALESCE(SUM(v.leaflet_qty + v.banner_qty) FILTER (WHERE v.status='verified'),0)::int AS branding
       FROM marketing_visits v LEFT JOIN users u ON u.id = v.staff_id
       WHERE v.visit_date = $1 GROUP BY v.staff_id, u.full_name ORDER BY visits DESC`, [date]);
    const plans = await pool.query(
      `SELECT staff_id, COUNT(*)::int AS plans, COALESCE(SUM(target_visits),0)::int AS plan_visits
       FROM marketing_routes WHERE route_date = $1 GROUP BY staff_id`, [date]);
    const due = await pool.query(
      `SELECT staff_id, COUNT(*)::int AS due FROM marketing_visits
       WHERE followup_date <= $1 AND outcome NOT IN ('closed','lost','done') AND status <> 'rejected'
       GROUP BY staff_id`, [date]);
    const planMap = Object.fromEntries(plans.rows.map((r) => [r.staff_id, r]));
    const dueMap = Object.fromEntries(due.rows.map((r) => [r.staff_id, r.due]));
    res.json({ date, rows: rows.map((r) => ({ ...r, plans: planMap[r.staff_id]?.plans || 0, plan_visits: planMap[r.staff_id]?.plan_visits || 0, due_followups: dueMap[r.staff_id] || 0 })) });
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const monthlyReport = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const month = String(req.query.month || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }).slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: 'month must be YYYY-MM' });
    const funnel = await pool.query(
      `SELECT COUNT(*)::int AS visits,
         COUNT(*) FILTER (WHERE visit_type='prospect' AND phone <> '')::int AS leads,
         COUNT(*) FILTER (WHERE visit_type='survey' AND outcome='done')::int AS surveys,
         COUNT(*) FILTER (WHERE visit_type='form' AND outcome='done')::int AS forms_done,
         COUNT(*) FILTER (WHERE visit_type='close' AND outcome='closed')::int AS closes,
         COALESCE(SUM(day_sale),0)::int AS total_sale,
         COALESCE(SUM(forms_filled),0)::int AS forms,
         COALESCE(SUM(collection_amount) FILTER (WHERE visit_type='bill_collect'),0) AS collection,
         COALESCE(SUM(bill_amount) FILTER (WHERE visit_type='bill_submit'),0) AS submitted,
         COALESCE(SUM(advance_paid),0) AS advance
       FROM marketing_visits WHERE to_char(visit_date,'YYYY-MM') = $1 AND status='verified'`, [month]);
    const byArea = await pool.query(
      `SELECT area, COUNT(*)::int AS visits, COUNT(*) FILTER (WHERE visit_type='close' AND outcome='closed')::int AS closes
       FROM marketing_visits WHERE to_char(visit_date,'YYYY-MM') = $1 AND status='verified'
       GROUP BY area ORDER BY visits DESC`, [month]);
    const byStaff = await pool.query(
      `SELECT v.staff_id, u.full_name AS staff_name, COUNT(*)::int AS visits,
         COUNT(*) FILTER (WHERE v.visit_type='close' AND v.outcome='closed')::int AS closes,
         COALESCE(SUM(v.day_sale),0)::int AS sale,
         COALESCE(SUM(v.collection_amount) FILTER (WHERE v.visit_type='bill_collect'),0) AS collection,
         t.target_visits, t.target_closes, t.target_collection
       FROM marketing_visits v LEFT JOIN users u ON u.id = v.staff_id
       LEFT JOIN marketing_targets t ON t.staff_id = v.staff_id AND t.month = $1
       WHERE to_char(v.visit_date,'YYYY-MM') = $1 AND v.status='verified'
       GROUP BY v.staff_id, u.full_name, t.target_visits, t.target_closes, t.target_collection ORDER BY visits DESC`, [month]);
    const competitors = await pool.query(
      `SELECT COALESCE(NULLIF(details->>'competitor_name',''), competitor_note) AS who,
         COUNT(*)::int AS n FROM marketing_visits
       WHERE to_char(visit_date,'YYYY-MM') = $1 AND visit_type='competitor' AND status='verified'
       GROUP BY 1 ORDER BY n DESC LIMIT 20`, [month]);
    const f = funnel.rows[0];
    const pct = (a, b) => (b > 0 ? Math.round((100.0 * a) / b) : 0);
    res.json({ month, funnel: { ...f, lead_rate: pct(f.leads, f.visits), survey_rate: pct(f.surveys, f.visits), close_rate: pct(f.closes, f.visits) }, byArea: byArea.rows, byStaff: byStaff.rows, competitors: competitors.rows });
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

// ── Targets ───────────────────────────────────────────────────
const listTargets = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const { month } = req.query;
    const vals = [];
    let where = '';
    if (month) { vals.push(month); where = `WHERE t.month = $${vals.length}`; }
    const { rows } = await pool.query(
      `SELECT t.*, u.full_name AS staff_name FROM marketing_targets t
       LEFT JOIN users u ON u.id = t.staff_id ${where} ORDER BY t.month DESC LIMIT 200`, vals);
    res.json(rows);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

const upsertTarget = async (req, res) => {
  try {
    await ensureRouteVisitSchema();
    const { staff_id, month, target_visits = 0, target_leads = 0, target_closes = 0, target_collection = 0 } = req.body || {};
    if (!staff_id || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
      return res.status(400).json({ message: 'staff_id and month (YYYY-MM) are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO marketing_targets (staff_id, month, target_visits, target_leads, target_closes, target_collection, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (staff_id, month) DO UPDATE SET target_visits=EXCLUDED.target_visits,
         target_leads=EXCLUDED.target_leads, target_closes=EXCLUDED.target_closes,
         target_collection=EXCLUDED.target_collection, updated_at=NOW() RETURNING *`,
      [Number(staff_id), month, toInt(target_visits), toInt(target_leads), toInt(target_closes), toNum(target_collection), req.user.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ message: 'Server Error' }); }
};

module.exports = {
  ensureRouteVisitSchema,
  listRoutes, createRoute, listVisits, createVisit, updateVisit, verifyVisit,
  dailyReport, monthlyReport, listTargets, upsertTarget,
  VISIT_TYPES: [...VISIT_TYPES], TYPE_RULES,
};
