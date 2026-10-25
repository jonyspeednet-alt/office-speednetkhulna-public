const pool = require('../utilities/db');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { isSuperAdmin, resolvePermission } = require('../utilities/permissionRegistry');
const { onboardingStatusError, canWriteOnboarding, prepareOnboardingApprovals } = require('../utilities/onboardingAuthorization');

// Ensure upload dir exists (also done in init, but belt-and-suspenders)
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/partner_onboarding');
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      cb(null, UPLOADS_DIR);
    } catch (err) { cb(err); }
  },
  filename: function (req, file, cb) {
    const safe = String(file.originalname || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + safe);
  }
});
const ALLOWED_ONBOARDING_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_ONBOARDING_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = String(file.originalname || '').toLowerCase().slice(String(file.originalname || '').lastIndexOf('.'));
    if (!ALLOWED_ONBOARDING_MIME.has(mime) || !ALLOWED_ONBOARDING_EXT.has(ext)) return cb(new Error('Only JPG/PNG/WebP/GIF images allowed'), false);
    cb(null, true);
  }
});

// S6: resolve a stored photo path strictly inside UPLOADS_DIR.
// Returns the absolute path or null (never throws, never escapes the dir).
const safePhotoAbsPath = (stored) => {
  if (!stored) return null;
  const base = path.basename(String(stored));
  if (!base || base === '.' || base === '..') return null;
  const resolved = path.resolve(UPLOADS_DIR, base);
  if (resolved !== UPLOADS_DIR && !resolved.startsWith(UPLOADS_DIR + path.sep)) return null;
  return resolved;
};

const normalizePartnerType = (val) => {
  const v = String(val || '').toLowerCase().trim();
  if (['mac', 'mac_partner'].includes(v)) return 'mac';
  if (['distribution', 'distribution_partner', 'dist'].includes(v)) return 'distribution';
  if (['channel', 'channel_partner', 'chanel'].includes(v)) return 'channel';
  return 'mac';
};

const toDbPartnerType = (val) => {
  const n = normalizePartnerType(val);
  if (n === 'mac') return 'mac_partner';
  if (n === 'distribution') return 'distribution_partner';
  return 'channel_partner';
};

