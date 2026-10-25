const pool = require('./db');
const { createHash } = require('crypto');

let ready;
let nextCleanupAt = 0;
const ensureTable = () => {
  if (!ready) ready = pool.query(`CREATE TABLE IF NOT EXISTS login_rate_limits (
    key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at TIMESTAMPTZ NOT NULL
  )`).then(() => pool.query('CREATE INDEX IF NOT EXISTS login_rate_limits_expiry ON login_rate_limits (reset_at)'))
    .catch((error) => { ready = null; throw error; });
  return ready;
};

// PostgreSQL is already shared by both API workers. Atomic upserts keep the
// counters consistent without adding another service or storing identifiers.
class LoginRateStore {
  constructor(namespace) { this.namespace = namespace; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  key(raw) { return createHash('sha256').update(`${this.namespace}:${raw}`).digest('hex'); }
  async increment(raw) {
    await ensureTable();
    if (Date.now() >= nextCleanupAt) {
      nextCleanupAt = Date.now() + 60000;
      // Bound each retention pass; only expired security counters are removed.
      await pool.query(`DELETE FROM login_rate_limits WHERE key IN
        (SELECT key FROM login_rate_limits WHERE reset_at < clock_timestamp() - interval '1 day'
         ORDER BY reset_at LIMIT 500)`);
    }
    const result = await pool.query(`
      INSERT INTO login_rate_limits (key, hits, reset_at)
      VALUES ($1, 1, clock_timestamp() + $2 * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN login_rate_limits.reset_at <= clock_timestamp()
          THEN 1 ELSE login_rate_limits.hits + 1 END,
        reset_at = CASE WHEN login_rate_limits.reset_at <= clock_timestamp()
          THEN clock_timestamp() + $2 * interval '1 millisecond' ELSE login_rate_limits.reset_at END
      RETURNING hits, reset_at`, [this.key(raw), this.windowMs]);
    return { totalHits: result.rows[0].hits, resetTime: new Date(result.rows[0].reset_at) };
  }
  async decrement(raw) {
    await ensureTable();
    await pool.query('UPDATE login_rate_limits SET hits = GREATEST(0, hits - 1) WHERE key = $1 AND reset_at > clock_timestamp()', [this.key(raw)]);
  }
  async resetKey(raw) {
    await ensureTable();
    await pool.query('UPDATE login_rate_limits SET hits = 0, reset_at = clock_timestamp() WHERE key = $1', [this.key(raw)]);
  }
}

const resolveLoginAccount = async (identifier) => {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  let phone = raw.replace(/[\s\-+()]/g, '');
  if (phone.startsWith('880')) phone = '0' + phone.slice(3);
  const result = await pool.query(`SELECT id FROM users
    WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER($1)
      OR LOWER(TRIM(COALESCE(employee_id, ''))) = LOWER($1)
      OR TRIM(phone) = $1 OR TRIM(phone) = $2
      OR REPLACE(REPLACE(REPLACE(phone, '+88', ''), '88', ''), ' ', '') = $2
    ORDER BY id ASC LIMIT 1`, [raw, phone]);
  return result.rows[0]?.id ?? null;
};

module.exports = { LoginRateStore, resolveLoginAccount };
