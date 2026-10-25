const cron = require('node-cron');
const pool = require('../utilities/db');
const { syncConfiguredDevices } = require('../services/mikrotikSupportService');

let running = false;

const startMikrotikSupportSyncCron = () => {
  cron.schedule('*/10 * * * *', async () => {
    if (running) {
      console.log('[SupportSync] skipped: previous run in progress');
      return;
    }
    running = true;
    // Reap crashed runs (orphaned 'running' rows) + 30-day retention.
    // The 10-min tick inserts ≥1 row/router — unbounded without this.
    await pool.query(
      `UPDATE mikrotik_sync_runs SET status = 'failed', error_message = 'stale running reaped', completed_at = NOW()
        WHERE status = 'running' AND started_at < NOW() - INTERVAL '2 hours'`,
    ).catch(() => ({}));
    await pool.query(`DELETE FROM mikrotik_sync_runs WHERE started_at < NOW() - INTERVAL '30 days'`).catch(() => ({}));
    // Advisory locks are session-scoped: lock AND unlock must use the SAME
    // connection, otherwise unlock silently fails and all future ticks skip.
    let lockClient = null;
    let lockAcquired = false;
    try {
      try {
        lockClient = await pool.connect();
        const lockRes = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('mikrotik_support_sync')) AS locked`);
        lockAcquired = lockRes.rows[0] && lockRes.rows[0].locked;
      } catch (error) {
        console.warn('[SupportSync] advisory lock unavailable:', error.message);
      }
      if (!lockAcquired) {
        console.log('[SupportSync] skipped: previous run in progress');
        return;
      }
      const result = await syncConfiguredDevices();
      if (result.failed && result.failed.length) {
        console.log(`[SupportSync] completed with partial failures: synced ${result.synced.length}, failed ${result.failed.length}: ${result.failed.map((f) => `${f.routerId}: ${f.error}`).join('; ')}`);
      } else {
        console.log(`[SupportSync] completed: synced ${result.synced.length}`);
      }
    } catch (error) { console.warn('[SupportSync] skipped/failed:', error.message); }
    finally {
      if (lockAcquired && lockClient) {
        try { await lockClient.query(`SELECT pg_advisory_unlock(hashtext('mikrotik_support_sync'))`); } catch { /* best-effort */ }
      }
      if (lockClient) { try { lockClient.release(); } catch {} lockClient = null; }
      running = false;
    }
  }, { timezone: 'Asia/Dhaka' });
  console.log('[SupportSync] scheduled every 10 minutes');
};
module.exports = { startMikrotikSupportSyncCron };
