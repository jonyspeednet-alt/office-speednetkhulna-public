// middleware/partnerAuth.js — Reseller (partner portal) authentication
// Separate auth realm from employee auth (middleware/auth.js):
//   - authenticates against the `resellers` table (not `users`)
//   - uses its own cookie `partner_token` so employee/reseller sessions
//     never collide when both subdomains are open in one browser.
const jwt = require("jsonwebtoken");
const pool = require("../utilities/db");
const { getAuthSecret } = require("../utilities/authSecret");

const PARTNER_COOKIE = "partner_token";
const TOKEN_EXPIRY = "7d";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

const normalizePartnerType = (value) => {
  const type = String(value || "distribution_partner")
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, "_");
  if (["channel_partner", "channel", "chanel_partner", "chanel"].includes(type)) return "channel_partner";
  if (["mac_partner", "mac"].includes(type)) return "mac_partner";
  return "distribution_partner";
};

const partnerCookieOptions = (req) => ({
  httpOnly: true,
  // The temporary IP:port portal is HTTP-only until its DNS record can be
  // moved. Keep cookies Secure everywhere else, including the HTTPS domain.
  secure: !(
    process.env.ALLOW_INSECURE_PARTNER_IP === "true" &&
    req &&
    !req.secure
  ),
  sameSite: "lax",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
});

const signPartnerToken = (reseller) => {
  const secret = getAuthSecret();
  if (!secret) throw new Error("JWT secret is not configured");
  return jwt.sign(
    {
      reseller_id: reseller.id,
      reseller_name: reseller.reseller_name,
      type: "partner",
      token_version: reseller.token_version || 0,
    },
    secret,
    { expiresIn: TOKEN_EXPIRY },
  );
};

/**
 * Guard for all /api/partner/* routes. Verifies the partner_token cookie
 * (or Authorization bearer), loads the reseller and attaches req.reseller.
 */
const requirePartner = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
    const token = bearer || (req.cookies && req.cookies[PARTNER_COOKIE]);

    if (!token) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Authentication required" });
    }

    const secret = getAuthSecret();
    if (!secret) {
      return res
        .status(500)
        .json({ message: "Server configuration error: JWT secret missing" });
    }

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (decoded?.type !== "partner" || !decoded?.reseller_id) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Invalid partner session" });
    }

    const result = await pool.query(
      `SELECT * FROM resellers WHERE id = $1`,
      [decoded.reseller_id],
    );
    const reseller = result.rows[0];
    if (!reseller) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Account no longer exists" });
    }
    if (String(reseller.status || "").toLowerCase() !== "active") {
      return res.status(403).json({ message: "Account is inactive" });
    }
    // Session invalidation: password-change/logout bumps token_version
    if (Number(decoded.token_version || 0) !== Number(reseller.token_version || 0)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(401).json({ message: "Session expired. Please login again." });
    }
    // Forced-change gate: temp/guessable passwords are read+settings only
    // until replaced (frontend already redirects flagged users to /settings).
    const partnerMustChange = reseller.must_change_password === true
      || reseller.must_change_password === 1
      || reseller.must_change_password === '1';
    if (partnerMustChange) {
      const p = String(req.path || '');
      const ok = p.endsWith('/settings/password') || p.endsWith('/logout') || p.endsWith('/me');
      if (!ok) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        return res.status(403).json({ message: "Please change your temporary password first.", must_change_password: true });
      }
    }

    req.reseller = reseller;
    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res
        .status(401)
        .json({ message: "Invalid or expired session. Please login again." });
    }
    console.error("partnerAuth error:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
};

/**
 * Loose guard for logout only: attaches req.reseller even when the token is
 * expired (ignoreExpiration), and always calls next() so logout never 401s.
 * Without this the token_version bump in logout never fires (dead code).
 */
const requirePartnerLoose = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
    const token = bearer || (req.cookies && req.cookies[PARTNER_COOKIE]);
    if (token) {
      const secret = getAuthSecret();
      if (secret) {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], ignoreExpiration: true });
        // Same 24h bound as the employee loose path — ancient tokens cannot
        // kill live sessions via the logout version bump.
        if (!decoded?.exp || Date.now() / 1000 - Number(decoded.exp) <= 24 * 60 * 60) {
          if (decoded?.type === "partner" && decoded?.reseller_id) {
            const result = await pool.query(
              `SELECT * FROM resellers WHERE id = $1`,
              [decoded.reseller_id],
            );
            const reseller = result.rows[0];
            if (reseller && decoded.token_version !== undefined &&
                reseller.token_version !== undefined &&
                Number(decoded.token_version) === Number(reseller.token_version)) {
              req.reseller = reseller;
            }
          }
        }
      }
    }
  } catch (_) {
    // logout must succeed regardless — best-effort attach only
  }
  return next();
};

const requireDistributionPartner = (req, res, next) => {  if (normalizePartnerType(req.reseller?.partner_type) !== "distribution_partner") {
    return res.status(403).json({ message: "এই সুবিধাটি ডিস্ট্রিবিউশন পার্টনারদের জন্য।" });
  }
  next();
};

const requireCommissionPartner = (req, res, next) => {
  if (!["channel_partner", "mac_partner"].includes(normalizePartnerType(req.reseller?.partner_type))) {
    return res.status(403).json({ message: "এই সুবিধাটি Channel ও MAC পার্টনারদের জন্য।" });
  }
  next();
};

module.exports = {
  requirePartner,
  requirePartnerLoose,
  signPartnerToken,
  partnerCookieOptions,
  PARTNER_COOKIE,
  normalizePartnerType,
  requireDistributionPartner,
  requireCommissionPartner,
};