// S1: helper to create reseller directly from onboarding formData (same logic as convertToReseller, but without approved guard)
// Used inside createOnboarding transaction — auto-creates reseller when status != 'draft'
const createResellerForOnboarding = async (client, formData, onboardingRow) => {
  const resellerName = String(formData.partnerName || formData.partner_name || onboardingRow.partner_name || '').trim();
  if (!resellerName) throw new Error('Partner name missing for reseller creation');
  let finalUserId = String(formData.partnerUserId || formData.user_id || onboardingRow.reseller_code || '').trim();
  if (!finalUserId) {
    let slug = resellerName.toLowerCase().replace(/[^a-z0-9]/g,'');
    if (!slug || slug.length < 3) {
      const contactDigits = String(formData.contactNumber || formData.contact_number || onboardingRow.contact_number || '').replace(/\D/g,'').slice(-6);
      if (contactDigits && contactDigits.length >= 4) slug = 'partner' + contactDigits;
      else slug = 'partner' + Date.now().toString().slice(-6);
    }
    // Keep slug reasonable length
    if (slug.length > 20) slug = slug.slice(0,20);
    finalUserId = slug + '_' + Math.floor(1000+Math.random()*9000);
  }
  const dup = await client.query('SELECT id FROM resellers WHERE user_id=$1 LIMIT 1', [finalUserId]);
  if (dup.rows.length) {
    const err = new Error('Reseller code already exists: '+finalUserId);
    err.code = 'DUPLICATE_RESSELLER';
    err.reseller_id = dup.rows[0].id;
    throw err;
  }
  const companyName = String(formData.partnerName || formData.company_name || resellerName).trim();
  const contactNo = String(formData.contactNumber || formData.contact_number || onboardingRow.contact_number || '').trim() || finalUserId;
  const popLocation = String(formData.address || formData.popAddress || onboardingRow.address || '').trim() || null;
  const partnerTypeDb = toDbPartnerType(formData.partnerType || formData.partner_type || onboardingRow.partner_type);
  const onboardingDate = parseDateDDMMYYYY(formData.onboardingDate || formData.onboarding_date) || onboardingRow.onboarding_date || new Date().toISOString().slice(0,10);
  const latitude = formData.latitude ? String(formData.latitude).trim() : null;
  const longitude = formData.longitude ? String(formData.longitude).trim() : null;
  const parseNum = (v) => parseFloat(String(v||'').replace(/[^0-9.]/g,'')) || 0;
  const iig = parseNum(formData.distIig);
  const ggc = parseNum(formData.distGgc);
  const fna = parseNum(formData.distFna);
  const bdix = parseNum(formData.distBdix);
  const cdnBw = parseNum(formData.distCdn);
  const nttnCap = parseNum(formData.distNttnCapacity || formData.distTotalCapacity || formData.distNttn);
  const nttnLink = String(formData.distNttnLinkId || formData.distNttnProvider || '').trim() || null;
  const nttnType = String(formData.distNttnType || '').trim() || null;
  // Never default to the phone number: random password + forced change on first login.
  const crypto = require("crypto");
  const suppliedOnboardPw = String(formData.password || "").trim();
  const onboardIds = [String(formData.contactNumber || "").trim(), String(contactNo || "").trim(), String(finalUserId || "").trim()].filter(Boolean);
  let passwordRaw = null;
  let onboardMustChange = true;
  if (suppliedOnboardPw) {
    if (suppliedOnboardPw.length < 8 || onboardIds.includes(suppliedOnboardPw)) {
      const err = new Error("Password must be at least 8 characters and not the phone number or user ID");
      err.code = 'INVALID_PASSWORD';
      throw err;
    }
    passwordRaw = suppliedOnboardPw;
    onboardMustChange = false;
  } else {
    passwordRaw = crypto.randomBytes(9).toString("base64url");
  }
  const hashed = await bcrypt.hash(passwordRaw, 10);
  // Create with status='inactive' (pending approval) — will become 'active' on Management Approval
  let newResellerId = null;
  try {
    const ins = await client.query(
      `INSERT INTO resellers (user_id, reseller_name, company_name, pop_location, contact_no, iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, nttn_capacity, nttn_link, nttn_type, latitude, longitude, partner_type, password, joining_date, created_at, last_activity_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,NOW(),NOW(),'inactive') RETURNING id`,
      [finalUserId, resellerName, companyName, popLocation, contactNo, iig, bdix, ggc, fna, cdnBw, nttnCap, nttnLink, nttnType, latitude, longitude, partnerTypeDb, hashed, onboardingDate]
    );
    newResellerId = ins.rows[0].id;
  } catch (e) {
    // Handle race duplicate: two concurrent creates with same code -> unique violation
    if (e.code === '23505' && String(e.constraint || '').includes('user_id') || String(e.message||'').includes('user_id')) {
      try {
        const dup = await client.query('SELECT id FROM resellers WHERE user_id=$1 LIMIT 1', [finalUserId]);
        const dupId = dup.rows[0]?.id || null;
        const err = new Error('Reseller code already exists: '+finalUserId);
        err.code = 'DUPLICATE_RESSELLER';
        err.reseller_id = dupId;
        throw err;
      } catch (dupErr) {
        if (dupErr.code === 'DUPLICATE_RESSELLER') throw dupErr;
        throw e;
      }
    }
    // Fallback for schema mismatch (older resellers table without BW columns)
    try {
      const ins2 = await client.query(
        `INSERT INTO resellers (user_id, reseller_name, company_name, pop_location, contact_no, partner_type, password, created_at, last_activity_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),'inactive') RETURNING id`,
        [finalUserId, resellerName, companyName, popLocation, contactNo, partnerTypeDb, hashed]
      );
      newResellerId = ins2.rows[0].id;
      try { await client.query(`UPDATE resellers SET iig_bw=$1, bdix_bw=$2, ggc_bw=$3, fna_bw=$4, cdn_bw=$5, nttn_capacity=$6 WHERE id=$7`, [iig,bdix,ggc,fna,cdnBw,nttnCap,newResellerId]); } catch(_){}
    } catch (e2) {
      if (e2.code === '23505') {
        const dup = await client.query('SELECT id FROM resellers WHERE user_id=$1 LIMIT 1', [finalUserId]);
        const err = new Error('Reseller code already exists: '+finalUserId);
        err.code = 'DUPLICATE_RESSELLER';
        err.reseller_id = dup.rows[0]?.id || null;
        throw err;
      }
      throw e2;
    }
  }
  const owners = Array.isArray(formData.owners) ? formData.owners : [];
  for (let i=0;i<owners.length;i++) {
    const pName = String(owners[i]?.name || '').trim();
    const pPhone = String(owners[i]?.mobile || '').trim();
    if (pName || pPhone) {
      try { await client.query(`INSERT INTO reseller_partners (reseller_id, partner_name, contact_no, sort_order) VALUES ($1,$2,$3,$4)`, [newResellerId, pName||resellerName, pPhone||contactNo, i]); } catch(e){}
    }
  }
  if (!owners.length || !owners.some(o=> (o.name||'').trim())) {
    try { await client.query(`INSERT INTO reseller_partners (reseller_id, partner_name, contact_no, sort_order) VALUES ($1,$2,$3,0)`, [newResellerId, resellerName, contactNo]); } catch(e){}
  }
  if (onboardMustChange && newResellerId) {
    try { await client.query(`UPDATE resellers SET must_change_password = TRUE WHERE id = $1`, [newResellerId]); } catch (e) {}
  }
  return {
    id: newResellerId,
    code: finalUserId,
    // Shown ONCE to the creating admin (sealed-slip handoff). Never stored/logged.
    ...(onboardMustChange ? { tempPassword: passwordRaw } : {}),
  };
};

const parseDateDDMMYYYY = (str) => {
  if (!str) return null;
  const s = String(str).trim();
  // Expect DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y.toString().padStart(4,'0')}-${mo.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
  // Validate real date
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  return iso;
};

// Agent commission: strict — rejects negatives, garbage, out-of-range.
// Returns { ok:true, value } or { ok:false, error }. Empty/absent => { ok:true, value:null }.
const parseAgentCommission = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const s = String(raw).replace(/%/g, '').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Agent Commission must be a number between 0 and 100 (e.g. 5 or 7.5)' };
  const n = parseFloat(s);
  if (isNaN(n) || n < 0 || n > 100) return { ok: false, error: 'Agent Commission must be between 0 and 100' };
  return { ok: true, value: n };
};

const buildApprovalsFromForm = (formData) => {
  const defs = formData?.approvals;
  if (Array.isArray(defs) && defs.length) return defs;
  return [
    { stage: 'Verified By / Onboarding Officer', name: '', signDate: '', status: 'pending' },
    { stage: 'Finance Verification', name: '', signDate: '', status: 'pending' },
    { stage: 'Technical / NOC Verification', name: '', signDate: '', status: 'pending' },
    { stage: 'Management Approval', name: '', signDate: '', status: 'pending' },
  ];
};

