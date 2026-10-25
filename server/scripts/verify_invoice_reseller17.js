const { Pool } = require('/srv/office_app/server/node_modules/pg');
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432
});

async function testInvoice() {
  const resellerId = 17;
  const monthParam = '2026-08';
  const monthStart = '2026-08-01';

  const resellerRes = await pool.query(
    `SELECT id, user_id AS reseller_code,
            COALESCE(reseller_name, company_name) AS name,
            reseller_name, company_name, contact_no AS phone,
            pop_location, nttn_capacity, rate_nttn, cdn_bw, rate_cdn, bcdn_bw, rate_bcdn
     FROM resellers WHERE id = $1`,
    [resellerId]
  );
  const reseller = resellerRes.rows[0];

  const billRes = await pool.query(
    `SELECT id, reseller_id, bill_month, amount AS final_amount,
            adjustment, adjustment_note, bill_details, previous_due, created_at
     FROM monthly_bills
     WHERE reseller_id = $1 AND bill_month = $2::date`,
    [resellerId, monthStart]
  );
  const bill = billRes.rows[0];

  const paidRes = await pool.query(
    `SELECT
       COALESCE(SUM(transaction_amount) FILTER (WHERE log_type = 'payment'), 0)::numeric AS total_paid,
       COALESCE(SUM(transaction_amount) FILTER (WHERE log_type = 'discount'), 0)::numeric AS total_discount
     FROM billing_logs
     WHERE reseller_id = $1
       AND TO_CHAR(COALESCE(effective_date, created_at), 'YYYY-MM') = $2`,
    [resellerId, monthParam]
  );

  const logsRes = await pool.query(
    `SELECT id, reseller_id, log_type, change_desc AS note,
            transaction_amount AS amount, effective_date, created_at
     FROM billing_logs
     WHERE reseller_id = $1
       AND DATE_TRUNC('month', COALESCE(effective_date, created_at)) = DATE_TRUNC('month', $2::date)
     ORDER BY effective_date ASC`,
    [resellerId, monthStart]
  );

  const items = JSON.parse(bill.bill_details);

  const previousDue = Number(bill.previous_due || 0);
  const currentBill = Number(bill.final_amount || 0);
  const totalPaid = Number(paidRes.rows[0]?.total_paid || 0);
  const netPayable = previousDue + currentBill - totalPaid;

  console.log('=== VERIFICATION SUMMARY FOR https://office.speednetkhulna.com/invoice?resellerId=17&month=2026-08 ===\n');
  console.log('Reseller Code:', reseller.reseller_code);
  console.log('Reseller Name:', reseller.name);
  console.log('Company Name:', reseller.company_name);
  console.log('Bill Month:', monthStart);
  console.log('Invoice Type: Final Static Snapshot (monthly_bills ID #' + bill.id + ')');
  console.log('Previous Due:', previousDue.toFixed(2), 'Tk');
  console.log('Current Month Bill:', currentBill.toFixed(2), 'Tk');
  console.log('Total Paid in August:', totalPaid.toFixed(2), 'Tk');
  console.log('Net Payable (Balance Due):', netPayable.toFixed(2), 'Tk\n');

  console.log('--- Breakdown Items on Invoice ---');
  items.forEach((item, i) => {
    console.log(`${i+1}. ${item.desc.padEnd(6)} | ${String(item.bw).padStart(4)} Mbps | Rate: ${String(item.rate).padStart(2)} Tk | Days: ${String(item.days).padStart(2)} | Date: ${item.date_range} | Total: ${String(item.total).padStart(8)} Tk | Type: ${item.change_type}`);
  });

  const sumItems = items.reduce((acc, it) => acc + Number(it.total), 0);
  console.log('\nCalculated Items Sum:', sumItems.toFixed(2), 'Tk');
  console.log('Matches bill.final_amount?', sumItems === currentBill ? 'YES ✅' : 'NO ❌');

  console.log('\n--- Bandwidth / Payment Logs Recorded in Month ---');
  logsRes.rows.forEach(l => {
    console.log(`[Log #${l.id}] ${l.log_type} | Amount: ${l.amount} Tk | Date: ${l.effective_date?.toISOString().slice(0, 10)} | Note: ${l.note}`);
  });

  await pool.end();
  process.exit(0);
}

testInvoice().catch(err => {
  console.error(err);
  process.exit(1);
});
