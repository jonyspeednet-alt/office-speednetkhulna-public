function getAuthSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || null;
}

module.exports = { getAuthSecret };
