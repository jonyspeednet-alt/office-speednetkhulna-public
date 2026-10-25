const cron = require('node-cron');
const db = require('../utilities/db');
const { logAppError } = require('../utilities/errorLogger');

// Watches audit_logs for credential-attack velocity: many failed logins from
// one IP, or one account hammered from many IPs (victim-lock weapon).
// Log-based (visible in PM2 logs + app_errors viewer); wire MONITOR_WEBHOOK_URL
// later for push alerts.
const WINDOW_MIN = 15;
const FAILS_PER_IP = 30;
const DISTINCT_IPS_PER_ACCOUNT = 10;

function startLoginVelocityAlertCron() {
  console.log('=== Login Velocity Alert Cron Registered ===');
  console.log(`Window: ${WINDOW_MIN}min, every 5min`);

  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await db.query(
        `SELECT ip_address,
                COUNT(*) AS fails,
                COUNT(DISTINCT COALESCE(request_body->>'identifier', request_body->>'username', '')) AS accounts
         FROM audit_logs
         WHERE created_at > NOW() - INTERVAL '${WINDOW_MIN} minutes'
           AND (action_type LIKE 'LOGIN_FAILED%' OR action_type LIKE 'PARTNER_LOGIN_FAILED%')
         GROUP BY ip_address
         HAVING COUNT(*) >= $1
         ORDER BY COUNT(*) DESC
         LIMIT 20`,
        [FAILS_PER_IP],
      );
      for (const row of r.rows) {
        const msg = `[VelocityAlert] ${row.fails} failed logins from ${row.ip_address} across ~${row.accounts} account(s) in ${WINDOW_MIN}min — possible stuffing/victim-lock wave`;
        console.warn(msg);
        logAppError('velocity-alert', new Error(msg), { routePath: '/api/auth/login' }).catch(() => {});
      }

      const v = await db.query(
        `SELECT COALESCE(request_body->>'identifier', request_body->>'username', '') AS account,
                COUNT(DISTINCT ip_address) AS ips, COUNT(*) AS fails
         FROM audit_logs
         WHERE created_at > NOW() - INTERVAL '${WINDOW_MIN} minutes'
           AND (action_type LIKE 'LOGIN_FAILED%' OR action_type LIKE 'PARTNER_LOGIN_FAILED%')
         GROUP BY 1
         HAVING COUNT(DISTINCT ip_address) >= $1
         ORDER BY COUNT(*) DESC
         LIMIT 20`,
        [DISTINCT_IPS_PER_ACCOUNT],
      );
      for (const row of v.rows) {
        if (!row.account) continue;
        const msg = `[VelocityAlert] account '${row.account}' failed from ${row.ips} IPs (${row.fails} tries) in ${WINDOW_MIN}min — possible targeted lock/spray`;
        console.warn(msg);
        logAppError('velocity-alert', new Error(msg), { routePath: '/api/auth/login' }).catch(() => {});
      }
    } catch (error) {
      console.error('=== Login Velocity Alert Cron Failed ===', error.message);
    }
  });
}

module.exports = { startLoginVelocityAlertCron };
