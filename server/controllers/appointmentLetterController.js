const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_letters (
      id SERIAL PRIMARY KEY,
      employee_name TEXT,
      employee_id TEXT,
      letter_type TEXT,
      form_data JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}
ensureTable().catch(err => console.error('[appointmentLetters] Table init error:', err.message));

exports.saveLetter = async (req, res) => {
  try {
    const { employee_name, employee_id, letter_type, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `INSERT INTO appointment_letters (employee_name, employee_id, letter_type, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, letter_type || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[appointmentLetters] save error:', err.message);
    res.status(500).json({ error: 'Failed to save letter' });
  }
};

exports.getMyLetters = async (req, res) => {
  try {
    // Fix: show ALL letters to anyone with appointment_letters.generate permission (Super Admin / HR)
    // Previously filtered by created_by, so Super Admin (id=1) saw 0 rows when letters were created by HR (id=84)
    const result = await pool.query(
      `SELECT al.id, al.employee_name, al.employee_id, al.letter_type, al.created_at, al.updated_at, al.created_by, u.full_name as created_by_name
       FROM appointment_letters al LEFT JOIN users u ON u.id = al.created_by ORDER BY al.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[appointmentLetters] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letters' });
  }
};

exports.getLetterById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM appointment_letters WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[appointmentLetters] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letter' });
  }
};

exports.updateLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, letter_type, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `UPDATE appointment_letters
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           letter_type = COALESCE($3, letter_type),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, letter_type, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[appointmentLetters] update error:', err.message);
    res.status(500).json({ error: 'Failed to update letter' });
  }
};

exports.deleteLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM appointment_letters WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[appointmentLetters] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete letter' });
  }
};

// Next serial per (letter_type, year). No UNIQUE constraint on this legacy
// table (duplicates may exist) — race-tolerant count+1 is fine.
// NOTE: route wiring (GET /next-numbers BEFORE GET /:id) must be added
// centrally in server/routes/appointmentLetterRoutes.js (not owned here).
exports.getNextNumbers = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const letterType = req.query.letter_type || 'probationary';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM appointment_letters WHERE letter_type = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
      [letterType, year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(3, '0');
    res.json({
      refNo: serial,
      year: String(year),
      ref: `SN/HR/APPT/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[appointmentLetters] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};
