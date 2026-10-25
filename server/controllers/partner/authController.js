// controllers/partner/authController.js — Reseller portal login/logout/me
// Mirrors the legacy PHP logic in partner.speednetkhulna.com/index.php:
//   - lookup by user_id OR contact_no OR company_name
//   - bcrypt verify when the stored value looks like a hash; else legacy
//     plaintext compare with auto-upgrade to bcrypt
//   - require status = 'active'
const pool = require("../../utilities/db");
const bcrypt = require("bcrypt");
const {
  signPartnerToken,
  partnerCookieOptions,
  PARTNER_COOKIE,
  normalizePartnerType,
} = require("../../middleware/partnerAuth");

const BCRYPT_RE = /^\$2[aby]\$/;

// Keep alias resolution identical to login, including deterministic selection
// when legacy rows have overlapping contact/company identifiers.
const resolvePartnerAccount = async (username) => {
  const result = await pool.query(`SELECT id FROM resellers
    WHERE user_id = $1 OR contact_no = $1 OR company_name = $1
    ORDER BY id ASC LIMIT 1`, [String(username || '').trim()]);
  return result.rows[0]?.id ?? null;
};

const publicReseller = (r) => ({
  id: r.id,
  reseller_name: r.reseller_name,
  company_name: r.company_name,
  contact_no: r.contact_no,
  user_id: r.user_id,
  pop_location: r.pop_location,
  status: r.status,
  partner_type: normalizePartnerType(r.partner_type),
  profile_image: r.profile_image || null,
  must_change_password: r.must_change_password === true || r.must_change_password === 1 || r.must_change_password === '1',
});

const login = async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password ?? "");

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "অনুগ্রহ করে সব তথ্য পূরণ করুন!" });
    }

    const result = await pool.query(
      `SELECT * FROM resellers
       WHERE user_id = $1 OR contact_no = $1 OR company_name = $1
       ORDER BY id ASC LIMIT 1`,
      [username],
    );
    const reseller = result.rows[0];
    // Generic message — must not reveal whether the username exists (S7)
    if (!reseller) {
      res.locals.auditAction = "PARTNER_LOGIN_FAILED_USER_NOT_FOUND";
      return res.status(401).json({ message: "ইউজারনেম বা পাসওয়ার্ড ভুল!" });
    }

    // Status BEFORE password: verifying first confirms both the username
    // AND the password for inactive accounts (401 vs 403 oracle).
    // Generic 401, same as the employee realm.
    if (String(reseller.status || "").toLowerCase() !== "active") {
      res.locals.auditAction = "PARTNER_LOGIN_FAILED_DEACTIVATED";
      return res.status(401).json({ message: "ইউজারনেম বা পাসওয়ার্ড ভুল!" });
    }

    const stored = String(reseller.password ?? "").trim();
    let isMatch = false;

    if (stored !== "" && BCRYPT_RE.test(stored)) {
      try {
        isMatch = await bcrypt.compare(password, stored);
      } catch (_) {
        isMatch = false;
      }
    }

    // Plaintext password rows do not authenticate.

    if (!isMatch) {
      res.locals.auditAction = "PARTNER_LOGIN_FAILED_INVALID_PASSWORD";
      return res.status(401).json({ message: "ইউজারনেম বা পাসওয়ার্ড ভুল!" });
    }

    // Forced-change: randomly-generated passwords + legacy phone-as-password
    // rows must be changed on next login (heuristic compare, best-effort).
    let mustChange = reseller.must_change_password === true
      || reseller.must_change_password === 1
      || reseller.must_change_password === '1';
    if (!mustChange && BCRYPT_RE.test(stored)) {
      try {
        for (const guess of [reseller.contact_no, reseller.user_id]) {
          if (guess && await bcrypt.compare(String(guess).trim(), stored)) { mustChange = true; break; }
        }
      } catch (_) {}
    } else if (!mustChange && stored !== "" && !BCRYPT_RE.test(stored)) {
      // Legacy plaintext row: guessable until the reseller changes it.
      mustChange = true;
    }
    // Persist heuristic detections — the hard gate reads the DB flag, and a
    // JSON-only flag is bypassable via direct API calls.
    if (mustChange && !reseller.must_change_password) {
      await pool.query('UPDATE resellers SET must_change_password = TRUE WHERE id = $1', [reseller.id]);
      reseller.must_change_password = true;
    }

    const token = signPartnerToken(reseller);
    res.cookie(PARTNER_COOKIE, token, partnerCookieOptions(req));
    res.locals.auditAction = "PARTNER_LOGIN_SUCCESS";
    res.locals.auditUserId = reseller.id;
    res.json({ message: "Login successful", reseller: { ...publicReseller(reseller), must_change_password: mustChange } });
  } catch (error) {
    console.error("partner login error:", error);
    res.status(500).json({ message: "Server Error. Please try again later." });
  }
};

const me = async (req, res) => {
  res.json({ reseller: publicReseller(req.reseller) });
};

const logout = async (req, res) => {
  // Invalidate all outstanding partner tokens
  if (req.reseller?.id) {
    try {
      await pool.query('UPDATE resellers SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1 AND token_version = $2', [req.reseller.id, req.reseller.token_version]);
    } catch (err) {
      console.error("partner logout version bump failed:", err.message);
    }
  }
  const opts = partnerCookieOptions(req);
  delete opts.maxAge;
  res.clearCookie(PARTNER_COOKIE, opts);
  res.json({ message: "Logged out successfully" });
};

module.exports = { login, me, logout, publicReseller, resolvePartnerAccount };
