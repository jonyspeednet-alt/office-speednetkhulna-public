const pool = require('../utilities/db');

// Simple in-memory cache for public employee profiles
const profileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 500; // max cached profiles to prevent memory leak

// Cleanup stale cache entries every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now > entry.expiresAt) profileCache.delete(key);
  }
  // Enforce max size after cleanup
  if (profileCache.size > CACHE_MAX_SIZE) {
    let toDelete = profileCache.size - CACHE_MAX_SIZE;
    for (const [key] of profileCache) {
      if (toDelete <= 0) break;
      profileCache.delete(key);
      toDelete--;
    }
  }
}, 5 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

// Ensure index exists on first call (runs once per process lifetime)
let indexEnsured = false;
const ensureIndex = async () => {
  if (indexEnsured) return;
  try {
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users (employee_id)');
    indexEnsured = true;
  } catch (_) { /* non-blocking */ }
};

const getPublicEmployeeProfile = async (req, res) => {
  try {
    const { employee_id } = req.params;
    if (!employee_id || !/^[A-Z0-9\-]+$/i.test(employee_id)) {
      return res.status(400).json({ message: 'Invalid employee ID' });
    }

    const normalizedId = employee_id.toUpperCase();
    const cacheKey = `emp:${normalizedId}`;

    // Browser cache: PII must not sit in shared caches
    res.setHeader('Cache-Control', 'private, max-age=60');

    // Check cache (no X-Cache header — it leaks cross-user query state)
    const cached = profileCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }

    // Ensure index (first call only)
    ensureIndex();

    const result = await pool.query(
      `SELECT employee_id, full_name, designation, department,
              profile_pic, status
       FROM users WHERE employee_id = $1`,
      [normalizedId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const data = result.rows[0];

    // Store in cache
    profileCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });

    res.json(data);
  } catch (error) {
    console.error('getPublicEmployeeProfile Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getPublicEmployeeProfile };
