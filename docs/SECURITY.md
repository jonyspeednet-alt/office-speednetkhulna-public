# Security Documentation — office.speednetkhulna.com

**Version:** 1.0 — 2026-09-03  
**Stack:** Node/Express + React (Vite) + PostgreSQL + LiteSpeed/Apache + PM2  
**Scope:** Puro project e security kivabe maintain kora hoy — sudhu ajker fix na, full system

---

## Table of Contents
1. [Authentication](#1-authentication)
2. [Authorization / RBAC](#2-authorization--rbac)
3. [Brute-Force Protection](#3-brute-force--rate-limiting)
4. [Transport & Headers](#4-transport--security-headers)
5. [CORS](#5-cors)
6. [Input Validation & SQL Injection](#6-input-validation--sql-injection)
7. [XSS / CSP](#7-xss--csp)
8. [CSRF](#8-csrf)
9. [CSRF + httpOnly Migration](#9-token-storage--httponly-migration)
10. [File Upload](#10-file-upload)
11. [IDOR / Access Control](#11-idor--access-control)
12. [Secrets & Config](#12-secrets--configuration)
13. [Database](#13-database)
14. [Audit Logging](#14-audit-logging)
15. [Client-Side](#15-client-side)
16. [Infrastructure / Proxy](#16-infrastructure--proxy)
17. [Build & Deploy](#17-build--deploy)
18. [Recent Fixes (3 Medium Risk)](#18-recent-fixes-3-medium-risk)
19. [Verification Commands](#19-verification)
20. [Pending Low Risks](#20-pending-low-risks)

---

## 1. Authentication

### 1.1 Employee (users table)
- **JWT verify** `server/middleware/auth.js:154` — `getAuthSecret()` missing hole 500 fail-closed, `jwt.verify(token, secret)` diye verify
- **Dual source:** `Authorization: Bearer` age check, na pele `req.cookies.token` fallback `server/middleware/auth.js:138` — stale cookie diye account switch confusion prevent
- **httpOnly cookie** `server/controllers/authController.js:138` — `httpOnly:true, secure:isProd, sameSite:"strict", path:"/", maxAge:7d` — JS `document.cookie` theke read possible na, XSS token theft block
- **Token payload** `id, role, emp_id, full_name, token_version` — `token_version` DB `users.token_version` er sathe match `server/middleware/auth.js:187` — password change korle purono token invalid (increment `server/controllers/authController.js:245`)
- **Auto-migration** `server/index.js:74` — `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version` + index, best-effort
- **Password:** `bcrypt.compare` 10 rounds age, plaintext fallback + auto-upgrade `bcrypt.hash` `server/controllers/authController.js:76` — purono plain password login er por auto hash hoy
- **Expiry:** 7d JWT, `expiresAt` client e pathano hoy UI warning er jonno — token JS e store hoy na
- **Cache-Control:** 401 response e `no-store` `server/middleware/auth.js:149` — cache poisoning block
- **Degraded auth:** Transient DB error `ECONNRESET/ETIMEDOUT/57P01` hole `authUserCache` TTL 10m MAX 1000 theke serve `server/middleware/auth.js:15` — availability vs strict auth tradeoff

### 1.2 Partner / Reseller (resellers table) — alada realm
- Separate cookie `partner_token`, separate middleware `requirePartner` `server/middleware/partnerAuth.js:10` — employee ≠ reseller, cross-realm IDOR block
- JWT type check `decoded.type==='partner' && reseller_id` `server/middleware/partnerAuth.js:61`
- Status check `status==='active'` na hole 403 `server/middleware/partnerAuth.js:75`
- `httpOnly + secure + SameSite=lax` 7d `server/middleware/partnerAuth.js:14`
- Password bcrypt + plaintext fallback `server/controllers/partner/authController.js:53`

---

## 2. Authorization / RBAC

Single source of truth `server/utilities/permissionRegistry.js:157` `getEffectivePermissions()`
- DB view `v_effective_user_permissions` (role grants + user overrides allow/deny) theke permission load `server/utilities/permissionRegistry.js:128`
- `role_id` na thakle sudhu legacy hardcoded defaults — role name spoof kore privilege barano jabe na `server/utilities/permissionRegistry.js:80`
- `MASTER_ADMIN_EMPLOYEE_IDS = SN-01` sudhu super admin `server/utilities/permissionRegistry.js:95`
- Helpers `requirePermission`, `requireAnyPermission`, `requireRole` `server/middleware/checkPermission.js:15` — per-route gate, fail hole 403 `server/utilities/apiResponse.js:24`

**Route matrix** `server/routes/index.js:1`:
- `/public` public (rate-limited), `/auth/login,logout` public, baki sob `authMiddleware` + per-route permission
- `resellerRoutes.js:8` webhook public kintu `GOOGLE_SHEETS_WEBHOOK_TOKEN` `server/controllers/reseller/utils.js:112` diye check
- `partnerRoutes.js:16` login/logout public, baki `requirePartner`
- `auditLogRoutes.js:8` double gate `requireRole('super admin') + requirePermission`

---

## 3. Brute-Force / Rate Limiting

- **Login** `server/routes/auth.js:16` `express-rate-limit` 5 req / 15min / IP, `X-Forwarded-For` (Apache proxy) aware, `standardHeaders:true`
- **Public profile** `server/routes/publicRoutes.js:6` 30 req / 60s / IP, in-memory max 5000 + 5min cleanup
- **cPanel/WAF** doc `(internal runbook)` — cPHulk 5/15min + 2FA + Cloudflare CAPTCHA recommend

---

## 4. Transport & Security Headers

**Node (helmet) for /api** `server/middleware/index.js:17`:
```js
helmet({
  contentSecurityPolicy: { defaultSrc ["'self'"], scriptSrc ["'self'","'unsafe-inline'","'unsafe-eval'"],
    styleSrc [...fonts.googleapis, cdnjs], fontSrc [...], imgSrc [self,data,blob,speednetkhulna,ui-avatars,quickchart],
    frameSrc ["'none'"], objectSrc ["'none'"] },
  crossOriginEmbedderPolicy:false
})
```
Auto adds `Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options` etc.

**Apache/LiteSpeed for static HTML** `(internal runbook)` `(internal runbook)` (Node down hole o header thake):
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(self), microphone=(), camera=()
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
ServerSignature Off + Header unset X-Powered-By
FilesMatch \.html -> Cache-Control no-store
RewriteCond %{HTTPS} off -> 301 https://
```

**Sourcemap** `client/vite.config.js:28` `sourcemap:false` — source leak block

---

## 5. CORS

`server/config/cors.js:4` Allowlist:
- `exactAllowedOrigins` = `localhost:3000,5173-5176, 127.0.0.1:5173-5174, FRONTEND_URL, CORS_ALLOWED_ORIGINS (CSV), CORS_SERVER_IP (env only, no hardcode)`
- Regex `^https?:\/\/([a-z0-9-]+\.)*speednetkhulna\.com` — sudhu apnar domain er subdomain
- `credentials:true`, origin normalize lowercase trim, non-allow -> `CORS blocked for origin` log

---

## 6. Input Validation & SQL Injection

- **100% parameterized** `pool.query(sql, [$1,$2])` — kothao string concat nai `server/controllers/authController.js:47`, `employeeController.js:42` etc. ~200+ query
- **Public profile** `server/controllers/publicController.js:39` regex `^[A-Z0-9\-]+$`i
- **Support** `server/controllers/supportController.js:6` whitelist: `allowedStatuses` Set, `priority` enum, `office` `ALLOWED_OFFICE_NAMES`
- **Reseller** `server/controllers/reseller/utils.js:136` `parseAmount`, `parseWholeNumber`, `normalizeChangeType` only `increase/decrease`
- **Partner request** `server/controllers/partner/requestController.js:19` `change_type` + amount>0 + downgrade 30d notice
- **Limits** `LIMIT 500` employees, `LIMIT 30` search, `LIMIT 1000` tickets — DoS via large result block

---

## 7. XSS / CSP

- CSP `default-src 'self'; frame-src 'none'; object-src 'none'` diye inline eval limited
- React auto-escape — kono `dangerouslySetInnerHTML` nai
- Audit log sanitization `server/utilities/auditLogger.js:3` `MAX_STRING 500, MAX_ARRAY 30, MAX_DEPTH 4`, `SENSITIVE_KEYS -> [REDACTED]`
- `bodyParser limit 20mb` `server/middleware/index.js:53` — payload bomb block

---

## 8. CSRF

- `SameSite=strict` (employee) / `lax` (partner) `server/controllers/authController.js:141` — cross-site cookie send block
- `withCredentials:true` + `helmet` + state-changing sudhu POST/PUT/PATCH (GET diye mutate na)
- `trust proxy: loopback` `server/index.js:63` — `X-Forwarded-For` spoof block (sudhu Apache loopback trust)

---

## 9. Token Storage — httpOnly Migration

**Before:** `localStorage.setItem("token")` + `Authorization: Bearer` — XSS hole token churi
**After (2026-09-03):**
- Server set `httpOnly` cookie only, client `localStorage.setItem("token")` 0 hit (build verify `dist/assets` `BAD count 0`)
- `client/src/config/axiosConfig.js:37` Bearer header remove, sudhu `withCredentials`, legacy token auto `removeItem`
- `client/src/services/authService.js:27` sudhu `user`+`expiresAt` store, `client/src/components/PrivateRoute.jsx:14` `user`+`expiresAt` check
- `client/src/components/SessionWarning.jsx:15` `expiresAt` diye 1h age warning, `POST /api/auth/refresh` cookie refresh
- `client/src/pages/SupportTickets.jsx:320` `user.id` diye count, token decode remove
- Transition: `server/middleware/auth.js:138` Bearer + cookie both accept, log e warning

---

## 10. File Upload

- **Reseller/Avatar** `server/middleware/uploadMiddleware.js:6` `multer.memoryStorage()` + `sharp` resize 800px + `webp` quality 80, filename `prefix-Date.now.webp` — originalname use na, PHP/RCE block
- **Partner avatar** `server/controllers/partner/settingsController.js:69` `reseller_<id>_<ts>.webp` 300x300
- **Employee diskStorage** `server/routes/employeeRoutes.js:12` `Date.now+random-originalname` — `fs.mkdirSync recursive`
- **Serve** `server/middleware/index.js:57` `express.static('/uploads', maxAge:'7d', -Indexes)`, avatar `server/controllers/partner/settingsController.js:104` regex `^reseller_\d+_\d+\.webp$` + `startsWith(reseller_${id}_)` + `path.basename`

---

## 11. IDOR / Access Control (verified)

- `GET /api/employees` mask `employee_id` if not `canManageUsers` `server/controllers/employeeController.js:50`
- `GET/PUT /api/employees/:id` `if(id!==current && !canEditAnyProfile) ->403` `server/controllers/employeeController.js:98`
- `PATCH status` `canManageUsers` + self toggle block `server/controllers/employeeController.js:201`
- `GET /api/partner/*` sob `WHERE reseller_id = $1` via `req.reseller.id` `server/controllers/partner/dashboardController.js:28`
- `GET /api/partner/invoice/:billId` `WHERE mb.id=$1 AND mb.reseller_id=$2` `server/controllers/partner/invoiceController.js:37`
- `PUT /api/partner/requests/:id` `WHERE id=$1 AND reseller_id=$2` `server/controllers/partner/requestController.js:116`
- Avatar `startsWith(reseller_${id}_)` — onno reseller er file access block

---

## 12. Secrets & Configuration

- **Load order** `server/utilities/envLoader.js:13` `secrets/.env.[mode] > .env.[mode] > secrets/.env > .env` — `APP_ENV` production/local only
- **Preserve PORT** `server/config/env.js:4` `ORIGINAL_PORT` dotenv er age save — port hijack block
- **Getter** `server/utilities/authSecret.js:1` `JWT_SECRET || SESSION_SECRET`
- **DB** `server/utilities/db.js:7` `MAIN_DB_*` prod, `DB_*` fallback, `strictTargetCheck` prod e exit, pool `max 20, idle 30s, query 15s, statement 20s, maxUses 7500`
- **.gitignore** `/.gitignore:4` `.env, secrets/, uploads/, *.sql.gz, ACCESS_CREDENTIALS.md, deploy.env, cookies.txt` — commit leak block
- **CORS IP** `server/config/cors.js:23` env only, hardcode nai

---

## 13. Database

- Pool `max 20, keepAlive true, verifyTargetDatabase retry 3x` `server/utilities/db.js:28`
- `timezone Asia/Dhaka` `server/utilities/db.js:54`
- Financial immutable: `reseller_financial_audit_logs` + `reseller_financial_audit_log_immutable` transactional `BEGIN/COMMIT` `server/controllers/reseller/billing.js:53`

---

## 14. Audit Logging

`server/utilities/auditLogger.js:93` table `audit_logs` bigserial `user_id, action_type, http_method, route_path, query_params::jsonb, request_body::jsonb, ip_address, duration_ms, success`
- Sanitization `password/new_password/token/authorization -> [REDACTED]` `server/utilities/auditLogger.js:40`
- `getIpAddress` `X-Forwarded-For` first hop `server/utilities/auditLogger.js:70`
- Middleware `res.json` capture + `res.locals.auditAction`, success GET skip, `/health` skip `server/utilities/auditLogger.js:159`
- `Cache-Control private,no-cache` GET, `no-store` mutating `server/middleware/index.js:72`
- Financial `verifyAuditIntegrity` + `exportFinancialAuditTrail` `server/utilities/auditLogger.js:280`
- Errors `server/utilities/errorLogger.js:8` `app_errors` table

---

## 15. Client-Side

- `client/src/config/axiosConfig.js:13` `withCredentials:true, timeout 30s, retry 2x on 502/503/504` for `GET/HEAD` with backoff, 401 -> `triggerLogout` (exp `user/expiresAt` clear)
- `loginUser` ager `token/user/expiresAt` clear + `auth-change` event `client/src/services/authService.js:14`
- `PrivateRoute.jsx` `user` + `expiresAt -30s` check
- `SessionWarning.jsx` 1h age warning, 60s interval, `POST /refresh`
- Partner `client-partner/src/services/api.js:3` `baseURL /api/partner, withCredentials:true`

---

## 16. Infrastructure / Proxy

- `app.set('trust proxy','loopback')` `server/index.js:63` — sudhu loopback Apache trust
- `(internal runbook)` SSRF harden: `path` trim, reject `..`, control chars, sudhu `127.0.0.1:5000/5001`, strip `host/content-length`, multipart boundary `----OfficeProxyBoundary+random_bytes12` + `addcslashes`
- Fallback curl + `proxy_restart.lock` 30s throttle + `nohup crontab_bootstrap.sh` `(internal runbook)`
- `.htaccess` `RewriteCond %{HTTPS} off -> 301 https://` + `-Indexes`, `api/(.*) -> proxy.php` age, `index.html` fallback pore `(internal runbook)`
- PM2 dual `office-api-a:5000 / office-api-b:5001` + cron guard `if(PORT==='5000')` `server/index.js:90`
- `client/dist/index.html:7` `meta robots noindex,nofollow`, `preconnect` fonts/cdn

---

## 17. Build & Deploy

- Vite `sourcemap:false, manualChunks` `client/vite.config.js:28`
- Deploy: build the client, copy `dist` to the docroot, then reload the process manager. Server layout, ports and topology are managed outside this repository.
- Partner alada docroot `partner.speednetkhulna.com` `(internal runbook)`
- `.well-known/security.txt` `client/public/.well-known/security.txt` + `server/index.js:178` fallback chain, `.gitignore` `!**/security.txt`

---

## 18. Recent Fixes (3 Medium Risk)

| Risk | Before | After | File |
|------|--------|-------|------|
| Brute-force login unlimited | `loginRateLimiter = (req,res,next)=>next()` | 5/15min `express-rate-limit` + `600` + `cPHulk` doc | `server/routes/auth.js:16` |
| Static No CSP/HSTS/X-Frame | Header absent on `/` | htaccess + helmet full set | `(internal runbook)` |
| Token in localStorage + FTP open | `localStorage token + Bearer` + port 21/2083 open | httpOnly Strict + Bearer remove + FTP doc `(internal runbook)` | `authController.js:138`, `axiosConfig.js:37` |

---

## 19. Verification

```bash
# Headers
curl -I https://office.speednetkhulna.com/ | grep -i "strict\|x-frame\|content-security"
curl -s https://office.speednetkhulna.com/.well-known/security.txt | head
# Rate limit
for i in {1..6}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://office.speednetkhulna.com/api/auth/login -H "Content-Type: application/json" -d '{"identifier":"test","password":"test"}'; done
# Auth cookie
curl -i -X POST https://office.speednetkhulna.com/api/auth/login -d '{"identifier":"...","password":"..."}' | grep -i "set-cookie.*HttpOnly.*SameSite=Strict"
# No token in JS
grep -r 'setItem("token"' client/dist/assets  # 0
# CORS
curl -H "Origin: https://evil.com" -I https://office.speednetkhulna.com/api/auth/me | grep "Access-Control-Allow-Origin"
```

---

## 20. Pending Low Risks (next sprint)

- `employeeController addEmployee` plain `password` insert — `bcrypt.hash` korte hobe `server/controllers/employeeController.js:81`
- `smsService.js:5` hardcoded `SPEEDNET` fallback — prod e `throw` korte hobe
- `uploadMiddleware` originalname sanitize + extension whitelist
- Login `User not found` vs `Invalid password` alada message — generic `Invalid credentials` korte hobe
- Rate limit in-memory per-process — Redis e move
- `Server: LiteSpeed` 403 e visible — `ServerTokens Prod` Apache conf

---
*Generated from direct file read — `server/middleware/auth.js`, `authController.js`, `permissionRegistry.js`, `cors.js`, `db.js`, `auditLogger.js`, `proxy.php`, `office_spa.htaccess`, `axiosConfig.js` etc. — not inferred.*