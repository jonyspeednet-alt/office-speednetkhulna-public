import { BRANCHES } from '../constants/branches.js';

export const normalizeSupportOffice = (value) => {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return '';
  const branch = BRANCHES.find((item) =>
    item.name.toLowerCase() === candidate ||
    item.code.toLowerCase() === candidate ||
    (item.aliases || []).some((alias) => alias.toLowerCase() === candidate)
  );
  // Intentional: display uses normalizeOfficeName (raw fallback) while access-scope uses '' fallback (fail-closed).
  return branch?.name || '';
};

export const getLoggedInSupportOffice = () => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return normalizeSupportOffice(user.work_location);
  } catch {
    return '';
  }
};
