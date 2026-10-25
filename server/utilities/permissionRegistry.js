const pool = require("./db");

const ALL_MENU_PERMISSIONS = [
  "p_add_reseller",
  "p_apply_leave",
  "p_billing_logs",
  "p_add_discount",
  "p_generate_bill",
  "p_invoice",
  "p_manage_leaves",
  "p_manage_menus",
  "p_manage_permissions",
  "p_manage_procurement",
  "p_manage_users",
  "p_monthly_summary",
  "p_my_leaves",
  "p_noc_view",
  "p_reports",
  "p_request_bw",
  "p_requests_admin",
  "p_reseller_list",
  "p_system_logs",
  "p_tech_task",
  "p_view_static_invoice",
  "p_office_work",
  "p_assets_view",
  "p_assets_manage",
  "p_appointment_letter",
  "p_termination_letter",
  "p_employee_create_edit",
  "p_support_view",
  "p_support_create",
  "p_support_update",
  "p_support_assign",
  "p_support_mikrotik_sync",
  "p_support_router_manage",
  "p_route_visit",
  "p_route_visit_verify",
];

const LEGACY_TO_CANONICAL = {
  all_access: "system.all_access",
  p_manage_users: "users.manage",
  p_edit_any_profile: "users.edit.any",
  p_manage_permissions: "permissions.manage",
  p_manage_menus: "menus.manage",
  p_manage_leaves: "leave.manage",
  p_leave_submission: "leave.submit",
  p_apply_leave: "leave.apply",
  p_my_leaves: "leave.my",
  p_approvals: "leave.approvals.view",
  p_entitlements: "leave.entitlements.manage",
  p_calendar: "calendar.view",
  p_reports: "reports.view",
  p_notices: "notices.manage",
  p_phone_directory: "phone_directory.view",
  p_reseller_list: "reseller.list",
  p_reseller_profile: "reseller.profile",
  p_add_reseller: "reseller.add",
  p_request_bw: "reseller.requests.create",
  p_requests_admin: "reseller.requests.review",
  p_approve_request: "reseller.requests.approve",
  p_tech_task: "reseller.tasks.manage",
  p_noc_view: "reseller.status_noc.view",
  p_billing_logs: "billing.logs.view",
  p_add_discount: "billing.discount.add",
  p_monthly_summary: "billing.monthly_summary.view",
  p_generate_bill: "billing.generate_bill",
  p_invoice: "billing.invoice.view",
  p_view_static_invoice: "billing.invoice.static_view",
  p_system_logs: "audit.system_logs.view",
  p_manage_procurement: "procurement.manage",
  p_office_work: "office_work.manage",
  p_assets_view: "assets.view",
  p_assets_manage: "assets.manage",
  p_employees: "employees.view",
  p_office_work_tracker: "work_tracker.use",
  p_work_tracker_admin: "work_tracker.admin",
  p_asset_management: "asset_management.manage",
  p_appointment_letter: "appointment_letters.generate",
  p_termination_letter: "termination_letters.generate",
  p_employee_create_edit: "employees.create_edit",
  p_support_view: "support.ticket.view",
  p_support_create: "support.ticket.create",
  p_support_update: "support.ticket.update",
  p_support_assign: "support.ticket.assign",
  p_support_mikrotik_sync: "support.mikrotik.sync",
  p_support_router_manage: "support.router.manage",
  p_route_visit: "route_visit.manage",
  p_route_visit_verify: "route_visit.verify",
};

const CANONICAL_TO_LEGACY = Object.entries(LEGACY_TO_CANONICAL).reduce(
  (acc, [legacy, canonical]) => {
    if (!acc[canonical]) acc[canonical] = [];
    acc[canonical].push(legacy);
    return acc;
  },
  {},
);

const MASTER_ADMIN_EMPLOYEE_IDS = new Set(["SN-01"]);

const isTruthyPermission = (value) =>
  value === true || value === 1 || value === "1";

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const normalizeEmployeeId = (employeeId) =>
  String(employeeId || "")
    .trim()
    .toUpperCase();

const isMasterAdminUser = (user) =>
  MASTER_ADMIN_EMPLOYEE_IDS.has(
    normalizeEmployeeId(user?.employee_id || user?.emp_id),
  );

const isSuperAdmin = (user) => {
  if (isMasterAdminUser(user)) return true;
  // Users with a role_id are governed by their role's `permissions` JSON
  // (see Manage Permissions). Name-based super admin detection only applies
  // to legacy users without a role_id — otherwise a custom role literally
  // named "Super Admin" would bypass whatever was configured for it.
  if (user?.role_id) return false;
  const role = normalizeRole(user?.role_name || user?.role);
  return role === "super admin" || role === "superadmin";
};

