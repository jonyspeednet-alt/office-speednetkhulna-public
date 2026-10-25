import Swal from "sweetalert2";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getManagePermissionsData,
  updatePermission,
} from "../services/permissionService";
import {
  getRoles,
  saveRole,
  deleteRole,
  assignRoleToUser,
} from "../services/roleService";
import { t } from "../i18n";
import { canManagePermissions, currentUserFromStorage } from "../utils/pageAccess";
import "../styles/AdminDashboard.css";
import "../styles/ManagePermissions.css";

const permissionGroups = {
  user_management: [
    "p_manage_users",
    "p_edit_any_profile",
    "p_employees",
    "p_employee_create_edit",
  ],
  leave_management: [
    "p_manage_leaves",
    "p_leave_submission",
    "p_my_leaves",
    "p_approvals",
    "p_entitlements",
    "p_apply_leave",
  ],
  reseller_management: [
    "p_reseller_list",
    "p_reseller_profile",
    "p_request_bw",
    "p_requests_admin",
    "p_approve_request",
    "p_tech_task",
    "p_billing_logs",
    "p_add_discount",
    "p_monthly_summary",
    "p_generate_bill",
    "p_invoice",
    "p_view_static_invoice",
    "p_add_reseller",
    "p_noc_view",
  ],
  support: ["p_support_view", "p_support_create", "p_support_update", "p_support_assign", "p_support_mikrotik_sync", "p_support_router_manage"],
  hr_documents: ["p_appointment_letter", "p_termination_letter"],
  assets: ["p_assets_view", "p_assets_manage"],
  officeWork: ["p_office_work"],
  system: [
    "p_manage_permissions",
    "p_manage_menus",
    "p_reports",
    "p_notices",
    "p_calendar",
    "p_phone_directory",
    "p_system_logs",
  ],
  procurement: ["p_manage_procurement"],
  work_tracker: ["p_office_work_tracker", "p_work_tracker_admin"],
  asset: ["p_asset_management"],
};

const GROUP_ICONS = {
  user_management: "fa-users-cog",
  leave_management: "fa-calendar-check",
  system: "fa-cog",
  reseller_management: "fa-network-wired",
  support: "fa-headset",
  hr_documents: "fa-file-lines",
  procurement: "fa-boxes-stacked",
  work_tracker: "fa-briefcase",
  asset: "fa-layer-group",
  assets: "fa-cubes",
  officeWork: "fa-building",
  other: "fa-shield-halved",
};

const groupTitle = (g) => {
  if (g === "user_management") return t("managePermissions.userManagement");
  if (g === "leave_management") return t("managePermissions.leaveManagement");
  if (g === "system") return t("managePermissions.system");
  if (g === "reseller_management")
    return t("managePermissions.resellerManagement");
  if (g === "support") return t("managePermissions.supportTicket");
  if (g === "hr_documents") return t("managePermissions.hrDocuments");
  if (g === "procurement") return t("managePermissions.procurement");
  if (g === "work_tracker") return t("managePermissions.workTracker");
  if (g === "asset") return t("managePermissions.asset");
  if (g === "assets") return t("managePermissions.assets");
  if (g === "officeWork") return t("managePermissions.officeWork");
  return t("managePermissions.other");
};

