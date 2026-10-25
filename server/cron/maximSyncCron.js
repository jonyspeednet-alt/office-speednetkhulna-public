const cron = require("node-cron");
const db = require("../utilities/db");
// Dhaka-safe month math (pure YYYY-MM string arithmetic).
const {
  getDhakaMonthYm,
  previousMonthYm,
} = require("../controllers/reseller/utils");
const { runMaximSync } = require("../utilities/maximSync");

function startMaximSyncCron() {
  console.log("=== Maxim Sync Cron Registered ===");
  console.log("Schedule: 1st of each month at 00:30 (Asia/Dhaka), previous month");

  // Month-end snapshot: runs after the month closes so the payment report
  // (from_date=1st, to_date=last) is complete. Reconciliation cron (5th 09:00)
  // runs after this, so Maxim data is ready before commission finalize.
  cron.schedule(
    "30 0 1 * *",
    async () => {
      console.log("=== Maxim Auto-Sync Cron Started ===");
      const monthYm = previousMonthYm(getDhakaMonthYm());
      console.log(`Syncing Maxim snapshots for month: ${monthYm}`);
      try {
        // Reap crashed runs + retain 90 days (see syncNow for the why)
        await db.query(
          `UPDATE maxim_sync_logs SET status = 'failed', error = 'stale running reaped', finished_at = NOW()
            WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 hours'`,
        ).catch(() => ({}));
        await db.query(`DELETE FROM maxim_sync_logs WHERE started_at < NOW() - INTERVAL '90 days'`).catch(() => ({}));
        // Snapshot tables grow customers x months forever: keep 24 months for
        // cross-checks, prune older (reconcile windows never reach further).
        await db.query(`DELETE FROM maxim_customer_snapshots WHERE snapshot_month < (date_trunc('month', NOW()) - INTERVAL '24 months')::date`).catch(() => ({}));
        await db.query(`DELETE FROM maxim_payment_snapshots WHERE snapshot_month < (date_trunc('month', NOW()) - INTERVAL '24 months')::date`).catch(() => ({}));
        const partners = await db.query(
          `SELECT id, COALESCE(maxim_suffix,'') AS suffix
           FROM resellers
           WHERE status = 'active' AND partner_type = 'channel_partner'
             AND COALESCE(maxim_suffix,'') <> ''`,
        ).catch(() => ({ rows: [] }));
        if (!partners.rows.length) {
          console.log("[MaximSyncCron] no channel partners with maxim_suffix.");
          return;
        }
        let ok = 0;
        let fail = 0;
        let skipped = 0;
        for (const p of partners.rows) {
          try {
            const done = await db.query(
              `SELECT 1 FROM maxim_sync_logs
               WHERE reseller_id = $1 AND snapshot_month = ($2 || '-01')::date
                 AND status = 'completed' LIMIT 1`,
              [p.id, monthYm],
            );
            if (done.rows.length) {
              skipped++;
              continue;
            }
            // Same overlap guard as manual syncNow (either PM2 instance)
            const busy = await db.query(
              `SELECT 1 FROM maxim_sync_logs
                WHERE reseller_id = $1 AND snapshot_month = ($2 || '-01')::date
                  AND status = 'running' LIMIT 1`,
              [p.id, monthYm],
            ).catch(() => ({ rows: [] }));
            if (busy.rows.length) {
              skipped++;
              continue;
            }
            const log = await db.query(
              `INSERT INTO maxim_sync_logs
                (reseller_id, reseller_suffix, snapshot_month, source, status)
               VALUES ($1,$2,($3 || '-01')::date,'cron','running')
               RETURNING id`,
              [p.id, p.suffix, monthYm],
            );
            const counts = await runMaximSync({
              resellerId: p.id,
              suffix: p.suffix,
              monthYm,
              source: "cron",
              logId: log.rows[0].id,
            });
            console.log(
              `[MaximSyncCron] reseller ${p.id}: +${counts.payments} payments, +${counts.customers} customers`,
            );
            ok++;
          } catch (err) {
            fail++;
            console.error(
              `[MaximSyncCron] reseller ${p.id} failed:`,
              err.message,
            );
          }
        }
        console.log(
          `=== Maxim Auto-Sync Cron Done: ok=${ok} skipped=${skipped} failed=${fail} ===`,
        );
      } catch (err) {
        console.error("[MaximSyncCron] fatal:", err.message);
      }
    },
    { timezone: "Asia/Dhaka" },
  );
}

module.exports = { startMaximSyncCron };