// Hardcoded fallback for legacy users who predate the roles table (no
// role_id). Never applied to role_id-linked users — see isSuperAdmin() above.
const getDefaultRolePermissions = (roleNameRaw, employeeIdRaw = null) => {
  const roleName = normalizeRole(roleNameRaw);

  if (isMasterAdminUser({ employee_id: employeeIdRaw })) {
    const full = { all_access: true };
    for (const key of ALL_MENU_PERMISSIONS) full[key] = true;
    return full;
  }

  if (roleName === "super admin" || roleName === "superadmin") {
    const full = { all_access: true };
    for (const key of ALL_MENU_PERMISSIONS) full[key] = true;
    return full;
  }

  if (roleName === "admin") {
    const adminPerms = { all_access: true };
    for (const key of ALL_MENU_PERMISSIONS) adminPerms[key] = true;
    return adminPerms;
  }

  // Staff defaults: self-service only.
  return {
    p_apply_leave: true,
    p_my_leaves: true,
  };
};

// Single source of truth for "what can this user do". Queries the RBAC v2
// view (role grants + user overrides, allow/deny resolved) and, only for
// legacy users without a role_id, layers the hardcoded defaults underneath.
// Both middleware/auth.js (per-request enforcement) and authController.js
// (login response) call this — previously each had its own copy, and they
// had already drifted (see the smallint-column handling difference fixed in
// the RBAC v2 migration backfill).
const getEffectivePermissions = async (userRow) => {
  const permissions = {};

  const isLegacyRole = !userRow?.role_id;
  if (isLegacyRole) {
    Object.assign(
      permissions,
      getDefaultRolePermissions(
        userRow?.role_name || userRow?.role,
        userRow?.employee_id,
      ),
    );
  }

  if (userRow?.id) {
    const result = await pool.query(
      "SELECT permission_code, legacy_key FROM v_effective_user_permissions WHERE user_id = $1",
      [userRow.id],
    );
    result.rows.forEach((row) => {
      if (row.legacy_key) permissions[row.legacy_key] = true;
      if (row.permission_code) permissions[row.permission_code] = true;
    });
    // The view supplies positive grants only. Explicit denies must also
    // remove legacy defaults layered above, otherwise revocation is ignored.
    if (isLegacyRole) {
      const denied = await pool.query(
        `SELECT p.legacy_key FROM user_permission_overrides o
         JOIN permissions p ON p.id = o.permission_id
         WHERE o.user_id = $1 AND o.effect = 'deny'`,
        [userRow.id],
      );
      for (const row of denied.rows) {
        delete permissions[row.legacy_key];
        if (LEGACY_TO_CANONICAL[row.legacy_key]) delete permissions[LEGACY_TO_CANONICAL[row.legacy_key]];
      }
    }
  }

  const superAdmin = isSuperAdmin(userRow);
  if (superAdmin) {
    permissions.all_access = true;
    permissions["system.all_access"] = true;
  }

  return { permissions, isSuperAdmin: superAdmin };
};

const resolvePermission = (user, requestedPermission) => {
  const reqKey = String(requestedPermission || "").trim();
  if (!reqKey) return false;
  if (!user) return false;
  if (isSuperAdmin(user)) return true;

  const merged = {
    ...(user.permissions || {}),
    ...user,
  };

  // Global bypass
  if (
    isTruthyPermission(merged.all_access) ||
    isTruthyPermission(merged["system.all_access"])
  ) {
    return true;
  }

  const keysToCheck = new Set([reqKey]);

  // If requested canonical, include legacy aliases.
  if (CANONICAL_TO_LEGACY[reqKey]) {
    CANONICAL_TO_LEGACY[reqKey].forEach((k) => keysToCheck.add(k));
  }

  // If requested legacy, include canonical alias.
  if (LEGACY_TO_CANONICAL[reqKey]) {
    keysToCheck.add(LEGACY_TO_CANONICAL[reqKey]);
  }

  for (const key of keysToCheck) {
    if (isTruthyPermission(merged[key])) return true;
  }

  return false;
};

module.exports = {
  LEGACY_TO_CANONICAL,
  CANONICAL_TO_LEGACY,
  MASTER_ADMIN_EMPLOYEE_IDS,
  ALL_MENU_PERMISSIONS,
  isTruthyPermission,
  isMasterAdminUser,
  isSuperAdmin,
  getDefaultRolePermissions,
  getEffectivePermissions,
  resolvePermission,
};
