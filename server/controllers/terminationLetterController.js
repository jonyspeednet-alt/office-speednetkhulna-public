const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS termination_letters (
      id SERIAL PRIMARY KEY,
      employee_name TEXT,
      employee_id TEXT,
      form_data JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}
ensureTable().catch(err => console.error('[terminationLetters] Table init error:', err.message));

exports.saveLetter = async (req, res) => {
  try {
    const { employee_name, employee_id, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (form_data && Object.prototype.hasOwnProperty.call(form_data, 'lastWorkingDate') && !String(form_data.lastWorkingDate || '').trim()) return res.status(400).json({ error: 'Last working date is required' });
    const result = await pool.query(
      `INSERT INTO termination_letters (employee_name, employee_id, form_data, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [employee_name || null, employee_id || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[terminationLetters] save error:', err.message);
    res.status(500).json({ error: 'Failed to save letter' });
  }
};

exports.getMyLetters = async (req, res) => {
  try {
    const created_by = req.user?.id;
    const result = await pool.query(
      `SELECT id, employee_name, employee_id, created_at, updated_at
       FROM termination_letters WHERE created_by = $1 ORDER BY updated_at DESC`,
      [created_by]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[terminationLetters] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letters' });
  }
};

exports.getLetterById = async (req, res) => {
  try {
    const { id } = req.params;
    const created_by = req.user?.id;
    const result = await pool.query(
      `SELECT * FROM termination_letters WHERE id = $1 AND created_by = $2`,
      [id, created_by]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[terminationLetters] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letter' });
  }
};

exports.updateLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, form_data } = req.body;
    const created_by = req.user?.id;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (form_data && Object.prototype.hasOwnProperty.call(form_data, 'lastWorkingDate') && !String(form_data.lastWorkingDate || '').trim()) return res.status(400).json({ error: 'Last working date is required' });
    const result = await pool.query(
      `UPDATE termination_letters
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           form_data = COALESCE($3, form_data),
           updated_at = NOW()
       WHERE id = $4 AND created_by = $5 RETURNING *`,
      [employee_name, employee_id, form_data ? JSON.stringify(form_data) : null, id, created_by]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[terminationLetters] update error:', err.message);
    res.status(500).json({ error: 'Failed to update letter' });
  }
};

exports.deleteLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const created_by = req.user?.id;
    const result = await pool.query(
      `DELETE FROM termination_letters WHERE id = $1 AND created_by = $2 RETURNING id`,
      [id, created_by]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[terminationLetters] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete letter' });
  }
};

// Next serial per year. No UNIQUE constraint on this legacy table
// (duplicates may exist) — race-tolerant count+1 is fine.
// NOTE: route wiring (GET /next-numbers BEFORE GET /:id) must be added
// centrally in server/routes/terminationLetterRoutes.js (not owned here).
exports.getNextNumbers = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM termination_letters WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(3, '0');
    res.json({
      refNo: serial,
      year: String(year),
      ref: `SN/HR/TERM/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[terminationLetters] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};