const genRefNumber = async (client = null) => {
  // SN-PO-YYYYMMDD-XXX unique — uses client inside transaction when available to reduce race
  const base = `SN-PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
  const queryFn = client ? (sql, params) => client.query(sql, params) : (sql, params) => pool.query(sql, params);
  for (let i=0;i<5;i++) {
    const suffix = String(Math.floor(100 + Math.random()*900));
    const candidate = `${base}-${suffix}`;
    try {
      const r = await queryFn('SELECT 1 FROM partner_onboardings WHERE ref_number=$1 LIMIT 1', [candidate]);
      if (r.rows.length===0) return candidate;
    } catch(_){}
  }
  return `${base}-${Date.now().toString().slice(-6)}-${String(Math.floor(100+Math.random()*900))}`;
};

const syncApprovals = async (client, onboardingId, approvals) => {
  for (const a of approvals) {
    const stage = String(a.stage || '').trim() || 'Unknown Stage';
    const name = String(a.name || '').trim() || null;
    const signDate = /^\d{4}-\d{2}-\d{2}$/.test(String(a.signDate || '')) ? a.signDate : parseDateDDMMYYYY(a.signDate) || null;
    const status = String(a.status || 'pending').toLowerCase();
    const allowed = ['pending','approved','rejected'];
    const finalStatus = allowed.includes(status) ? status : 'pending';
    await client.query(
      `INSERT INTO partner_onboarding_approvals (onboarding_id, stage, approver_name, status, sign_date)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (onboarding_id, stage) DO UPDATE SET approver_name=EXCLUDED.approver_name, status=EXCLUDED.status, sign_date=EXCLUDED.sign_date, updated_at=NOW()`,
      [onboardingId, stage, name, finalStatus, signDate]
    );
  }
};

// POST /api/partner-onboardings
const createOnboarding = async (req, res) => {
  if (!canWriteOnboarding(req.user)) return res.status(403).json({ message: 'Onboarding write permission required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let formData = {};
    try {
      if (req.body.form_data) formData = typeof req.body.form_data === 'string' ? JSON.parse(req.body.form_data) : req.body.form_data;
      else if (req.body.formData) formData = typeof req.body.formData === 'string' ? JSON.parse(req.body.formData) : req.body.formData;
      else {
        // Direct JSON body (no file)
        const bodyKeys = Object.keys(req.body || {});
        // If body contains onboarding-like keys, treat as form_data
        if (bodyKeys.includes('partnerName') || bodyKeys.includes('partner_name')) {
          formData = req.body;
        } else if (bodyKeys.length && !req.file) {
          // Single JSON payload may be { form_data: {...} } already parsed
          formData = req.body.form_data || req.body;
        }
      }
      // If still empty and req.body is JSON, use it
      if (!formData || (typeof formData === 'object' && Object.keys(formData).length===0)) {
        // Fallback: try to parse raw body as form_data if handler received JSON via application/json
        // express.json already parsed req.body
        if (req.body && typeof req.body === 'object' && (req.body.partnerName || req.body.form_data)) {
          formData = req.body.form_data ? (typeof req.body.form_data==='string'? JSON.parse(req.body.form_data): req.body.form_data) : req.body;
        }
      }
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid form_data JSON' });
    }

    // Normalize: support both camelCase form fields and direct form_data passthrough
    // If frontend sends FormData with 'form_data' stringified, formData already holds it.
    // If frontend sends JSON directly, it arrives as top-level body.
    if (!formData || typeof formData !== 'object') formData = {};

    // Fallback: if req.body has partner fields but formData lacks them, merge
    const mergeKeys = ['refNumber','partnerUserId','partnerName','partnerType','contactNumber','address','onboardingDate','latitude','longitude','revenueSharing'];
    for (const k of mergeKeys) {
      if (!formData[k] && req.body[k] !== undefined) formData[k] = req.body[k];
    }

    const partnerName = String(formData.partnerName || formData.partner_name || '').trim();
    if (!partnerName) {
      await client.query('ROLLBACK');
      // cleanup uploaded file
      if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
      return res.status(400).json({ message: 'Partner name (partnerName) is required' });
    }
    const partnerType = normalizePartnerType(formData.partnerType || formData.partner_type || 'mac');
    const contactNumber = String(formData.contactNumber || formData.contact_number || '').trim() || null;
    const address = String(formData.address || '').trim() || null;
    const resellerCode = String(formData.partnerUserId || formData.reseller_code || formData.user_id || '').trim() || null;
    const onboardingDate = parseDateDDMMYYYY(formData.onboardingDate || formData.onboarding_date);
    const latitude = formData.latitude ? parseFloat(formData.latitude) : null;
    const longitude = formData.longitude ? parseFloat(formData.longitude) : null;
    const revenueSharing = String(formData.revenueSharing || formData.revenue_sharing || '').trim() || null;
    const commRaw = (formData.agentCommissionPct !== undefined) ? formData.agentCommissionPct : formData.agent_commission;
    const commParsed = parseAgentCommission(commRaw);
    if (!commParsed.ok) {
      await client.query('ROLLBACK');
      if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
      return res.status(400).json({ message: commParsed.error });
    }
    const agentCommission = commParsed.value;
    const distTotalCapacity = formData.distTotalCapacity ? parseFloat(String(formData.distTotalCapacity).replace(/[^0-9.]/g,'')) || null : null;
    const distReqRate = formData.distReqRate ? parseFloat(String(formData.distReqRate).replace(/[^0-9.]/g,'')) || null : null;
    const popDeclared = formData.popDeclared ? true : false;
    const popAddress = String(formData.popAddress || '').trim() || null;
    const popType = String(formData.popType || '').trim() || null;
    const agreementDuration = String(formData.agreementDuration || '').trim() || null;
    const agreementStartDate = parseDateDDMMYYYY(formData.agreementStartDate);
    const agreementExpiryDate = parseDateDDMMYYYY(formData.agreementExpiryDate);
    const currentCustomers = formData.currentCustomers ? parseInt(String(formData.currentCustomers).replace(/[^0-9]/g,''),10) || null : null;
    const previousIsp = String(formData.previousIsp || '').trim() || null;
    const hasDue = !!formData.hasDue;
    const dueAmount = formData.dueAmount ? parseFloat(String(formData.dueAmount).replace(/[^0-9.]/g,'')) || null : null;

    // Handle linked reseller_id if provided
    let resellerId = null;
    const rawResellerId = formData.reseller_id || formData.resellerId || req.body.reseller_id;
    if (rawResellerId) {
      const r = await client.query('SELECT id FROM resellers WHERE id=$1 LIMIT 1', [parseInt(rawResellerId,10)]);
      if (r.rows.length) resellerId = r.rows[0].id;
    } else if (resellerCode) {
      const byCode = await client.query('SELECT id FROM resellers WHERE user_id=$1 LIMIT 1', [resellerCode]);
      if (byCode.rows.length) resellerId = byCode.rows[0].id;
    }

    // Photo handling
    let photoPath = null;
    if (req.file) {
      photoPath = `/uploads/partner_onboarding/${req.file.filename}`;
      // Also store base64/data URI fallback in form_data if provided, but file is primary
      formData._uploadedPhotoPath = photoPath;
    }
    // S6: photo_path is server-controlled only (from req.file). Client-supplied
    // values are ignored AND stripped from stored JSON so a later
    // update/delete can never resolve them to an arbitrary filesystem path.
    if (formData) { delete formData.photo_path; delete formData.photoPath; }
    // Strip large base64 data URI to avoid DB bloat — file path is source of truth when upload exists
    if (formData.partnerPhoto && String(formData.partnerPhoto).startsWith('data:')) {
      if (photoPath) {
        // File uploaded: don't store 2-3MB base64 in JSONB, keep only path
        delete formData.partnerPhoto;
      } else if (String(formData.partnerPhoto).length > 50000) {
        // No file but huge base64: strip to avoid 20MB JSONB, preview will use photo_path fallback
        console.warn('[partnerOnboarding] large base64 without file, stripping preview to avoid DB bloat');
        delete formData.partnerPhoto;
      }
    }

    const refNumber = String(formData.refNumber || formData.ref_number || '').trim() || await genRefNumber(client);
    // Ensure ref unique (use transaction client to reduce race window)
    const dupRef = await client.query('SELECT id FROM partner_onboardings WHERE ref_number=$1 LIMIT 1', [refNumber]);
    let finalRef = refNumber;
    if (dupRef.rows.length) finalRef = await genRefNumber(client);

    const submittedBy = req.user?.id || null;
    const status = String(req.body.status || formData.status || 'draft').toLowerCase();
    const allowedStatus = ['draft','submitted','verified','approved','rejected','converted'];
    const finalStatus = allowedStatus.includes(status) ? status : 'draft';
    formData.status = finalStatus;
    const statusError = onboardingStatusError(req.user, submittedBy, finalStatus);
    if (statusError) {
      await client.query('ROLLBACK');
      return res.status(statusError.status).json({ message: statusError.message });
    }
    const preparedApprovals = prepareOnboardingApprovals(req.user, submittedBy, buildApprovalsFromForm(formData));
    if (preparedApprovals.error) {
      await client.query('ROLLBACK');
      return res.status(preparedApprovals.error.status).json({ message: preparedApprovals.error.message });
    }
    formData.approvals = preparedApprovals.approvals;

    // Insert with retry on ref_number unique violation (concurrent creates)
    let row = null;
    let finalRefToUse = finalRef;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const insert = await client.query(
          `INSERT INTO partner_onboardings
            (ref_number, status, reseller_id, reseller_code, partner_name, partner_type, contact_number, address, onboarding_date,
             latitude, longitude, photo_path, revenue_sharing, dist_total_capacity, dist_req_rate, pop_declared, pop_address, pop_type,
             agreement_duration, agreement_start_date, agreement_expiry_date, current_customers, previous_isp, has_due, due_amount,
             agent_commission, form_data, submitted_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28)
            RETURNING *`,
          [
            finalRefToUse, finalStatus, resellerId, resellerCode, partnerName, partnerType, contactNumber, address, onboardingDate,
            isNaN(latitude)?null:latitude, isNaN(longitude)?null:longitude, photoPath, revenueSharing,
            isNaN(distTotalCapacity)?null:distTotalCapacity, isNaN(distReqRate)?null:distReqRate,
            popDeclared, popAddress, popType,
            agreementDuration, agreementStartDate, agreementExpiryDate,
            isNaN(currentCustomers)?null:currentCustomers, previousIsp, hasDue, isNaN(dueAmount)?null:dueAmount,
            (agentCommission === null || isNaN(agentCommission)) ? null : agentCommission,
            JSON.stringify(formData), submittedBy
          ]
        );
        row = insert.rows[0];
        // Ensure formData reflects the actual ref used
        if (finalRefToUse !== refNumber) {
          row.form_data = { ...row.form_data, refNumber: finalRefToUse };
        }
        break;
      } catch (e) {
        const isRefDup = e.code === '23505' && (String(e.constraint||'').toLowerCase().includes('ref_number') || String(e.message||'').toLowerCase().includes('ref_number') || String(e.detail||'').toLowerCase().includes('ref_number'));
        if (isRefDup && attempt < 2) {
          finalRefToUse = await genRefNumber(client);
          continue;
        }
        throw e;
      }
    }
    if (!row) throw new Error('Failed to insert onboarding after retries');

    // Sync approvals
    const approvals = buildApprovalsFromForm(formData);
    await syncApprovals(client, row.id, approvals);

    // S1: auto-create reseller when not draft (simple flow) — draft keeps no reseller, submitted+ creates inactive pending
    let autoReseller = null;
    if (finalStatus !== 'draft' && !resellerId) {
      try {
        autoReseller = await createResellerForOnboarding(client, formData, row);
        await client.query('UPDATE partner_onboardings SET reseller_id=$1, reseller_code=$2 WHERE id=$3', [autoReseller.id, autoReseller.code, row.id]);
        row.reseller_id = autoReseller.id;
        row.reseller_code = autoReseller.code;
      } catch (e) {
        if (e.code === 'DUPLICATE_RESSELLER') {
          await client.query('ROLLBACK');
          if (req.file) try { fs.unlinkSync(req.file.path); } catch(_){}
          return res.status(409).json({ message: 'Reseller code already taken' });
        }
        if (e.code === 'INVALID_PASSWORD') {
          await client.query('ROLLBACK');
          if (req.file) try { fs.unlinkSync(req.file.path); } catch(_){}
          return res.status(400).json({ message: e.message });
        }
        throw e;
      }
    }

    await client.query('COMMIT');
    // Fetch approvals for response
    const approvRows = await pool.query('SELECT * FROM partner_onboarding_approvals WHERE onboarding_id=$1 ORDER BY id ASC', [row.id]);
    const respRow = autoReseller ? { ...row, reseller_id: autoReseller.id, reseller_code: autoReseller.code } : row;
    res.status(201).json({ ...respRow, approvals: approvRows.rows, reseller_created: !!autoReseller, reseller_id: autoReseller?.id || row.reseller_id, reseller_code: autoReseller?.code || row.reseller_code, ...(autoReseller?.tempPassword ? { tempPassword: autoReseller.tempPassword } : {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[partnerOnboarding] create error:', err.message);
    // cleanup file on error
    if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
    if (err.code === '23505') return res.status(409).json({ message: 'Ref number already exists, please retry' });
    res.status(500).json({ message: 'Failed to create onboarding' });
  } finally {
    client.release();
  }
};

const listOnboardings = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const partnerType = String(req.query.partner_type || req.query.partnerType || '').trim().toLowerCase();
    const resellerId = String(req.query.reseller_id || req.query.resellerId || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const mine = String(req.query.mine || '') === 'true';
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${escapeLike(search)}%`);
      const p = `$${params.length}`;
      where.push(`(p.ref_number ILIKE ${p} ESCAPE '\\' OR COALESCE(p.reseller_code,'') ILIKE ${p} ESCAPE '\\' OR p.partner_name ILIKE ${p} ESCAPE '\\' OR COALESCE(p.contact_number,'') ILIKE ${p} ESCAPE '\\')`);
    }
    if (status && ['draft','submitted','verified','approved','rejected','converted'].includes(status)) {
      params.push(status);
      where.push(`p.status = $${params.length}`);
    }
    if (partnerType) {
      const norm = normalizePartnerType(partnerType);
      params.push(norm);
      where.push(`p.partner_type = $${params.length}`);
    }
    if (resellerId) {
      const rid = parseInt(resellerId, 10);
      if (!isNaN(rid)) {
        params.push(rid);
        where.push(`p.reseller_id = $${params.length}`);
      }
    }
    if (mine && req.user?.id) {
      params.push(req.user.id);
      where.push(`p.submitted_by = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*)::int AS total FROM partner_onboardings p ${whereSql}`;
    const countRes = await pool.query(countSql, params);
    const total = countRes.rows[0]?.total || 0;
    params.push(limit); params.push(offset);
    const dataSql = `SELECT p.*, u.full_name AS submitted_by_name FROM partner_onboardings p LEFT JOIN users u ON u.id=p.submitted_by ${whereSql} ORDER BY p.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const result = await pool.query(dataSql, params);
    res.json({ total, rows: result.rows });
  } catch (err) {
    console.error('[partnerOnboarding] list error:', err.message);
    res.status(500).json({ message: 'Failed to list onboardings' });
  }
};

const getOnboarding = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT p.*, u.full_name AS submitted_by_name FROM partner_onboardings p LEFT JOIN users u ON u.id=p.submitted_by WHERE p.id=$1 LIMIT 1`,
      [parseInt(id,10)]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Onboarding not found' });
    const approvals = await pool.query('SELECT * FROM partner_onboarding_approvals WHERE onboarding_id=$1 ORDER BY id ASC', [parseInt(id,10)]);
    const row = result.rows[0];
    const approvalForm = approvals.rows.map((approval) => ({ stage: approval.stage,
      name: approval.approver_name || '', status: approval.status,
      signDate: approval.sign_date ? new Date(approval.sign_date).toISOString().slice(0, 10) : '' }));
    res.json({ ...row, form_data: { ...row.form_data, status: row.status, approvals: approvalForm }, approvals: approvals.rows });
  } catch (err) {
    console.error('[partnerOnboarding] get error:', err.message);
    res.status(500).json({ message: 'Failed to fetch onboarding' });
  }
};

