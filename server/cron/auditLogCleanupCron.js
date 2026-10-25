const cron = require('node-cron');
const db = require('../utilities/db');

const RETENTION_DAYS = 365;
const DB_SIZE_WARN_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

function startAuditLogCleanupCron() {
  console.log('=== Audit Log Cleanup Cron Registered ===');
  console.log(`Retention: ${RETENTION_DAYS} days, runs daily at 00:20`);
  // 00:20, not 00:30: maximSyncCron fires 00:30 on the 1st and both contend
  // the 10-conn pool (unbatched audit DELETE + heavy Maxim upserts).

  cron.schedule('20 0 * * *', async () => {
    console.log('=== Audit Log Cleanup Cron Job Started ===');
    console.log('Time:', new Date().toISOString());

    try {
      const result = await db.query(
        `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
      );
      console.log(`✓ Deleted ${result.rowCount} audit_logs rows older than ${RETENTION_DAYS} days`);
    } catch (error) {
      console.error('=== Audit Log Cleanup Cron Job Failed ===', error);
    }

    try {
      const sizeResult = await db.query('SELECT pg_database_size(current_database()) AS bytes');
      const dbBytes = Number(sizeResult.rows[0]?.bytes || 0);
      const dbMb = Math.round(dbBytes / (1024 * 1024));
      if (dbBytes > DB_SIZE_WARN_BYTES) {
        console.warn(`[AuditLogCleanup] WARNING: database size is ${dbMb} MB, above the ${Math.round(DB_SIZE_WARN_BYTES / (1024 * 1024))} MB watch threshold`);
      } else {
        console.log(`[AuditLogCleanup] Database size: ${dbMb} MB`);
      }
    } catch (error) {
      console.error('[AuditLogCleanup] DB size check failed:', error.message);
    }

    console.log('=== Audit Log Cleanup Cron Job Completed ===');
  });
}

module.exports = { startAuditLogCleanupCron };
