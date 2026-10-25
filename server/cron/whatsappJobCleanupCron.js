const cron = require('node-cron');
const db = require('../utilities/db');

// WhatsApp job history retention: completed/failed rows older than this
// are deleted nightly. Pending/processing rows are never touched.
const RETENTION_DAYS = 30;

function startWhatsAppJobCleanupCron() {
  console.log('=== WhatsApp Job Cleanup Cron Registered ===');
  console.log(`Retention: ${RETENTION_DAYS} days (completed/failed only), runs daily at 01:00`);

  cron.schedule('0 1 * * *', async () => {
    console.log('=== WhatsApp Job Cleanup Cron Job Started ===');
    try {
      const result = await db.query(
        `DELETE FROM whatsapp_worker_jobs WHERE status IN ('completed', 'failed') AND updated_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`,
      );
      console.log(`✓ Deleted ${result.rowCount} whatsapp_worker_jobs rows older than ${RETENTION_DAYS} days`);
    } catch (error) {
      console.error('=== WhatsApp Job Cleanup Cron Job Failed ===', error);
    }
    console.log('=== WhatsApp Job Cleanup Cron Job Completed ===');
  });
}

module.exports = { startWhatsAppJobCleanupCron };
