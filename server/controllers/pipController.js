const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pips (
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
  // Unique serial per PIP (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pips_ref_no_key') THEN
        ALTER TABLE pips ADD CONSTRAINT pips_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[pips] Table init error:', err.message));

exports.savePip = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `INSERT INTO pips (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Ref no already exists — please use the next serial' });
    console.error('[pips] save error:', err.message);
    res.status(500).json({ error: 'Failed to save PIP' });
  }
};

exports.getMyPips = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.employee_name, p.employee_id, p.ref_no, p.created_at, p.updated_at, p.created_by, u.full_name as created_by_name
       FROM pips p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[pips] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch PIPs' });
  }
};

exports.getPipById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM pips WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'PIP not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[pips] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch PIP' });
  }
};

exports.updatePip = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `UPDATE pips
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'PIP not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Ref no already exists — please use the next serial' });
    console.error('[pips] update error:', err.message);
    res.status(500).json({ error: 'Failed to update PIP' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM pips WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/PIP/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[pips] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deletePip = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM pips WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'PIP not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[pips] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete PIP' });
  }
};
