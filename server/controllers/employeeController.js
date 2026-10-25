const pool = require('../utilities/db');
const { diffProfile, logProfileHistory } = require('../utilities/profileHistory');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const bcrypt = require('bcrypt');
const { resolvePermission, isTruthyPermission, getEffectivePermissions } = require('../utilities/permissionRegistry');
const { BRANCHES, normalizeOfficeName } = require('../constants/branches');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const BCRYPT_RE = /^\$2[aby]\$/;
const escapeLike = (s) => String(s).replace(/([%_\\])/g, '\\$1');
const MIN_PASSWORD_LEN = 8;
// Reset password must be supplied by the deployment environment; never hardcode a default.
const DEFAULT_RESET_PASSWORD = process.env.DEFAULT_RESET_PASSWORD || '';

const canManageUsers = (user) => resolvePermission(user, 'users.manage');
// S1: fail closed — only users with users.edit.any may edit others unless
// the operator explicitly opts back into the legacy override.
const allowProfileEditOverride = String(process.env.ALLOW_PROFILE_EDIT_OVERRIDE || 'false').toLowerCase() === 'true';
const canEditAnyProfile = (user) => {
  if (resolvePermission(user, 'users.edit.any')) return true;
  return allowProfileEditOverride;
};

// all_access on req.user lives as a top-level flag and/or inside the
// permissions object (see permissionRegistry.resolvePermission); SN-01
// master bypass is preserved because resolvePermission returns true for
// super admins. Used to gate assignment of the Admin role.
const canGrantAllAccess = (user) => resolvePermission(user, 'system.all_access');
// Roles whose assignment hands out (or may hand out) all_access — gated to all_access holders.
const isPrivilegedRoleName = (name) => ['admin', 'super admin', 'superadmin'].includes(String(name || '').trim().toLowerCase());
const roleGrantsAllAccess = (role) =>
  isTruthyPermission(role?.permissions?.all_access) ||
  isTruthyPermission(role?.permissions?.['system.all_access']);

