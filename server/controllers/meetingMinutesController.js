const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meeting_minutes (
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
  // Unique serial per minutes (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_minutes_ref_no_key') THEN
        ALTER TABLE meeting_minutes ADD CONSTRAINT meeting_minutes_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[meetingMinutes] Table init error:', err.message));

exports.saveMinutes = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!form_data?.meetingDate || !String(form_data.meetingDate).trim()) return res.status(400).json({ error: 'Meeting date is required' });
    const result = await pool.query(
      `INSERT INTO meeting_minutes (employee_name, employee_id, ref_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[meetingMinutes] save error:', err.message);
    res.status(500).json({ error: 'Failed to save meeting minutes' });
  }
};

exports.getMyMinutes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mm.id, mm.employee_name, mm.employee_id, mm.ref_no, mm.created_at, mm.updated_at, mm.created_by, u.full_name as created_by_name
       FROM meeting_minutes mm LEFT JOIN users u ON u.id = mm.created_by ORDER BY mm.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[meetingMinutes] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch meeting minutes' });
  }
};

exports.getMinutesById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM meeting_minutes WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Meeting minutes not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[meetingMinutes] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch meeting minutes' });
  }
};

exports.updateMinutes = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, form_data } = req.body;
    if (form_data !== undefined && form_data?.meetingDate !== undefined && !String(form_data.meetingDate).trim()) {
      return res.status(400).json({ error: 'Meeting date is required' });
    }
    const result = await pool.query(
      `UPDATE meeting_minutes
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, ref_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Meeting minutes not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Reference no already exists — please use the next serial' });
    console.error('[meetingMinutes] update error:', err.message);
    res.status(500).json({ error: 'Failed to update meeting minutes' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM meeting_minutes WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/MOM/${year}/${serial}`,
    });
  } catch (err) {
    console.error('[meetingMinutes] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteMinutes = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM meeting_minutes WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Meeting minutes not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[meetingMinutes] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete meeting minutes' });
  }
};
