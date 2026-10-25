const pool = require('./db');

// Fields tracked in employee_profile_history. Password hashes are NEVER stored.
const TRACKED_FIELDS = [
  'employee_id', 'full_name', 'father_name', 'designation', 'email', 'phone',
  'emergency_phone', 'present_address', 'permanent_address', 'blood_group',
  'nid_number', 'joining_date', 'department', 'role', 'role_id', 'status',
  'reporting_manager', 'work_location', 'employment_type', 'profile_pic', 'nid_pic',
];

const norm = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' ? null : s;
};

// Build [{field, old, new}] for changed tracked fields only.
const diffProfile = (oldRow = {}, newVals = {}) => {
  const changes = [];
  for (const f of TRACKED_FIELDS) {
    if (!(f in newVals)) continue;
    const oldV = norm(oldRow[f]);
    const newV = norm(newVals[f]);
    if (oldV !== newV) changes.push({ field: f, old: oldRow[f] ?? null, new: newVals[f] ?? null });
  }
  return changes;
};

const ensureProfileHistoryTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_profile_history (
      id BIGSERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      changed_by INTEGER NULL,
      changed_by_name TEXT NULL,
      change_source TEXT NOT NULL DEFAULT 'profile_update',
      changes JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_profile_history_employee ON employee_profile_history (employee_id, created_at DESC)');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_profile_history_changed_by ON employee_profile_history (changed_by)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER NULL');
};

// Fire-and-forget: history must never break the profile update itself.
const logProfileHistory = async ({ employeeId, actorId, actorName, source, changes }) => {
  try {
    if (!changes || changes.length === 0) return;
    await ensureProfileHistoryTable();
    await pool.query(
      `INSERT INTO employee_profile_history
        (employee_id, changed_by, changed_by_name, change_source, changes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [employeeId, actorId || null, actorName || null, source || 'profile_update', JSON.stringify(changes)],
    );
  } catch (err) {
    console.error('[ProfileHistory] insert failed:', err.message);
  }
};

module.exports = { TRACKED_FIELDS, diffProfile, ensureProfileHistoryTable, logProfileHistory };