// ---- Shared input validation (fix #1) + uniqueness helpers (fix #2) ----
const BD_PHONE_RE = /^01[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NID_RE = /^\d{10}(\d{3,7})?$/;
const normalizeBloodGroup = (value) => value == null ? value : String(value).trim().toUpperCase();
const BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']);
const RESERVED_EMPLOYEE_ID = 'sn-01';
const MAX_EMPLOYEE_ID_LEN = 40;

const isReservedEmployeeId = (v) => String(v || '').trim().toLowerCase() === RESERVED_EMPLOYEE_ID;
const canonicalWorkLocation = (value) => {
  const office = String(value || '').trim();
  return office ? normalizeOfficeName(office) : '';
};

// Create mode enforces required fields; update mode validates only fields
// actually supplied in req.body. Returns { message, field } or null.
const validateEmployeeInput = (input, { isUpdate = false } = {}) => {
  const supplied = (name) => input[name] !== undefined && input[name] !== null;
  // full_name: required ≥3 on create; if-supplied on update
  if (!isUpdate || supplied('full_name')) {
    if (String(input.full_name ?? '').trim().length < 3) {
      return { message: 'Full name is required (min 3 characters)', field: 'full_name' };
    }
  }
  // phone: required + BD format on create; if-supplied non-empty on update
  // (legacy rows may hold non-BD numbers, so no regex on update)
  if (!isUpdate) {
    const v = String(input.phone ?? '').trim();
    if (!v) return { message: 'Phone is required', field: 'phone' };
    if (!BD_PHONE_RE.test(v)) return { message: 'Phone must be a valid BD mobile number (01XXXXXXXXX)', field: 'phone' };
  } else if (supplied('phone')) {
    if (!String(input.phone ?? '').trim()) return { message: 'Phone cannot be empty', field: 'phone' };
  }
  // email: optional, validated only when a non-empty value is present
  if (supplied('email')) {
    const v = String(input.email ?? '').trim();
    if (v && !EMAIL_RE.test(v)) return { message: 'Invalid email address', field: 'email' };
  }
  // nid_number: optional, 10 digits + up to 7 more when present
  if (supplied('nid_number')) {
    const v = String(input.nid_number ?? '').trim();
    if (v && !NID_RE.test(v)) return { message: 'NID must be 10-17 digits', field: 'nid_number' };
  }
  if (!isUpdate || supplied('work_location')) {
    const value = String(input.work_location ?? '').trim();
    if (!value) return { message: 'Work location is required', field: 'work_location' };
    const office = normalizeOfficeName(value);
    if (!BRANCHES.some((branch) => branch.name === office)) {
      return { message: 'Select a valid work location', field: 'work_location' };
    }
  }
  // joining_date: ''/undefined means keep-old (update) or today (create);
  // a non-empty unparseable value is a 400, never a silent fallback
  if (supplied('joining_date') && input.joining_date !== '') {
    if (isNaN(Date.parse(input.joining_date))) return { message: 'Invalid joining date', field: 'joining_date' };
  }
  // department: required on create
  if (!isUpdate && !String(input.department ?? '').trim()) {
    return { message: 'Department is required', field: 'department' };
  }
  // blood_group: allowlist when present
  if (supplied('blood_group')) {
    const v = String(input.blood_group ?? '').trim();
    if (v && !BLOOD_GROUPS.has(v.toUpperCase())) return { message: 'Invalid blood group', field: 'blood_group' };
  }
  // employee_id: length cap only (legacy formats exist — no format regex)
  if (supplied('employee_id')) {
    const v = String(input.employee_id ?? '').trim();
    if (v && v.length > MAX_EMPLOYEE_ID_LEN) {
      return { message: 'Employee ID must be 40 characters or fewer', field: 'employee_id' };
    }
  }
  return null;
};

// Duplicate pre-check for phone / email / employee_id. excludeId skips the
// row being updated so unchanged values don't false-positive.
const findDuplicate = async (field, value, excludeId = null) => {
  let query;
  const params = [value];
  if (field === 'email') {
    query = 'SELECT id FROM users WHERE LOWER(TRIM(COALESCE(email, \'\'))) = LOWER(TRIM($1))';
  } else if (field === 'phone') {
    query = 'SELECT id FROM users WHERE TRIM(COALESCE(phone, \'\')) = TRIM($1)';
  } else {
    query = 'SELECT id FROM users WHERE employee_id = $1';
  }
  if (excludeId !== null && excludeId !== undefined) {
    query += ` AND id <> $${params.length + 1}`;
    params.push(excludeId);
  }
  query += ' LIMIT 1';
  const res = await pool.query(query, params);
  return res.rows.length > 0;
};

const isEmployeeIdConflict = (error) => {
  const hay = `${error.constraint || ''} ${error.detail || ''}`.toLowerCase();
  return hay.includes('employee_id');
};

// Map a 23505 unique violation to the actual conflicting field by
// inspecting error.constraint / error.detail.
const uniqueViolationResponse = (error) => {
  const hay = `${error.constraint || ''} ${error.detail || ''}`.toLowerCase();
  if (hay.includes('phone')) return { status: 409, body: { message: 'This phone number is already in use', field: 'phone' } };
  if (hay.includes('email')) return { status: 409, body: { message: 'This email is already in use', field: 'email' } };
  if (hay.includes('employee_id')) return { status: 409, body: { message: 'This employee ID is already in use', field: 'employee_id' } };
  return { status: 409, body: { message: 'Duplicate value violates a unique constraint' } };
};

// Non-manager-safe row masking shared by list/detail responses.
const maskEmployeeRow = (user, currentUserId, viewerIsManager) => {
  const { password, ...userInfo } = user;
  if (Number(userInfo.id) !== currentUserId && !viewerIsManager) {
    userInfo.employee_id = null;
    // S1/S17: never expose NID / addresses to non-managers for other users
    userInfo.nid_number = null;
    userInfo.present_address = null;
    userInfo.permanent_address = null;
  }
  return userInfo;
};

const generateID = async () => {
  const prefix = 'SNKHL-';
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const combinedChars = letters + numbers;
  const MAX_ATTEMPTS = 20;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const digitPart = numbers.charAt(Math.floor(Math.random() * numbers.length));
    let randomPart = '';
    for (let i = 0; i < 3; i++) randomPart += combinedChars.charAt(Math.floor(Math.random() * combinedChars.length));
    const mixed = (digitPart + randomPart).split('').sort(() => 0.5 - Math.random()).join('');
    const candidateID = prefix + mixed;
    const res = await pool.query('SELECT id FROM users WHERE employee_id = $1', [candidateID]);
    if (res.rows.length === 0) return candidateID;
  }
  throw new Error('Failed to generate unique employee ID after maximum attempts');
};

const getNextEmployeeId = async (req, res) => {
  try { const id = await generateID(); res.json({ id }); }
  catch (error) { res.status(500).json({ message: 'Error generating ID' }); }
};

