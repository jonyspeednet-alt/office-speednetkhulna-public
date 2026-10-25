const pool = require("../utilities/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { getAuthSecret } = require("../utilities/authSecret");
const {
  isMasterAdminUser,
  getEffectivePermissions,
} = require("../utilities/permissionRegistry");

// Native mobile clients (technician-app) send X-App-Version on every request
// (see technician-app/src/api.js) — browsers never do. Used to decide whether
// the raw JWT may be included in the JSON body (H3).
// Browser Origin/Fetch Metadata cannot be forged by page JavaScript.
const isNativeClient = (req) => !!req.headers?.["x-app-version"] &&
  !req.headers?.origin &&
  !Object.keys(req.headers || {}).some((key) => key.toLowerCase().startsWith('sec-fetch-'));
const canReturnRefreshToken = (req) => isNativeClient(req) &&
  /^Bearer \S+$/.test(req.headers?.authorization || '');

/**
 * Login User
 * Replaces logic in login_action.php
 */
const login = async (req, res) => {
  try {
    // 0. Input Validation & Debugging
    console.log("--- Login Request Received ---");
    console.log("Request Body:", {
      ...req.body,
      password: req.body?.password ? "[REDACTED]" : undefined,
    });

    const { identifier, password } = req.body;

    if (!identifier || !password) {
      res.locals.auditAction = "LOGIN_FAILED_VALIDATION";
      res.locals.auditError = "Missing identifier or password";
      console.log("Error: Missing identifier or password");
      return res
        .status(400)
        .json({ message: "Phone Number/Email and Password are required" });
    }
    const inputPassword =
      typeof password === "string" ? password : String(password);

    const rawIdentifier = identifier.trim();
    let normalizedPhone = rawIdentifier.replace(/[\s\-\+\(\)]/g, '');
    if (normalizedPhone.startsWith('8801')) {
      normalizedPhone = '0' + normalizedPhone.slice(3);
    } else if (normalizedPhone.startsWith('880')) {
      normalizedPhone = '0' + normalizedPhone.slice(3);
    }

    console.log(`Processing Login for: '${rawIdentifier}' (norm phone: '${normalizedPhone}')`);

    // 1. Comprehensive lookup (employee_id, phone, normalized phone, email)
    const query = `
      SELECT * FROM users
      WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER($1)
      OR LOWER(TRIM(COALESCE(employee_id, ''))) = LOWER($1)
      OR TRIM(phone) = $1
      OR TRIM(phone) = $2
      OR REPLACE(REPLACE(REPLACE(phone, '+88', ''), '88', ''), ' ', '') = $2
      ORDER BY id ASC
      LIMIT 1
    `;
    let result = await pool.query(query, [rawIdentifier, normalizedPhone]);
    let user = result.rows[0];

    if (!user) {
      res.locals.auditAction = "LOGIN_FAILED_USER_NOT_FOUND";
      res.locals.auditError = "User not found";
      console.log(`Login Failed: User '${rawIdentifier}' not found in DB`);
      // Generic message — must not reveal whether the identifier exists (S7-class oracle)
      return res.status(401).json({ message: "Invalid login credentials" });
    }

    // Deactivated accounts cannot log in, even with a correct password.
    // Generic message — a distinct 403 would confirm the identifier + its
    // status to anyone guessing (limited oracle, M6).
    if (String(user.status || "").trim().toLowerCase() !== "active") {
      res.locals.auditAction = "LOGIN_FAILED_DEACTIVATED";
      res.locals.auditError = "Account deactivated";
      console.log(`Login Failed: Account deactivated for '${rawIdentifier}'`);
      return res
        .status(401)
        .json({ message: "Invalid login credentials" });
    }

    // 2. Verify Password
    let isMatch = false;
    // ডাটাবেস পাসওয়ার্ড ক্লিন করা (স্পেস রিমুভ)
    const dbPassword = user.password ? user.password.trim() : "";

    // ডিবাগিং লগ: সার্ভার কনসোলে পাসওয়ার্ড চেক করার জন্য
    console.log("--- Password Verification ---");

    // First try bcrypt if it looks like a hash
    if (dbPassword.startsWith("$2")) {
      try {
        isMatch = await bcrypt.compare(inputPassword, dbPassword);
        console.log(`Method: Bcrypt | Match: ${isMatch}`);
      } catch (err) {
        console.error("Bcrypt Error:", err);
        isMatch = false;
      }
    }

    // Plaintext passwords do not authenticate; migrate existing rows before deploy.
    console.log("-------------------");

    if (!isMatch) {
      res.locals.auditAction = "LOGIN_FAILED_INVALID_PASSWORD";
      res.locals.auditError = "Invalid password";
      console.log("Login Failed: Password mismatch");
      return res.status(401).json({ message: "Invalid login credentials" });
    }

    // 3. Generate Token
    const authSecret = getAuthSecret();
    if (!authSecret) {
      console.error(
        "Login Error: JWT_SECRET/SESSION_SECRET is missing in environment",
      );
      return res.status(500).json({
        message: "Server configuration error",
      });
    }

    const isMasterAdmin = isMasterAdminUser(user);
    const effectiveRole = isMasterAdmin ? "Super Admin" : user.role;
    const TOKEN_EXPIRY = "7d"; // 7 days for better user experience
    const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

    const token = jwt.sign(
      {
        id: user.id,
        role: effectiveRole,
        emp_id: user.employee_id,
        full_name: user.full_name,
        token_version: user.token_version || 0,
        session_start: Date.now(),
      },
      authSecret,
      { expiresIn: TOKEN_EXPIRY },
    );

    // 4. Set Cookie — httpOnly + Secure + SameSite=Strict (mitigates XSS token theft + CSRF)
    // Token is NOT exposed to JS; client must use cookie-only auth (withCredentials:true).
    // Bearer header is still accepted for transition (see middleware/auth.js) but deprecated.
    const isProd = String(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production")).toLowerCase() === "true";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    // Also clear any legacy token from non-httpOnly exposure (defense-in-depth)
    // ExpiresAt helps client show session warning without reading token
    const expiresAt = Date.now() + COOKIE_MAX_AGE;

    // 5. Build Enriched User Info (Including Permissions)
    // Resolved via the same shared source of truth middleware/auth.js uses
    // (permissionRegistry.getEffectivePermissions) — previously this login
    // handler had its own independent copy of this logic, which had already
    // drifted from the middleware's version (see RBAC v2 migration notes).
    const { permissions, isSuperAdmin } = await getEffectivePermissions({
      ...user,
      role_name: effectiveRole,
    });

    const { password: _, ...userInfo } = user;
    // Never expose session-security internals (token_version) to clients
    delete userInfo.token_version;
    const enrichedUser = {
      ...userInfo,
      ...permissions, // Merge flags to top-level for direct access
      role: effectiveRole,
      role_name: effectiveRole,
      is_super_admin: isSuperAdmin,
      permissions, // Also keep the permissions object
    };

    res.locals.auditAction = isMasterAdminUser(user) ? "BREAKGLASS_LOGIN" : "LOGIN_SUCCESS";
    res.locals.auditUserId = user.id;
    res.locals.auditUserName = user.full_name || null;
    res.locals.auditRoleName = effectiveRole || null;

    res.json({
      message: "Login successful",
      user: enrichedUser,
      expiresAt,
      // H3: raw JWT in body ONLY for native clients (technician-app sends
      // X-App-Version on every request, browsers never do). Web stays
      // cookie-only so XSS/log theft can't harvest a 7-day Bearer token.
      ...(isNativeClient(req) ? { token } : {}),
    });
  } catch (error) {
    res.locals.auditAction = "LOGIN_FAILED_SERVER_ERROR";
    res.locals.auditError = error.message;
    console.error("Login Error:", error);
    // Generic message — never leak DB/schema details to the client (M2)
    res.status(500).json({ message: "Server Error. Please try again later." });
  }
};

/**
 * Change Password (own account only)
 */
const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res
        .status(400)
        .json({ message: "বর্তমান ও নতুন পাসওয়ার্ড প্রয়োজন" });
    }
    if (String(new_password).length < 8) {
      return res
        .status(400)
        .json({ message: "নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে" });
    }
    if (String(new_password) === String(current_password)) {
      return res
        .status(400)
        .json({ message: "নতুন পাসওয়ার্ড বর্তমান পাসওয়ার্ড থেকে আলাদা হতে হবে" });
    }

    // Fetch current password from DB
    const result = await pool.query(
      "SELECT password FROM users WHERE id = $1",
      [userId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ব্যবহারকারী পাওয়া যায়নি" });
    }

    const dbPassword = result.rows[0].password
      ? result.rows[0].password.trim()
      : "";
    const inputCurrent =
      typeof current_password === "string"
        ? current_password
        : String(current_password);
    const inputNew =
      typeof new_password === "string" ? new_password : String(new_password);

    // Verify current password (bcrypt first, then plain text fallback)
    let isMatch = false;
    if (dbPassword.startsWith("$2")) {
      try {
        isMatch = await bcrypt.compare(inputCurrent, dbPassword);
      } catch (_) {
        isMatch = false;
      }
    }
    // Hash new password with bcrypt and save + increment token_version to invalidate old tokens
    const hashedNew = await bcrypt.hash(inputNew, 10);
    await pool.query("UPDATE users SET password = $1, must_change_password = FALSE, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2", [
      hashedNew,
      userId,
    ]);
    try {
      require("../middleware/auth").evictAuthCache(userId);
    } catch (_) {}

    res.locals.auditAction = "PASSWORD_CHANGED";
    res.locals.auditUserId = userId;
    res.json({ message: "পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে" });
  } catch (error) {
    console.error("changePassword Error:", error);
    res.status(500).json({ message: "সার্ভার ত্রুটি। পরে আবার চেষ্টা করুন।" });
  }
};

