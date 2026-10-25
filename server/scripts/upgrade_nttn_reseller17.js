#!/usr/bin/env node
/**
 * Upgrade Script: Update NTTN capacity for Reseller 17 (Sync Online)
 * - Adds 100 Mbps upgrade on 2026-08-29 (600 -> 700 Mbps)
 * - Inserts bandwidth_requests record
 * - Inserts billing_logs record
 * - Updates resellers table (nttn_capacity = 700)
 * - Updates monthly_bills for August 2026 (id=147) with prorated breakdown
 */

require('../config/env');
const pool = require('../utilities/db');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('--- Step 1: Checking current reseller 17 info ---');
    const resRow = await client.query('SELECT id, reseller_name, company_name, nttn_capacity, rate_nttn FROM resellers WHERE id = 17 FOR UPDATE');
    if (!resRow.rows.length) {
      throw new Error('Reseller 17 not found');
    }
    console.log('Current Reseller 17:', resRow.rows[0]);

    console.log('--- Step 2: Insert implemented bandwidth_requests record ---');
    const bwReq = await client.query(
      `INSERT INTO bandwidth_requests (
        reseller_id, bw_type, change_type, amount, requested_effective_date,
        implementation_date, admin_status, engineer_status, tech_note, created_at
      ) VALUES (
        17, 'NTTN', 'increase', 100, '2026-08-29 00:00:00',
        '2026-08-29 00:00:00', 'approved', 'implemented', 'NTTN Upgrade 100 Mbps on 29 Aug', NOW()
      ) RETURNING id, bw_type, change_type, amount, implementation_date`
    );
    const reqId = bwReq.rows[0].id;
    console.log('Created bandwidth request:', bwReq.rows[0]);

    console.log('--- Step 3: Insert billing_logs record ---');
    const logRes = await client.query(
      `INSERT INTO billing_logs (
        reseller_id, request_id, change_desc, transaction_amount, effective_date, created_at, log_type
      ) VALUES (
        17, $1, 'Applied increase 100 on NTTN', 0, '2026-08-29 00:00:00', NOW(), 'bandwidth_change'
      ) RETURNING id, change_desc, effective_date`,
      [reqId]
    );
    console.log('Created billing log:', logRes.rows[0]);

    console.log('--- Step 4: Update resellers table nttn_capacity to 700 ---');
    const updateReseller = await client.query(
      `UPDATE resellers
       SET nttn_capacity = 700,
           last_activity_date = NOW()
       WHERE id = 17
       RETURNING id, nttn_capacity`
    );
    console.log('Updated reseller:', updateReseller.rows[0]);

    console.log('--- Step 5: Update monthly_bills for August 2026 ---');
    const updatedBillDetails = [
      {
        desc: "BCDN",
        bw: 750,
        rate: 20,
        days: 31,
        total: 15000,
        date_range: "01 Aug - 31 Aug",
        change_type: "প্যাকেজ বৃদ্ধি"
      },
      {
        desc: "CDN",
        bw: 500,
        rate: 40,
        days: 31,
        total: 20000,
        date_range: "01 Aug - 31 Aug",
        change_type: "standard"
      },
      {
        desc: "NTTN",
        bw: 700,
        rate: 15,
        days: 3,
        total: 1016.13,
        date_range: "29 Aug - 31 Aug",
        change_type: "প্যাকেজ বৃদ্ধি"
      },
      {
        desc: "NTTN",
        bw: 600,
        rate: 15,
        days: 28,
        total: 8129.03,
        date_range: "01 Aug - 28 Aug",
        change_type: "standard"
      }
    ];

    const totalAmount = 44145.16;

    const updateBill = await client.query(
      `UPDATE monthly_bills
       SET amount = $1,
           bill_details = $2
       WHERE reseller_id = 17 AND bill_month = '2026-08-01'::date
       RETURNING id, reseller_id, bill_month, amount, bill_details`,
      [totalAmount, JSON.stringify(updatedBillDetails)]
    );
    console.log('Updated monthly_bills row:', updateBill.rows[0]);

    await client.query('COMMIT');
    console.log('\n✅ Successfully updated database for Reseller 17 NTTN Upgrade!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error executing update:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
