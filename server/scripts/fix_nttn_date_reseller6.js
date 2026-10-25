#!/usr/bin/env node
/**
 * Fix Script: Update NTTN bandwidth_request implementation_date for reseller 6
 * From: 2026-07-12 → To: 2026-07-11
 *
 * Run on server: node fix_nttn_date.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || process.env.MAIN_DB_USER,
  host: process.env.DB_HOST || process.env.MAIN_DB_HOST || 'localhost',
  database: process.env.DB_NAME || process.env.MAIN_DB_NAME,
  password: process.env.DB_PASSWORD || process.env.MAIN_DB_PASSWORD,
  port: process.env.DB_PORT || process.env.MAIN_DB_PORT || 5432,
});

async function main() {
  const client = await pool.connect();
  try {
    // Step 1: Show existing records to confirm
    const check = await client.query(
      `SELECT id, reseller_id, bw_type, change_type, amount,
              requested_effective_date, implementation_date,
              admin_status, engineer_status, created_at
       FROM bandwidth_requests
       WHERE reseller_id = 6
         AND bw_type ILIKE '%nttn%'
         AND engineer_status = 'implemented'
       ORDER BY created_at DESC LIMIT 10`
    );

    console.log('\n=== Current NTTN bandwidth_requests for reseller 6 ===');
    console.table(check.rows.map(r => ({
      id: r.id,
      bw_type: r.bw_type,
      change_type: r.change_type,
      amount: r.amount,
      requested_effective_date: r.requested_effective_date ? new Date(r.requested_effective_date).toISOString().slice(0, 10) : null,
      implementation_date: r.implementation_date ? new Date(r.implementation_date).toISOString().slice(0, 10) : null,
      admin_status: r.admin_status,
      engineer_status: r.engineer_status,
    })));

    if (check.rows.length === 0) {
      console.log('No matching records found.');
      return;
    }

    // Step 2: Find the record with implementation_date = 2026-07-12
    const target = check.rows.find(r => {
      const d = r.implementation_date ? new Date(r.implementation_date).toISOString().slice(0, 10) : null;
      return d === '2026-07-12';
    });

    if (!target) {
      console.log('\n⚠️  No record found with implementation_date = 2026-07-12');
      console.log('Check the table output above manually.');
      return;
    }

    console.log(`\n✅ Found target record: ID=${target.id}, current implementation_date=2026-07-12`);
    console.log('Updating to 2026-07-11...\n');

    await client.query('BEGIN');

    // Update bandwidth_requests
    const updateBw = await client.query(
      `UPDATE bandwidth_requests
       SET implementation_date = '2026-07-11'::date,
           requested_effective_date = '2026-07-11'::date
       WHERE id = $1
       RETURNING id, implementation_date, requested_effective_date`,
      [target.id]
    );
    console.log('bandwidth_requests updated:', updateBw.rows[0]);

    // Also update the billing_log entry that was created for this bandwidth change
    const updateLog = await client.query(
      `UPDATE billing_logs
       SET effective_date = '2026-07-11'::date
       WHERE request_id = $1
         AND log_type = 'bandwidth_change'
       RETURNING id, effective_date`,
      [target.id]
    );
    console.log('billing_logs updated:', updateLog.rows);

    await client.query('COMMIT');
    console.log('\n✅ Fix applied successfully!');
    console.log('The NTTN Package Upgrade date_range will now show "11 Jul - 31 Jul" on the invoice.');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
