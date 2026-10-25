// config/cors.js — CORS configuration
const cors = require('cors');

// DNS root-trailing-dot (FQDN) form: `https://host.` is the same DNS name as
// `https://host`, and browsers treat the two as interchangeable for cookies.
// Bangladeshi mobile ISPs (GP/BL) silently drop any connection whose TLS SNI or
// HTTP Host matches `(^|\.)speednetkhulna\.com(:|$)` — so on mobile data the
// portal is ONLY reachable as `office.speednetkhulna.com.` (trailing dot).
// Normalise on both paths: env validation and incoming Origin comparison,
// otherwise the reachable origin fails the exact-allowlist check below and the
// SPA gets a 403 "Origin not allowed" on every API call.
const stripHostRootDot = (s) => String(s || '').replace(/\.$/, '');
// Strip the DNS root dot from an ORIGIN string. Handle all three shapes the
// client can produce — dot after the host, dot after host before an explicit
// port, and (invalid but seen) dot after the port — without ever touching a
// lookalike suffix such as `office.speednetkhulna.com.evil.com`.
const stripOriginRootDot = (s) => {
    const str = String(s || '').replace(/\.$/, '');
    const m = /^(https?:\/\/)([^/?#:]+)(:\d+)?$/.exec(str);
    if (!m) return str;
    return m[1] + stripHostRootDot(m[2]) + (m[3] || '');
};

// Env-provided origins are validated: scheme + host only, no credentials in
// URL, no wildcard. A poisoned FRONTEND_URL (attacker domain) would otherwise
// grant credentials:true API access AND feed invoice-link phishing.
const isSaneOrigin = (v) => {
    const s = String(v || '').trim();
    if (!s || s === '*' || s.includes('*')) return false;
    try {
        const u = new URL(s);
        if (!['http:', 'https:'].includes(u.protocol)) return false;
        if (u.username || u.password) return false;
        // `new URL('https://host.').hostname` keeps the root dot, so strip it
        // before the first-party suffix check (see stripHostRootDot above).
        const h = stripHostRootDot(u.hostname);
        const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1';
        const isFirstParty = h.endsWith('.speednetkhulna.com');
        // IP literals (v4/v6): the portal is served over bare-IP HTTP until
        // the TLS cutover, so IPs must stay allowed. DNS names outside our
        // domain stay rejected (phishing-origin protection).
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':');
        if (!isLocal && !isFirstParty && !isIp) {
            console.error(`[CORS] rejecting non-first-party origin from env: ${s}`);
            return false;
        }
        // Production hardening: only HTTPS origins are trusted by default, because
        // an http:// origin can be injected by anyone on the network path, so
        // allowing one hands a network attacker a credentialed API. That guard is
        // fundamentally incompatible with serving the portal over plain HTTP, so it
        // can be lifted deliberately with CORS_ALLOW_INSECURE_ORIGINS=1 instead of
        // being deleted: the opt-in stays visible in the environment, is a single
        // value to remove, and local/isIP origins stay exempt either way.
        const allowInsecureOrigins = process.env.CORS_ALLOW_INSECURE_ORIGINS === '1';
        if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:' && !isLocal && !isIp && !allowInsecureOrigins) {
            console.error(`[CORS] rejecting non-https origin in production: ${s}`);
            return false;
        }
        return true;
    } catch (_) {
        return false;
    }
};

const exactAllowedOrigins = new Set([
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    // First-party production SPAs served by this backend (office + partner portal)
    'https://office.speednetkhulna.com',
    'https://partner.speednetkhulna.com',
    process.env.FRONTEND_URL,
].filter(Boolean).filter(isSaneOrigin));

if (process.env.CORS_ALLOWED_ORIGINS) {
    process.env.CORS_ALLOWED_ORIGINS
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .filter(isSaneOrigin)
        .forEach((v) => exactAllowedOrigins.add(v));
}

// Server IP from env only (no hardcoded fallback for security)
if (process.env.CORS_SERVER_IP && isSaneOrigin(process.env.CORS_SERVER_IP)) {
    exactAllowedOrigins.add(process.env.CORS_SERVER_IP);
}

// Trailing slash AND trailing root dot are both dropped so that
// `https://office.speednetkhulna.com.` resolves to the same allowlist entry as
// `https://office.speednetkhulna.com`. See stripHostRootDot note above.
const normalizeOrigin = (origin) =>
    !origin ? '' : stripOriginRootDot(String(origin).trim().replace(/\/+$/, '').toLowerCase());

// S11: NO wildcard subdomain matching. A wildcard with credentials:true lets
// any XSS on the public marketing site (speednetkhulna.com, jQuery 1.12.4) or
// any other subdomain drive the office API with the victim's session cookie
// (SameSite=Strict does not isolate subdomains). New origins go in
// CORS_ALLOWED_ORIGINS / FRONTEND_URL env — never a regex.
const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (origin === "null") return false; // sandboxed iframe — never trust with credentials
    const normalized = normalizeOrigin(origin);
    if (exactAllowedOrigins.has(origin) || exactAllowedOrigins.has(normalized)) return true;
    return false;
};

const corsMiddleware = cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        console.error(`CORS blocked for origin: ${origin}`);
        const error = new Error('CORS blocked for this origin');
        error.status = 403;
        return callback(error);
    },
    credentials: true,
});

module.exports = corsMiddleware;
