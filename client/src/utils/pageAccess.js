// Display-only mirror of server permissionRegistry (isSuperAdmin) +
// checkPermission for the Manage Permissions page.
// Enforcement lives on the server (requirePermission); this helper only
// decides what UI to show, so it must stay in sync with:
//   server/utilities/permissionRegistry.js  (isSuperAdmin, SN-01 master admin)
//   server/middleware/checkPermission.js    (requirePermission)

const MASTER_ADMIN_IDS = new Set(["SN-01"]);

const normalizeRole = (role) => String(role || "").trim().toLowerCase();

export const currentUserFromStorage = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
};

// Server parity: name-based super-admin applies ONLY to legacy users without
// a role_id. A custom role literally named "Super Admin" does NOT bypass.
export const isSuperAdminUser = (u) => {
  if (!u) return false;
  const emp = String(u.employee_id || u.emp_id || "").trim().toUpperCase();
  if (MASTER_ADMIN_IDS.has(emp)) return true;
  if (u.role_id) return false;
  const role = normalizeRole(u.role_name || u.role);
  return role === "super admin" || role === "superadmin";
};

export const canManagePermissions = (u) => {
  if (!u) return false;
  if (isSuperAdminUser(u)) return true;
  const p = u.permissions || {};
  return Boolean(
    u.all_access ||
      p.all_access ||
      p["permissions.manage"] ||
      p.p_manage_permissions ||
      u["permissions.manage"] ||
      u.p_manage_permissions,
  );
};
