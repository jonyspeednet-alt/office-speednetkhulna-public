const cron = require('node-cron');
const db = require('../utilities/db');
// B8: Dhaka-safe month math (pure YYYY-MM string arithmetic — never
// new Date() + toISOString(), which shifts a month under Asia/Dhaka).
const { getDhakaMonthYm, previousMonthYm, nextMonthYm } = require('../controllers/reseller/utils');

function startReconciliationCron() {
  const startupTime = new Date();
  console.log(`=== Reconciliation Cron Registered ===`);
  console.log(`Startup: ${startupTime.toISOString()}`);
  console.log(`Next scheduled: 5th of each month at 09:00`);
  console.log(`Next run: Expected on or after ${new Date(startupTime.getFullYear(), startupTime.getMonth(), 5, 9, 0).toISOString()}`);

  // B8: pin Asia/Dhaka so the 5th-09:00 run and the month math don't depend
  // on the host's TZ (default node-cron uses server local time).
  cron.schedule('0 9 5 * *', async () => {
    console.log('=== Auto-Reconciliation Cron Job Started ===');
    console.log('Time:', new Date().toISOString());

    try {
      const monthStr     = previousMonthYm(getDhakaMonthYm());
      const monthStart   = monthStr + '-01';
      const monthEnd     = nextMonthYm(monthStr) + '-01';

      console.log(`Processing reconciliation for month: ${monthStr}`);

      const resellersResult = await db.query(
        `SELECT id, reseller_name AS name, profit_share_percentage
         FROM resellers
         WHERE status = 'active' AND partner_type = 'channel_partner'`,
      );

      if (!resellersResult.rows.length) {
        console.log('No active channel partners found.');
        return;
      }

      // Batch check: get all already-reconciled reseller IDs in one query
      const resellerIds = resellersResult.rows.map((r) => r.id);
      const existingResult = await db.query(
        `SELECT reseller_id
         FROM billing_reconciliation_logs
         WHERE reconciliation_month = $1 AND reseller_id = ANY($2)`,
        [monthStart, resellerIds],
      );
      const alreadyDone = new Set(existingResult.rows.map((r) => r.reseller_id));

      const { getProductDeductionForMonth } = require('../utilities/channelProductHelpers');

      let successCount = 0;
      let skipCount    = 0;
      let errorCount   = 0;

      for (const reseller of resellersResult.rows) {
        if (alreadyDone.has(reseller.id)) {
          console.log(`Skipping reseller ${reseller.id} (${reseller.name}) - Already reconciled`);
          skipCount++;
          continue;
        }

        try {
          // Run all independent queries in parallel for this reseller
          const [summaryResult, advancesResult, paymentsResult, advancesListResult, productDeduction] =
            await Promise.all([
              db.query(
                `SELECT
                   COALESCE(SUM(amount_paid), 0)     AS total_collected,
                   COALESCE(SUM(realized_amount), 0) AS total_realized,
                   COALESCE(SUM(deferred_amount), 0) AS total_deferred
                 FROM channel_user_payments
                 WHERE reseller_id = $1
                   AND service_period >= $2 AND service_period < $3
                   AND deleted_at IS NULL`,
                [reseller.id, monthStart, monthEnd],
              ),
              db.query(
                `SELECT COALESCE(SUM(advance_amount), 0) AS total_advances
                 FROM channel_partner_advances
                 WHERE reseller_id = $1
                   AND advance_month >= $2 AND advance_month < $3
                   AND settlement_status IN ('pending_adjustment', 'adjusted')`,
                [reseller.id, monthStart, monthEnd],
              ),
              db.query(
                `SELECT cup.id, cup.user_id, cpu.user_name,
                        cup.amount_paid, cup.realized_amount, cup.deferred_amount,
                        cup.billing_status, cup.service_period
                 FROM channel_user_payments cup
                 LEFT JOIN channel_partner_users cpu ON cpu.id = cup.user_id
                 WHERE cup.reseller_id = $1
                   AND cup.service_period >= $2 AND cup.service_period < $3
                   AND cup.deleted_at IS NULL
                 ORDER BY cup.service_period, cpu.user_name`,
                [reseller.id, monthStart, monthEnd],
              ),
              db.query(
                `SELECT cpa.id, cpa.user_id, cpu.user_name,
                        cpa.advance_amount, cpa.advance_type, cpa.notes,
                        cpa.advance_month, cpa.settlement_status
                 FROM channel_partner_advances cpa
                 LEFT JOIN channel_partner_users cpu ON cpu.id = cpa.user_id
                 WHERE cpa.reseller_id = $1
                   AND cpa.advance_month >= $2 AND cpa.advance_month < $3
                   AND cpa.settlement_status IN ('pending_adjustment', 'adjusted')
                 ORDER BY cpa.advance_month, cpu.user_name`,
                [reseller.id, monthStart, monthEnd],
              ),
              getProductDeductionForMonth(reseller.id, monthStr),
            ]);

          const summary         = summaryResult.rows[0];
          const profitPct       = parseFloat(reseller.profit_share_percentage || 0);
          const grossCommission = (parseFloat(summary.total_realized) * profitPct) / 100;
          const partnerAdvances = parseFloat(advancesResult.rows[0].total_advances || 0);
          const totalDeferred   = parseFloat(summary.total_deferred) || 0;
          const netCommission   = grossCommission - partnerAdvances - productDeduction - totalDeferred;

          const snapshot = {
            payments: paymentsResult.rows,
            advances: advancesListResult.rows,
            summary: {
              total_collected:  summary.total_collected,
              total_realized:   summary.total_realized,
              total_deferred:   summary.total_deferred,
              product_deduction: productDeduction,
              gross_commission:  grossCommission,
              partner_advances:  partnerAdvances,
              net_commission:    netCommission,
            },
          };

          // Re-check just before INSERT: the batch pre-check above races when
          // two processes run the 09:00 cron simultaneously. Narrow to ms.
          const raceCheck = await db.query(
            `SELECT 1 FROM billing_reconciliation_logs
              WHERE reseller_id = $1 AND reconciliation_month = $2 LIMIT 1`,
            [reseller.id, monthStart],
          ).catch(() => ({ rows: [] }));
          if (raceCheck.rows.length) {
            console.log(`Skipping reseller ${reseller.id} (${reseller.name}) - reconciled concurrently`);
            skipCount++;
            continue;
          }

          await db.query(
            `INSERT INTO billing_reconciliation_logs (
               reseller_id, reconciliation_month,
               total_collected, total_realized, total_deferred,
               gross_commission, partner_advances, net_commission,
               reconciliation_status, initiated_by, snapshot_data
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 1, $9)`,
            [
              reseller.id, monthStart,
              summary.total_collected, summary.total_realized, summary.total_deferred,
              grossCommission, partnerAdvances, netCommission,
              JSON.stringify(snapshot),
            ],
          );

          console.log(`✓ Reconciliation initiated for reseller ${reseller.id} (${reseller.name})`);
          successCount++;

        } catch (error) {
          console.error(`✗ Error processing reseller ${reseller.id} (${reseller.name}):`, error.message);
          errorCount++;
        }
      }

      console.log('=== Auto-Reconciliation Cron Job Completed ===');
      console.log(`Success: ${successCount}, Skipped: ${skipCount}, Errors: ${errorCount}`);

    } catch (error) {
      console.error('=== Auto-Reconciliation Cron Job Failed ===', error);
    }
  }, { timezone: 'Asia/Dhaka' });

  console.log('Reconciliation cron job scheduled: Runs at 9:00 AM on the 5th of every month');
}

module.exports = { startReconciliationCron };
