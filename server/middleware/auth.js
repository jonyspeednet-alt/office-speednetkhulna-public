const jwt = require("jsonwebtoken");
const pool = require("../utilities/db");
const { getAuthSecret } = require("../utilities/authSecret");
const {
  getEffectivePermissions,
} = require("../utilities/permissionRegistry");
const { requestLogEnabled } = require("../config/env");
const RETRYABLE_DB_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "57P01",
]);
const AUTH_CACHE_TTL_MS = Math.max(
  30000,
  Number(process.env.AUTH_CACHE_TTL_MS || 10 * 60 * 1000),
);
const AUTH_CACHE_MAX_SIZE = 1000; // max cached users to prevent memory leak
const authUserCache = new Map();
// Generations exist only while authentication requests are in flight. This
// bounds memory and prevents one account's eviction disrupting other accounts.
const authUserGenerations = new Map();
// P1: hot-path freshness window for the cache-first shortcut below. Short on
// purpose — permissions can be reused within this window; session version and
// account status are checked against PostgreSQL on every normal request.
// The longer cache lifetime bounds permission-cache memory retention only.
const AUTH_HOT_CACHE_TTL_MS = Math.max(
  10000,
  Number(process.env.AUTH_HOT_CACHE_TTL_MS || 60 * 1000),
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Forced-change gate: temp/guessable passwords must be replaced before any
// write. Reads stay open (dashboard/profile navigation), and the password,
// logout, refresh, and identity endpoints stay reachable.
const PASSWORD_EXEMPT_RE = /\/auth\/(change-password|logout|refresh|me)$/;
const passwordChangeRequired = (req, res) => {
  if (!req.user || req.user.must_change_password !== true) return false;
  const m = String(req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (PASSWORD_EXEMPT_RE.test(String(req.originalUrl || req.url || ''))) return false;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(403).json({ message: "Please change your temporary password first.", must_change_password: true });
  return true;
};

const queryWithRetry = async (sql, params, maxRetries = 1) => {
  let attempt = 0;
  while (true) {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      const canRetry =
        attempt < maxRetries &&
        (RETRYABLE_DB_CODES.has(String(error.code || "")) ||
          String(error.message || "")
            .toLowerCase()
            .includes("timeout") ||
          String(error.message || "")
            .toLowerCase()
            .includes("connection terminated"));
      if (!canRetry) throw error;
      attempt += 1;
      await wait(120 * attempt);
    }
  }
};

const cacheAuthUser = (userId, user) => {
  if (!userId || !user) return;
  // Enforce max size: evict oldest expired entries first, then LRU
  if (authUserCache.size >= AUTH_CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [k, v] of authUserCache) {
      if (now > v.expiresAt) authUserCache.delete(k);
    }
    // If still over limit, delete oldest entry
    if (authUserCache.size >= AUTH_CACHE_MAX_SIZE) {
      const firstKey = authUserCache.keys().next().value;
      if (firstKey) authUserCache.delete(firstKey);
    }
  }
  authUserCache.set(String(userId), {
    user,
    cachedAt: Date.now(),
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });
};

const buildUserFromDb = (userData, permissions, isSuperAdmin) => {
  const { password, role_permissions, ...user } = userData;
  const permissionFlags = {};
  Object.keys(permissions).forEach((key) => {
    permissionFlags[key] =
      permissions[key] === true ||
      permissions[key] === 1 ||
      permissions[key] === "1";
  });
  const effectiveRoleName = isSuperAdmin
    ? "Super Admin"
    : user.role_name || user.role || "";
  return {
    ...user,
    ...permissionFlags,
    role: effectiveRoleName,
    role_name: effectiveRoleName,
    is_super_admin: isSuperAdmin,
    permissions,
  };
};

/**
 * Authentication Middleware
 * Replaces: auth_check.php (Backend Logic)
 */
