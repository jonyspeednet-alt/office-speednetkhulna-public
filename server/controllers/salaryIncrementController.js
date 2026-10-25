const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_increments (
      id SERIAL PRIMARY KEY,
      employee_name TEXT,
      employee_id TEXT,
      ref_no TEXT,
      form_data JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Unique serial per letter (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_increments_ref_no_key') THEN
        ALTER TABLE salary_increments ADD CONSTRAINT salary_increments_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[salaryIncrements] Table init error:', err.message));

exports.saveLetter = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `INSERT INTO salary_increments (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Ref no already exists — please use the next serial' });
    console.error('[salaryIncrements] save error:', err.message);
    res.status(500).json({ error: 'Failed to save letter' });
  }
};

exports.getMyLetters = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.employee_name, s.employee_id, s.ref_no, s.created_at, s.updated_at, s.created_by, u.full_name as created_by_name
       FROM salary_increments s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[salaryIncrements] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letters' });
  }
};

exports.getLetterById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM salary_increments WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[salaryIncrements] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch letter' });
  }
};

exports.updateLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `UPDATE salary_increments
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Ref no already exists — please use the next serial' });
    console.error('[salaryIncrements] update error:', err.message);
    res.status(500).json({ error: 'Failed to update letter' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM salary_increments WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/SIL/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[salaryIncrements] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM salary_increments WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Letter not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[salaryIncrements] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete letter' });
  }
};
