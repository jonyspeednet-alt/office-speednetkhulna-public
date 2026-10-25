const pool = require('../utilities/db');
const { ensureEmployeeOfTheMonthTable } = require('../utilities/employeeOfTheMonthInit');

const CERTIFICATE_FIELDS = {
  refNo: 100,
  issueDate: 40,
  headerPrefix: 160,
  monthYear: 40,
  awardLead: 160,
  employeeName: 200,
  appreciationLine1: 500,
  appreciationLine2: 160,
  orgName: 160,
  yearBanner: 160,
  signerTitle: 100,
  signerDesignation: 160,
  signerOrg: 160,
  frameColor: 20,
};

const normalizeCertificateData = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(CERTIFICATE_FIELDS).map(([field, maxLength]) => [
    field,
    typeof input[field] === 'string' ? input[field].slice(0, maxLength) : '',
  ]));
};

const listAwards = async (req, res) => {
  try {
    await ensureEmployeeOfTheMonthTable();
    const result = await pool.query(`
      SELECT TO_CHAR(award_month, 'YYYY-MM') AS award_month,
             employee_id, employee_name, certificate_data, created_at, updated_at
      FROM employee_of_the_month_awards
      ORDER BY award_month DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('[employeeOfTheMonth] list error:', error.message);
    res.status(500).json({ message: 'Could not load monthly award records' });
  }
};

const getLatestAward = async (_req, res) => {
  try {
    await ensureEmployeeOfTheMonthTable();
    const result = await pool.query(`
      SELECT TO_CHAR(a.award_month, 'YYYY-MM') AS award_month,
             a.employee_id, a.employee_name, a.certificate_data,
             a.updated_at, u.profile_pic, u.designation, u.department
      FROM employee_of_the_month_awards a
      LEFT JOIN users u ON u.id = a.employee_id
      ORDER BY a.award_month DESC
      LIMIT 1
    `);
    res.json(result.rows[0] || null);
  } catch (error) {
    console.error('[employeeOfTheMonth] latest error:', error.message);
    res.status(500).json({ message: 'Could not load the latest monthly award' });
  }
};

const saveAward = async (req, res) => {
  try {
    await ensureEmployeeOfTheMonthTable();
    const awardMonth = String(req.params.awardMonth || '');
    const { employee_name: rawName, employee_id: rawEmployeeId } = req.body || {};
    const employeeName = String(rawName || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      return res.status(400).json({ message: 'A valid award month is required (YYYY-MM)' });
    }
    if (!employeeName || employeeName.length > 200) {
      return res.status(400).json({ message: 'Employee name is required and must be 200 characters or fewer' });
    }
    const employeeId = rawEmployeeId === null || rawEmployeeId === undefined || rawEmployeeId === ''
      ? null
      : Number(rawEmployeeId);
    if (employeeId !== null && (!Number.isInteger(employeeId) || employeeId <= 0)) {
      return res.status(400).json({ message: 'Invalid employee ID' });
    }

    const certificateData = normalizeCertificateData(req.body?.certificate_data);
    certificateData.employeeName = employeeName;
    certificateData.monthYear = certificateData.monthYear || awardMonth;
    const userId = Number(req.user?.id) || null;
    const result = await pool.query(`
      INSERT INTO employee_of_the_month_awards
        (award_month, employee_id, employee_name, certificate_data, created_by, updated_by)
      VALUES ($1::date, $2, $3, $4::jsonb, $5, $5)
      ON CONFLICT (award_month) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        employee_name = EXCLUDED.employee_name,
        certificate_data = EXCLUDED.certificate_data,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING TO_CHAR(award_month, 'YYYY-MM') AS award_month,
                employee_id, employee_name, certificate_data, created_at, updated_at
    `, [`${awardMonth}-01`, employeeId, employeeName, JSON.stringify(certificateData), userId]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[employeeOfTheMonth] save error:', error.message);
    res.status(500).json({ message: 'Could not save monthly award record' });
  }
};

const deleteAward = async (req, res) => {
  try {
    await ensureEmployeeOfTheMonthTable();
    const awardMonth = String(req.params.awardMonth || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      return res.status(400).json({ message: 'A valid award month is required (YYYY-MM)' });
    }
    const result = await pool.query(`
      DELETE FROM employee_of_the_month_awards
      WHERE award_month = $1::date
      RETURNING TO_CHAR(award_month, 'YYYY-MM') AS award_month,
                employee_id, employee_name
    `, [`${awardMonth}-01`]);
    if (!result.rows.length) return res.status(404).json({ message: 'Monthly award record not found' });
    res.json({ deleted: true, ...result.rows[0] });
  } catch (error) {
    console.error('[employeeOfTheMonth] delete error:', error.message);
    res.status(500).json({ message: 'Could not delete the monthly award record' });
  }
};

module.exports = { listAwards, getLatestAward, saveAward, deleteAward };
