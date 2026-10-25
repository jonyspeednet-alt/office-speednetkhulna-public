const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS no_dues_certificates (
      id SERIAL PRIMARY KEY,
      employee_name TEXT,
      employee_id TEXT,
      certificate_no TEXT,
      form_data JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Unique serial per certificate (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_dues_certificates_certificate_no_key') THEN
        ALTER TABLE no_dues_certificates ADD CONSTRAINT no_dues_certificates_certificate_no_key UNIQUE (certificate_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[noDuesCertificates] Table init error:', err.message));

exports.saveCertificate = async (req, res) => {
  try {
    const { employee_name, employee_id, certificate_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (!certificate_no || !String(certificate_no).trim()) return res.status(400).json({ error: 'Certificate no is required' });
    const result = await pool.query(
      `INSERT INTO no_dues_certificates (employee_name, employee_id, certificate_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_name || null, employee_id || null, certificate_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Certificate no already exists — please use the next serial' });
    console.error('[noDuesCertificates] save error:', err.message);
    res.status(500).json({ error: 'Failed to save certificate' });
  }
};

exports.getMyCertificates = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT nc.id, nc.employee_name, nc.employee_id, nc.certificate_no, nc.created_at, nc.updated_at, nc.created_by, u.full_name as created_by_name
       FROM no_dues_certificates nc LEFT JOIN users u ON u.id = nc.created_by ORDER BY nc.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[noDuesCertificates] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
};

exports.getCertificateById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM no_dues_certificates WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[noDuesCertificates] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
};

exports.updateCertificate = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, certificate_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (certificate_no !== undefined && !String(certificate_no).trim()) return res.status(400).json({ error: 'Certificate no is required' });
    const result = await pool.query(
      `UPDATE no_dues_certificates
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           certificate_no = COALESCE($3, certificate_no),
           form_data = COALESCE($4, form_data),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [employee_name, employee_id, certificate_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Certificate no already exists — please use the next serial' });
    console.error('[noDuesCertificates] update error:', err.message);
    res.status(500).json({ error: 'Failed to update certificate' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const yymm = String(year).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM no_dues_certificates WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/NDC/${year}/${serial}`,
      certificateNo: `SN/HR/NDC/${yymm}/${serial}`,
    });
  } catch (err) {
    console.error('[noDuesCertificates] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteCertificate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM no_dues_certificates WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[noDuesCertificates] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete certificate' });
  }
};
