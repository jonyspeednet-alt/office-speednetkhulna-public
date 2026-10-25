const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_suggestions (
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
  // Unique serial per suggestion (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_suggestions_ref_no_key') THEN
        ALTER TABLE employee_suggestions ADD CONSTRAINT employee_suggestions_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[employeeSuggestions] Table init error:', err.message));

exports.saveSuggestion = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    const issue = form_data?.issueDescription ? String(form_data.issueDescription).trim() : '';
    const suggestion = form_data?.suggestion ? String(form_data.suggestion).trim() : '';
    if (!issue && !suggestion) return res.status(400).json({ error: 'Issue description or suggestion is required' });
    const result = await pool.query(
      `INSERT INTO employee_suggestions (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[employeeSuggestions] save error:', err.message);
    res.status(500).json({ error: 'Failed to save suggestion' });
  }
};

exports.getMySuggestions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT es.id, es.employee_name, es.employee_id, es.ref_no, es.created_at, es.updated_at, es.created_by, u.full_name as created_by_name
       FROM employee_suggestions es LEFT JOIN users u ON u.id = es.created_by ORDER BY es.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[employeeSuggestions] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
};

exports.getSuggestionById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM employee_suggestions WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Suggestion not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[employeeSuggestions] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch suggestion' });
  }
};

exports.updateSuggestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (form_data !== undefined) {
      const issue = form_data?.issueDescription ? String(form_data.issueDescription).trim() : '';
      const suggestion = form_data?.suggestion ? String(form_data.suggestion).trim() : '';
      if (!issue && !suggestion) return res.status(400).json({ error: 'Issue description or suggestion is required' });
    }
    const result = await pool.query(
      `UPDATE employee_suggestions
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Suggestion not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[employeeSuggestions] update error:', err.message);
    res.status(500).json({ error: 'Failed to update suggestion' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM employee_suggestions WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/SUG/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[employeeSuggestions] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteSuggestion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM employee_suggestions WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Suggestion not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[employeeSuggestions] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete suggestion' });
  }
};
