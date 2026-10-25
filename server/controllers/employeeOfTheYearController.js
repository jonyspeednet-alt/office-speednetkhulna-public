const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_of_the_year (
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
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_of_the_year_ref_no_key') THEN
        ALTER TABLE employee_of_the_year ADD CONSTRAINT employee_of_the_year_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[employeeOfTheYear] Table init error:', err.message));

exports.saveRecord = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `INSERT INTO employee_of_the_year (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[employeeOfTheYear] save error:', err.message);
    res.status(500).json({ error: 'Failed to save record' });
  }
};

exports.getMyRecords = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ey.id, ey.employee_name, ey.employee_id, ey.ref_no, ey.created_at, ey.updated_at, ey.created_by, u.full_name as created_by_name
       FROM employee_of_the_year ey LEFT JOIN users u ON u.id = ey.created_by ORDER BY ey.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[employeeOfTheYear] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
};

exports.getRecordById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM employee_of_the_year WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[employeeOfTheYear] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch record' });
  }
};

exports.updateRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    const result = await pool.query(
      `UPDATE employee_of_the_year
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[employeeOfTheYear] update error:', err.message);
    res.status(500).json({ error: 'Failed to update record' });
  }
};

exports.deleteRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM employee_of_the_year WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[employeeOfTheYear] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete record' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM employee_of_the_year WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({ refNo: `SNKHL/HR/EOY/${year}/${serial}` });
  } catch (err) {
    console.error('[employeeOfTheYear] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};
