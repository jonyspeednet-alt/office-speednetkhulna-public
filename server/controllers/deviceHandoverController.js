const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_handovers (
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
  // Unique serial per form (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_handovers_ref_no_key') THEN
        ALTER TABLE device_handovers ADD CONSTRAINT device_handovers_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[deviceHandovers] Table init error:', err.message));

exports.saveForm = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `INSERT INTO device_handovers (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[deviceHandovers] save error:', err.message);
    res.status(500).json({ error: 'Failed to save form' });
  }
};

exports.getMyForms = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dh.id, dh.employee_name, dh.employee_id, dh.ref_no, dh.created_at, dh.updated_at, dh.created_by, u.full_name as created_by_name
       FROM device_handovers dh LEFT JOIN users u ON u.id = dh.created_by ORDER BY dh.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[deviceHandovers] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
};

exports.getFormById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM device_handovers WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[deviceHandovers] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
};

exports.updateForm = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `UPDATE device_handovers
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[deviceHandovers] update error:', err.message);
    res.status(500).json({ error: 'Failed to update form' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM device_handovers WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/DH/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[deviceHandovers] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteForm = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM device_handovers WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[deviceHandovers] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete form' });
  }
};
