const { loadEnv } = require('../utilities/envLoader');

// Load env (correctly prioritizing secrets/ directory)
loadEnv();

const pool = require('../utilities/db');

const indexStatements = [
  { table: 'users', sql: 'CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users (employee_id)' },
  { table: 'users', sql: "CREATE INDEX IF NOT EXISTS idx_users_email_norm ON users (LOWER(TRIM(COALESCE(email, ''))))" },
  { table: 'leave_requests', sql: 'CREATE INDEX IF NOT EXISTS idx_leave_requests_status_dates ON leave_requests (status, start_date, end_date)' },
  { table: 'leave_requests', sql: 'CREATE INDEX IF NOT EXISTS idx_leave_requests_user_applied ON leave_requests (user_id, applied_at DESC)' },
  { table: 'leave_requests', sql: 'CREATE INDEX IF NOT EXISTS idx_leave_requests_user_status ON leave_requests (user_id, status)' },
  { table: 'sidebar_menus', sql: 'CREATE INDEX IF NOT EXISTS idx_sidebar_menus_visible_sort ON sidebar_menus (is_visible, sort_order)' },
  { table: 'office_phones', sql: 'CREATE INDEX IF NOT EXISTS idx_office_phones_assign_to ON office_phones (assign_to)' },
  { table: 'office_phones', sql: 'CREATE INDEX IF NOT EXISTS idx_office_phones_desk_name ON office_phones (desk_name)' },
  { table: 'resellers', sql: 'CREATE INDEX IF NOT EXISTS idx_resellers_status ON resellers (status)' },
  { table: 'resellers', sql: 'CREATE INDEX IF NOT EXISTS idx_resellers_user_id ON resellers (user_id)' },
  { table: 'resellers', sql: 'CREATE INDEX IF NOT EXISTS idx_resellers_name ON resellers (reseller_name)' },
  { table: 'bandwidth_requests', sql: 'CREATE INDEX IF NOT EXISTS idx_bw_requests_reseller_impl ON bandwidth_requests (reseller_id, implementation_date DESC)' },
  { table: 'bandwidth_requests', sql: "CREATE INDEX IF NOT EXISTS idx_bw_requests_status_combo ON bandwidth_requests (reseller_id, admin_status, engineer_status, implementation_date)" },
  { table: 'monthly_bills', sql: 'CREATE INDEX IF NOT EXISTS idx_monthly_bills_reseller_month ON monthly_bills (reseller_id, bill_month DESC)' },
  { table: 'billing_logs', sql: 'CREATE INDEX IF NOT EXISTS idx_billing_logs_reseller_created ON billing_logs (reseller_id, created_at DESC)' },
  { table: 'billing_logs', sql: 'CREATE INDEX IF NOT EXISTS idx_billing_logs_reseller_effective ON billing_logs (reseller_id, effective_date DESC)' },
  { table: 'resellers', sql: 'CREATE INDEX IF NOT EXISTS idx_resellers_status_name ON resellers (status, reseller_name)' },
];

async function tableExists(tableName) {
  const result = await pool.query('SELECT to_regclass($1) AS table_ref', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_ref);
}

async function run() {
  const started = Date.now();
  let created = 0;
  let skipped = 0;

  console.log('[DB:optimize] applying performance indexes...');

  for (const item of indexStatements) {
    // Some environments may miss optional tables; skip safely.
    const exists = await tableExists(item.table);
    if (!exists) {
      skipped += 1;
      console.log(`[DB:optimize] skipped (missing table): ${item.table}`);
      continue;
    }
    try {
      await pool.query(item.sql);
      created += 1;
      console.log(`[DB:optimize] ok: ${item.sql}`);
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('must be owner of relation')) {
        skipped += 1;
        console.log(`[DB:optimize] skipped (owner required): ${item.sql}`);
        continue;
      }
      throw err;
    }
  }

  const elapsed = Date.now() - started;
  console.log(`[DB:optimize] done. applied=${created}, skipped=${skipped}, elapsed=${elapsed}ms`);
}

run()
  .catch((err) => {
    console.error('[DB:optimize] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      // no-op
    }
  });