const updateOnboarding = async (req, res) => {
  if (!canWriteOnboarding(req.user)) return res.status(403).json({ message: 'Onboarding write permission required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const existing = await client.query('SELECT * FROM partner_onboardings WHERE id=$1 LIMIT 1 FOR UPDATE', [parseInt(id,10)]);
    if (!existing.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Onboarding not found' }); }
    const row = existing.rows[0];
    // S1: allow edit after approved/rejected (sync to reseller), only block converted (legacy)
    if (['converted'].includes(String(row.status).toLowerCase())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cannot edit after converted ('+row.status+') — duplicate onboarding' });
    }

    let formData = {};
    try {
      if (req.body.form_data) formData = typeof req.body.form_data==='string'? JSON.parse(req.body.form_data): req.body.form_data;
      else if (req.body.formData) formData = typeof req.body.formData==='string'? JSON.parse(req.body.formData): req.body.formData;
      else if (req.body.partnerName) formData = req.body;
      else if (Object.keys(req.body||{}).length && !req.file) formData = req.body.form_data || req.body;
    } catch(e) { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Invalid form_data JSON' }); }
    if (!formData || typeof formData !== 'object') formData = {};
    // Merge with existing form_data for partial updates
    let mergedForm = { ...row.form_data, ...formData };
    // Ensure approvals merged correctly
    if (formData.approvals) mergedForm.approvals = formData.approvals;

    const partnerName = String(mergedForm.partnerName || mergedForm.partner_name || row.partner_name).trim() || row.partner_name;
    const partnerType = normalizePartnerType(mergedForm.partnerType || mergedForm.partner_type || row.partner_type);
    const contactNumber = String(mergedForm.contactNumber || mergedForm.contact_number || row.contact_number || '').trim() || null;
    const address = String(mergedForm.address || row.address || '').trim() || null;
    const resellerCode = String(mergedForm.partnerUserId || mergedForm.reseller_code || row.reseller_code || '').trim() || null;
    const onboardingDate = parseDateDDMMYYYY(mergedForm.onboardingDate || mergedForm.onboarding_date) || row.onboarding_date;
    const latitude = mergedForm.latitude ? parseFloat(mergedForm.latitude) : row.latitude;
    const longitude = mergedForm.longitude ? parseFloat(mergedForm.longitude) : row.longitude;
    // Fix 6: mirror create-time columns so edits don't leave top-level fields stale
    const numOrNull = (v, fb) => {
      const s = String(v ?? fb ?? '').replace(/[^0-9.]/g, '').trim();
      if (!s) return null;
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };
    const revenueSharingU = String(mergedForm.revenueSharing ?? mergedForm.revenue_sharing ?? row.revenue_sharing ?? '').trim() || null;
    const distTotalCapacityU = numOrNull(mergedForm.distTotalCapacity, null);
    const distReqRateU = numOrNull(mergedForm.distReqRate, null);
    const popDeclaredU = mergedForm.popDeclared ? true : false;
    const popAddressU = String(mergedForm.popAddress ?? row.pop_address ?? '').trim() || null;
    const popTypeU = String(mergedForm.popType ?? row.pop_type ?? '').trim() || null;
    const agreementDurationU = String(mergedForm.agreementDuration ?? row.agreement_duration ?? '').trim() || null;
    const agreementStartDateU = parseDateDDMMYYYY(mergedForm.agreementStartDate) || row.agreement_start_date;
    const agreementExpiryDateU = parseDateDDMMYYYY(mergedForm.agreementExpiryDate) || row.agreement_expiry_date;
    const currentCustomersU = (() => {
      const raw = String(mergedForm.currentCustomers ?? '').replace(/[^0-9]/g, '').trim();
      if (raw) { const n = parseInt(raw, 10); return isNaN(n) ? null : n; }
      return row.current_customers;
    })();
    const previousIspU = String(mergedForm.previousIsp ?? row.previous_isp ?? '').trim() || null;
    const hasDueU = !!mergedForm.hasDue;
    const dueAmountU = numOrNull(mergedForm.dueAmount, null);
    // Commission: only re-validate when the client sent the key (don't punish old rows);
    // otherwise preserve the stored column value.
    const commProvidedU = formData.agentCommissionPct !== undefined || formData.agent_commission !== undefined;
    let agentCommissionU = row.agent_commission;
    if (commProvidedU) {
      const rawU = (formData.agentCommissionPct !== undefined) ? formData.agentCommissionPct : formData.agent_commission;
      const parsedU = parseAgentCommission(rawU);
      if (!parsedU.ok) {
        await client.query('ROLLBACK');
        if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
        return res.status(400).json({ message: parsedU.error });
      }
      agentCommissionU = parsedU.value;
      mergedForm.agentCommissionPct = rawU === undefined || rawU === null ? '' : String(rawU);
    }

    let photoPath = row.photo_path;
    let previousPhotoToRemove = null;
    // S6: drop any client-supplied path keys before merge so stored JSON stays clean
    if (formData) { delete formData.photo_path; delete formData.photoPath; }
    if (mergedForm) { delete mergedForm.photo_path; delete mergedForm.photoPath; }
    if (req.file) {
      // Keep the old photo until authorization and the transaction both succeed.
      if (photoPath) previousPhotoToRemove = safePhotoAbsPath(photoPath);
      photoPath = `/uploads/partner_onboarding/${req.file.filename}`;
      mergedForm._uploadedPhotoPath = photoPath;
    }
    // Strip large base64 data URI to avoid DB bloat — keep only file path when upload exists
    if (mergedForm.partnerPhoto && String(mergedForm.partnerPhoto).startsWith('data:')) {
      if (photoPath) {
        delete mergedForm.partnerPhoto;
      } else if (String(mergedForm.partnerPhoto).length > 50000) {
        console.warn('[partnerOnboarding] large base64 without file on update, stripping preview');
        delete mergedForm.partnerPhoto;
      }
    }

    // Determine effective status — prevent downgrade from non-draft to draft (same as frontend guard)
    const allowedStatusForUpdate = ['draft','submitted','verified','approved','rejected','converted'];
    let requestedStatus = String(formData.status ?? req.body.status ?? row.status ?? 'draft').toLowerCase().trim();
    if (!allowedStatusForUpdate.includes(requestedStatus)) requestedStatus = String(row.status || 'draft').toLowerCase();
    let effectiveStatus = requestedStatus;
    if (String(row.status).toLowerCase() !== 'draft' && requestedStatus === 'draft') {
      effectiveStatus = String(row.status).toLowerCase(); // prevent downgrade
    }
    mergedForm.status = effectiveStatus;
    const statusError = onboardingStatusError(req.user, row.submitted_by, effectiveStatus, String(row.status).toLowerCase());
    if (statusError) {
      await client.query('ROLLBACK');
      return res.status(statusError.status).json({ message: statusError.message });
    }
    {
      const previousApprovals = await client.query(
        'SELECT stage, approver_name, status, sign_date FROM partner_onboarding_approvals WHERE onboarding_id=$1 FOR UPDATE',
        [parseInt(id,10)]
      );
      const incomingApprovals = formData.approvals !== undefined ? formData.approvals :
        previousApprovals.rows.map((approval) => ({ stage: approval.stage, name: approval.approver_name,
          status: approval.status, signDate: approval.sign_date }));
      const preparedApprovals = prepareOnboardingApprovals(req.user, row.submitted_by, incomingApprovals, previousApprovals.rows);
      if (preparedApprovals.error) {
        await client.query('ROLLBACK');
        return res.status(preparedApprovals.error.status).json({ message: preparedApprovals.error.message });
      }
      mergedForm.approvals = preparedApprovals.approvals;
    }

    const updated = await client.query(
      `UPDATE partner_onboardings SET
        partner_name=$1, partner_type=$2, contact_number=$3, address=$4, reseller_code=$5, onboarding_date=$6,
        latitude=$7, longitude=$8, photo_path=$9, revenue_sharing=$10, dist_total_capacity=$11, dist_req_rate=$12,
        pop_declared=$13, pop_address=$14, pop_type=$15, agreement_duration=$16, agreement_start_date=$17,
        agreement_expiry_date=$18, current_customers=$19, previous_isp=$20, has_due=$21, due_amount=$22,
        agent_commission=$23, form_data=$24::jsonb, status=$25, updated_at=NOW()
       WHERE id=$26 RETURNING *`,
      [partnerName, partnerType, contactNumber, address, resellerCode, onboardingDate, isNaN(latitude)?null:latitude, isNaN(longitude)?null:longitude, photoPath,
       revenueSharingU, isNaN(distTotalCapacityU)?null:distTotalCapacityU, isNaN(distReqRateU)?null:distReqRateU,
       popDeclaredU, popAddressU, popTypeU, agreementDurationU, agreementStartDateU, agreementExpiryDateU,
       (currentCustomersU === null || isNaN(currentCustomersU))?null:currentCustomersU, previousIspU, hasDueU, isNaN(dueAmountU)?null:dueAmountU,
       (agentCommissionU === null || agentCommissionU === undefined || isNaN(agentCommissionU)) ? null : agentCommissionU,
       JSON.stringify(mergedForm), effectiveStatus, parseInt(id,10)]
    );
    // Sync approvals if provided
    if (mergedForm.approvals && Array.isArray(mergedForm.approvals)) {
      await syncApprovals(client, parseInt(id,10), mergedForm.approvals);
    }
    // S1: if was draft with no reseller and now submitted/approved via update, auto-create reseller
    const desiredStatusForAuto = effectiveStatus;
    let updateTempPassword = null;
    if (!row.reseller_id && ['submitted','verified','approved'].includes(desiredStatusForAuto)) {
      try {
        const auto = await createResellerForOnboarding(client, mergedForm, { ...row, ...updated.rows[0] });
        if (auto.tempPassword) updateTempPassword = auto.tempPassword;
        await client.query('UPDATE partner_onboardings SET reseller_id=$1, reseller_code=$2, status=$3 WHERE id=$4', [auto.id, auto.code, desiredStatusForAuto, parseInt(id,10)]);
        updated.rows[0].reseller_id = auto.id;
        updated.rows[0].reseller_code = auto.code;
        updated.rows[0].status = desiredStatusForAuto;
      } catch (e) {
        if (e.code === 'DUPLICATE_RESSELLER') {
          await client.query('ROLLBACK');
          if (req.file) try { fs.unlinkSync(req.file.path); } catch(_){}
          return res.status(409).json({ message: 'Reseller code already taken' });
        }
        if (e.code === 'INVALID_PASSWORD') {
          await client.query('ROLLBACK');
          if (req.file) try { fs.unlinkSync(req.file.path); } catch(_){}
          return res.status(400).json({ message: e.message });
        }
        throw e;
      }
    }
    await client.query('COMMIT');
    // Align: if linked reseller exists and still editable, sync key fields to resellers (onboarding -> reseller)
    try { if (previousPhotoToRemove && fs.existsSync(previousPhotoToRemove)) fs.unlinkSync(previousPhotoToRemove); } catch (_) {}
    if (String(req.query.sync_to_reseller || 'true').toLowerCase() !== 'false' && row.reseller_id && ['draft','submitted','verified','approved','rejected'].includes(effectiveStatus)) {
      try {
        const syncName = String(mergedForm.partnerName || mergedForm.partner_name || '').trim() || null;
        const syncPhone = String(mergedForm.contactNumber || mergedForm.contact_number || '').trim() || null;
        const syncAddr = String(mergedForm.address || '').trim() || null;
        const syncTypeRaw = mergedForm.partnerType || mergedForm.partner_type;
        const dbType = syncTypeRaw ? toDbPartnerType(syncTypeRaw) : null;
        let syncCode = String(resellerCode || '').trim() || null;
        // Avoid duplicate user_id on sync — check before updating
        if (syncCode) {
          try {
            const dup = await pool.query('SELECT id FROM resellers WHERE user_id=$1 AND id<>$2 LIMIT 1', [syncCode, row.reseller_id]);
            if (dup.rows.length) {
              console.warn('[sync reseller] skip user_id change, duplicate:', syncCode);
              syncCode = null;
            }
          } catch(_){}
        }
        if (syncCode) {
          await pool.query(
            "UPDATE resellers SET reseller_name=COALESCE($1, reseller_name), contact_no=COALESCE($2, contact_no), pop_location=COALESCE($3, pop_location), partner_type=COALESCE($4, partner_type), user_id=COALESCE($5, user_id) WHERE id=$6",
            [syncName, syncPhone, syncAddr, dbType, syncCode, row.reseller_id]
          );
        } else {
          await pool.query(
            "UPDATE resellers SET reseller_name=COALESCE($1, reseller_name), contact_no=COALESCE($2, contact_no), pop_location=COALESCE($3, pop_location), partner_type=COALESCE($4, partner_type) WHERE id=$5",
            [syncName, syncPhone, syncAddr, dbType, row.reseller_id]
          );
        }
      } catch (e) { console.warn('[sync reseller] warn', e.message); }
    }
    const approvals = await pool.query('SELECT * FROM partner_onboarding_approvals WHERE onboarding_id=$1 ORDER BY id ASC', [parseInt(id,10)]);
    res.json({ ...updated.rows[0], approvals: approvals.rows, ...(updateTempPassword ? { tempPassword: updateTempPassword } : {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[partnerOnboarding] update error:', err.message);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch(e){}
    res.status(500).json({ message: 'Failed to update onboarding' });
  } finally { client.release(); }
};

const deleteOnboarding = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT * FROM partner_onboardings WHERE id=$1 LIMIT 1', [parseInt(id,10)]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Not found' });
    const row = existing.rows[0];
    if (String(row.status).toLowerCase() === 'converted') return res.status(400).json({ message: 'Cannot delete converted onboarding' });
    const isOwner = Number(row.submitted_by) === Number(req.user?.id);
    const isSuper = String(req.user?.role || '').toLowerCase().includes('super admin');
    const canManage = req.user?.permissions?.all_access || req.user?.all_access || isSuper;
    if (!isOwner && !canManage) return res.status(403).json({ message: 'Not allowed' });
    // Delete approvals cascade + photo file (S6: confined to uploads dir)
    if (row.photo_path) {
      const fsPath = safePhotoAbsPath(row.photo_path);
      try { if (fsPath && fs.existsSync(fsPath)) fs.unlinkSync(fsPath); } catch(e){}
    }
    await pool.query('DELETE FROM partner_onboardings WHERE id=$1', [parseInt(id,10)]);
    res.json({ success: true });
  } catch (err) {
    console.error('[partnerOnboarding] delete error:', err.message);
    res.status(500).json({ message: 'Failed to delete' });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['draft','submitted','verified','approved','rejected'];
    const target = String(status||'').toLowerCase();
    if (!allowed.includes(target)) return res.status(400).json({ message: 'Invalid status' });
    const existing = await pool.query('SELECT * FROM partner_onboardings WHERE id=$1 LIMIT 1', [parseInt(id,10)]);
    if (!existing.rows.length) return res.status(404).json({ message: 'Not found' });
    const row = existing.rows[0];
    if (String(row.status).toLowerCase() === 'converted') return res.status(400).json({ message: 'Already converted' });
    const statusError = onboardingStatusError(req.user, row.submitted_by, target);
    if (statusError) return res.status(statusError.status).json({ message: statusError.message });
    let approverCol = null;
    if (target === 'verified') approverCol = 'verified_by';
    if (target === 'approved') approverCol = 'approved_by';
    let sql = `UPDATE partner_onboardings SET status=$1, updated_at=NOW()`;
    const params = [target];
    if (approverCol) { sql += `, ${approverCol}=$${params.length+1}`; params.push(req.user?.id || null); }
    sql += ` WHERE id=$${params.length+1} RETURNING *`;
    params.push(parseInt(id,10));
    const upd = await pool.query(sql, params);
    // Also update approval table for tracking
    if (target === 'verified' || target === 'approved') {
      try {
        const stageMap = { verified: 'Verified By / Onboarding Officer', approved: 'Management Approval' };
        const stage = stageMap[target];
        await pool.query(
          `INSERT INTO partner_onboarding_approvals (onboarding_id, stage, approver_name, status, sign_date)
           VALUES ($1,$2,$3,'approved', CURRENT_DATE)
           ON CONFLICT (onboarding_id, stage) DO UPDATE SET status='approved', sign_date=CURRENT_DATE, approver_name=EXCLUDED.approver_name, updated_at=NOW()`,
          [parseInt(id,10), stage, String(req.user?.full_name || '')]
        );
      } catch(e){ console.warn('approval stage update warn:', e.message); }
    }
    // S1: sync reseller status with approval — approved -> active, rejected -> suspended
    try {
      if (row.reseller_id) {
        if (target === 'approved') {
          await pool.query(`UPDATE resellers SET status='active' WHERE id=$1`, [row.reseller_id]);
        } else if (target === 'rejected') {
          await pool.query(`UPDATE resellers SET status='suspended' WHERE id=$1`, [row.reseller_id]);
        } else if (target === 'verified' && String(row.status).toLowerCase() === 'draft') {
          // keep pending as inactive, no change
        }
      }
    } catch(e){ console.warn('[reseller status sync] warn', e.message); }
    // Include reseller status in response for UI badge
    let resp = upd.rows[0];
    if (row.reseller_id) {
      try {
        const rs = await pool.query('SELECT status FROM resellers WHERE id=$1', [row.reseller_id]);
        if (rs.rows.length) resp = { ...resp, reseller_status: rs.rows[0].status };
      } catch(_){}
    }
    res.json(resp);
  } catch (err) {
    console.error('[partnerOnboarding] status error:', err.message);
    res.status(500).json({ message: 'Failed to update status' });
  }
};

const convertToReseller = async (req, res) => {
  // S1: kept for backward-compat but now auto-create happens on save; this just links existing onboarding if somehow not yet linked
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const existing = await client.query('SELECT * FROM partner_onboardings WHERE id=$1 FOR UPDATE', [parseInt(id,10)]);
    if (!existing.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ message: 'Not found' }); }
    const row = existing.rows[0];
    if (row.reseller_id) { await client.query('ROLLBACK'); return res.json({ success: true, reseller_id: row.reseller_id, reseller_code: row.reseller_code, message: 'Already linked' }); }
    if (String(row.status).toLowerCase() === 'converted') { await client.query('ROLLBACK'); return res.status(400).json({ message: 'Already converted', reseller_id: row.reseller_id }); }
    const fd = row.form_data || {};
    // Use shared helper (creates inactive, will be activated via approval)
    let newReseller;
    try {
      newReseller = await createResellerForOnboarding(client, fd, row);
    } catch (e) {
      if (e.code === 'DUPLICATE_RESSELLER') { await client.query('ROLLBACK'); return res.status(409).json({ message: 'Reseller code already taken' }); }
      if (e.code === 'INVALID_PASSWORD') { await client.query('ROLLBACK'); return res.status(400).json({ message: e.message }); }
      throw e;
    }
    const newResellerId = newReseller.id;
    const finalUserId = newReseller.code;
    // If already approved, mark active immediately (helper creates as inactive)
    if (String(row.status).toLowerCase() === 'approved') {
      try { await client.query(`UPDATE resellers SET status='active' WHERE id=$1`, [newResellerId]); } catch(_){}
    }

    // Link onboarding -> reseller
    await client.query(`UPDATE partner_onboardings SET reseller_id=$1, reseller_code=$2, status='converted', updated_at=NOW() WHERE id=$3`, [newResellerId, finalUserId, parseInt(id,10)]);

    await client.query('COMMIT');
    res.json({
      success: true,
      reseller_id: newResellerId,
      reseller_code: finalUserId,
      // Shown ONCE to the creating admin (sealed-slip handoff). Never stored/logged.
      ...(newReseller.tempPassword ? { tempPassword: newReseller.tempPassword } : {}),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[partnerOnboarding] convert error:', err.message);
    res.status(500).json({ message: 'Failed to convert to reseller' });
  } finally { client.release(); }
};

module.exports = { upload, createOnboarding, listOnboardings, getOnboarding, updateOnboarding, deleteOnboarding, updateStatus, convertToReseller };
