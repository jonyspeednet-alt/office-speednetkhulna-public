const cron = require('node-cron');
const db = require('../utilities/db');

const RETENTION_DAYS = 30;
const DELETE_BATCH = 5000; // bounded deletes — no long table locks

function startErrorLogCleanupCron() {
  console.log('=== Error Log Cleanup Cron Registered ===');
  console.log(`Retention: ${RETENTION_DAYS} days (batches of ${DELETE_BATCH}), runs daily at 00:45`);

  cron.schedule('45 0 * * *', async () => {
    console.log('=== Error Log Cleanup Cron Job Started ===');
    try {
      // ctid-batched delete loop so app_errors can never grow unbounded (log-DoS cap)
      let total = 0;
      for (;;) {
        const r = await db.query(
          `DELETE FROM app_errors WHERE ctid IN (
             SELECT ctid FROM app_errors
             WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
             LIMIT ${DELETE_BATCH}
           )`,
        );
        total += r.rowCount;
        if (r.rowCount < DELETE_BATCH) break;
      }
      console.log(`✓ Deleted ${total} app_errors rows older than ${RETENTION_DAYS} days`);
      // sms_logs has no other retention: strictly append-only without this
      const sms = await db.query(
        `DELETE FROM sms_logs WHERE created_at < NOW() - INTERVAL '90 days'`,
      ).catch(() => ({ rowCount: 0 }));
      console.log(`✓ Deleted ${sms.rowCount || 0} sms_logs rows older than 90 days`);
    } catch (error) {
      console.error('=== Error Log Cleanup Cron Job Failed ===', error.message);
    }
  });
}

module.exports = { startErrorLogCleanupCron };
