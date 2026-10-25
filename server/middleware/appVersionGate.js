'use strict';

// Mobile version gate (additive only — web clients unaffected).
// - No `X-App-Version` header  -> next() silently (web app + old clients).
// - Header present + MIN_APP_VERSION set + header < min -> 426 JSON.
// - Any error -> next() (never break web traffic).
const compareVersions = (a, b) => {
  const parts = (v) =>
    String(v || '')
      .trim()
      .split('.')
      .slice(0, 3)
      .map((p) => {
        const m = String(p).match(/^\d+/);
        const n = m ? parseInt(m[0], 10) : 0;
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parts(a);
  const pb = parts(b);
  while (pa.length < 3) pa.push(0);
  while (pb.length < 3) pb.push(0);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
};

const appVersionGate = (req, res, next) => {
  try {
    const header = req.headers && (req.headers['x-app-version'] || req.headers['X-App-Version']);
    const clientVersion = String(header || '').trim();
    if (!clientVersion) return next(); // web clients send no header
    const minVersion = String(process.env.MIN_APP_VERSION || '').trim();
    if (!minVersion) return next();
    if (compareVersions(clientVersion, minVersion) < 0) {
      return res.status(426).json({
        success: false,
        message: 'Please update your app to the latest version.',
        update_required: true,
      });
    }
    return next();
  } catch (_) {
    return next();
  }
};

module.exports = appVersionGate;