/**
 * Refresh Token — issue a fresh 7-day token for a still-valid session
 */
const refreshToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const authSecret = getAuthSecret();
    if (!authSecret) {
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Re-read token_version from DB — never mint from a stale cached claim.
    // Closes the ~60s hot-cache window after password-change/logout.
    let freshVersion = req.user.token_version || 0;
    try {
      const vr = await pool.query('SELECT token_version, status FROM users WHERE id=$1 LIMIT 1', [userId]);
      if (!vr.rows.length) return res.status(401).json({ message: "Invalid session" });
      if (String(vr.rows[0].status || '').trim().toLowerCase() !== 'active') {
        return res.status(401).json({ message: "Invalid login credentials" });
      }
      freshVersion = vr.rows[0].token_version || 0;
      if (Number(req.user.token_version || 0) !== Number(freshVersion)) {
        return res.status(401).json({ message: "Session expired. Please login again." });
      }
    } catch (_) {
      return res.status(503).json({ message: "Service unavailable. Please retry." });
    }

    const effectiveRole = req.user.role || req.user.role_name || "Staff";
    // Absolute session cap: refresh carries the ORIGINAL login time forward.
    // Stolen tokens die at 30d no matter how often they are refreshed.
    const MAX_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
    let sessionStart = 0;
    try {
      const raw = (req.headers.authorization || "").startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : req.cookies?.token;
      const decodedRaw = raw ? jwt.decode(raw) : null;
      sessionStart = Number(decodedRaw?.session_start || 0);
    } catch (_) {}
    if (!sessionStart) {
      // Legacy pre-cap token: anchor at its own iat (already verified above),
      // NOT now — otherwise a near-dead token mints a fresh 30-day window.
      try {
        const raw2 = (req.headers.authorization || "").startsWith("Bearer ")
          ? req.headers.authorization.split(" ")[1]
          : req.cookies?.token;
        const dec2 = raw2 ? jwt.decode(raw2) : null;
        sessionStart = Number(dec2?.iat || 0) * 1000 || Date.now();
      } catch (_) {
        sessionStart = Date.now();
      }
    }
    const remainingSeconds = Math.floor((sessionStart + MAX_SESSION_MS - Date.now()) / 1000);
    if (remainingSeconds <= 0 || sessionStart > Date.now()) {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }
    const token = jwt.sign(
      {
        id: userId,
        role: effectiveRole,
        emp_id: req.user.employee_id,
        full_name: req.user.full_name,
        token_version: freshVersion,
        session_start: sessionStart,
      },
      authSecret,
      { expiresIn: Math.min(7 * 24 * 60 * 60, remainingSeconds) },
    );

    const isProd = String(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production")).toLowerCase() === "true";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      path: "/",
      maxAge: Math.min(7 * 24 * 60 * 60, remainingSeconds) * 1000,
    });

    res.locals.auditAction = "TOKEN_REFRESHED";
    res.locals.auditUserId = userId;
    const expiresAt = Date.now() + Math.min(7 * 24 * 60 * 60, remainingSeconds) * 1000;
    // H3: same native-only gating as login — web refresh stays cookie-only.
    res.json({ message: "Token refreshed", expiresAt, ...(canReturnRefreshToken(req) ? { token } : {}) });
  } catch (error) {
    console.error("refreshToken Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

/**
 * Get current user (for cookie-only auth check)
 */
const getMe = async (req, res) => {
  try {
    // req.user already populated by authMiddleware
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT u.*, r.name as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const userData = result.rows[0];
    const { permissions, isSuperAdmin } = await getEffectivePermissions({
      ...userData,
      role_name: userData.role_name || userData.role || req.user.role,
    });
    const { password: _, ...userInfo } = userData;
    delete userInfo.token_version;
    const effectiveRole = isSuperAdmin ? "Super Admin" : userInfo.role_name || userInfo.role || req.user.role;
    const enrichedUser = {
      ...userInfo,
      ...permissions,
      role: effectiveRole,
      role_name: effectiveRole,
      is_super_admin: isSuperAdmin,
      permissions,
    };
    res.json({ user: enrichedUser });
  } catch (error) {
    console.error("getMe Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

/**
 * Logout User
 * Replaces logic in logout.php
 * Invalidation: increment token_version so all outstanding JWTs for this
 * user are rejected by auth middleware (even if the cookie wasn't cleared,
 * e.g. stolen cookie / network interception).
 */
const logout = async (req, res) => {
  // 1. Invalidate all outstanding tokens for this user
  if (req.user?.id) {
    try {
      await pool.query(
        "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1 AND token_version = $2",
        [req.user.id, req.user.token_version],
      );
    } catch (err) {
      console.error("Logout token_version bump failed:", err.message);
      // Continue with cookie clear even if DB update fails
    }
    try {
      require("../middleware/auth").evictAuthCache(req.user.id);
    } catch (_) {}
  }

  // 2. Clear the authentication cookie
  const isProd = String(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production")).toLowerCase() === "true";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
  });

  res.locals.auditAction = "LOGOUT";
  if (req.user?.id) {
    res.locals.auditUserId = req.user.id;
    res.locals.auditUserName = req.user.full_name || null;
    res.locals.auditRoleName = req.user.role || null;
  }
  res.status(200).json({ message: "Logged out successfully" });
};

module.exports = { login, logout, changePassword, refreshToken, getMe };
