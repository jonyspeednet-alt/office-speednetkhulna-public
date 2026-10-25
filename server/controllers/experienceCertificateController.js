const pool = require('../utilities/db');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS experience_certificates (
      id SERIAL PRIMARY KEY,
      employee_name TEXT,
      employee_id TEXT,
      ref_no TEXT,
      certificate_no TEXT,
      form_data JSONB,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Unique serials (NULLs allowed, duplicates rejected)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_certificates_ref_no_key') THEN
        ALTER TABLE experience_certificates ADD CONSTRAINT experience_certificates_ref_no_key UNIQUE (ref_no);
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experience_certificates_certificate_no_key') THEN
        ALTER TABLE experience_certificates ADD CONSTRAINT experience_certificates_certificate_no_key UNIQUE (certificate_no);
      END IF;
    END $$;
  `);
}
ensureTable().catch(err => console.error('[experienceCertificates] Table init error:', err.message));

exports.saveCertificate = async (req, res) => {
  try {
    const { employee_name, employee_id, ref_no, certificate_no, form_data } = req.body;
    const created_by = req.user?.id;
    if (!form_data) return res.status(400).json({ error: 'form_data is required' });
    if (!employee_name || !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (!certificate_no || !String(certificate_no).trim()) return res.status(400).json({ error: 'Certificate no is required' });
    const result = await pool.query(
      `INSERT INTO experience_certificates (employee_name, employee_id, ref_no, certificate_no, form_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [employee_name || null, employee_id || null, ref_no || null, certificate_no || null, JSON.stringify(form_data), created_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Certificate no already exists — please use the next serial' });
    console.error('[experienceCertificates] save error:', err.message);
    res.status(500).json({ error: 'Failed to save certificate' });
  }
};

exports.getMyCertificates = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ec.id, ec.employee_name, ec.employee_id, ec.ref_no, ec.certificate_no, ec.created_at, ec.updated_at, ec.created_by, u.full_name as created_by_name
       FROM experience_certificates ec LEFT JOIN users u ON u.id = ec.created_by ORDER BY ec.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[experienceCertificates] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
};

exports.getCertificateById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM experience_certificates WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[experienceCertificates] get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
};

exports.updateCertificate = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee_name, employee_id, ref_no, certificate_no, form_data } = req.body;
    if (employee_name !== undefined && !String(employee_name).trim()) return res.status(400).json({ error: 'Employee name is required' });
    if (certificate_no !== undefined && !String(certificate_no).trim()) return res.status(400).json({ error: 'Certificate no is required' });
    const result = await pool.query(
      `UPDATE experience_certificates
       SET employee_name = COALESCE($1, employee_name),
           employee_id = COALESCE($2, employee_id),
           ref_no = COALESCE($3, ref_no),
           certificate_no = COALESCE($4, certificate_no),
           form_data = COALESCE($5, form_data),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [employee_name, employee_id, ref_no, certificate_no, form_data ? JSON.stringify(form_data) : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ error: 'Certificate no already exists — please use the next serial' });
    console.error('[experienceCertificates] update error:', err.message);
    res.status(500).json({ error: 'Failed to update certificate' });
  }
};

exports.getNextNumbers = async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const yymm = String(year).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM experience_certificates WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year]
    );
    const serial = String((countResult.rows[0]?.c || 0) + 1).padStart(2, '0');
    res.json({
      refNo: `SNKHL/HR/EC/${year}/${serial}`,
      certificateNo: `SN/HR/EC/${yymm}/${serial}`,
    });
  } catch (err) {
    console.error('[experienceCertificates] next-numbers error:', err.message);
    res.status(500).json({ error: 'Failed to generate numbers' });
  }
};

exports.deleteCertificate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM experience_certificates WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[experienceCertificates] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete certificate' });
  }
};