const titleize = (k) => {
  const s = String(k ?? "").trim();
  if (!s) return "—";
  if (!/^[A-Za-z0-9_.]+$/.test(s)) return s;
  return s
    .replace(/^p_/, "")
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const useAutoMessage = () => {
  const [msg, setMsg] = useState(null);
  const t = useRef(null);
  const clear = useCallback(() => {
    clearTimeout(t.current);
    setMsg(null);
  }, []);
  const show = useCallback(
    (type, text) => {
      setMsg({ type, text });
      clearTimeout(t.current);
      // Errors stay longer + have a manual close button; success fades fast.
      t.current = setTimeout(() => setMsg(null), type === "danger" ? 8000 : 4000);
    },
    [],
  );
  return [msg, show, clear];
};

const ManagePermissions = () => {
  // Display-only check (server parity via pageAccess.js). Enforcement is
  // server-side (requirePermission) — a tampered localStorage only changes
  // what renders, never what the API returns.
  const currentUser = currentUserFromStorage();
  const canAccessPage = canManagePermissions(currentUser);

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [columns, setColumns] = useState([]);
  const [roles, setRoles] = useState([]);
  const [activePermissions, setActivePermissions] = useState({});
  const [activeTab, setActiveTab] = useState("roles");
  const [userSearch, setUserSearch] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [overrideGroupFilter, setOverrideGroupFilter] = useState(null);
  const [showOnlyOverrides, setShowOnlyOverrides] = useState(false);
  const [message, showMessage, clearMessage] = useAutoMessage();
  const [collapsedRoles, setCollapsedRoles] = useState({});
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [modalError, setModalError] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [clearingIds, setClearingIds] = useState({});
  const [assigningIds, setAssigningIds] = useState({});
  const [toggling, setToggling] = useState({});
  const [bulkPending, setBulkPending] = useState({});
  const [overrideColSearch, setOverrideColSearch] = useState("");
  const [loadErrors, setLoadErrors] = useState({ perms: null, roles: null });
  const newRoleBtnRef = useRef(null);
  const roleModalInputRef = useRef(null);
  const roleModalBoxRef = useRef(null);

  const fetchData = useCallback(async () => {
    // No access → no API calls (avoids 2×403 + misleading loadFailed toast).
    if (!canAccessPage) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadErrors({ perms: null, roles: null });
      // Partial render: one source failing must not discard the other half.
      const [pr, rr] = await Promise.allSettled([
        getManagePermissionsData(),
        getRoles(),
      ]);
      if (pr.status === "fulfilled") {
        const permData = pr.value || {};
        setUsers(Array.isArray(permData.users) ? permData.users : []);
        setColumns(Array.isArray(permData.columns) ? permData.columns : []);
        setActivePermissions(permData.activePermissions || {});
      } else {
        setLoadErrors((e) => ({
          ...e,
          perms: pr.reason?.message || t("managePermissions.loadFailed"),
        }));
      }
      if (rr.status === "fulfilled") {
        setRoles(Array.isArray(rr.value) ? rr.value : []);
      } else {
        setLoadErrors((e) => ({
          ...e,
          roles: rr.reason?.message || t("managePermissions.loadFailed"),
        }));
      }
    } finally {
      setLoading(false);
    }
  }, [canAccessPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (overrideGroupFilter !== null || columns.length === 0) return;
    if (columns.length > 30) {
      const present = new Set(columns.map((c) => c.permission_column));
      const first = Object.keys(permissionGroups).find((g) =>
        permissionGroups[g].some((k) => present.has(k)),
      );
      setOverrideGroupFilter(first || "all");
    } else {
      setOverrideGroupFilter("all");
    }
  }, [columns, overrideGroupFilter]);

  useEffect(() => {
    if (!showRoleModal) return;
    roleModalInputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowRoleModal(false);
        newRoleBtnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showRoleModal]);

  const colNameMap = useMemo(() => {
    const m = new Map();
    columns.forEach((c) => {
      m.set(c.permission_column, c.menu_name || titleize(c.permission_column));
    });
    return m;
  }, [columns]);

  const groupMap = useMemo(() => {
    const m = new Map();
    Object.entries(permissionGroups).forEach(([g, ks]) =>
      ks.forEach((k) => {
        if (!m.has(k)) m.set(k, g);
      }),
    );
    return m;
  }, []);

  const roleNameMap = useMemo(() => {
    const m = new Map();
    roles.forEach((r) => m.set(r.id, r.name));
    users.forEach((u) => {
      if (u.role_id != null && !m.has(u.role_id) && u.role) m.set(u.role_id, u.role);
    });
    return m;
  }, [roles, users]);

  const getColName = (k) => colNameMap.get(k) || titleize(k);
  const getGroup = useCallback((pk) => groupMap.get(pk) || "other", [groupMap]);

  const extraKeys = useMemo(() => {
    const grouped = new Set(Object.values(permissionGroups).flat());
    return columns
      .map((c) => c.permission_column)
      .filter((k) => !grouped.has(k));
  }, [columns]);

  // Token-based user match: "sk.rafath" finds "SK. Rafath Uddin".
  // Splits the query on non-alphanumerics; every token must appear in
  // name / ID / role / phone / email (case-insensitive).
  const matchUser = useCallback(
    (u, raw) => {
      const tokens = String(raw || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      if (!tokens.length) return true;
      const hay = [
        u.full_name,
        u.employee_id,
        roleNameMap.get(u.role_id) || u.role,
        u.phone,
        u.email,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return tokens.every((t) => hay.includes(t));
    },
    [roleNameMap],
  );

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim();
    if (!q) return users;
    return users.filter((u) => matchUser(u, q));
  }, [users, userSearch, matchUser]);

  const filteredOverrideUsers = useMemo(() => {
    const q = overrideSearch.trim();
    // Independent scope: Users-tab search must NOT leak into this tab.
    const base = !q ? users : users.filter((u) => matchUser(u, q));
    if (!showOnlyOverrides) return base;
    return base.filter((u) =>
      Object.values(activePermissions[u.id] || {}).some(Boolean),
    );
  }, [users, overrideSearch, showOnlyOverrides, activePermissions, matchUser]);

  const usersWithOverrides = useMemo(
    () =>
      users.filter((u) =>
        Object.values(activePermissions[u.id] || {}).some(Boolean),
      ).length,
    [users, activePermissions],
  );

  const overrideColumns = useMemo(() => {
    const filter = overrideGroupFilter || "all";
    const base =
      filter === "all"
        ? columns
        : columns.filter((c) => getGroup(c.permission_column) === filter);
    const q = overrideColSearch.trim().toLowerCase();
    const searched = !q
      ? base
      : base.filter((c) =>
          (colNameMap.get(c.permission_column) || "")
            .toLowerCase()
            .includes(q),
        );
    const groupOrder = [...Object.keys(permissionGroups), "other"];
    return [...searched].sort((a, b) => {
      const ga = groupOrder.indexOf(getGroup(a.permission_column));
      const gb = groupOrder.indexOf(getGroup(b.permission_column));
      return ga - gb;
    });
  }, [columns, getGroup, overrideGroupFilter, overrideColSearch, colNameMap]);

  const overrideHeaderGroups = useMemo(() => {
    const out = [];
    overrideColumns.forEach((col) => {
      const g = getGroup(col.permission_column);
      const last = out[out.length - 1];
      if (last && last.group === g) last.cols.push(col);
      else out.push({ group: g, cols: [col] });
    });
    return out;
  }, [getGroup, overrideColumns]);

  const overrideGroupOptions = useMemo(
    () => [
      "all",
      ...Array.from(new Set(columns.map((c) => getGroup(c.permission_column)))),
    ],
    [columns, getGroup],
  );

  const overrideCount = useMemo(
    () =>
      Object.values(activePermissions || {}).reduce(
        (a, r) => a + Object.values(r || {}).filter(Boolean).length,
        0,
      ),
    [activePermissions],
  );

  const roleUserCount = useMemo(() => {
    const m = {};
    users.forEach((u) => {
      if (u.role_id) m[u.role_id] = (m[u.role_id] || 0) + 1;
    });
    return m;
  }, [users]);

  const withBnDetail = (key, err) => {
    const base = t(key);
    const raw = err?.message ? String(err.message) : "";
    return raw && raw !== base ? `${base} (${raw})` : base;
  };

  const handleRoleToggle = async (role, pk) => {
    const key = `${role.id}:${pk}`;
    if (toggling[key]) return;
    const wasOn = !!role.permissions?.[pk];
    const previous = { ...(role.permissions || {}) };
    const updated = { ...previous };
    if (wasOn) delete updated[pk];
    else updated[pk] = true;
    setToggling((p) => ({ ...p, [key]: true }));
    setRoles((p) =>
      p.map((r) => (r.id === role.id ? { ...r, permissions: updated } : r)),
    );
    try {
      await saveRole({ ...role, permissions: updated });
      showMessage(
        "info",
        t("managePermissions.roleUpdated")
          .replace("{name}", role.name)
          .replace("{perm}", getColName(pk))
          .replace(
            "{state}",
            wasOn
              ? t("managePermissions.stateOff")
              : t("managePermissions.stateOn"),
          ),
      );
    } catch (err) {
      console.error("Role toggle error:", err);
      setRoles((p) =>
        p.map((r) => (r.id === role.id ? { ...r, permissions: previous } : r)),
      );
      showMessage("danger", withBnDetail("managePermissions.roleUpdateFailed", err));
    } finally {
      setToggling((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  };

  const handleBulkRole = async (role, perms, grant) => {
    if (bulkPending[role.id]) return;
    const previous = { ...(role.permissions || {}) };
    const updated = { ...previous };
    perms.forEach((pk) => {
      if (grant) updated[pk] = true;
      else delete updated[pk];
    });
    setBulkPending((p) => ({ ...p, [role.id]: true }));
    setRoles((p) =>
      p.map((r) => (r.id === role.id ? { ...r, permissions: updated } : r)),
    );
    try {
      await saveRole({ ...role, permissions: updated });
      showMessage(
        "info",
        t("managePermissions.bulkUpdated")
          .replace("{name}", role.name)
          .replace("{count}", String(perms.length))
          .replace(
            "{state}",
            grant
              ? t("managePermissions.stateOn")
              : t("managePermissions.stateOff"),
          ),
      );
    } catch (err) {
      console.error("Bulk role error:", err);
      setRoles((p) =>
        p.map((r) => (r.id === role.id ? { ...r, permissions: previous } : r)),
      );
      showMessage("danger", withBnDetail("managePermissions.roleUpdateFailed", err));
    } finally {
      setBulkPending((p) => {
        const n = { ...p };
        delete n[role.id];
        return n;
      });
    }
  };

  const handleOverrideToggle = async (uid, col, cur) => {
    const key = `u:${uid}:${col}`;
    if (toggling[key]) return;
    const nv = cur ? 0 : 1;
    setToggling((p) => ({ ...p, [key]: true }));
    setActivePermissions((p) => ({
      ...p,
      [uid]: { ...(p[uid] || {}), [col]: nv === 1 },
    }));
    try {
      await updatePermission(uid, col, nv);
      showMessage(
        "info",
        (nv === 1
          ? t("managePermissions.overrideGranted")
          : t("managePermissions.overrideRemoved")
        ).replace("{perm}", getColName(col)),
      );
    } catch (err) {
      console.error("Override error:", err);
      setActivePermissions((p) => ({
        ...p,
        [uid]: { ...(p[uid] || {}), [col]: cur },
      }));
      showMessage("danger", withBnDetail("managePermissions.overrideUpdateFailed", err));
    } finally {
      setToggling((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  };

  const handleAssignRole = async (uid, rid) => {
    if (assigningIds[uid]) return;
    const target = users.find((u) => u.id === uid);
    // Empty option = unassign: destructive, confirm first.
    if (!rid) {
      const confirmed = await Swal.fire({
        title: t("managePermissions.unassignConfirmTitle"),
        text: t("managePermissions.unassignConfirmText").replace(
          "{name}",
          target?.full_name || `#${uid}`,
        ),
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        cancelButtonColor: "#64748b",
        confirmButtonText: t("managePermissions.removeAction"),
        cancelButtonText: t("managePermissions.cancelAction"),
      });
      if (!confirmed.isConfirmed) return;
    }
    setAssigningIds((p) => ({ ...p, [uid]: true }));
    const prevRoleId = target?.role_id ?? null;
    const prevRoleText = target?.role ?? null;
    try {
      const res = await assignRoleToUser(uid, rid);
      // Server now syncs users.role text alongside role_id — mirror both so
      // Employees list / Edit form never disagree with this page.
      const syncedName = res?.role
        || (rid ? roleNameMap.get(Number(rid)) || null : 'Staff');
      setUsers((p) =>
        p.map((u) =>
          u.id === uid
            ? { ...u, role_id: rid ? Number(rid) : null, role: syncedName ?? u.role }
            : u,
        ),
      );
      const roleName = syncedName || (rid ? `#${rid}` : t("managePermissions.noRole"));
      showMessage(
        "info",
        t("managePermissions.roleAssignedDetail")
          .replace("{user}", target?.full_name || `#${uid}`)
          .replace("{role}", roleName),
      );
    } catch (err) {
      console.error("Assign role error:", err);
      setUsers((p) =>
        p.map((u) => (u.id === uid ? { ...u, role_id: prevRoleId, role: prevRoleText } : u)),
      );
      showMessage("danger", withBnDetail("managePermissions.roleAssignFailed", err));
    } finally {
      setAssigningIds((p) => {
        const n = { ...p };
        delete n[uid];
        return n;
      });
    }
  };

  const handleClearOverrides = async (uid) => {
    if (clearingIds[uid]) return;
    const target = users.find((u) => u.id === uid);
    const ex = activePermissions[uid] || {};
    const enabled = Object.entries(ex)
      .filter(([, v]) => !!v)
      .map(([k]) => k);
    if (!enabled.length) return;
    const shown = enabled.slice(0, 8).map((k) => getColName(k));
    const more =
      enabled.length > 8
        ? t("managePermissions.moreCount").replace(
            "{count}",
            String(enabled.length - 8),
          )
        : "";
    const confirmed = await Swal.fire({
      title: t("managePermissions.clearConfirmTitle"),
      html: `<p>${t("managePermissions.clearConfirmText")
        .replace("{count}", String(enabled.length))
        .replace("{name}", target?.full_name || `#${uid}`)}</p>
        <ul style="text-align:left;margin:0.5rem 0 0;padding-left:1.2rem">${shown
          .map((n) => `<li>${n}</li>`)
          .join("")}${more ? `<li>${more}</li>` : ""}</ul>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: t("managePermissions.clearAction"),
      cancelButtonText: t("managePermissions.cancelAction"),
    });
    if (!confirmed.isConfirmed) return;
    const snap = { ...ex };
    setClearingIds((p) => ({ ...p, [uid]: true }));
    setActivePermissions((p) => ({
      ...p,
      [uid]: Object.fromEntries(Object.keys(ex).map((k) => [k, false])),
    }));
    const results = await Promise.allSettled(
      enabled.map((pk) => updatePermission(uid, pk, 0)),
    );
    setClearingIds((p) => {
      const n = { ...p };
      delete n[uid];
      return n;
    });
    const failedKeys = enabled.filter(
      (_, i) => results[i].status === "rejected",
    );
    if (failedKeys.length > 0) {
      const restore = Object.fromEntries(failedKeys.map((k) => [k, snap[k]]));
      setActivePermissions((p) => ({ ...p, [uid]: { ...p[uid], ...restore } }));
      const names = failedKeys
        .slice(0, 5)
        .map((k) => getColName(k))
        .join(", ");
      showMessage(
        "danger",
        t("managePermissions.partialClear")
          .replace("{ok}", String(enabled.length - failedKeys.length))
          .replace("{total}", String(enabled.length))
          .replace("{failed}", String(failedKeys.length))
          .replace("{names}", names),
      );
    } else {
      showMessage("info", t("managePermissions.overrideCleared"));
    }
  };

  const handleCreateRole = async (e) => {
    e.preventDefault();
    const name = newRoleName.trim();
    if (!name) return;
    if (
      roles.some((r) => String(r.name || "").toLowerCase() === name.toLowerCase())
    ) {
      setModalError(t("managePermissions.modalDuplicate"));
      return;
    }
    setModalError("");
    setSavingRole(true);
    try {
      const res = await saveRole({ name, permissions: {} });
      if (!res?.role) throw new Error("Server did not return the created role");
      const nr = res.role;
      setRoles((p) => [...p, nr]);
      setCollapsedRoles((p) => ({ ...p, [nr.id]: false }));
      setNewRoleName("");
      setShowRoleModal(false);
      newRoleBtnRef.current?.focus();
      showMessage(
        "info",
        t("managePermissions.roleCreatedDetail").replace("{name}", nr.name),
      );
      setTimeout(() => {
        document
          .getElementById(`mp-role-${nr.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    } catch (err) {
      console.error("Create role error:", err);
      const msg = withBnDetail("managePermissions.createFailedInline", err);
      // Modal is above the global toast: show the error inside the modal.
      setModalError(msg);
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role) => {
    const uc = roleUserCount[role.id] || 0;
    if (uc > 0) {
      showMessage(
        "danger",
        t("managePermissions.roleDeleteBlocked")
          .replace("{name}", role.name)
          .replace("{count}", String(uc)),
      );
      return;
    }
    const confirmed = await Swal.fire({
      title: t("managePermissions.deleteRoleTitle").replace("{name}", role.name),
      text: t("managePermissions.deleteRoleConfirm"),
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: t("managePermissions.deleteAction"),
      cancelButtonText: t("managePermissions.cancelAction"),
    });
    if (!confirmed.isConfirmed) return;
    try {
      await deleteRole(role.id);
      setRoles((p) => p.filter((r) => r.id !== role.id));
      showMessage(
        "info",
        t("managePermissions.roleDeletedDetail").replace("{name}", role.name),
      );
    } catch (err) {
      console.error("Delete role error:", err);
      showMessage("danger", withBnDetail("managePermissions.roleDeleteFailed", err));
    }
  };

  if (loading)
    return (
      <div className="manage-permissions-page">
        <div
          className="mp-loading-status"
          role="status"
          aria-live="polite"
        >
          {t("managePermissions.loading")}
        </div>
        <div className="mp-skeleton-hero" aria-hidden="true" />
        <div className="mp-skeleton-bar" aria-hidden="true" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mp-skeleton-card" aria-hidden="true" />
        ))}
      </div>
    );

  if (!canAccessPage)
    return (
      <div className="manage-permissions-page">
        <div className="alert alert-danger m-4" role="alert">
          <i className="fas fa-lock me-2" aria-hidden="true" />
          {t("managePermissions.accessDenied")}
        </div>
      </div>
    );

  return (
    <div className="manage-permissions-page">
      <section className="mp-hero">
        <div>
          <span className="mp-chip">
            <i className="fas fa-shield-alt" aria-hidden="true" /> {t("managePermissions.accessControl")}
          </span>
          <h1>{t("managePermissions.centerTitle")}</h1>
          <p>{t("managePermissions.centerSubtitle")}</p>
        </div>
        <div className="mp-metrics">
          <button type="button" className="mp-metric" onClick={() => setActiveTab("roles")}>
            <span>{t("managePermissions.totalRoles")}</span>
            <strong>{roles.length}</strong>
          </button>
          <button type="button" className="mp-metric" onClick={() => setActiveTab("users")}>
            <span>{t("managePermissions.totalUsers")}</span>
            <strong>{users.length}</strong>
          </button>
          <button type="button" className="mp-metric" onClick={() => setActiveTab("overrides")}>
            <span>{t("managePermissions.permissions")}</span>
            <strong>{columns.length}</strong>
          </button>
          <button
            type="button"
            className="mp-metric"
            title={t("managePermissions.userOverridesHint")}
            onClick={() => setActiveTab("overrides")}
          >
            <span>{t("managePermissions.userOverrides")}</span>
            <strong>{overrideCount}</strong>
          </button>
        </div>
      </section>

      {message && (
        <div
          className={`mp-alert ${message.type === "danger" ? "danger" : "info"}`}
          role={message.type === "danger" ? "alert" : "status"}
          aria-live={message.type === "danger" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <i
            className={`fas ${message.type === "danger" ? "fa-triangle-exclamation" : "fa-circle-check"}`}
            aria-hidden="true"
          />
          <span>{message.text}</span>
          <button
            type="button"
            className="mp-alert-close"
            aria-label={t("managePermissions.closeAction")}
            onClick={clearMessage}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
      )}

      {(loadErrors.perms || loadErrors.roles) && (
        <div className="mp-alert danger" role="alert" aria-live="assertive" aria-atomic="true">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>
            {loadErrors.perms && loadErrors.roles
              ? t("managePermissions.loadFailed")
              : loadErrors.perms
                ? t("managePermissions.permsLoadFailed")
                : t("managePermissions.rolesLoadFailed")}
          </span>
          <button type="button" className="mp-btn-secondary mp-retry-btn" onClick={fetchData}>
            <i className="fas fa-rotate-right" aria-hidden="true" /> {t("managePermissions.retryAction")}
          </button>
        </div>
      )}

      <section className="mp-toolbar">
        <div
          className="mp-tabs"
          role="tablist"
          aria-label={t("managePermissions.centerTitle")}
          onKeyDown={(e) => {
            const ids = ["roles", "users", "overrides"];
            const i = ids.indexOf(activeTab);
            let n = null;
            if (e.key === "ArrowRight") n = ids[(i + 1) % ids.length];
            else if (e.key === "ArrowLeft") n = ids[(i - 1 + ids.length) % ids.length];
            else if (e.key === "Home") n = ids[0];
            else if (e.key === "End") n = ids[ids.length - 1];
            if (n) {
              e.preventDefault();
              setActiveTab(n);
              document.getElementById(`mp-tab-${n}`)?.focus();
            }
          }}
        >
          {[
            ["roles", "fa-layer-group", t("managePermissions.tabRoles"), roles.length, ""],
            ["users", "fa-users", t("managePermissions.tabUsers"), users.length, userSearch],
            ["overrides", "fa-sliders", t("managePermissions.tabOverrides"), usersWithOverrides, overrideSearch],
          ].map(([id, icon, label, cnt, filterText]) => (
            <button
              key={id}
              id={`mp-tab-${id}`}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`mp-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              title={
                id === "overrides"
                  ? t("managePermissions.userOverridesHint")
                  : undefined
              }
              className={`mp-tab ${activeTab === id ? "active" : ""}${filterText ? " has-filter" : ""}`}
              onClick={() => setActiveTab(id)}
            >
              <i className={`fas ${icon}`} aria-hidden="true" /> {label}
              <span className="mp-tab-badge">{cnt}</span>
            </button>
          ))}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {(activeTab === "users" || activeTab === "overrides") && (
            <div className="mp-search">
              <i className="fas fa-search" aria-hidden="true" />
              <input
                type="text"
                aria-label={t("managePermissions.searchUser")}
                placeholder={t("managePermissions.searchUser")}
                value={activeTab === "users" ? userSearch : overrideSearch}
                onChange={(e) =>
                  activeTab === "users"
                    ? setUserSearch(e.target.value)
                    : setOverrideSearch(e.target.value)
                }
              />
              {(activeTab === "users" ? userSearch : overrideSearch) && (
                <button
                  className="mp-search-clear"
                  aria-label={t("managePermissions.clearSearch")}
                  onClick={() =>
                    activeTab === "users" ? setUserSearch("") : setOverrideSearch("")
                  }
                  type="button"
                >
                  <i className="fas fa-times" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {activeTab === "roles" && (
            <button
              ref={newRoleBtnRef}
              className="mp-btn-primary"
              onClick={() => setShowRoleModal(true)}
            >
              <i className="fas fa-plus" aria-hidden="true" /> {t("managePermissions.addRole")}
            </button>
          )}
        </div>
      </section>

      {activeTab === "roles" && (
        <div
          className="roles-section"
          role="tabpanel"
          id="mp-panel-roles"
          aria-labelledby="mp-tab-roles"
        >
          <div className="mp-roles-actions">
            <span className="mp-muted-text">{t("managePermissions.roleEnabledLocked")}</span>
            <span className="mp-roles-actions-btns">
              <button
                type="button"
                className="mp-btn-secondary mp-mini-btn"
                onClick={() => setCollapsedRoles({})}
              >
                {t("managePermissions.expandAll")}
              </button>
              <button
                type="button"
                className="mp-btn-secondary mp-mini-btn"
                onClick={() =>
                  setCollapsedRoles(
                    Object.fromEntries(roles.map((r) => [r.id, true])),
                  )
                }
              >
                {t("managePermissions.collapseAll")}
              </button>
            </span>
          </div>
          {roles.length === 0 && !loadErrors.roles && (
            <div className="mp-table-card">
              <div className="mp-empty-row" style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--text-muted)" }}>
                <div>{t("managePermissions.noRoles")}</div>
                <button
                  type="button"
                  className="mp-btn-primary"
                  style={{ marginTop: "0.75rem" }}
                  onClick={() => setShowRoleModal(true)}
                >
                  <i className="fas fa-plus" aria-hidden="true" /> {t("managePermissions.addRole")}
                </button>
              </div>
            </div>
          )}
          {roles.map((role) => {
            const isCollapsed = !!collapsedRoles[role.id];
            const enabledCnt = Object.keys(role.permissions || {}).length;
            const uc = roleUserCount[role.id] || 0;
            const bulkBusy = !!bulkPending[role.id];
            return (
              <div key={role.id} id={`mp-role-${role.id}`} className="mp-table-card mb-3">
                <header>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <button
                      className="mp-collapse-btn"
                      aria-label={
                        isCollapsed
                          ? t("managePermissions.expand")
                          : t("managePermissions.collapse")
                      }
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsedRoles((p) => ({
                          ...p,
                          [role.id]: !p[role.id],
                        }))
                      }
                      type="button"
                    >
                      <i
                        className={`fas fa-chevron-${isCollapsed ? "right" : "down"}`}
                        aria-hidden="true"
                      />
                    </button>
                    <h2>{role.name}</h2>
                    <span className="mp-role-badge enabled">
                      {t("managePermissions.permsBadge").replace("{count}", String(enabledCnt))}
                    </span>
                    <span className="mp-role-badge users">
                      {t("managePermissions.usersBadge").replace("{count}", String(uc))}
                    </span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {uc > 0 && (
                      <span className="mp-muted-text">
                        {t("managePermissions.deleteBlockedHint").replace("{count}", String(uc))}
                      </span>
                    )}
                    <button
                      className="mp-delete-role-btn"
                      onClick={() => handleDeleteRole(role)}
                      disabled={uc > 0}
                      type="button"
                      aria-label={t("managePermissions.deleteRole")}
                      title={
                        uc > 0
                          ? t("managePermissions.deleteBlockedHint").replace("{count}", String(uc))
                          : t("managePermissions.deleteRole")
                      }
                    >
                      <i className="fas fa-trash" aria-hidden="true" />
                    </button>
                  </div>
                </header>
                {!isCollapsed && (
                  <div className="p-3">
                    {Object.entries(permissionGroups).map(([gid, perms]) => (
                      <div key={gid} className="mp-perm-group mb-3">
                        <div className="mp-group-label">
                          <i
                            className={`fas ${GROUP_ICONS[gid] || "fa-shield-halved"}`}
                            aria-hidden="true"
                          />{" "}
                          {groupTitle(gid)}
                          <span className="mp-group-count">
                            {
                              perms.filter((k) => !!role.permissions?.[k])
                                .length
                            }
                            /{perms.length}
                          </span>
                          <span className="mp-group-actions">
                            <button
                              type="button"
                              className="mp-mini-btn"
                              disabled={bulkBusy}
                              onClick={() => handleBulkRole(role, perms, true)}
                            >
                              {t("managePermissions.enableAll")}
                            </button>
                            <button
                              type="button"
                              className="mp-mini-btn"
                              disabled={bulkBusy}
                              onClick={() => handleBulkRole(role, perms, false)}
                            >
                              {t("managePermissions.clearGroup")}
                            </button>
                          </span>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          {perms.map((pk) => {
                            const busy = !!toggling[`${role.id}:${pk}`];
                            return (
                              <label
                                key={pk}
                                className={`mp-perm-pill ${role.permissions?.[pk] ? "active" : ""}${busy ? " busy" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  className="visually-hidden"
                                  checked={!!role.permissions?.[pk]}
                                  disabled={busy || bulkBusy}
                                  aria-label={`${getColName(pk)} — ${role.name}`}
                                  onChange={() => handleRoleToggle(role, pk)}
                                />
                                <i
                                  className={`fas ${role.permissions?.[pk] ? "fa-check-circle" : "fa-circle"}`}
                                  aria-hidden="true"
                                />
                                <span>{getColName(pk)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {extraKeys.length > 0 && (
                      <div className="mp-perm-group mb-2">
                        <div className="mp-group-label">
                          <i className="fas fa-shield-halved" aria-hidden="true" /> {t("managePermissions.other")}
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          {extraKeys.map((pk) => {
                            const busy = !!toggling[`${role.id}:${pk}`];
                            return (
                              <label
                                key={pk}
                                className={`mp-perm-pill ${role.permissions?.[pk] ? "active" : ""}${busy ? " busy" : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  className="visually-hidden"
                                  checked={!!role.permissions?.[pk]}
                                  disabled={busy || bulkBusy}
                                  aria-label={`${getColName(pk)} — ${role.name}`}
                                  onChange={() => handleRoleToggle(role, pk)}
                                />
                                <i
                                  className={`fas ${role.permissions?.[pk] ? "fa-check-circle" : "fa-circle"}`}
                                  aria-hidden="true"
                                />
                                <span>{getColName(pk)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "users" && (
        <div
          className="mp-table-card"
          role="tabpanel"
          id="mp-panel-users"
          aria-labelledby="mp-tab-users"
        >
          <header>
            <h2>{t("managePermissions.tabUsers")}</h2>
            <span className="mp-role-badge users">
              {t("managePermissions.shownBadge").replace("{count}", String(filteredUsers.length))}
            </span>
          </header>
          <div className="table-responsive">
            <table className="table mp-table align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">{t("managePermissions.employee")}</th>
                  <th scope="col">{t("managePermissions.currentRole")}</th>
                  <th scope="col">{t("managePermissions.overrides")}</th>
                  <th scope="col">{t("managePermissions.assignRole")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 && (
                  <tr className="mp-empty-row">
                    <td colSpan={4}>
                      {t("managePermissions.noUsers")}{" "}
                      {userSearch && (
                        <button type="button" onClick={() => setUserSearch("")}>
                          {t("managePermissions.clearSearch")}
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {filteredUsers.map((user) => {
                  const oc = Object.values(
                    activePermissions[user.id] || {},
                  ).filter(Boolean).length;
                  return (
                    <tr key={user.id}>
                      <th className="mp-user-col" scope="row">
                        <strong>{user.full_name}</strong>
                        <small>{user.employee_id}</small>
                      </th>
                      <td>
                        <span className="mp-role-badge enabled">
                          {roleNameMap.get(user.role_id) ||
                            t("managePermissions.noRole")}
                        </span>
                      </td>
                      <td>
                        {oc > 0 ? (
                          <span className="mp-role-badge warn">{oc}</span>
                        ) : (
                          <span className="mp-muted-text">{t("managePermissions.noneText")}</span>
                        )}
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <select
                            className="mp-role-select"
                            value={user.role_id || ""}
                            disabled={!!assigningIds[user.id]}
                            aria-label={`${t("managePermissions.assignRole")} — ${user.full_name}`}
                            onChange={(e) =>
                              handleAssignRole(user.id, e.target.value)
                            }
                          >
                            <option value="">{t("managePermissions.selectRole")}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                          {assigningIds[user.id] && (
                            <span className="mp-muted-text" role="status">
                              <i className="fas fa-spinner fa-spin" aria-hidden="true" />{" "}
                              {t("managePermissions.assigning")}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "overrides" && (
        <div
          className="mp-table-card"
          role="tabpanel"
          id="mp-panel-overrides"
          aria-labelledby="mp-tab-overrides"
        >
          <header>
            <h2>{t("managePermissions.tabOverrides")}</h2>
            <div className="d-flex gap-2 flex-wrap align-items-center">
              <div className="mp-search mp-col-search">
                <i className="fas fa-search" aria-hidden="true" />
                <input
                  type="text"
                  aria-label={t("managePermissions.columnSearch")}
                  placeholder={t("managePermissions.columnSearch")}
                  value={overrideColSearch}
                  onChange={(e) => setOverrideColSearch(e.target.value)}
                />
                {overrideColSearch && (
                  <button
                    className="mp-search-clear"
                    aria-label={t("managePermissions.clearSearch")}
                    onClick={() => setOverrideColSearch("")}
                    type="button"
                  >
                    <i className="fas fa-times" aria-hidden="true" />
                  </button>
                )}
              </div>
              <select
                className="mp-role-select mp-override-filter"
                aria-label={t("managePermissions.permissionGroup")}
                value={overrideGroupFilter || "all"}
                onChange={(e) => setOverrideGroupFilter(e.target.value)}
              >
                {overrideGroupOptions.map((g) => (
                  <option key={g} value={g}>
                    {g === "all"
                      ? t("managePermissions.allWithCount").replace("{count}", String(columns.length))
                      : groupTitle(g)}
                  </option>
                ))}
              </select>
              <label
                className="d-flex align-items-center gap-2 small mb-0"
                style={{ cursor: "pointer" }}
                title={t("managePermissions.onlyOverridesHint")}
              >
                <input
                  type="checkbox"
                  checked={showOnlyOverrides}
                  onChange={(e) => setShowOnlyOverrides(e.target.checked)}
                />
                <span>{t("managePermissions.showOnlyOverridden")}</span>
              </label>
              <span
                className="mp-role-badge users"
                aria-label={t("managePermissions.shownBadge").replace("{count}", String(filteredOverrideUsers.length))}
                title={t("managePermissions.shownBadge").replace("{count}", String(filteredOverrideUsers.length))}
              >
                {filteredOverrideUsers.length}/{users.length}
              </span>
            </div>
          </header>
          <div
            className="mp-override-hint"
            role="group"
            aria-label={t("managePermissions.legendLabel")}
          >
            <span className="mp-legend-item">
              <i className="fas fa-lock is-brand" aria-hidden="true" />
              {t("managePermissions.enabledByRole")}
            </span>
            <span className="mp-legend-item">
              <i className="fas fa-toggle-on is-success" aria-hidden="true" />
              {t("managePermissions.userOverride")}
            </span>
            <span className="mp-legend-item">
              <i className="fas fa-toggle-off is-muted" aria-hidden="true" />
              {t("managePermissions.noAccess")}
            </span>
            <span className="mp-legend-item mp-scroll-hint">
              <i className="fas fa-arrows-left-right" aria-hidden="true" />
              {t("managePermissions.scrollHint")}
            </span>
          </div>
          <div className="table-responsive mp-override-scroll">
            <table className="table mp-table mp-override-table align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col" className="mp-sticky-col" rowSpan={2}>
                    {t("managePermissions.employee")}
                  </th>
                  {overrideHeaderGroups.map(({ group, cols }) => (
                    <th
                      key={group}
                      scope="colgroup"
                      colSpan={cols.length}
                      className="mp-group-header-cell"
                    >
                      <i
                        className={`fas ${GROUP_ICONS[group] || "fa-shield-halved"}`}
                        aria-hidden="true"
                      />{" "}
                      {groupTitle(group)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {overrideColumns.map((col) => (
                    <th
                      key={col.permission_column}
                      scope="col"
                      className="mp-col-header"
                      title={getColName(col.permission_column)}
                      aria-label={getColName(col.permission_column)}
                    >
                      {getColName(col.permission_column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredOverrideUsers.length === 0 && (
                  <tr className="mp-empty-row">
                    <td colSpan={overrideColumns.length + 1}>
                      {t("managePermissions.noUsers")}{" "}
                      {(overrideSearch || showOnlyOverrides) && (
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideSearch("");
                            setShowOnlyOverrides(false);
                          }}
                        >
                          {t("managePermissions.clearSearch")}
                        </button>
                      )}
                    </td>
                  </tr>
                )}
                {filteredOverrideUsers.map((user) => {
                    const userRole = roles.find((r) => r.id === user.role_id);
                    const uov = activePermissions[user.id] || {};
                    const uoc = Object.values(uov).filter(Boolean).length;
                    const clearing = !!clearingIds[user.id];
                    return (
                      <tr key={user.id}>
                        <th className="mp-user-col mp-sticky-col" scope="row">
                          <strong>{user.full_name}</strong>
                          <small>{user.employee_id}</small>
                          <span>{userRole?.name || t("managePermissions.staff")}</span>
                          <button
                            className="mp-clear-btn"
                            onClick={() => handleClearOverrides(user.id)}
                            disabled={uoc === 0 || clearing}
                            type="button"
                          >
                            {clearing
                              ? t("managePermissions.clearing")
                              : uoc > 0
                                ? t("managePermissions.clearOverrides").replace("{count}", String(uoc))
                                : t("managePermissions.noOverrides")}
                          </button>
                        </th>
                        {overrideColumns.map((col) => {
                          const roleHas =
                            !!userRole?.permissions?.[col.permission_column];
                          const userHas = !!uov[col.permission_column];
                          const colLabel = getColName(col.permission_column);
                          const busy = !!toggling[`u:${user.id}:${col.permission_column}`];
                          return (
                            <td
                              key={col.permission_column}
                              className="text-center"
                            >
                              <label
                                className={`mp-switch${roleHas ? " locked" : ""}${busy ? " busy" : ""}`}
                                title={
                                  roleHas
                                    ? t("managePermissions.roleLocked")
                                    : userHas
                                      ? t("managePermissions.removeOverride")
                                      : t("managePermissions.grantOverride")
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={roleHas || userHas}
                                  disabled={roleHas || busy}
                                  aria-label={`${colLabel} — ${
                                    roleHas
                                      ? t("managePermissions.roleLocked")
                                      : userHas
                                        ? t("managePermissions.removeOverride")
                                        : t("managePermissions.grantOverride")
                                  }`}
                                  onChange={() =>
                                    handleOverrideToggle(
                                      user.id,
                                      col.permission_column,
                                      userHas,
                                    )
                                  }
                                />
                                <span className="mp-slider" aria-hidden="true" />
                                {roleHas && (
                                  <span className="mp-lock-tag" aria-hidden="true">
                                    <i className="fas fa-lock" />
                                  </span>
                                )}
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showRoleModal && (
        <div
          className="mp-modal-overlay"
          onClick={() => {
            // Don't throw away a typed name on accidental backdrop click.
            if (newRoleName.trim()) return;
            setModalError("");
            setShowRoleModal(false);
            newRoleBtnRef.current?.focus();
          }}
        >
          <div
            ref={roleModalBoxRef}
            className="mp-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mp-role-modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Focus trap: keep Tab cycling inside the dialog.
              if (e.key !== "Tab" || !roleModalBoxRef.current) return;
              const items = Array.from(
                roleModalBoxRef.current.querySelectorAll(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
                ),
              ).filter((el) => el.offsetParent !== null);
              if (!items.length) return;
              const first = items[0];
              const last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="mp-modal-header">
              <h3 id="mp-role-modal-title">
                <i className="fas fa-layer-group" aria-hidden="true" /> {t("managePermissions.addRole")}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setModalError("");
                  setShowRoleModal(false);
                  newRoleBtnRef.current?.focus();
                }}
                aria-label={t("managePermissions.closeAction")}
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>
            <form
              onSubmit={handleCreateRole}
              className="mp-modal-body"
              aria-describedby={modalError ? "mp-modal-error" : undefined}
            >
              <label className="mp-form-label" htmlFor="mp-new-role-name">
                {t("managePermissions.roleName")}
              </label>
              <input
                id="mp-new-role-name"
                ref={roleModalInputRef}
                className="mp-form-input"
                type="text"
                placeholder={t("managePermissions.roleNamePlaceholder")}
                value={newRoleName}
                onChange={(e) => {
                  setNewRoleName(e.target.value);
                  if (modalError) setModalError("");
                }}
                required
              />
              {modalError && (
                <p id="mp-modal-error" className="mp-modal-error" role="alert">
                  <i className="fas fa-triangle-exclamation" aria-hidden="true" />{" "}
                  {modalError}
                </p>
              )}
              <p className="small text-muted mt-2">
                {t("managePermissions.assignAfter")}
              </p>
              <div className="mp-modal-footer">
                <button
                  type="button"
                  className="mp-btn-secondary"
                  onClick={() => {
                    setModalError("");
                    setShowRoleModal(false);
                    newRoleBtnRef.current?.focus();
                  }}
                >
                  {t("managePermissions.cancelAction")}
                </button>
                <button
                  type="submit"
                  className="mp-btn-primary"
                  disabled={savingRole || !newRoleName.trim()}
                >
                  {savingRole ? t("managePermissions.creating") : t("managePermissions.saveRole")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagePermissions;