const getEmployees = async (req, res) => {
  try {
    const { search, dept, status } = req.query;
    const baseCols = 'SELECT id, employee_id, full_name, father_name, designation, email, role, department, status, phone, blood_group, profile_pic, present_address, permanent_address, nid_number, joining_date, reporting_manager, work_location, employment_type FROM users';
    const params = [];
    const conditions = [];
    const trimmedSearch = String(search ?? '').trim();
    if (trimmedSearch) {
      const idx = params.length + 1;
      conditions.push(`(full_name ILIKE $${idx} ESCAPE '\\' OR employee_id ILIKE $${idx} ESCAPE '\\' OR phone ILIKE $${idx} ESCAPE '\\' OR email ILIKE $${idx} ESCAPE '\\' OR designation ILIKE $${idx} ESCAPE '\\' OR department ILIKE $${idx} ESCAPE '\\')`);
      params.push(`%${escapeLike(trimmedSearch)}%`);
    }
    if (dept && String(dept).trim() !== '') {
      conditions.push(`LOWER(TRIM(COALESCE(department, ''))) = LOWER(TRIM($${params.length + 1}))`);
      params.push(String(dept).trim());
    }
    if (status && String(status).trim() !== '') {
      const s = String(status).trim().toLowerCase();
      if (s === 'active' || s === 'inactive') {
        conditions.push(`LOWER(TRIM(COALESCE(status, ''))) = $${params.length + 1}`);
        params.push(s);
      }
    }
    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    const statusOrder = ` ORDER BY CASE WHEN LOWER(TRIM(COALESCE(status, ''))) = 'active' THEN 0 ELSE 1 END, id DESC`;
    const currentUserId = Number(req.user?.id || 0);
    const viewerIsManager = canManageUsers(req.user);
    // BACKWARD COMPAT: no page/limit params → legacy plain array capped at 500.
    // With page/limit present → paginated { rows, total, page, limit }.
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    if (!paginated) {
      const result = await pool.query(baseCols + where + statusOrder + ' LIMIT 500', params);
      res.json(result.rows.map(user => maskEmployeeRow(user, currentUserId, viewerIsManager)));
      return;
    }
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(page) || page < 1) page = 1;
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;
    const offset = (page - 1) * limit;
    const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM users' + where, params);
    const total = countRes.rows[0]?.total ?? 0;
    const dataRes = await pool.query(
      baseCols + where + statusOrder + ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ rows: dataRes.rows.map(user => maskEmployeeRow(user, currentUserId, viewerIsManager)), total, page, limit });
  } catch (error) {
    console.error('getEmployees Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

const getDepartments = async (req, res) => {
  try { const result = await pool.query('SELECT * FROM departments ORDER BY dept_name ASC'); res.json(result.rows); }
  catch (error) { res.status(500).json({ message: 'Server Error' }); }
};

const addEmployee = async (req, res) => {
  try {
    if (!canManageUsers(req.user)) return res.status(403).json({ message: 'Unauthorized' });
    const validationError = validateEmployeeInput(req.body, { isUpdate: false });
    if (validationError) return res.status(400).json(validationError);
    const { full_name, designation, email, phone, emergency_phone, present_address, permanent_address, blood_group, nid_number, joining_date, password, department, role: employeeRole, status, reporting_manager, work_location, employment_type } = req.body;
    const father_name = (req.body.father_name || '').trim();
    const rawEmployeeId = (req.body.employee_id || '').trim();
    // SN-01 is reserved (master all_access holder) — privilege-escalation guard.
    // No format regex here: legacy employee_id formats exist in production.
    if (rawEmployeeId && isReservedEmployeeId(rawEmployeeId)) {
      return res.status(403).json({ message: 'This employee ID is reserved', field: 'employee_id' });
    }
    let employee_id = rawEmployeeId || await generateID();
    const serverGeneratedId = !rawEmployeeId;
    const profile_pic = req.files?.profile_pic ? req.files.profile_pic[0].filename : 'default.png';
    const nid_pic = req.files?.nid_pic ? req.files.nid_pic[0].filename : null;
    const can_take_action = ['admin', 'super admin', 'superadmin', 'hr'].includes(String(employeeRole || '').trim().toLowerCase()) ? 1 : 0;
    const j_date = (joining_date !== undefined && joining_date !== '') ? joining_date : new Date().toISOString().split('T')[0];
    const userStatus = status || 'Active';
    if (!password) return res.status(400).json({ message: 'Password is required', field: 'password' });
    if (String(password).length < MIN_PASSWORD_LEN) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LEN} characters`, field: 'password' });
    // Assigning the Admin role requires all_access (SN-01 master bypass stays).
    if (isPrivilegedRoleName(employeeRole) && !canGrantAllAccess(req.user)) {
      return res.status(403).json({ message: 'Only all-access admins can assign the Admin role', field: 'role' });
    }
    // Unknown role name → 400, never a silent role_id=NULL.
    // Legacy free-text roles (Manager/HR predate the roles table) keep role_id=NULL as today.
    // Trimmed before lookup so " Staff " resolves instead of 400.
    const roleNameToAssign = String(employeeRole || 'Staff').trim() || 'Staff';
    const roleIdRes = await pool.query('SELECT id, name, permissions FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1', [roleNameToAssign]);
    if (roleGrantsAllAccess(roleIdRes.rows[0]) && !canGrantAllAccess(req.user)) {
      return res.status(403).json({ message: 'Only all-access admins can assign an all-access role', field: 'role' });
    }
    let role_id = roleIdRes.rows[0]?.id || null;
    const canonicalRoleName = roleIdRes.rows[0]?.name || roleNameToAssign;
    if (!roleIdRes.rows[0] && !['manager', 'hr'].includes(roleNameToAssign.toLowerCase())) {
      return res.status(400).json({ message: 'Unknown role', field: 'role' });
    }
    // S2: always store bcrypt hash, never plaintext
    const pass = await bcrypt.hash(String(password), 10);
    // Duplicate pre-checks → 409 with field-specific messages.
    if (await findDuplicate('employee_id', employee_id)) {
      return res.status(409).json({ message: 'This employee ID is already in use', field: 'employee_id' });
    }
    if (phone && String(phone).trim() && await findDuplicate('phone', String(phone).trim())) {
      return res.status(409).json({ message: 'This phone number is already in use', field: 'phone' });
    }
    if (email && String(email).trim() && await findDuplicate('email', String(email).trim())) {
      return res.status(409).json({ message: 'This email is already in use', field: 'email' });
    }
    const query = 'INSERT INTO users (employee_id, full_name, father_name, designation, email, phone, emergency_phone, present_address, permanent_address, blood_group, nid_number, nid_pic, joining_date, password, must_change_password, role, role_id, department, can_take_action, profile_pic, status, reporting_manager, work_location, employment_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14,TRUE,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id, employee_id';
    const values = [employee_id, full_name, father_name, designation, email, phone, emergency_phone, present_address, permanent_address, normalizeBloodGroup(blood_group), nid_number, nid_pic, j_date, pass, canonicalRoleName, role_id, department, can_take_action, profile_pic, userStatus, reporting_manager || null, normalizeOfficeName(work_location), employment_type || null];
    // If the ID was server-generated and the INSERT races on employee_id,
    // regenerate and retry up to 3 times before surfacing a 409.
    let result;
    let idRetries = 0;
    while (true) {
      try {
        result = await pool.query(query, values);
        break;
      } catch (insertError) {
        if (insertError.code === '23505' && serverGeneratedId && isEmployeeIdConflict(insertError) && idRetries < 3) {
          idRetries += 1;
          employee_id = await generateID();
          values[0] = employee_id;
          continue;
        }
        throw insertError;
      }
    }
    res.locals.auditAction = "EMPLOYEE_CREATED";
    res.locals.auditUserId = result.rows[0].id;
    try {
      const { logProfileHistory: logHist2 } = require('../utilities/profileHistory');
      logHist2({
        employeeId: result.rows[0].id,
        actorId: Number(req.user?.id || 0) || null,
        actorName: req.user?.full_name || req.user?.name || null,
        source: 'employee_created',
        changes: [{ field: 'profile', old: null, new: `Created: ${full_name} (${employee_id})` }],
      });
    } catch (histErr) {
      console.error('[ProfileHistory] addEmployee hook failed:', histErr.message);
    }
    res.status(201).json({ message: 'Employee added successfully', employee_id: result.rows[0].employee_id });
  } catch (error) {
    if (error.code === '23505') {
      const { status: dupStatus, body } = uniqueViolationResponse(error);
      return res.status(dupStatus).json(body);
    }
    console.error('addEmployee Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const { id: currentUserId } = req.user;
    const targetUserId = parseInt(id, 10);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ message: 'Invalid employee ID' });
    if (targetUserId !== currentUserId && !canEditAnyProfile(req.user)) return res.status(403).json({ message: 'Unauthorized' });
    const result = await pool.query('SELECT u.id, u.employee_id, u.full_name, u.father_name, u.designation, u.email, u.role, u.role_id, r.name AS role_name, u.department, u.status, u.phone, u.emergency_phone, u.blood_group, u.profile_pic, u.present_address, u.permanent_address, u.nid_number, u.joining_date, u.reporting_manager, u.work_location, u.employment_type, u.token_version FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const user = result.rows[0];
    // Single source of truth for display: prefer the joined role name when
    // role_id is set, so Manage-Permissions assigns never look stale here.
    if (user.role_id && user.role_name) user.role = user.role_name;
    delete user.password;
    // S1: token_version is session-security internals — never expose.
    // Non-managers viewing someone else get a reduced column set.
    delete user.token_version;
    if (targetUserId !== currentUserId && !canManageUsers(req.user)) {
      user.nid_number = null;
      user.present_address = null;
      user.permanent_address = null;
    }
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?.id;
    const targetUserId = parseInt(id, 10);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ message: 'Invalid employee ID' });
    const isSelf = targetUserId === Number(currentUserId);
    const hasOverrideEdit = canEditAnyProfile(req.user);
    if (targetUserId !== currentUserId && !hasOverrideEdit) return res.status(403).json({ message: 'Unauthorized' });
    // Supplied-fields-only validation on update.
    const validationError = validateEmployeeInput(req.body, { isUpdate: true });
    if (validationError) return res.status(400).json(validationError);
    // Self-service password changes must go through Change Password
    // (current password required). Managers resetting OTHER users' passwords
    // here is still allowed without the current password.
    if (isSelf && req.body.password !== undefined && String(req.body.password).trim() !== '') {
      return res.status(400).json({ message: 'Use Change Password (current password required)' });
    }
    const currentDataRes = await pool.query('SELECT id, employee_id, full_name, father_name, designation, email, phone, emergency_phone, present_address, permanent_address, blood_group, nid_number, nid_pic, joining_date, password, role, role_id, department, can_take_action, profile_pic, status, reporting_manager, work_location, employment_type, token_version, (SELECT r.name FROM roles r WHERE r.id = users.role_id) AS role_name FROM users WHERE id = $1', [id]);
    if (currentDataRes.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    const currentUserData = currentDataRes.rows[0];
    let { full_name, designation, email, phone, joining_date, password, role, department, emergency_phone, nid_number, blood_group, present_address, permanent_address, status, reporting_manager, work_location, employment_type } = req.body;
    let employee_id = req.body.employee_id !== undefined ? String(req.body.employee_id).trim() : currentUserData.employee_id;
    if (!employee_id) employee_id = currentUserData.employee_id;
    // SN-01 is reserved (master all_access holder): reject only when the value
    // is being changed to a different value that equals SN-01 (case-insensitive).
    // No format regex here: legacy employee_id formats exist in production.
    if (String(employee_id || '').trim() && isReservedEmployeeId(employee_id) &&
        String(employee_id).trim().toLowerCase() !== String(currentUserData.employee_id || '').trim().toLowerCase()) {
      return res.status(403).json({ message: 'This employee ID is reserved', field: 'employee_id' });
    }
    const father_name = req.body.father_name !== undefined ? String(req.body.father_name).trim() : (currentUserData.father_name || '');
    full_name = full_name !== undefined ? full_name : currentUserData.full_name;
    designation = designation !== undefined ? designation : currentUserData.designation;
    email = email !== undefined ? email : currentUserData.email;
    phone = phone !== undefined ? phone : currentUserData.phone;
    joining_date = (joining_date !== undefined && joining_date !== '') ? joining_date : currentUserData.joining_date;
    // A non-empty unparseable joining_date is a 400 — never a silent fallback.
    if (joining_date !== undefined && joining_date !== null && joining_date !== '' && isNaN(Date.parse(joining_date))) {
      return res.status(400).json({ message: 'Invalid joining date', field: 'joining_date' });
    }
    role = role !== undefined ? role : currentUserData.role;
    department = department !== undefined ? department : currentUserData.department;
    emergency_phone = emergency_phone !== undefined ? emergency_phone : currentUserData.emergency_phone;
    nid_number = nid_number !== undefined ? nid_number : currentUserData.nid_number;
    blood_group = blood_group !== undefined ? normalizeBloodGroup(blood_group) : currentUserData.blood_group;
    present_address = present_address !== undefined ? present_address : currentUserData.present_address;
    permanent_address = permanent_address !== undefined ? permanent_address : currentUserData.permanent_address;
    status = status !== undefined ? status : currentUserData.status;
    reporting_manager = reporting_manager !== undefined ? reporting_manager : currentUserData.reporting_manager;
    work_location = work_location !== undefined ? normalizeOfficeName(work_location) : currentUserData.work_location;
    employment_type = employment_type !== undefined ? employment_type : currentUserData.employment_type;
    // Old files are deleted only AFTER a successful UPDATE (see below);
    // newly uploaded files are tracked so the catch block can clean them up.
    const oldProfilePic = currentUserData.profile_pic;
    const oldNidPic = currentUserData.nid_pic;
    let profile_pic = currentUserData.profile_pic;
    let nid_pic = currentUserData.nid_pic;
    const newProfilePic = req.files?.profile_pic ? req.files.profile_pic[0].filename : null;
    const newNidPic = req.files?.nid_pic ? req.files.nid_pic[0].filename : null;
    if (newProfilePic) {
      const savedPath = path.join(UPLOADS_DIR, path.basename(String(newProfilePic)));
      try { await fsp.access(savedPath); }
      catch (_) { console.error('Uploaded profile_pic not found on disk:', savedPath); }
      profile_pic = newProfilePic;
    }
    if (newNidPic) {
      nid_pic = newNidPic;
    }
    const currentRoleName = currentUserData.role_name || currentUserData.role;
    // 403 gate compares RAW trimmed values: canonicalizing first would hide
    // alias rewrites (Sonadanga→Shonadanga Office) from non-managers.
    const rawWorkLocation = req.body.work_location !== undefined ? String(req.body.work_location).trim() : null;
    const workLocationChanged = rawWorkLocation !== null &&
      rawWorkLocation !== String(currentUserData.work_location || '').trim();
    if (workLocationChanged && !canManageUsers(req.user)) {
      return res.status(403).json({ message: 'Only user managers can change an employee work location.' });
    }
    const roleChanged = req.body.role !== undefined && !isSelf && canManageUsers(req.user) &&
      String(currentRoleName || '').trim().toLowerCase() !== String(req.body.role || '').trim().toLowerCase();
    if (roleChanged && isPrivilegedRoleName(req.body.role) && !canGrantAllAccess(req.user)) {
      return res.status(403).json({ message: 'Only all-access admins can assign the Admin role', field: 'role' });
    }
    // S1: privilege fields (role/status/employee_id) are users.manage-only.
    // A caller can never change their OWN role/status/employee_id either.
    const isManager = canManageUsers(req.user);
    if (isManager && !isSelf && !canGrantAllAccess(req.user)) {
      const securityMutation = (password && String(password).trim() !== '') ||
        roleChanged || workLocationChanged || ['status', 'employee_id'].some((field) => req.body[field] !== undefined &&
          String(req.body[field] || '').trim().toLowerCase() !== String(currentUserData[field] || '').trim().toLowerCase());
      if (securityMutation) {
        const targetAccess = await getEffectivePermissions(currentUserData);
        if (targetAccess.isSuperAdmin || roleGrantsAllAccess(targetAccess)) {
          return res.status(403).json({ message: 'Only all-access admins can change security settings for an all-access user' });
        }
      }
    }
    if (!isManager) {
      role = currentUserData.role;
      status = currentUserData.status;
      employee_id = currentUserData.employee_id;
    } else if (isSelf) {
      role = currentUserData.role;
      status = currentUserData.status;
      employee_id = currentUserData.employee_id;
    }
    // S2: hash any newly supplied password; non-managers may not set
    // passwords for OTHER users (profile fields only).
    let passwordChanged = false;
    let newPassword = currentUserData.password;
    const passwordSupplied = password && String(password).trim() !== '';
    if (passwordSupplied && (isManager || isSelf)) {
      if (String(password).length < MIN_PASSWORD_LEN) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
      // Admin resets of ANOTHER user's password: ban guessable IDs and force
      // rotation (admin knows the value → silent sharing otherwise).
      if (isManager && !isSelf) {
        const resetIds = [String(currentUserData.phone || '').trim(), String(currentUserData.employee_id || '').trim()].filter(Boolean);
        if (resetIds.includes(String(password).trim())) {
          return res.status(400).json({ message: 'Phone number or employee ID cannot be used as password' });
        }
      }
      newPassword = await bcrypt.hash(String(password), 10);
      passwordChanged = true;
    } else if (passwordSupplied && !BCRYPT_RE.test(String(currentUserData.password || ''))) {
      // Legacy plaintext row being re-saved without a new password — upgrade opportunistically
      newPassword = await bcrypt.hash(String(currentUserData.password), 10);
      passwordChanged = false;
    }
    // Duplicate pre-checks on supplied fields (exclude self) → 409 field-specific.
    if (req.body.employee_id !== undefined && employee_id && await findDuplicate('employee_id', employee_id, targetUserId)) {
      return res.status(409).json({ message: 'This employee ID is already in use', field: 'employee_id' });
    }
    if (req.body.phone !== undefined && phone && String(phone).trim() && await findDuplicate('phone', String(phone).trim(), targetUserId)) {
      return res.status(409).json({ message: 'This phone number is already in use', field: 'phone' });
    }
    if (req.body.email !== undefined && email && String(email).trim() && await findDuplicate('email', String(email).trim(), targetUserId)) {
      return res.status(409).json({ message: 'This email is already in use', field: 'email' });
    }
    let query, values;
    let tokenVersionInc = '';
    let adminResetOther = false;
    if (isManager) {
      const roleText = roleChanged ? String(role || '').trim() : String(currentRoleName || '').trim();
      role = roleText;
      const can_take_action = roleChanged
        ? (['admin', 'super admin', 'superadmin', 'hr'].includes(roleText.toLowerCase()) ? 1 : 0)
        : currentUserData.can_take_action;
      const updatedStatus = status || 'Active';
      // Only an explicit role change may replace the current role assignment.
      let role_id = currentUserData.role_id || null;
      if (roleChanged) {
        const roleIdRes = await pool.query('SELECT id, name, permissions FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1', [roleText]);
        if (roleGrantsAllAccess(roleIdRes.rows[0]) && !canGrantAllAccess(req.user)) {
          return res.status(403).json({ message: 'Only all-access admins can assign an all-access role', field: 'role' });
        }
        if (!roleIdRes.rows[0] && !['manager', 'hr'].includes(roleText.toLowerCase())) {
          return res.status(400).json({ message: 'Unknown role', field: 'role' });
        }
        role_id = roleIdRes.rows[0]?.id || null;
        role = roleIdRes.rows[0]?.name || roleText;
      }
      // Increment token_version on password change AND on privilege change
      // (role/status/employee_id) so demoted users lose old powers immediately.
      const privilegeChanged = isManager && (
        roleChanged ||
        workLocationChanged ||
        String(status || '').trim().toLowerCase() !== String(currentUserData.status || '').trim().toLowerCase() ||
        String(employee_id || '').trim().toLowerCase() !== String(currentUserData.employee_id || '').trim().toLowerCase()
      );
      tokenVersionInc = (passwordChanged || privilegeChanged) ? ', token_version = COALESCE(token_version, 0) + 1' : '';
      // Admin-chosen passwords are known to the admin: force rotation + audit.
      adminResetOther = isManager && !isSelf && passwordChanged;
      const forceChangeSql = adminResetOther ? ', must_change_password = TRUE' : '';
      query = `UPDATE users SET employee_id=$1, full_name=$2, father_name=$3, designation=$4, email=$5, phone=$6, joining_date=$7::date, password=$8, role=$9, role_id=$10, department=$11, can_take_action=$12, profile_pic=$13, emergency_phone=$14, nid_number=$15, nid_pic=$16, blood_group=$17, present_address=$18, permanent_address=$19, status=$20, reporting_manager=$21, work_location=$22, employment_type=$23${tokenVersionInc}${forceChangeSql} WHERE id=$24`;
      values = [employee_id, full_name, father_name, designation, email, phone, joining_date, newPassword, role, role_id, department, can_take_action, profile_pic, emergency_phone, nid_number, nid_pic, blood_group, present_address, permanent_address, updatedStatus, reporting_manager || null, work_location || null, employment_type || null, id];
    } else if (!isSelf && hasOverrideEdit) {
      // HR-style edit: profile fields only — no password/role/status/employee_id.
      // Non-managers cannot read NID/addresses (masked nulls in the form), so
      // ignore supplied values here — masked nulls must never clobber real PII.
      nid_number = currentUserData.nid_number;
      present_address = currentUserData.present_address;
      permanent_address = currentUserData.permanent_address;
      query = `UPDATE users SET full_name=$1, father_name=$2, designation=$3, email=$4, phone=$5, joining_date=$6::date, department=$7, profile_pic=$8, emergency_phone=$9, nid_number=$10, nid_pic=$11, blood_group=$12, present_address=$13, permanent_address=$14, reporting_manager=$15, work_location=$16, employment_type=$17 WHERE id=$18`;
      values = [full_name, father_name, designation, email, phone, joining_date, department, profile_pic, emergency_phone, nid_number, nid_pic, blood_group, present_address, permanent_address, reporting_manager || null, work_location || null, employment_type || null, id];
    } else {
      if (!passwordChanged) return res.status(400).json({ message: 'Nothing to update' });
      query = 'UPDATE users SET password=$1, token_version = COALESCE(token_version, 0) + 1 WHERE id=$2';
      tokenVersionInc = ', token_version = COALESCE(token_version, 0) + 1';
      values = [newPassword, id];
    }
    // Do not restore an old password/role snapshot after a concurrent reset
    // or promotion, nor apply a checked mutation to a newly privileged target.
    values.push(currentUserData.token_version || 0);
    query += ` AND COALESCE(token_version, 0) = $${values.length}`;
    const updated = await pool.query(query, values);
    if (updated.rowCount === 0) {
      return res.status(409).json({ message: 'Employee security settings changed. Please reload and retry.' });
    }
    // Profile change history: old->new diff + updated_at/by stamp (never fails the request).
    try {
      const afterRes = await pool.query(
        'SELECT employee_id, full_name, father_name, designation, email, phone, emergency_phone, present_address, permanent_address, blood_group, nid_number, joining_date, department, role, role_id, status, reporting_manager, work_location, employment_type, profile_pic, nid_pic FROM users WHERE id = $1',
        [id],
      );
      const after = afterRes.rows[0] || {};
      const changes = diffProfile(currentUserData, after);
      if (changes.length > 0) {
        await pool.query('UPDATE users SET updated_at = NOW(), updated_by = $2 WHERE id = $1', [id, currentUserId]);
        logProfileHistory({
          employeeId: targetUserId,
          actorId: currentUserId,
          actorName: req.user?.full_name || req.user?.name || null,
          source: 'profile_update',
          changes,
        });
      }
    } catch (histErr) {
      console.error('[ProfileHistory] updateEmployee hook failed:', histErr.message);
    }
    if (tokenVersionInc) {
      try {
        require('../middleware/auth').evictAuthCache(id);
      } catch (_) {}
    }
    if (adminResetOther) {
      res.locals.auditAction = "ADMIN_PASSWORD_RESET";
      res.locals.auditUserId = targetUserId;
    }
    // Delete replaced files only AFTER the successful UPDATE above.
    if (newProfilePic && oldProfilePic && oldProfilePic !== 'default.png' && String(oldProfilePic) !== String(profile_pic)) {
      try { await fsp.unlink(path.join(UPLOADS_DIR, path.basename(String(oldProfilePic)))); }
      catch (cleanupErr) { console.error('Old profile_pic cleanup failed:', cleanupErr.message); }
    }
    if (newNidPic && oldNidPic && String(oldNidPic) !== String(nid_pic)) {
      try { await fsp.unlink(path.join(UPLOADS_DIR, path.basename(String(oldNidPic)))); }
      catch (cleanupErr) { console.error('Old nid_pic cleanup failed:', cleanupErr.message); }
    }
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    // Best-effort delete of newly uploaded files when the UPDATE failed.
    for (const f of [req.files?.profile_pic?.[0]?.filename, req.files?.nid_pic?.[0]?.filename].filter(Boolean)) {
      try { await fsp.unlink(path.join(UPLOADS_DIR, path.basename(String(f)))); }
      catch (_) { /* best-effort cleanup */ }
    }
    if (error.code === '23505') {
      const { status: dupStatus, body } = uniqueViolationResponse(error);
      return res.status(dupStatus).json(body);
    }
    console.error('updateEmployee Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

// NEW: Toggle employee active/inactive
const toggleEmployeeStatus = async (req, res) => {
  try {
    if (!canManageUsers(req.user)) return res.status(403).json({ message: 'Unauthorized: Only admins can change employee status' });
    const { id } = req.params;
    const targetUserId = parseInt(id, 10);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ message: 'Invalid employee ID' });
    if (targetUserId === Number(req.user?.id)) return res.status(400).json({ message: 'You cannot change your own status' });
    const currentRes = await pool.query('SELECT id, full_name, status, employee_id, role, role_id, token_version FROM users WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) return res.status(404).json({ message: 'Employee not found' });
    if (!canGrantAllAccess(req.user)) {
      const targetAccess = await getEffectivePermissions(currentRes.rows[0]);
      if (targetAccess.isSuperAdmin || roleGrantsAllAccess(targetAccess)) {
        return res.status(403).json({ message: 'Only all-access admins can change security settings for an all-access user' });
      }
    }
    const currentStatus = String(currentRes.rows[0].status ?? '').trim().toLowerCase();
    if (currentStatus !== 'active' && currentStatus !== 'inactive') {
      return res.status(400).json({ message: 'Employee has an invalid status' });
    }
    const newStatus = currentStatus === 'active' ? 'Inactive' : 'Active';
    // Bump token_version in the same UPDATE so existing JWTs die with the status flip.
    const updated = await pool.query('UPDATE users SET status = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2 AND COALESCE(token_version, 0) = $3', [newStatus, id, currentRes.rows[0].token_version || 0]);
    if (updated.rowCount === 0) {
      return res.status(409).json({ message: 'Employee security settings changed. Please reload and retry.' });
    }
    require('../middleware/auth').evictAuthCache(id);
    try {
      const { logProfileHistory: logHist } = require('../utilities/profileHistory');
      logHist({
        employeeId: targetUserId,
        actorId: Number(req.user?.id || 0) || null,
        actorName: req.user?.full_name || req.user?.name || null,
        source: 'status_toggle',
        changes: [{ field: 'status', old: currentStatus === 'active' ? 'Active' : 'Inactive', new: newStatus }],
      });
      await pool.query('UPDATE users SET updated_at = NOW(), updated_by = $2 WHERE id = $1', [id, Number(req.user?.id || 0)]);
    } catch (histErr) {
      console.error('[ProfileHistory] toggleStatus hook failed:', histErr.message);
    }
    res.json({ message: `Employee status updated to ${newStatus}`, id: targetUserId, name: currentRes.rows[0].full_name, old_status: currentStatus === 'active' ? 'Active' : 'Inactive', new_status: newStatus });
  } catch (error) {
    console.error('toggleEmployeeStatus Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

const resetEmployeePassword = async (req, res) => {
  try {
    if (!canManageUsers(req.user)) return res.status(403).json({ message: 'Unauthorized: Only admins can reset employee passwords' });
    const targetUserId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ message: 'Invalid employee ID' });
    if (targetUserId === Number(req.user?.id)) return res.status(400).json({ message: 'You cannot reset your own password here' });

    const currentRes = await pool.query(
      'SELECT id, full_name, role, role_id, token_version FROM users WHERE id = $1',
      [targetUserId],
    );
    if (currentRes.rows.length === 0) return res.status(404).json({ message: 'Employee not found' });
    const currentUser = currentRes.rows[0];
    if (!canGrantAllAccess(req.user)) {
      const targetAccess = await getEffectivePermissions(currentUser);
      if (targetAccess.isSuperAdmin || roleGrantsAllAccess(targetAccess)) {
        return res.status(403).json({ message: 'Only all-access admins can reset an all-access user password' });
      }
    }

    if (!DEFAULT_RESET_PASSWORD) {
      return res.status(500).json({ message: 'Password reset is not configured (DEFAULT_RESET_PASSWORD missing)' });
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_RESET_PASSWORD, 10);
    const updated = await pool.query(
      `UPDATE users
       SET password = $1, must_change_password = TRUE,
           token_version = COALESCE(token_version, 0) + 1,
           updated_at = NOW(), updated_by = $2
       WHERE id = $3 AND COALESCE(token_version, 0) = $4`,
      [hashedPassword, Number(req.user.id), targetUserId, currentUser.token_version || 0],
    );
    if (updated.rowCount === 0) {
      return res.status(409).json({ message: 'Employee security settings changed. Please reload and retry.' });
    }

    require('../middleware/auth').evictAuthCache(targetUserId);
    res.locals.auditAction = 'ADMIN_PASSWORD_RESET';
    res.locals.auditUserId = targetUserId;
    return res.json({ message: 'Password reset successfully. Employee must change it after logging in.' });
  } catch (error) {
    console.error('resetEmployeePassword Error:', error);
    return res.status(500).json({ message: 'Database Error' });
  }
};

// Profile change history: old->new diff per edit (permanent, unlike 30d audit).
// Visible to self, user managers, and anyone who can edit profiles.
const getProfileHistory = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetUserId)) return res.status(400).json({ message: 'Invalid employee ID' });
    const isSelf = targetUserId === Number(req.user?.id);
    const canView = isSelf || canManageUsers(req.user) || canEditAnyProfile(req.user)
      || resolvePermission(req.user, 'employees.create_edit');
    if (!canView) return res.status(403).json({ message: 'Unauthorized' });
    const { ensureProfileHistoryTable } = require('../utilities/profileHistory');
    await ensureProfileHistoryTable();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const hist = await pool.query(
      `SELECT id, employee_id, changed_by, changed_by_name, change_source, changes, created_at
       FROM employee_profile_history WHERE employee_id = $1 ORDER BY id DESC LIMIT $2`,
      [targetUserId, limit],
    );
    // Companion: API audit rows that touched this profile (mutations only).
    let auditRows = [];
    try {
      const audit = await pool.query(
        `SELECT id, created_at, user_id, user_name, action_type, http_method, route_path,
                request_body, response_status, success
         FROM audit_logs
         WHERE route_path LIKE $1 OR route_path LIKE $2
         ORDER BY id DESC LIMIT $3`,
        [`%/api/employees/${targetUserId}`, `%/api/employees/${targetUserId}?%`, Math.min(limit, 50)],
      );
      auditRows = audit.rows;
    } catch (_) { auditRows = []; }
    res.json({ history: hist.rows, audit: auditRows });
  } catch (error) {
    console.error('getProfileHistory Error:', error.message);
    res.status(500).json({ message: 'Database Error' });
  }
};

module.exports = { getEmployees, getDepartments, getNextEmployeeId, addEmployee, getEmployeeById, updateEmployee, toggleEmployeeStatus, resetEmployeePassword, getProfileHistory };
