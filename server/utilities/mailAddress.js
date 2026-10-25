const { domainToASCII } = require('node:url');

// Invoice delivery accepts one mailbox, never display names, recipient lists,
// comments or quoted local parts. Bound input before any mail-library parsing.
const normalizeMailbox = (value) => {
  if (typeof value !== 'string' || value.length > 320) return null;
  // Reject controls even at the edges (trim must not conceal header injection).
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  const address = value.trim();
  const at = address.indexOf('@');
  if (at < 1 || at !== address.lastIndexOf('@')) return null;
  const local = address.slice(0, at);
  if (local.length > 64 || !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(local)) return null;
  const rawDomain = address.slice(at + 1);
  if (!rawDomain || /[\s()<>\[\],;:"\\/@?#%]/.test(rawDomain)) return null;
  const domain = domainToASCII(rawDomain).toLowerCase();
  if (!domain || domain.length > 253) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  const normalized = `${local}@${domain}`;
  return normalized.length <= 254 ? normalized : null;
};

module.exports = { normalizeMailbox };
