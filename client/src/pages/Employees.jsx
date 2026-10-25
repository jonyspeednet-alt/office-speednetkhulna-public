import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Swal from 'sweetalert2';
import ImageWithFallback from '../components/ImageWithFallback';
import EmployeeQRModal from '../components/EmployeeQRModal';
import { getEmployees, getDepartments, getNextEmployeeId, addEmployee, toggleEmployeeStatus } from '../services/employeeService';
import { getRoles } from '../services/roleService';
import { getSidebarMenus } from '../services/sidebarService';
import apiClient from '../config/axiosConfig';
import { BRANCHES, normalizeOfficeName } from '../constants/branches';
import { t } from '../i18n';
import '../styles/AdminDashboard.css';
import '../styles/Employees.css';

// Encode each '/'-separated segment (spaces etc.) while preserving slashes + query/hash.
const encodeUploadSegments = (p) => String(p).split('/').map((seg) => (seg ? encodeURIComponent(seg) : seg)).join('/');
const encodeUploadPath = (p) => {
  const m = String(p).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  if (!m) return String(p);
  return `${encodeUploadSegments(m[1])}${m[2] || ''}${m[3] || ''}`;
};

const resolveUploadUrl = (pic) => {
  if (!pic || pic === 'default.png') return null;
  if (/^https?:\/\//i.test(pic)) return pic;
  if (String(pic).startsWith('/api/')) return pic;
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const path = String(pic).startsWith('/') ? encodeUploadPath(pic) : `/uploads/${encodeUploadSegments(pic)}`;
  return `${base}${path}`;
};

const toCsvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Non-empty + equal check for the two password fields (helper keeps JSX clean).
const passwordsMatch = (a, b) => {
  const x = String(a || '');
  return x !== '' && x === String(b || '');
};

const Employees = () => {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const FILTER_KEY = 'employees-filters';
  const SCROLL_KEY = 'employees-scroll';
  const HIGHLIGHT_KEY = 'employees-highlight';
  const getInitialFilters = () => {
    try {
      const saved = sessionStorage.getItem(FILTER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          search: typeof parsed.search === 'string' ? parsed.search : '',
          dept: typeof parsed.dept === 'string' ? parsed.dept : '',
          status: typeof parsed.status === 'string' ? parsed.status : 'all',
        };
      }
    } catch { /* ignore */ }
    return { search: '', dept: '', status: 'all' };
  };
  const [filters, setFilters] = useState(getInitialFilters);
  const [highlightId, setHighlightId] = useState(() => {
    try {
      return location.state?.highlightId
        ? String(location.state.highlightId)
        : (sessionStorage.getItem(HIGHLIGHT_KEY) || null);
    } catch { return location.state?.highlightId ? String(location.state.highlightId) : null; }
  });
  const restoredRef = useRef(false);
  // Guards out-of-order list responses: only the latest request may publish data.
  const listSeqRef = useRef(0);
  // Last-known totalPages (updated by the clamp effect); the outgoing list
  // request is clamped to it so we never fire with a page beyond range.
  const knownTotalPagesRef = useRef(1);
  // Add-button trigger for focus return when the modal closes.
  const addBtnRef = useRef(null);
  const addModalWasOpenRef = useRef(false);
  // Permissions come from server-provided data only (/api/auth/me + /api/sidebar).
  // Never gate UI on a raw role string or raw localStorage values.
  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await apiClient.get('/api/auth/me')).data,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const { data: sidebarData } = useQuery({
    queryKey: ['sidebarMenus'],
    queryFn: getSidebarMenus,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const serverUser = meData?.user || {};
  const serverPerms = serverUser.permissions || {};
  const hasServerPerm = (key) => Boolean(
    serverUser.all_access || serverPerms.all_access ||
    serverPerms[key] || serverUser[key]
  );
  const allAccess = hasServerPerm('all_access') || hasServerPerm('system.all_access');
  const canAssignAdmin = allAccess;
  // Dynamic role list (roles table) — so custom roles created in
  // Manage Permissions (e.g. "Noc Executive") also appear in Add/Edit forms.
  // Legacy free-text roles (Manager/HR) keep working even with role_id=NULL.
  const [availableRoles, setAvailableRoles] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getRoles();
        if (!cancelled && Array.isArray(list)) setAvailableRoles(list);
      } catch { /* non-blocking: fallback options below */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const roleOptions = useMemo(() => {
    const isPrivileged = (n) => ['admin', 'super admin', 'superadmin'].includes(String(n || '').trim().toLowerCase());
    const names = availableRoles.length > 0
      ? availableRoles.map((r) => r.name).filter(Boolean)
      : ['Staff', 'HR', 'Manager'];
    // Ensure legacy options exist even if roles table lacks them.
    ['Staff', 'HR', 'Manager'].forEach((legacy) => {
      if (!names.some((n) => String(n).toLowerCase() === legacy.toLowerCase())) names.push(legacy);
    });
    if (!names.some((n) => String(n).toLowerCase() === 'admin') && canAssignAdmin) names.push('Admin');
    return names.filter((n) => !isPrivileged(n) || canAssignAdmin);
  }, [availableRoles, canAssignAdmin]);
  const roleLabel = (name) => {
    const k = String(name || '').trim().toLowerCase();
    if (k === 'staff') return t('employees.staff');
    if (k === 'hr') return t('employees.roleHr');
    if (k === 'admin') return t('employees.roleAdmin');
    if (k === 'manager') return t('employees.roleManager');
    return name;
  };
  const canManageUsers = hasServerPerm('users.manage') || hasServerPerm('p_manage_users')
    || hasServerPerm('employees.create_edit') || hasServerPerm('p_employee_create_edit');
  // Add + Active/Inactive toggle are users.manage-only on the server
  // (addEmployee/toggleEmployeeStatus both 403 otherwise) — the button
  // must not show for employees.create_edit-only holders.
  const canFullManageUsers = hasServerPerm('users.manage') || hasServerPerm('p_manage_users') || allAccess;
  const canEditAnyProfile = hasServerPerm('users.edit.any') || hasServerPerm('p_edit_any_profile') || canManageUsers;
  const sidebarLinks = useMemo(() => {
    try { return Object.values(sidebarData?.menuData || {}).flat().map((m) => String(m?.link || '')); }
    catch { return []; }
  }, [sidebarData]);
  const canViewEmployees = sidebarLinks.length === 0 || sidebarLinks.some((l) => l.includes('/employees'));
  // Row identity only (not a permission): server id first, cached id as fallback until /me resolves.
  const loggedInUserId = Number(serverUser?.id || (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}')?.id || 0; }
    catch { return 0; }
  })());

  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(filters.search), 400);
    return () => clearTimeout(handler);
  }, [filters.search]);

  // Persist filters so back from edit/profile keeps search/dept/status
  useEffect(() => {
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [filters]);

  // Save scroll position continuously + on unmount (edit/profile থেকে back এলে restore হবে)
  useEffect(() => {
    let ticking = false;
    const save = () => {
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY || 0)); } catch { /* ignore */ }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { save(); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      save();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const saveRowNav = (userId) => () => {
    try {
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY || 0));
      sessionStorage.setItem(HIGHLIGHT_KEY, String(userId));
    } catch { /* ignore */ }
  };

  const [showModal, setShowModal] = useState(false);
  const [qrEmployee, setQrEmployee] = useState(null);
  const getBlankFormData = () => ({
    employee_id: '',
    role: 'Staff',
    blood_group: '',
    emergency_phone: '',
    present_address: '',
    permanent_address: '',
    nid_number: '',
    password: '',
    confirm_password: '',
    full_name: '',
    father_name: '',
    email: '',
    phone: '',
    department: '',
    designation: '',
    status: 'Active',
    joining_date: new Date().toISOString().split('T')[0],
    reporting_manager: '',
    work_location: '',
    employment_type: '',
  });
  const [formData, setFormData] = useState(getBlankFormData());
  const [errors, setErrors] = useState({});
  const blankSignature = useMemo(() => JSON.stringify(getBlankFormData()), []);
  const dirty = useMemo(() => {
    try {
      const cur = { ...formData };
      const blank = JSON.parse(blankSignature);
      const baseDirty = Object.keys(blank).some((k) => String(cur[k] ?? '') !== String(blank[k] ?? ''));
      if (baseDirty) return true;
      return Object.keys(cur).some((k) => !(k in blank) && cur[k] !== '' && cur[k] != null);
    } catch { return false; }
  }, [formData, blankSignature]);
  const filtersActive = Boolean(filters.search || filters.dept || filters.status !== 'all');
  const isSearching = filters.search !== debouncedSearch;
  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.search) chips.push({ key: 'search', label: filters.search });
    if (filters.dept) chips.push({ key: 'dept', label: filters.dept });
    if (filters.status !== 'all') chips.push({ key: 'status', label: filters.status });
    return chips;
  }, [filters]);

  const PAGE_SIZES = [20, 50, 100];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Reset to first page whenever the server-side filter changes
  useEffect(() => { setPage(1); }, [debouncedSearch, filters.dept, filters.status, pageSize]);

  const { data: departments = [], isError: deptIsError, refetch: refetchDepts } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
    staleTime: 1000 * 60 * 10,
    retry: 1,
  });
  const deptList = Array.isArray(departments) ? departments : [];

  // Clamp the outgoing request page the same way safePage does (uses last-known totalPages).
  const requestPage = Math.min(page, Math.max(1, knownTotalPagesRef.current || 1));
  const listKey = ['employees', debouncedSearch, filters.dept, filters.status, requestPage, pageSize];
  const {
    data: employeesPayload,
    isLoading: loading,
    isError,
    error: employeesError,
    refetch: refetchEmployees,
  } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const seq = ++listSeqRef.current;
      const res = await getEmployees({
        search: debouncedSearch,
        dept: filters.dept,
        status: filters.status,
        page: requestPage,
        limit: pageSize,
      });
      // An older response must not overwrite a newer one: fall back to the
      // cached data for this key (no visible change) instead of publishing stale rows.
      if (seq !== listSeqRef.current) return queryClient.getQueryData(listKey) ?? res;
      return res;
    },
    placeholderData: (prev) => prev,
  });

  // Normalize: paginated {rows,total,page,limit} or legacy array
  const normalized = useMemo(() => {
    if (Array.isArray(employeesPayload)) return { rows: employeesPayload, total: employeesPayload.length, paginated: false };
    if (employeesPayload && Array.isArray(employeesPayload.rows)) {
      return {
        rows: employeesPayload.rows,
        total: Number(employeesPayload.total ?? employeesPayload.rows.length),
        paginated: true,
      };
    }
    return { rows: [], total: 0, paginated: false };
  }, [employeesPayload]);

  const totalCount = normalized.total;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  // Clamp page if the result set shrank below the current page
  useEffect(() => {
    knownTotalPagesRef.current = totalPages;
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);
  const showCapWarning = normalized.paginated && totalCount > normalized.rows.length;

  // Global counts for metric buttons (unpaginated, same search/dept filter)
  const { data: statsPayload, isLoading: statsLoading } = useQuery({
    queryKey: ['employees-stats', debouncedSearch, filters.dept],
    queryFn: () => getEmployees({ search: debouncedSearch, dept: filters.dept }),
    staleTime: 1000 * 60 * 2,
    retry: false,
  });
  const statsRows = useMemo(() => {
    if (Array.isArray(statsPayload)) return statsPayload;
    if (statsPayload && Array.isArray(statsPayload.rows)) return statsPayload.rows;
    return normalized.rows;
  }, [statsPayload, normalized.rows]);

  const employees = useMemo(() => {
    const statusMatches = (employee) => (
      filters.status === 'all' ||
      String(employee.status || 'Active').trim().toLowerCase() === filters.status
    );
    const completeRows = statsRows.filter(statusMatches);
    const hasCompleteResultSet = !statsLoading && completeRows.length === totalCount;
    // Sort the complete unpaginated result before slicing so old API ordering
    // cannot place inactive employees above active employees on another page.
    const rows = hasCompleteResultSet
      ? completeRows
      : (normalized.paginated ? normalized.rows : normalized.rows.filter(statusMatches));
    const orderedRows = [...rows].sort((a, b) => {
      const aInactive = String(a.status || 'Active').trim().toLowerCase() === 'active' ? 0 : 1;
      const bInactive = String(b.status || 'Active').trim().toLowerCase() === 'active' ? 0 : 1;
      return aInactive - bInactive;
    });

    if (!hasCompleteResultSet) return orderedRows;
    const start = (safePage - 1) * pageSize;
    return orderedRows.slice(start, start + pageSize);
  }, [filters.status, normalized, pageSize, safePage, statsLoading, statsRows, totalCount]);

  const fileInputRef = useRef(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [nextIdLoading, setNextIdLoading] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const addMutation = useMutation({
    mutationFn: addEmployee,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees-stats'] });
      const createdName = formData.full_name || '';
      const createdId = data?.employee_id || formData.employee_id || '';
      const createdPass = formData.password || '';
      setShowModal(false);
      setFormData(getBlankFormData());
      setErrors({});
      if (photoPreview) { try { URL.revokeObjectURL(photoPreview); } catch { /* ignore */ } }
      setPhotoPreview(null);
      try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* ignore */ }
      Swal.fire({
        icon: 'success',
        title: t('employees.createdTitle'),
        html: `<p>${t('employees.createdText', { name: createdName, employee_id: createdId })}</p>`
          + (createdId ? `<p style="margin:.4rem 0 0"><strong>ID:</strong> <span id="emp-cred-id">${createdId}</span> <button type="button" data-copy="${createdId}" class="emp-micro-btn">${t('employees.copyLabel')}</button></p>` : '')
          + (createdPass ? `<p style="margin:.4rem 0 0"><strong>${t('employees.password')}:</strong> <span id="emp-cred-pass">${createdPass}</span> <button type="button" data-copy="${createdPass}" class="emp-micro-btn">${t('employees.copyLabel')}</button></p>` : '')
          + `<p style="margin:.6rem 0 0;color:#6b7280;font-size:.82rem">${t('employees.credentialsKeepNote')}</p>`,
        customClass: { popup: 'emp-swal' },
        buttonsStyling: false,
        didOpen: (el) => {
          el.querySelectorAll('[data-copy]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const val = btn.getAttribute('data-copy') || '';
              try { await navigator.clipboard.writeText(String(val)); }
              catch {
                try {
                  const ta = document.createElement('textarea');
                  ta.value = String(val);
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand('copy');
                  document.body.removeChild(ta);
                } catch { /* ignore */ }
              }
              const orig = btn.textContent;
              btn.textContent = t('employees.copiedLabel');
              setTimeout(() => { btn.textContent = orig; }, 1500);
            });
          });
        },
      });
    },
    onError: (error) => {
      const resp = error.response?.data || {};
      if (resp.field) {
        setErrors({ [resp.field]: resp.message || t('employees.addFailed') });
        setTimeout(() => {
          try { document.querySelector(`[name="${resp.field}"]`)?.focus(); } catch { /* ignore */ }
        }, 60);
      }
      const msg = resp.field && resp.message
        ? `${resp.field}: ${resp.message}`
        : (resp.message || t('employees.addFailed'));
      Swal.fire({ title: t('employees.errorTitle'), text: msg, icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
    }
  });

  const toggleStatusMutation = useMutation({
    mutationFn: toggleEmployeeStatus,
    onMutate: (id) => setTogglingId(Number(id)),
    onSettled: () => setTogglingId(null),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees-stats'] });
      const nowActive = String(data.new_status || '').toLowerCase() === 'active';
      Swal.fire({
        icon: nowActive ? 'success' : 'warning',
        title: nowActive ? t('employees.activateTitle') : t('employees.deactivateTitle'),
        text: nowActive
          ? t('employees.activateText', { name: data.name || '' })
          : t('employees.deactivateText', { name: data.name || '' }),
        timer: 2500,
        showConfirmButton: false,
        customClass: { popup: 'emp-swal' },
        buttonsStyling: false,
      });
    },
    onError: (error) => {
      Swal.fire({ title: t('employees.errorTitle'), text: error.response?.data?.message || t('employees.toggleFailed'), icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
    }
  });

  const handleToggleStatus = (emp) => {
    const isActive = String(emp.status || 'Active').toLowerCase() === 'active';
    Swal.fire({
      title: isActive
        ? t('employees.confirmDeactivateTitle', { name: emp.full_name || '' })
        : t('employees.confirmActivateTitle', { name: emp.full_name || '' }),
      html: `<p style="color:#6b7280;margin:0">${isActive ? t('employees.confirmDeactivateHint') : t('employees.confirmActivateHint')}</p>`,
      icon: isActive ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonColor: isActive ? '#ef4444' : '#10b981',
      cancelButtonColor: '#6b7280',
      confirmButtonText: isActive ? t('employees.confirmDeactivateBtn') : t('employees.confirmActivateBtn'),
      cancelButtonText: t('employees.cancel'),
      customClass: { popup: 'emp-swal' },
      buttonsStyling: false,
    }).then((result) => {
      if (result.isConfirmed) toggleStatusMutation.mutate(emp.id);
    });
  };

  const copyText = async (key, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = String(value);
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };

  const handleExportCsv = async () => {
    try {
      const all = await getEmployees({
        search: debouncedSearch,
        dept: filters.dept,
        status: filters.status,
        page: 1,
        limit: Math.max(totalCount || employees.length, 1),
      });
      const rows = Array.isArray(all) ? all : (all?.rows || employees);
      const header = ['name', 'id', 'phone', 'email', 'dept', 'designation', 'status'];
      const lines = [header.join(',')];
      rows.forEach((u) => {
        lines.push([
          toCsvCell(u.full_name),
          toCsvCell(u.employee_id),
          toCsvCell(u.phone),
          toCsvCell(u.email),
          toCsvCell(u.department),
          toCsvCell(u.designation),
          toCsvCell(u.status),
        ].join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employees.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (Array.isArray(rows) && Number(totalCount) > rows.length) {
        Swal.fire({
          icon: 'warning',
          title: t('employees.exportCsv'),
          text: `Partial export: ${rows.length} of ${totalCount} rows exported. The server caps export size — refine the filters and export again for the rest.`,
          customClass: { popup: 'emp-swal' },
          buttonsStyling: false,
        });
      }
    } catch (err) {
      Swal.fire({ title: t('employees.errorTitle'), text: err?.response?.data?.message || t('employees.loadFailed'), icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
    }
  };

  const stats = useMemo(() => {
    const active = statsRows.filter((emp) => String(emp.status || 'Active').toLowerCase() === 'active').length;
    // The stats query omits the status filter, so statsRows is the unfiltered set.
    // Derive total from that same source so header total/active/inactive stay
    // consistent when a status filter is applied (totalCount is status-filtered).
    const statsTotal = Array.isArray(statsPayload)
      ? statsPayload.length
      : Number(statsPayload?.total ?? NaN);
    // No status filter: the list total is already unfiltered and exact — keep it.
    // Status filter applied: totalCount is status-filtered, so use the unfiltered
    // stats source for total instead.
    const total = filters.status === 'all'
      ? (totalCount || statsRows.length)
      : (Number.isFinite(statsTotal) && statsTotal > 0 ? statsTotal : (totalCount || statsRows.length));
    return { total, active, inactive: Math.max(total - active, 0) };
  }, [statsRows, statsPayload, totalCount, filters.status]);

  const handleFilterChange = (e) => setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  const handleReset = () => {
    setFilters({ search: '', dept: '', status: 'all' });
    setPage(1);
    try {
      sessionStorage.removeItem(FILTER_KEY);
      sessionStorage.removeItem(SCROLL_KEY);
    } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Restore scroll after data loads; highlight row that was just edited
  useEffect(() => {
    if (loading || restoredRef.current) return;
    restoredRef.current = true;
    let y = 0;
    try { y = parseInt(sessionStorage.getItem(SCROLL_KEY) || '0', 10) || 0; } catch { y = 0; }
    const doRestore = () => {
      if (highlightId) {
        const el = document.getElementById(`emp-row-${highlightId}`);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          // highlight few seconds then clear
          const t = setTimeout(() => {
            setHighlightId(null);
            try { sessionStorage.removeItem(HIGHLIGHT_KEY); } catch { /* ignore */ }
            // location.state clear so refresh doesn't re-highlight
            try { navigate(location.pathname, { replace: true }); } catch { /* ignore */ }
          }, 3500);
          return () => clearTimeout(t);
        }
        // Row is on another page/filter: clear immediately so the highlight
        // state never persists into later visits.
        setHighlightId(null);
        try { sessionStorage.removeItem(HIGHLIGHT_KEY); } catch { /* ignore */ }
        try { navigate(location.pathname, { replace: true }); } catch { /* ignore */ }
      }
      if (y > 0) window.scrollTo(0, y);
    };
    // wait a tick for table render
    const raf = requestAnimationFrame(() => setTimeout(doRestore, 60));
    return () => cancelAnimationFrame(raf);
  }, [loading, employees.length, highlightId, location.pathname, navigate]);

  // Return focus to the Add button when the modal closes (a11y); guarded no-op on first mount.
  useEffect(() => {
    if (showModal) { addModalWasOpenRef.current = true; return; }
    if (addModalWasOpenRef.current) {
      addModalWasOpenRef.current = false;
      try { addBtnRef.current?.focus(); } catch { /* ignore */ }
    }
  }, [showModal]);

  const openAddModal = async () => {
    if (!canFullManageUsers) { Swal.fire({ title: t('employees.unauthorizedTitle'), text: t('employees.unauthorizedAdd'), icon: 'warning', customClass: { popup: 'emp-swal' }, buttonsStyling: false }); return; }
    setFormData(getBlankFormData());
    setErrors({});
    if (photoPreview) { try { URL.revokeObjectURL(photoPreview); } catch { /* ignore */ } }
    setPhotoPreview(null);
    try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* ignore */ }
    setShowModal(true);
    setNextIdLoading(true);
    try {
      const nextId = await getNextEmployeeId();
      if (nextId) setFormData((prev) => ({ ...prev, employee_id: prev.employee_id || nextId }));
    } catch { /* keep blank for server auto-generate */ }
    finally { setNextIdLoading(false); }
  };

  const handleModalHide = () => {
    if (dirty) {
      Swal.fire({
        title: t('employees.unsavedTitle'),
        text: t('employees.unsavedText'),
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: t('employees.discardChanges'),
        cancelButtonText: t('employees.keepEditing'),
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        customClass: { popup: 'emp-swal' },
        buttonsStyling: false,
      }).then((r) => { if (r.isConfirmed) { setShowModal(false); setErrors({}); } });
      return;
    }
    setShowModal(false);
    setErrors({});
  };

  const removePhoto = () => {
    if (photoPreview) { try { URL.revokeObjectURL(photoPreview); } catch { /* ignore */ } }
    setPhotoPreview(null);
    setFormData((prev) => {
      const next = { ...prev };
      delete next.profile_pic;
      return next;
    });
    try { if (fileInputRef.current) fileInputRef.current.value = ''; } catch { /* ignore */ }
  };

  const openPhotoDialog = () => {
    if (!photoPreview) return;
    Swal.fire({
      imageUrl: photoPreview,
      imageAlt: t('employees.photoPreview'),
      showConfirmButton: false,
      showCloseButton: true,
      customClass: { popup: 'emp-swal' },
      buttonsStyling: false,
    });
  };

  const validatePhotoFile = (file) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) return t('employees.photoBadType');
    if (file.size > 5 * 1024 * 1024) return t('employees.photoTooLarge');
    return null;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validatePhotoFile(file);
    if (err) {
      Swal.fire({ title: t('employees.errorTitle'), text: err, icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
      try { e.target.value = ''; } catch { /* ignore */ }
      return;
    }
    setFormData((prev) => ({ ...prev, [e.target.name]: file }));
    if (e.target.name === 'profile_pic') {
      if (photoPreview) { try { URL.revokeObjectURL(photoPreview); } catch { /* ignore */ } }
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((formData.password || '') !== (formData.confirm_password || '')) {
      setErrors((prev) => ({ ...prev, confirm_password: t('employees.passwordMismatch') }));
      Swal.fire({ title: t('employees.errorTitle'), text: t('employees.passwordMismatch'), icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
      try { document.querySelector('[name="confirm_password"]')?.focus(); } catch { /* ignore */ }
      return;
    }
    const file = formData.profile_pic;
    if (file instanceof File) {
      const err = validatePhotoFile(file);
      if (err) {
        Swal.fire({ title: t('employees.errorTitle'), text: err, icon: 'error', customClass: { popup: 'emp-swal' }, buttonsStyling: false });
        return;
      }
    }
    const payload = new FormData();
    Object.keys(formData).forEach((key) => {
      if (key === 'confirm_password') return;
      if (formData[key] !== undefined && formData[key] !== null && formData[key] !== '') payload.append(key, formData[key]);
    });
    addMutation.mutate(payload);
  };

  return (
    <>
      <section className="emp-hero">
        <div>
          <span className="emp-chip"><i className="fas fa-users-cog"></i>{t('employees.heroTag')}</span>
          <h1>{t('employees.heroTitle')}</h1>
          <p>{t('employees.heroSubtitle')}</p>
        </div>
        <div className="emp-hero-side">
          <div className="emp-metrics" role="group" aria-label={t('employees.listTitle')}>
            <button type="button" className="emp-metric-btn" onClick={() => setFilters(f => ({ ...f, status: 'all' }))} aria-pressed={filters.status === 'all'}>
              <span>{t('employees.total')}</span>
              <strong>{(loading || statsLoading) ? '···' : stats.total}</strong>
            </button>
            <button type="button" className="emp-metric-btn" onClick={() => setFilters(f => ({ ...f, status: 'active' }))} aria-pressed={filters.status === 'active'}>
              <span><span className="emp-dot green" aria-hidden="true" />{t('employees.active')}</span>
              <strong style={{ color: '#10b981' }}>{(loading || statsLoading) ? '···' : stats.active}</strong>
            </button>
            <button type="button" className="emp-metric-btn" onClick={() => setFilters(f => ({ ...f, status: 'inactive' }))} aria-pressed={filters.status === 'inactive'}>
              <span><span className="emp-dot red" aria-hidden="true" />{t('employees.inactive')}</span>
              <strong style={{ color: '#ef4444' }}>{(loading || statsLoading) ? '···' : stats.inactive}</strong>
            </button>
          </div>
          {canFullManageUsers && (
            <button ref={addBtnRef} className="emp-add-btn" onClick={openAddModal}>
              <i className="fas fa-user-plus"></i>{t('employees.addEmployee')}
            </button>
          )}
        </div>
      </section>

      <section className="emp-filter-card">
        <form onSubmit={(e) => e.preventDefault()} className="emp-filter-form">
          <div className="emp-field">
            <label htmlFor="emp-search">{t('employees.searchLabel')}</label>
            <div className={`emp-input with-icon${isSearching ? ' searching' : ''}`}>
              <i className={`fas ${isSearching ? 'fa-spinner fa-spin' : 'fa-search'}`}></i>
              <input id="emp-search" type="text" name="search" placeholder={t('employees.searchPlaceholder')} value={filters.search} onChange={handleFilterChange} autoComplete="off" />
              {filters.search && (<button type="button" className="clear-btn" aria-label={t('employees.reset')} onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}><i className="fas fa-times" aria-hidden="true"></i></button>)}
            </div>
          </div>
          <div className="emp-field">
            <label htmlFor="emp-dept">{t('employees.department')}</label>
            <select id="emp-dept" name="dept" value={filters.dept} onChange={handleFilterChange} aria-label={t('employees.department')}>
              <option value="">{t('employees.allDepartments')}</option>
              {deptList.map((dept) => (<option key={dept.id} value={dept.dept_name}>{dept.dept_name}</option>))}
            </select>
          </div>
          <div className="emp-field">
            <label htmlFor="emp-status">{t('employees.status')}</label>
            <select id="emp-status" name="status" value={filters.status} onChange={handleFilterChange} aria-label={t('employees.status')}>
              <option value="all">{t('employees.statusAll')}</option>
              <option value="active">{t('employees.statusActive')}</option>
              <option value="inactive">{t('employees.statusInactive')}</option>
            </select>
          </div>
          <div className="emp-field">
            <label aria-hidden="true">&nbsp;</label>
            <button type="button" className={`emp-btn secondary${filtersActive ? '' : ' is-disabled'}`} onClick={handleReset}>
              <i className="fas fa-rotate"></i>{t('employees.reset')}
            </button>
          </div>
        </form>
        {filtersActive && (
          <div className="emp-chips" aria-label={t('employees.listTitle')}>
            {activeChips.map((chip) => (
              <span key={chip.key} className="emp-filter-chip">
                {chip.key === 'dept' ? `${t('employees.department')}: ${chip.label}` : chip.label}
                <button
                  type="button"
                  aria-label={`${t('employees.removeFilter')}: ${chip.label}`}
                  onClick={() => {
                    if (chip.key === 'search') setFilters((prev) => ({ ...prev, search: '' }));
                    if (chip.key === 'dept') setFilters((prev) => ({ ...prev, dept: '' }));
                    if (chip.key === 'status') setFilters((prev) => ({ ...prev, status: 'all' }));
                  }}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      {(deptIsError || isError) && (
        <div className="emp-error-panel" role="alert">
          <strong>{deptIsError ? t('employees.departmentsFailed') : t('employees.loadFailed')}</strong>
          {!deptIsError && <span>{employeesError?.response?.data?.message || employeesError?.message || ''}</span>}
          <button type="button" className="emp-btn secondary" onClick={() => { if (deptIsError) refetchDepts(); if (isError) refetchEmployees(); }}>{t('employees.retry')}</button>
        </div>
      )}

      <section className="emp-table-card">
        <header>
          <h2>{t('employees.listTitle')}</h2>
          <div className="emp-table-meta">
            <p role="status">{loading ? t('employees.loadingRecords') : t('employees.showingXofY', { shown: employees.length, total: totalCount })}</p>
            <div className="emp-table-tools">
              <label className="emp-pagesize">
                {t('employees.pageSizeLabel')}
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label={t('employees.pageSizeLabel')}>
                  {PAGE_SIZES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </label>
              <button type="button" className="emp-btn secondary" onClick={handleExportCsv} aria-label={t('employees.exportCsv')}>
                <i className="fas fa-file-csv" aria-hidden="true"></i>{t('employees.exportCsv')}
              </button>
            </div>
          </div>
        </header>
        {showCapWarning && (
          <p className="emp-cap-warning" role="note">{t('employees.capWarning', { shown: employees.length, total: totalCount })}</p>
        )}
        <div className="table-responsive">
          <table className="table align-middle mb-0 emp-table">
            <thead>
              <tr>
                <th scope="col">{t('employees.memberDetails')}</th>
                <th scope="col">{t('employees.contact')}</th>
                <th scope="col">{t('employees.department')}</th>
                <th scope="col">{t('employees.role')}</th>
                <th scope="col">{t('employees.officeLabel')}</th>
                <th scope="col">{t('employees.bloodGroup')}</th>
                <th scope="col">{t('employees.status')}</th>
                <th scope="col">{t('employees.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && [...Array(5)].map((_, i) => (
                <tr key={`sk-${i}`}>
                  {[...Array(8)].map((__, c) => (
                    <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                  ))}
                </tr>
              ))}
              {!loading && employees.length === 0 && (
                <tr><td colSpan="8">
                  <div className="ui-empty">
                    <i className="fas fa-users-slash ui-empty-icon"></i>
                    <span className="ui-empty-title">{t('employees.noEmployees')}</span>
                    <p className="emp-filter-summary">{filtersActive ? t('employees.filterSummary', { summary: activeChips.map((c) => c.label).join(' · ') }) : t('employees.noResultsHint')}</p>
                    <div className="emp-empty-actions">
                      {filtersActive && (
                        <button type="button" className="emp-btn secondary" onClick={handleReset}>
                          <i className="fas fa-rotate"></i>{t('employees.reset')}
                        </button>
                      )}
                      {canFullManageUsers && (
                        <button type="button" className="emp-btn primary" onClick={openAddModal}>
                          <i className="fas fa-user-plus"></i>{t('employees.addEmployee')}
                        </button>
                      )}
                    </div>
                  </div>
                </td></tr>
              )}
              {!loading && !isError && employees.map((user) => {
                const isActive = String(user.status || 'Active').toLowerCase() === 'active';
                const isSelf = Number(user.id) === Number(loggedInUserId);
                const canEditRow = isSelf || canEditAnyProfile;
                const canToggleRow = canFullManageUsers && !isSelf;
                const isToggling = togglingId === Number(user.id);
                const isHighlighted = highlightId && String(user.id) === String(highlightId);
                const gotoWithScroll = saveRowNav(user.id);
                return (
                  <tr
                    key={user.id}
                    id={`emp-row-${user.id}`}
                    className={isActive ? undefined : 'emp-row-inactive'}
                    style={{
                      background: isHighlighted ? '#eef2ff' : undefined,
                      outline: isHighlighted ? '2px solid #6366f1' : undefined,
                      outlineOffset: isHighlighted ? '-2px' : undefined,
                      transition: 'background 0.3s',
                    }}
                  >
                    <td data-label={t('employees.memberDetails')}>
                      <Link to={`/profile/${user.id}`} state={{ from: '/employees' }} onClick={gotoWithScroll} className="text-decoration-none emp-user-cell">
                        <div style={{ position: 'relative', display: 'inline-block' }} title={user.blood_group ? `${t('employees.bloodLabel')}: ${user.blood_group}` : t('employees.bloodUnknown')}>
                          <ImageWithFallback
                            src={resolveUploadUrl(user.profile_pic)}
                            fallbackName={user.full_name} className="emp-avatar" alt={t('employees.profileAlt')}
                            width="44px" height="44px"
                            style={{ filter: isActive ? 'none' : 'grayscale(100%)' }}
                          />
                          <span style={{ position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: '50%', background: isActive ? '#10b981' : '#9ca3af', border: '2px solid white' }} />
                        </div>
                        <div>
                          <strong style={{ color: isActive ? undefined : '#64748b' }}><span className="emp-id-num">{user.full_name}</span></strong>
                          <small>{user.designation || t('employees.positionNa')}</small>
                        </div>
                      </Link>
                    </td>
                    <td data-label={t('employees.contact')}>
                      <div className="emp-contact">
                        <div>
                          <i className="fas fa-phone"></i>
                          {user.phone ? (<a href={`tel:${String(user.phone).replace(/[^\d+]/g, '')}`}>{user.phone}</a>) : t('employees.na')}
                          {user.phone && (
                            <button type="button" className={`emp-mini-btn${copiedKey === `p-${user.id}` ? ' copied' : ''}`} aria-label={`${t('employees.copyLabel')}: ${user.phone}`} title={copiedKey === `p-${user.id}` ? t('employees.copiedLabel') : t('employees.copyLabel')} onClick={() => copyText(`p-${user.id}`, user.phone)}>
                              <i className={`fas fa-${copiedKey === `p-${user.id}` ? 'check' : 'copy'}`} aria-hidden="true"></i>
                            </button>
                          )}
                        </div>
                        <div>
                          <i className="fas fa-envelope"></i>
                          {user.email ? (<a href={`mailto:${user.email}`}>{user.email}</a>) : t('employees.na')}
                          {user.email && (
                            <button type="button" className={`emp-mini-btn${copiedKey === `e-${user.id}` ? ' copied' : ''}`} aria-label={`${t('employees.copyLabel')}: ${user.email}`} title={copiedKey === `e-${user.id}` ? t('employees.copiedLabel') : t('employees.copyLabel')} onClick={() => copyText(`e-${user.id}`, user.email)}>
                              <i className={`fas fa-${copiedKey === `e-${user.id}` ? 'check' : 'copy'}`} aria-hidden="true"></i>
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label={t('employees.department')}>
                      <strong className="emp-department-name">{user.department || t('employees.general')}</strong>
                    </td>
                    <td data-label={t('employees.role')}>
                      <span className="emp-info-pill">{user.role || t('employees.staff')}</span>
                    </td>
                    <td data-label={t('employees.officeLabel')}>
                      <span className="emp-info-pill"><i className="fas fa-location-dot me-1"></i>{normalizeOfficeName(user.work_location) || t('employees.na')}</span>
                    </td>
                    <td data-label={t('employees.bloodGroup')}>
                      <span className="emp-blood-group">{user.blood_group || t('employees.bloodUnknown')}</span>
                    </td>
                    <td data-label={t('employees.status')}>
                      <span className={`emp-status ${isActive ? 'active' : 'inactive'}`} title={t('employees.inactiveLegend')}>
                        {isActive ? t('employees.active') : t('employees.inactive')}
                      </span>
                    </td>
                    <td data-label={t('employees.actions')}>
                      <div className="emp-actions">
                        {canViewEmployees && (
                          <Link title={t('employees.viewProfile')} aria-label={`${t('employees.viewProfile')}: ${user.full_name}`} to={`/profile/${user.id}`} state={{ from: '/employees' }} onClick={gotoWithScroll}>
                            <i className="fas fa-eye" aria-hidden="true"></i>
                          </Link>
                        )}
                        {user.employee_id && (
                          <button
                            type="button"
                            className="emp-icon-btn qr"
                            title="QR Code / ID Card"
                            aria-label={`QR Code / ID Card: ${user.full_name}`}
                            onClick={() => setQrEmployee(user)}
                          >
                            <i className="fas fa-qrcode" aria-hidden="true"></i>
                          </button>
                        )}
                        {canEditRow && (
                          <Link title={t('employees.editProfile')} aria-label={`${t('employees.editProfile')}: ${user.full_name}`} to={`/edit-employee/${user.id}`} state={{ from: '/employees' }} onClick={gotoWithScroll} className="edit">
                            <i className="fas fa-user-edit" aria-hidden="true"></i>
                          </Link>
                        )}
                        {canToggleRow && (
                          <span className="emp-sep">
                          <button
                            type="button"
                            className={`emp-icon-btn ${isActive ? 'danger' : 'success'}`}
                            title={isActive ? t('employees.confirmDeactivateBtn') : t('employees.confirmActivateBtn')}
                            aria-label={isActive ? t('employees.confirmDeactivateBtn') : t('employees.confirmActivateBtn')}
                            onClick={() => handleToggleStatus(user)}
                            disabled={isToggling}
                            style={isToggling ? { opacity: 0.5, cursor: 'wait' } : undefined}
                          >
                            <i className={`fas fa-${isToggling ? 'spinner fa-spin' : (isActive ? 'user-slash' : 'user-check')}`} aria-hidden="true"></i>
                          </button>
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
        <div className="emp-pager" role="navigation" aria-label={t('employees.listTitle')}>
          {totalPages > 3 && (
          <button type="button" className="emp-btn secondary" disabled={safePage <= 1} onClick={() => setPage(1)} aria-label={t('employees.pageFirst')}>
            <i className="fas fa-angles-left" aria-hidden="true"></i>{t('employees.pageFirst')}
          </button>
          )}
          <button type="button" className="emp-btn secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label={t('employees.pagePrev')}>
            <i className="fas fa-angle-left" aria-hidden="true"></i>{t('employees.pagePrev')}
          </button>
          <span className="emp-page-info">{t('employees.pageInfo', { page: safePage, pages: totalPages })} · {pageSize} {t('employees.rowsLabel')}</span>
          <button type="button" className="emp-btn secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label={t('employees.pageNext')}>
            {t('employees.pageNext')}<i className="fas fa-angle-right" aria-hidden="true"></i>
          </button>
          {totalPages > 3 && (
          <button type="button" className="emp-btn secondary" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)} aria-label={t('employees.pageLast')}>
            {t('employees.pageLast')}<i className="fas fa-angles-right" aria-hidden="true"></i>
          </button>
          )}
        </div>
        <p className="emp-legend">{t('employees.inactiveLegend')}</p>
      </section>

      <EmployeeQRModal
        show={Boolean(qrEmployee)}
        onHide={() => setQrEmployee(null)}
        employee={qrEmployee}
      />

      <Modal show={showModal} onHide={handleModalHide} size="lg" centered className="emp-modal" unmountOnExit backdrop={dirty ? 'static' : true}>
        <Modal.Header closeButton className="border-0 pt-4 px-4 bg-white rounded-top-4">
          <Modal.Title className="fw-bold">
            <i className="fas fa-user-plus text-primary me-2"></i>{t('employees.modalTitle')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4 bg-white rounded-bottom-4">
          <form onSubmit={handleSubmit} autoComplete="off" noValidate>
            <div className="row g-3">
              <div className="col-12"><div className="emp-form-section">{t('employees.sectionBasic')}</div><p className="emp-required-note"><strong>*</strong> {t('employees.requiredNote')}</p></div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.employeeId')}</label>
                <input type="text" name="employee_id" className={`emp-form-input fw-bold text-primary${errors.employee_id ? ' is-invalid' : ''}`} placeholder={nextIdLoading ? t('employees.generating') : t('employees.nextIdPlaceholder')} value={formData.employee_id || ''} onChange={handleInputChange} autoComplete="off" />
                <small className="text-muted">{t('employees.autoIdHint')}</small>
                {errors.employee_id && <div className="invalid-feedback">{errors.employee_id}</div>}
              </div>
              <div className="col-md-8">
                <label className="emp-form-label required">{t('employees.fullName')}</label>
                <input type="text" name="full_name" className={`emp-form-input${errors.full_name ? ' is-invalid' : ''}`} value={formData.full_name || ''} onChange={handleInputChange} required autoFocus autoComplete="name" />
                {errors.full_name && <div className="invalid-feedback">{errors.full_name}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label required">{t('employees.phone')}</label>
                <input type="tel" name="phone" className={`emp-form-input${errors.phone ? ' is-invalid' : ''}`} value={formData.phone || ''} onChange={handleInputChange} required pattern="01[3-9][0-9]{8}" title={t('employees.phoneHint')} placeholder="01XXXXXXXXX" autoComplete="tel" inputMode="tel" />
                <small className="text-muted">{t('employees.phoneHint')}</small>
                {errors.phone && <div className="invalid-feedback">{errors.phone}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.email')}</label>
                <input type="email" name="email" className={`emp-form-input${errors.email ? ' is-invalid' : ''}`} value={formData.email || ''} onChange={handleInputChange} autoComplete="email" />
                {errors.email && <div className="invalid-feedback">{errors.email}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.fatherName')}</label>
                <input type="text" name="father_name" className={`emp-form-input${errors.father_name ? ' is-invalid' : ''}`} value={formData.father_name || ''} onChange={handleInputChange} autoComplete="off" />
                {errors.father_name && <div className="invalid-feedback">{errors.father_name}</div>}
              </div>
              <div className="col-12 mt-2"><div className="emp-form-section">{t('employees.sectionOfficial')}</div></div>
              <div className="col-md-4">
                <label className="emp-form-label required">{t('employees.department')}</label>
                <input list="emp-dept-list" name="department" className={`emp-form-input${errors.department ? ' is-invalid' : ''}`} value={formData.department || ''} onChange={handleInputChange} required placeholder={t('employees.selectDepartment')} autoComplete="off" />
                <datalist id="emp-dept-list">
                  {deptList.map((dept) => (<option key={dept.id} value={dept.dept_name} />))}
                </datalist>
                {errors.department && <div className="invalid-feedback">{errors.department}</div>}
                {deptList.length === 0 && !deptIsError && (<small className="text-muted">{t('employees.noDepartments')}</small>)}
              </div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.designation')}</label>
                <input type="text" list="emp-designation-list" name="designation" className={`emp-form-input${errors.designation ? ' is-invalid' : ''}`} value={formData.designation || ''} onChange={handleInputChange} autoComplete="off" />
                <datalist id="emp-designation-list">
                  {[...new Set(statsRows.map((e) => e.designation).filter(Boolean))].map((d) => (<option key={d} value={d} />))}
                </datalist>
                {errors.designation && <div className="invalid-feedback">{errors.designation}</div>}
              </div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.role')}</label>
                <select name="role" className="emp-form-input" value={formData.role || 'Staff'} onChange={handleInputChange}>
                  {roleOptions.map((rName) => (
                    <option key={rName} value={rName}>{roleLabel(rName)}</option>
                  ))}
                  {formData.role && !roleOptions.some((n) => String(n).toLowerCase() === String(formData.role).toLowerCase()) && (
                    <option value={formData.role}>{formData.role}</option>
                  )}
                </select>
              </div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.status')}</label>
                <select name="status" className="emp-form-input" value={formData.status || 'Active'} onChange={handleInputChange}>
                  <option value="Active">{t('employees.active')}</option>
                  <option value="Inactive">{t('employees.inactive')}</option>
                </select>
              </div>
              <div className="col-12 mt-2"><div className="emp-form-section">{t('employees.sectionAdditional')}</div></div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.bloodGroup')}</label>
                <select name="blood_group" className="emp-form-input" value={formData.blood_group || ''} onChange={handleInputChange}>
                  <option value="">{t('employees.select')}</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((blood) => (<option key={blood} value={blood}>{blood}</option>))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.emergencyPhone')}</label>
                <input type="tel" name="emergency_phone" className={`emp-form-input${errors.emergency_phone ? ' is-invalid' : ''}`} value={formData.emergency_phone || ''} onChange={handleInputChange} autoComplete="tel" inputMode="tel" />
                {errors.emergency_phone && <div className="invalid-feedback">{errors.emergency_phone}</div>}
              </div>
              <div className="col-md-4">
                <label className="emp-form-label">{t('employees.nidNumber')}</label>
                <input type="text" name="nid_number" className={`emp-form-input${errors.nid_number ? ' is-invalid' : ''}`} value={formData.nid_number || ''} onChange={handleInputChange} pattern="([0-9]{10}|[0-9]{13}|[0-9]{17})" title={t('employees.nidHint')} inputMode="numeric" />
                <small className="text-muted">{t('employees.nidHint')}</small>
                {errors.nid_number && <div className="invalid-feedback">{errors.nid_number}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.presentAddress')}</label>
                <textarea name="present_address" className={`emp-form-input${errors.present_address ? ' is-invalid' : ''}`} rows="2" value={formData.present_address || ''} onChange={handleInputChange}></textarea>
                <button type="button" className="emp-micro-btn" onClick={() => setFormData((prev) => ({ ...prev, permanent_address: prev.present_address || prev.permanent_address }))}>{t('employees.copyAddress')}</button>
                {errors.present_address && <div className="invalid-feedback">{errors.present_address}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.permanentAddress')}</label>
                <textarea name="permanent_address" className={`emp-form-input${errors.permanent_address ? ' is-invalid' : ''}`} rows="2" value={formData.permanent_address || ''} onChange={handleInputChange}></textarea>
                {errors.permanent_address && <div className="invalid-feedback">{errors.permanent_address}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.joiningDate')}</label>
                <input type="date" name="joining_date" className="emp-form-input" value={formData.joining_date || ''} onChange={handleInputChange} />
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.reportingManager')}</label>
                <input list="emp-manager-list" name="reporting_manager" className={`emp-form-input${errors.reporting_manager ? ' is-invalid' : ''}`} value={formData.reporting_manager || ''} onChange={handleInputChange} placeholder={t('employees.select')} autoComplete="off" />
                <datalist id="emp-manager-list">
                  {statsRows.filter(e => String(e.status || 'Active').toLowerCase() === 'active').map((emp) => (
                    <option key={emp.id} value={emp.full_name}>{emp.designation || ''}</option>
                  ))}
                </datalist>
                {errors.reporting_manager && <div className="invalid-feedback">{errors.reporting_manager}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label required">{t('employees.workLocation')}</label>
                <select name="work_location" className="emp-form-input" value={formData.work_location || ''} onChange={handleInputChange} required>
                  <option value="">{t('employees.select')}</option>
                  {BRANCHES.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.employmentType')}</label>
                <select name="employment_type" className="emp-form-input" value={formData.employment_type || ''} onChange={handleInputChange}>
                  <option value="">{t('employees.select')}</option>
                  <option value="পূর্ণকালীন (Full-Time, Permanent)">Full-Time (Permanent)</option>
                  <option value="আংশিককালীন (Part-Time)">Part-Time</option>
                  <option value="চুক্তিভিত্তিক (Contract)">Contract</option>
                  <option value="ইন্টার্ন (Intern)">Intern</option>
                </select>
              </div>
              <div className="col-md-6">
                <label className="emp-form-label">{t('employees.profilePic')}</label>
                <input ref={fileInputRef} type="file" name="profile_pic" className="emp-form-input" onChange={handleFileChange} accept="image/jpeg,image/png,image/webp,image/gif" />
                <small className="emp-photo-hint">{t('employees.photoHint')}</small>
                {photoPreview && (
                  <div className="mt-2 d-flex align-items-center gap-2">
                    <img src={photoPreview} alt={t('employees.photoPreview')} title={t('employees.photoPreview')} onClick={openPhotoDialog} className="emp-photo-preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                    <button type="button" className="emp-btn secondary" onClick={removePhoto}>{t('employees.removePhoto')}</button>
                  </div>
                )}
              </div>
              <div className="col-12 mt-2"><div className="emp-form-section">{t('employees.sectionCredentials')}</div></div>
              <div className="col-md-6">
                <label className="emp-form-label required">{t('employees.password')}</label>
                <input type="password" name="password" className={`emp-form-input${errors.password ? ' is-invalid' : ''}`} value={formData.password || ''} onChange={handleInputChange} required minLength={8} placeholder={t('employees.passwordHint')} autoComplete="new-password" />
                <small className="text-muted">{t('employees.passwordHint')}</small>
                {errors.password && <div className="invalid-feedback">{errors.password}</div>}
              </div>
              <div className="col-md-6">
                <label className="emp-form-label required">{t('employees.confirmPassword')}</label>
                <input type="password" name="confirm_password" className={`emp-form-input${errors.confirm_password ? ' is-invalid' : ''}`} value={formData.confirm_password || ''} onChange={handleInputChange} required minLength={8} autoComplete="new-password" />
                {(formData.password || formData.confirm_password) && (
                  passwordsMatch(formData.password, formData.confirm_password)
                    ? <div className="emp-match-ok">{t('employees.passwordMatch')}</div>
                    : <div className="emp-match-bad">{t('employees.passwordNoMatch')}</div>
                )}
                {errors.confirm_password && <div className="invalid-feedback">{errors.confirm_password}</div>}
              </div>
            </div>
            <div className="mt-4 emp-modal-footer">
              <button type="button" className="emp-btn secondary" onClick={handleModalHide} disabled={addMutation.isPending}>{t('employees.cancel')}</button>
              <button type="submit" className="emp-btn primary" disabled={addMutation.isPending}>{addMutation.isPending ? t('employees.saving') : t('employees.saveEmployee')}</button>
            </div>
          </form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default Employees;
