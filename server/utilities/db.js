const { Pool } = require('pg');
const path = require('path');

// Environment variables are expected to be pre-loaded by config/env.js
// or by a standalone script calling utilities/envLoader.js

const isProd = process.env.NODE_ENV === 'production';
const useMainDbInLocal = String(process.env.USE_MAIN_DB_IN_LOCAL || 'false').toLowerCase() === 'true';
const useMainCredentials = isProd || useMainDbInLocal;
const expectedDatabase = process.env.EXPECTED_DB_NAME || process.env.MAIN_DB_NAME || process.env.DB_NAME || 'office_db';
const strictTargetCheck = String(
  process.env.STRICT_DB_TARGET ?? (isProd ? 'true' : 'false')
).toLowerCase() === 'true';
const strictTargetConnectivityExit = String(process.env.STRICT_DB_CONNECTIVITY_EXIT ?? 'false').toLowerCase() === 'true';
const keepAlivePingIntervalMs = Math.max(
  0,
  Number(process.env.DB_KEEPALIVE_PING_INTERVAL_MS || (isProd ? 30000 : 0))
);

// Preference: Use MAIN_DB credentials if available in production
const dbConfig = {
  user: (useMainCredentials && process.env.MAIN_DB_USER) ? process.env.MAIN_DB_USER : (process.env.DB_USER || 'postgres'),
  host: (useMainCredentials && process.env.MAIN_DB_HOST) ? process.env.MAIN_DB_HOST : (process.env.DB_HOST || 'localhost'),
  database: (useMainCredentials && process.env.MAIN_DB_NAME) ? process.env.MAIN_DB_NAME : (process.env.DB_NAME || 'office_db'),
  password: (useMainCredentials && process.env.MAIN_DB_PASSWORD) ? process.env.MAIN_DB_PASSWORD : (process.env.DB_PASSWORD || ''),
  port: (useMainCredentials && process.env.MAIN_DB_PORT) ? process.env.MAIN_DB_PORT : (process.env.DB_PORT || 5432),
  
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  keepAlive: true,
  keepAliveInitialDelayMillis: Number(process.env.DB_KEEPALIVE_DELAY_MS || 10000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 15000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 20000),
  maxUses: Number(process.env.DB_POOL_MAX_USES || 7500),
};

// Optional SSL for remote DB access (e.g. old server → new VPS over the internet).
// Enable with DB_SSL=true in .env. Self-signed certs are accepted (rejectUnauthorized:false)
// so the app keeps working until a proper CA-signed certificate is deployed.
if (String(process.env.DB_SSL) === 'true') {
  dbConfig.ssl = { rejectUnauthorized: false };
  console.log('[DB] SSL enabled for DB connection (rejectUnauthorized:false)');
}

// Log the connection target (without password)
console.log(`[DB] Target: ${dbConfig.database} on ${dbConfig.host} as ${dbConfig.user}`);
console.log(`[DB] Expected target: ${expectedDatabase} (strict: ${strictTargetCheck})`);

// Safety: refuse to start in production without a database password
if (isProd && !dbConfig.password) {
  console.error('[DB] FATAL: No database password configured in production. Set MAIN_DB_PASSWORD or DB_PASSWORD in .env');
  setTimeout(() => process.exit(1), 50);
}
const pool = new Pool(dbConfig);
pool.expectedDatabase = expectedDatabase;

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', (client) => {
  client.query("SET timezone TO 'Asia/Dhaka'").catch(err => {
    console.error('Error setting DB timezone:', err);
  });
});

async function verifyTargetDatabase() {
  const attempts = Math.max(1, Number(process.env.DB_VERIFY_RETRIES || 3));
  try {
    let lastError = null;
    let currentDb = '';
    for (let i = 1; i <= attempts; i++) {
      try {
        const result = await pool.query('SELECT current_database() AS current_db');
        currentDb = result.rows[0]?.current_db || '';
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const backoffMs = 250 * i;
        console.warn(`[DB] verify attempt ${i}/${attempts} failed: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    if (lastError) {
      const message = `[DB] Failed to verify active database after ${attempts} attempts: ${lastError.message}`;
      if (strictTargetConnectivityExit) {
        console.error(message);
        setTimeout(() => process.exit(1), 50);
        return;
      }
      console.warn(message);
      return;
    }

    const mismatch = currentDb !== expectedDatabase;
    if (!mismatch) {
      console.log(`[DB] Active database verified: ${currentDb}`);
      return;
    }
    const message = `[DB] Active database mismatch. current=${currentDb} expected=${expectedDatabase}`;
    if (strictTargetCheck) {
      console.error(message);
      setTimeout(() => process.exit(1), 50);
      return;
    }
    console.warn(message);
  } catch (error) {
    const message = `[DB] Failed to verify active database: ${error.message}`;
    if (strictTargetConnectivityExit) {
      console.error(message);
      setTimeout(() => process.exit(1), 50);
      return;
    }
    console.warn(message);
  }
}

verifyTargetDatabase();

if (keepAlivePingIntervalMs > 0) {
  const timer = setInterval(async () => {
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      console.warn(`[DB] keepalive ping failed: ${err.message}`);
    }
  }, keepAlivePingIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = pool;
