const crypto = require('crypto');

const getLegacyKey = () => {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
};

const getVaultKey = () => {
  const raw = process.env.ROUTER_VAULT_KEY;
  if (!raw || !String(raw).trim()) return null;
  return crypto.createHash('sha256').update(String(raw)).digest();
};

const getKey = () => {
  // Encrypt prefers the new vault key; falls back to legacy JWT derivation
  const vault = getVaultKey();
  if (vault) return vault;
  const legacy = getLegacyKey();
  if (!legacy) throw new Error('Support device configuration cannot be unlocked: application secret is missing');
  return legacy;
};

const encryptRouterPassword = (plain) => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain || ''), 'utf8'), cipher.final()]);
  const envelope = { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  return JSON.stringify(envelope);
};

const decryptRouterPassword = (stored) => {
  const vaultKey = getVaultKey();
  const legacyKey = getLegacyKey();
  if (!vaultKey && !legacyKey) throw new Error('Support device configuration cannot be unlocked: application secret is missing');
  let envelope = stored;
  if (typeof envelope === 'string') {
    try {
      envelope = JSON.parse(envelope);
    } catch {
      throw new Error('Support router credential could not be unlocked');
    }
  }
  if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error('Support router credential could not be unlocked');
  }
  // Backward-compat: try the new vault key first, then legacy
  const candidates = [vaultKey, legacyKey].filter(Boolean);
  let lastErr = null;
  for (const key of candidates) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) { lastErr = e; }
  }
  throw new Error('Support router credential could not be unlocked');
};

module.exports = { encryptRouterPassword, decryptRouterPassword };
