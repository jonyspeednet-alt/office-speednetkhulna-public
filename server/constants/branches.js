/**
 * Branch / Office constants for SpeedNet — shared with client/src/constants/branches.js
 * Keep in sync. Single source for backend validation.
 */
const BRANCHES = [
  { id: 1, name: 'Corporate Office', code: 'CO', aliases: ['Head Office', 'Head Office (Corporate Office)', 'Khulna Head Office'] },
  { id: 2, name: 'Shonadanga Office', code: 'SHA', aliases: ['Sonadanga Office', 'Sonadanga Branch', 'Shonadanga Branch'] },
  { id: 3, name: 'Gollamari Office', code: 'GOL', aliases: [] },
  { id: 4, name: 'Boyra Office', code: 'BOY', aliases: [] }
];

const canonicalByAlias = new Map();
for (const b of BRANCHES) {
  canonicalByAlias.set(b.name.toLowerCase(), b.name);
  for (const a of b.aliases) canonicalByAlias.set(a.toLowerCase(), b.name);
}

const ALLOWED_OFFICE_NAMES = new Set(BRANCHES.map(b => b.name));
// also allow aliases for backwards compat
for (const b of BRANCHES) for (const a of b.aliases) ALLOWED_OFFICE_NAMES.add(a);

function normalizeOfficeName(input) {
  // DIVERGENCE: falsy input defaults to 'Corporate Office' (client uses '');
  // kept because addEmployee requires work_location and the 400-on-undefined
  // regression test depends on validateEmployeeInput, not on this default.
  if (!input) return 'Corporate Office';
  const key = String(input).trim().toLowerCase();
  return canonicalByAlias.get(key) || String(input).trim();
}

function isAllowedOffice(input) {
  return ALLOWED_OFFICE_NAMES.has(String(input).trim());
}

module.exports = { BRANCHES, ALLOWED_OFFICE_NAMES, normalizeOfficeName, isAllowedOffice };
