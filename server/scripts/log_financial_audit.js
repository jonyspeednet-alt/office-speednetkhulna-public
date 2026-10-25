const { Pool } = require('/srv/office_app/server/node_modules/pg');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432
});

async function logAudit() {
  const auditSql = `
    INSERT INTO reseller_financial_audit_logs (
      reseller_id, actor_user_id, actor_user_name, actor_role, action_type,
      reference_table, reference_id,
      amount_before, amount_after, amount_delta,
      due_before, due_after, due_delta,
      field_changes, note, request_payload,
      route_path, http_method, ip_address, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
    ) RETURNING *
  `;

  const values = [
    17,
    74,
    'Md. Sabbir Hossain',
    'Senior Manager',
    'BANDWIDTH_UPGRADE',
    'bandwidth_requests',
    146,
    44000.00,
    44145.16,
    145.16,
    0.12,
    0.12,
    0.00,
    JSON.stringify({
      bw_type: 'NTTN',
      change_type: 'increase',
      amount: 100,
      prev_nttn_capacity: 600,
      new_nttn_capacity: 700,
      effective_date: '2026-08-29'
    }),
    'Upgraded 100 Mbps NTTN capacity (600 -> 700 Mbps) as per instruction from Md. Sabbir Hossain (Senior Manager, Marketing - User ID: 74, Profile: https://office.speednetkhulna.com/profile/74). Executed by IT Team.',
    JSON.stringify({
      reseller_id: 17,
      reseller_name: 'Mr. Shohan (Sync Online)',
      requested_by: 'Md. Sabbir Hossain',
      requested_by_id: 74,
      profile_url: 'https://office.speednetkhulna.com/profile/74',
      reason: '100 Mbps NTTN upgrade on 2026-08-29'
    }),
    '/profile/74',
    'MANUAL',
    '127.0.0.1'
  ];

  const res = await pool.query(auditSql, values);
  console.log('SUCCESS_AUDIT_LOG:', res.rows[0]);
  await pool.end();
  process.exit(0);
}

logAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
