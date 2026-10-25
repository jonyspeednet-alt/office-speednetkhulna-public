// One-time migration: copy env/enc-file MikroTik devices into mikrotik_routers table.
// Run: node server/scripts/migrate-mikrotik-env-to-db.js
// Never prints secrets or passwords — only `migrated N, skipped M`.
const { loadEnv } = require('../utilities/envLoader');

loadEnv();

const pool = require('../utilities/db');
const { getDevicesFromEnv } = require('../services/mikrotikSupportService');
const { encryptRouterPassword } = require('../services/supportRouterCrypto');

const main = async () => {
  let devices = [];
  try {
    devices = getDevicesFromEnv();
  } catch (error) {
    console.error(`migration failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  let migrated = 0;
  let skipped = 0;
  for (const device of devices) {
    try {
      if (!device || !device.id || !device.username || !device.password) { skipped += 1; continue; }
      if (device.protocol === 'api' && !device.host) { skipped += 1; continue; }
      if (device.protocol !== 'api' && !device.baseUrl) { skipped += 1; continue; }
      const passwordEnc = encryptRouterPassword(device.password);
      await pool.query(
        `INSERT INTO mikrotik_routers (id, label, protocol, host, base_url, port, username, password_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          device.id,
          device.id,
          device.protocol === 'rest' ? 'rest' : 'api',
          device.protocol === 'rest' ? null : device.host || null,
          device.protocol === 'rest' ? device.baseUrl || null : null,
          device.port || null,
          device.username,
          passwordEnc,
        ]
      );
      migrated += 1;
    } catch {
      skipped += 1;
    }
  }
  console.log(`migrated ${migrated}, skipped ${skipped}`);
};

main()
  .catch((error) => {
    console.error(`migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
