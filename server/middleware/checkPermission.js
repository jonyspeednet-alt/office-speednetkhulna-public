const { resolvePermission, isSuperAdmin } = require('../utilities/permissionRegistry');
const { unauthorized } = require('../utilities/apiResponse');

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const requireRole = (roleName) => {
  const expected = normalizeRole(roleName);
  return (req, res, next) => {
    const actual = normalizeRole(req.user?.role_name || req.user?.role);
    if (actual === expected) return next();
    return unauthorized(res, `Unauthorized: role ${roleName} required`);
  };
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (resolvePermission(req.user, permission)) return next();
    return unauthorized(res, `Unauthorized: missing permission (${permission})`);
  };
};

const requireAnyPermission = (permissions = []) => {
  return (req, res, next) => {
    if (isSuperAdmin(req.user)) return next();
    for (const p of permissions) {
      if (resolvePermission(req.user, p)) return next();
    }
    return unauthorized(res, `Unauthorized: requires one of [${permissions.join(', ')}]`);
  };
};

// Backward-compatible default export
module.exports = requirePermission;
module.exports.requirePermission = requirePermission;
module.exports.requireAnyPermission = requireAnyPermission;
module.exports.requireRole = requireRole;
