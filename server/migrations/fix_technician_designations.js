require('../config/env');
const pool = require('../utilities/db');

async function migrate() {
  console.log('Standardizing technician designations...');
  const statements = [
    // Fix common typos to standard Assistant / Senior / Technician
    `UPDATE users SET designation = 'Assistant Technician' WHERE LOWER(TRIM(designation)) = 'asstant technician'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE LOWER(TRIM(designation)) = 'assistant tecchnician'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE LOWER(TRIM(designation)) = 'ass technitian'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE LOWER(TRIM(designation)) = 'assistant tecchnician'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE designation ILIKE '%asstant%technician%'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE designation ILIKE '%tecchnician%'`,
    `UPDATE users SET designation = 'Technician' WHERE designation ILIKE '%technitian%' AND LOWER(TRIM(designation)) NOT LIKE '%assistant%'`,
    `UPDATE users SET designation = TRIM(designation) WHERE department='Network Operation'`,
    `UPDATE users SET designation = 'Senior Technician' WHERE LOWER(TRIM(designation)) IN ('sn technician', 'sr. technician', 'sr technician')`,
    `UPDATE users SET designation = 'Senior Technician' WHERE designation ILIKE 'sn technician' OR designation ILIKE 'sr.%technician'`,
    `UPDATE users SET designation = 'Assistant Technician' WHERE LOWER(TRIM(designation))='assistant technician' AND designation != 'Assistant Technician'`,
  ];
  for (const sql of statements) {
    const res = await pool.query(sql);
    console.log(`→ ${res.rowCount} rows: ${sql.substring(0, 80)}...`);
  }
  const check = await pool.query(`SELECT DISTINCT department, designation FROM users WHERE department='Network Operation' ORDER BY designation`);
  console.log('Distinct Network Operation designations:');
  console.table(check.rows);
  const count = await pool.query(`SELECT count(*) FROM users WHERE LOWER(status)='active' AND department='Network Operation' AND designation ILIKE '%technician%'`);
  console.log('Total technicians (standard):', count.rows[0].count);
}

migrate()
  .then(() => { console.log('Done.'); pool.end(); })
  .catch(err => { console.error('Migration error:', err); pool.end(); process.exit(1); });
