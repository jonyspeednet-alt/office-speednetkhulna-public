const { Pool } = require('/srv/office_app/server/node_modules/pg');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432
});

async function run() {
  const details = [
    { desc: 'BCDN', bw: 750, rate: 20, days: 31, total: 15000, date_range: '01 Aug - 31 Aug', change_type: 'increase' },
    { desc: 'CDN', bw: 500, rate: 40, days: 31, total: 20000, date_range: '01 Aug - 31 Aug', change_type: 'standard' },
    { desc: 'NTTN', bw: 700, rate: 15, days: 3, total: 1016.13, date_range: '29 Aug - 31 Aug', change_type: 'increase' },
    { desc: 'NTTN', bw: 600, rate: 15, days: 28, total: 8129.03, date_range: '01 Aug - 28 Aug', change_type: 'standard' }
  ];

  await pool.query('UPDATE monthly_bills SET bill_details = $1, amount = 44145.16 WHERE id = 147', [JSON.stringify(details)]);
  const res = await pool.query('SELECT id, bill_month, amount, previous_due, bill_details FROM monthly_bills WHERE id = 147');
  console.log('SUCCESS_NODE_UPDATE:', res.rows[0]);
  await pool.end();
}
run();