const authMiddleware = async (req, res, next) => {
  let decoded = null;
  let generationState = null;
  let generationKey = null;
  try {
    // 1. Get token from Authorization header first, then fallback to cookie.
    // This prevents stale cookie token from overriding a fresh bearer token after account switch.
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
    const cookieToken = req.cookies && req.cookies.token;
    const token = bearerToken || cookieToken;

    if (!token) {
      console.log("Auth Failed: No token found");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Authentication required" });
    }

    // 2. Verify Token
    const authSecret = getAuthSecret();
    if (!authSecret) {
      console.error(
        "Auth Middleware Error: JWT_SECRET/SESSION_SECRET is missing in environment",
      );
      return res
        .status(500)
        .json({ message: "Server configuration error: JWT secret missing" });
    }

    decoded = jwt.verify(token, authSecret, { algorithms: ['HS256'] });
    const sessionStart = Number(decoded.session_start || Number(decoded.iat) * 1000);
    if (Number.isFinite(sessionStart) && sessionStart > 0 &&
        (sessionStart > Date.now() || Date.now() - sessionStart >= 30 * 24 * 60 * 60 * 1000)) {
      return res.status(401).json({ message: 'Session expired. Please login again.' });
    }
    generationKey = String(decoded?.id || '');
    generationState = authUserGenerations.get(generationKey);
    if (!generationState) {
      if (authUserGenerations.size >= AUTH_CACHE_MAX_SIZE) {
        return res.status(503).json({ message: 'Authentication busy. Please retry.' });
      }
      generationState = { generation: 0, pending: 0 };
      authUserGenerations.set(generationKey, generationState);
    }
    generationState.pending += 1;
    const cacheGeneration = generationState.generation;
    const isReadRequest = ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || 'GET').toUpperCase());
    const requiresFreshAuth = !isReadRequest || req.requireFreshAuth === true;

    // Reuse recently resolved permissions, while checking shared session
    // state before trusting cached data from this API worker.
    const hotEntry = authUserCache.get(String(decoded?.id || ""));
    if (
      !requiresFreshAuth &&
      hotEntry &&
      hotEntry.user &&
      Date.now() - Number(hotEntry.cachedAt || 0) < AUTH_HOT_CACHE_TTL_MS &&
      Date.now() < Number(hotEntry.expiresAt || 0) &&
      // Deactivate/demote must take effect even on the hot path (M1)
      String(hotEntry.user.status || "").trim().toLowerCase() === "active" &&
      hotEntry.user.token_version !== undefined &&
      decoded.token_version !== undefined &&
      hotEntry.user.token_version === decoded.token_version
    ) {
      // Another API worker may have revoked this session since this worker
      // cached its permissions. Compare against shared state on every read.
      const current = await queryWithRetry(
        'SELECT token_version, status, must_change_password FROM users WHERE id = $1',
        [decoded.id],
      );
      const freshUser = current.rows[0];
      if (cacheGeneration !== generationState.generation) {
        return res.status(503).json({ message: 'Authentication state changed. Please retry.' });
      }
      if (!freshUser || freshUser.token_version !== decoded.token_version ||
          String(freshUser.status || '').trim().toLowerCase() !== 'active') {
        evictAuthCache(decoded.id);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(401).json({ message: 'Session invalidated. Please login again.' });
      }
      req.user = hotEntry.user;
      req.user['must_change_password'] = freshUser.must_change_password;
      if (passwordChangeRequired(req, res)) return;
      return next();
    }

    // 3. Fetch User + Role, then resolve effective permissions via the
    // single shared source of truth (RBAC v2 view + legacy fallback for
    // users without a role_id). See permissionRegistry.getEffectivePermissions.
    const userQuery = `
      SELECT u.*, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
    `;
    const userResult = await queryWithRetry(userQuery, [decoded.id], 1);

    if (userResult.rows.length === 0) {
      evictAuthCache(decoded.id);
      console.log("Auth Failed: User not found in DB for ID:", decoded.id);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "User no longer exists" });
    }

    const userData = userResult.rows[0];

    // Deactivated accounts are rejected against current database state,
    // even if they still hold a structurally valid JWT.
    if (String(userData.status || "").trim().toLowerCase() !== "active") {
      evictAuthCache(userData.id);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res
        .status(403)
        .json({ message: "Account deactivated. Contact admin." });
    }

    const effectiveRole = userData.role_name || userData.role || "";

    // Token version check: invalidate tokens after password change.
    // Strict (G6): a missing version on EITHER side rejects. Pre-version
    // tokens die on this deploy — every session re-logs in once. This closes
    // the bypass where a stolen legacy token survived password-change/logout.
    if (
      decoded.token_version === undefined ||
      userData.token_version === undefined ||
      decoded.token_version !== userData.token_version
    ) {
      console.log(`Auth Failed: Token version mismatch for user ${decoded.id}`);
      evictAuthCache(decoded.id);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Session invalidated. Please login again." });
    }

    const { permissions, isSuperAdmin } = await getEffectivePermissions(
      userData,
    );

    // Every request consults current DB state across workers.
    // Recheck after permission resolution to catch revocation during its await.
    {
      const current = await queryWithRetry(
        'SELECT token_version, status, must_change_password FROM users WHERE id = $1',
        [decoded.id],
      );
      const freshUser = current.rows[0];
      if (cacheGeneration !== generationState.generation) {
        return res.status(503).json({ message: 'Authentication state changed. Please retry.' });
      }
      if (!freshUser || freshUser.token_version !== decoded.token_version ||
          String(freshUser.status || '').trim().toLowerCase() !== 'active') {
        evictAuthCache(decoded.id);
        return res.status(401).json({ message: 'Session invalidated. Please login again.' });
      }
      userData.must_change_password = freshUser.must_change_password;
    }
    // An eviction while either query was in flight must not refill stale state.
    if (cacheGeneration !== generationState.generation) {
      return res.status(503).json({ message: 'Authentication state changed. Please retry.' });
    }

    // 4. Attach to request
    req.user = buildUserFromDb(userData, permissions, isSuperAdmin);
    cacheAuthUser(req.user.id, req.user);
    // P1/S31: no per-request user+permission dump to stdout (PII + disk I/O
    // on every /api call). Debug log only when the request log flag is on
    // (non-production by default, opt-in via REQUEST_LOG_ENABLED in prod).
    if (requestLogEnabled) {
      console.log(
        `[Auth] User: ${req.user.full_name} (${req.user.id}), Role: ${effectiveRole}`,
      );
    }
    if (passwordChangeRequired(req, res)) return;
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    // Expired token on logout: still allow server-side session kill so the
    // user can invalidate outstanding tokens even after expiry (Low-G10).
    // Every other route keeps the strict 401 below.
    if (
      error.name === "TokenExpiredError" &&
      req.method === "POST" &&
      /\/logout$/.test(String(req.originalUrl || ""))
    ) {
      try {
        // NOTE: `token`/`authSecret` from try{} are out of scope here — re-extract.
        const h = req.headers.authorization || "";
        const expiredToken = h.startsWith("Bearer ")
          ? h.split(" ")[1]
          : req.cookies && req.cookies.token;
        const late = jwt.verify(expiredToken, getAuthSecret(), {
          algorithms: ["HS256"],
          ignoreExpiration: true,
        });
        // Bound the loose path: tokens dead for >24h cannot kill sessions.
        // (Unbounded ignoreExpiration turns any ancient log/backup token into
        // a session-DoS oracle via the version bump in logout.)
        if (late?.exp && Date.now() / 1000 - Number(late.exp) > 24 * 60 * 60) {
          throw new Error("Token too old for loose logout");
        }
        if (late?.id && late.token_version !== undefined) {
          const current = await pool.query('SELECT token_version FROM users WHERE id = $1', [late.id]);
          if (!current.rows[0] || current.rows[0].token_version !== late.token_version) {
            throw new Error('Revoked logout session');
          }
          req.user = { id: late.id, token_version: late.token_version, _expired_session: true };
          return next();
        }
      } catch (_) {
        // fall through to 401
      }
    }
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res
        .status(401)
        .json({ message: "Invalid or expired token. Please login again." });
    }
    const transientDbError =
      RETRYABLE_DB_CODES.has(String(error.code || "")) ||
      String(error.message || "")
        .toLowerCase()
        .includes("timeout") ||
      String(error.message || "")
        .toLowerCase()
        .includes("connection terminated");
    if (transientDbError) {
      // A worker-local cache cannot prove another worker has not revoked the
      // token. Fail closed for reads and writes when shared state is unavailable.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res
        .status(503)
        .json({ message: 'Authentication unavailable. Please retry.' });
    }
    return res
      .status(500)
      .json({ message: "Internal Server Error during Authentication" });
  } finally {
    if (generationState) {
      generationState.pending -= 1;
      if (generationState.pending === 0) authUserGenerations.delete(generationKey);
    }
  }
};

// Eviction refreshes local permissions and invalidates in-flight resolution;
// every request also verifies shared token state across workers.
const evictAuthCache = (userId) => {
  try {
    if (userId !== undefined && userId !== null) {
      const key = String(userId);
      const generation = authUserGenerations.get(key);
      if (generation) generation.generation += 1;
      authUserCache.delete(key);
    }
  } catch (_) {}
};

module.exports = authMiddleware;
module.exports.evictAuthCache = evictAuthCache;
