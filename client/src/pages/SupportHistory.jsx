import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupportDashboard, getSupportTickets, revertSolvedTicket } from '../services/supportService';
import { BRANCHES } from '../constants/branches';
import { getLoggedInSupportOffice } from '../utils/supportOffice';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';
import { formatDateTime } from '../utils/formatters';
import SupportOfficeShortcuts from '../components/SupportOfficeShortcuts';
import '../styles/SupportHistory.css';
import '../styles/SupportTickets.css';

const FILTERS = {
  all: { title: 'All Tickets History', sub: 'Every ticket record', icon: 'fa-file-lines', cls: 'blue', status: '' },
  pending: { title: 'Pending Tickets History', sub: 'Awaiting response', icon: 'fa-hourglass-start', cls: 'orange', status: 'new,waiting_customer,reopened' },
  processing: { title: 'Processing Tickets History', sub: 'Work in progress', icon: 'fa-gear', cls: 'amber', status: 'assigned,in_progress,waiting_vendor,verification_pending' },
  solved: { title: 'Solved Tickets History', sub: 'Closed + resolved', icon: 'fa-circle-check', cls: 'green', status: 'closed,resolved' },
  my: { title: 'My Tickets History', sub: 'Assigned to me', icon: 'fa-user-check', cls: 'indigo', status: '' },
};

const fmtHistoryPrimaryDT = (v) => formatDateTime(v) || '—';
const fmtDur = (start, end) => {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e)) return '—';
  const diff = Math.max(0, e - s);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
};

const statusPill = (status) => {
  if (['closed', 'resolved'].includes(status)) return { label: 'Solved', cls: 'hst solved' };
  if (['new', 'waiting_customer', 'reopened'].includes(status)) return { label: 'Pending', cls: 'hst pending' };
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'hst cancelled' };
  return { label: 'Processing', cls: 'hst processing' };
};

const isPersistedVerified = (ticket) => Boolean(ticket?.verification_id) && (
  ticket.is_verified === true ||
  ticket.is_verified === 1 ||
  ticket.is_verified === '1' ||
  ticket.is_verified === 'true'
);

const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return dayStr(d); };
const SUPPORT_OFFICES = BRANCHES.map((b) => ({
  ...b,
  displayName: b.code === 'CO' ? 'Head Office (Corporate Office)' : b.name,
}));
const REMOVED_PROBLEM_CATEGORY_IDS = new Set([909, 912, 918]);
const hasQcSupport = (ticket) => Boolean(ticket?.is_qc_support || Number(ticket?.category_id) === 912);
const hasOnCallSupport = (ticket) => Boolean(ticket?.is_on_call || ticket?.resolution_type === 'on_call' || Number(ticket?.category_id) === 918);
const getProblemCategoryLabel = (ticket) => (
  [912, 918].includes(Number(ticket?.category_id))
    ? ticket?.subject || '—'
    : ticket?.category_name || ticket?.subject || '—'
);

const CategoryMultiSelect = ({ categories, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleCategories = categories.filter((category) =>
    String(category.name_bn || category.name || '').toLowerCase().includes(search.trim().toLowerCase())
  );

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const toggleCategory = (id) => {
    onChange(selectedSet.has(String(id))
      ? selected.filter((selectedId) => selectedId !== String(id))
      : [...selected, String(id)]);
  };
  const visibleIds = visibleCategories.map((category) => String(category.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const toggleVisibleCategories = () => {
    if (allVisibleSelected) {
      onChange(selected.filter((id) => !visibleIds.includes(id)));
      return;
    }
    onChange([...new Set([...selected, ...visibleIds])]);
  };

  return (
    <div className="history-category-select" ref={rootRef}>
      <button
        id="hist-category"
        type="button"
        className="history-filter-control history-category-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected.length ? `${selected.length} selected` : 'All Categories'}</span>
        <i className={`fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="history-category-menu">
          <input
            type="search"
            className="history-category-search"
            placeholder="Search categories..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search categories"
          />
          <button type="button" className="history-category-bulk" onClick={toggleVisibleCategories} disabled={!visibleIds.length}>
            {allVisibleSelected ? 'Uncheck all' : 'Check all'}{search.trim() ? ' shown' : ''}
          </button>
          <div className="history-category-options" role="group" aria-label="Problem categories">
            <label className="history-category-option history-category-all">
              <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
              <span>All Categories</span>
            </label>
            {visibleCategories.length ? visibleCategories.map((category) => {
              const id = String(category.id);
              return (
                <label className="history-category-option" key={id}>
                  <input type="checkbox" checked={selectedSet.has(id)} onChange={() => toggleCategory(id)} />
                  <span>{category.name_bn || category.name}</span>
                </label>
              );
            }) : <div className="history-category-empty">No categories found.</div>}
          </div>
          <div className="history-category-footer">
            <span>{selected.length} selected</span>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>Clear</button>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
};

const SupportHistory = () => {
  const { filter = 'all' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const restoredLocationKey = useRef('');
  const returnState = location.state?.restoreSupportHistoryState || {};
  const assignedSupportOffice = getLoggedInSupportOffice();
  const isHeadOfficeUser = assignedSupportOffice === 'Corporate Office';
  const isBranchOfficeUser = Boolean(assignedSupportOffice && !isHeadOfficeUser);
  const historyUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
  const historyPerms = historyUser.permissions || {};
  const cfg = FILTERS[filter] || FILTERS.all;
  // Admin-only undo: solved/closed mistake revert (server re-checks this).
  const historyIsAdmin = Boolean(
    historyUser.is_super_admin ||
    historyUser.all_access ||
    historyPerms.all_access ||
    historyPerms['system.all_access'] ||
    ['admin', 'super admin', 'superadmin'].includes(String(historyUser.role_name || historyUser.role || '').trim().toLowerCase())
  );
  const qc = useQueryClient();
  const revertMut = useMutation({
    mutationFn: ({ id }) => revertSolvedTicket(id, {}),
    onSuccess: (ticket) => {
      notify.success(`${ticket?.ticket_no || 'Ticket'} reverted to ${ticket?.status || 'active'}.`);
      qc.invalidateQueries({ queryKey: ['supportHistory'] });
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportHistoryDashboard'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to revert ticket.'),
  });
  const handleRevert = async (t) => {
    const ok = await confirmAction({
      title: 'Revert solved ticket?',
      text: `${t.ticket_no || 'This ticket'} will leave Solved history and return to its previous active status. Resolution note and solved/closed timestamps will be cleared.`,
      confirmText: 'Revert ticket',
      danger: true,
    });
    if (ok) revertMut.mutate({ id: t.id });
  };
  const [page, setPage] = useState(() => returnState.page || 1);
  const [q, setQ] = useState(() => returnState.q || '');
  const [debouncedQ, setDebouncedQ] = useState(() => String(returnState.q || '').trim());
  const [filtersOpen, setFiltersOpen] = useState(() => returnState.filtersOpen ?? false);
  const [selectedCategory, setSelectedCategory] = useState(() => {
    const saved = Array.isArray(returnState.selectedCategory)
      ? returnState.selectedCategory
      : String(returnState.selectedCategory || '').split(',').filter(Boolean);
    return saved.filter((id) => !REMOVED_PROBLEM_CATEGORY_IDS.has(Number(id)));
  });
  const [selectedZone, setSelectedZone] = useState(() => isBranchOfficeUser ? assignedSupportOffice : (returnState.selectedZone || ''));
  const [selectedAssignee, setSelectedAssignee] = useState(() => returnState.selectedAssignee || '');
  const [selectedCreator, setSelectedCreator] = useState(() => returnState.selectedCreator || '');
  const [selectedStatus, setSelectedStatus] = useState(() => returnState.selectedStatus || '');
  const [selectedPriority, setSelectedPriority] = useState(() => returnState.selectedPriority || '');
  const [complaintNo, setComplaintNo] = useState(() => returnState.complaintNo || '');
  const [fromDate, setFromDate] = useState(() => returnState.fromDate || '');
  const [toDate, setToDate] = useState(() => returnState.toDate || '');
  // Solve-date filter (solved tab only): which day(s) the ticket was solved
  const [solvedFrom, setSolvedFrom] = useState(() => returnState.solvedFrom || '');
  const [solvedTo, setSolvedTo] = useState(() => returnState.solvedTo || '');
  const limit = 10;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const { data: dashboardData } = useQuery({
    queryKey: ['supportHistoryDashboard'],
    queryFn: getSupportDashboard,
  });

  const categories = (dashboardData?.categories || []).filter((category) =>
    !REMOVED_PROBLEM_CATEGORY_IDS.has(Number(category.id)) &&
    !['others', 'qc_support', 'on_call_support'].includes(String(category.name || '').trim().toLowerCase().replace(/\s+/g, '_'))
  );
  const technicians = dashboardData?.technicians || [];

  const activeFilterCount = [selectedCategory.length ? selectedCategory : '', selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, complaintNo, fromDate, toDate, solvedFrom, solvedTo].filter((v) => String(v || '').trim() !== '').length;

  const applyPreset = (preset) => {
    const today = dayStr(new Date());
    setPage(1);
    if (preset === 'today') { setSolvedFrom(today); setSolvedTo(today); }
    else if (preset === 'yesterday') { const y = addDays(new Date(), -1); setSolvedFrom(y); setSolvedTo(y); }
    else if (preset === 'week') { setSolvedFrom(addDays(new Date(), -6)); setSolvedTo(today); }
    else if (preset === 'month') { setSolvedFrom(addDays(new Date(), -29)); setSolvedTo(today); }
    else { setSolvedFrom(''); setSolvedTo(''); }
  };
  const dateActive = solvedFrom || solvedTo;

  const resetFilters = () => {
    setSelectedCategory([]);
    setSelectedZone(isBranchOfficeUser ? assignedSupportOffice : '');
    setSelectedAssignee('');
    setSelectedCreator('');
    setSelectedStatus('');
    setSelectedPriority('');
    setComplaintNo('');
    setFromDate('');
    setToDate('');
    setSolvedFrom('');
    setSolvedTo('');
    setPage(1);
  };

  const params = useMemo(() => {
    const effectiveStatus = selectedStatus || cfg.status;
    const p = { status: effectiveStatus, page, limit, q: debouncedQ || undefined, hideOldSolved: filter === 'all' ? true : undefined };
    if (selectedCategory.length) p.category_id = selectedCategory.join(',');
    if (selectedZone) p.office = selectedZone;
    if (selectedAssignee) p.assignee = selectedAssignee;
    if (selectedCreator) p.creator = selectedCreator;
    if (selectedPriority) p.priority = selectedPriority;
    if (complaintNo) p.complaintNo = complaintNo;
    if (fromDate) p.fromDate = fromDate;
    if (toDate) p.toDate = toDate;
    if (filter === 'solved') {
      if (solvedFrom) p.solvedFrom = solvedFrom;
      if (solvedTo) p.solvedTo = solvedTo;
    }
    if (filter === 'my') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        const uid = String(u?.id || u?.userId || u?.user_id || '').trim();
        if (uid && /^\d+$/.test(uid)) p.myUserId = uid;
        else p.assignee = String(u?.full_name || u?.name || '').trim();
      } catch { /* ignore */ }
    }
    return p;
  }, [filter, cfg.status, page, limit, debouncedQ, selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, complaintNo, fromDate, toDate, solvedFrom, solvedTo]);

  const { data, isLoading, isPlaceholderData, isError, error } = useQuery({
    queryKey: ['supportHistory', filter, page, debouncedQ, selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, complaintNo, fromDate, toDate, solvedFrom, solvedTo],
    queryFn: () => getSupportTickets(params),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const scrollY = returnState.scrollY;
    if (scrollY == null || restoredLocationKey.current === location.key || isLoading) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, Number(scrollY) || 0);
      restoredLocationKey.current = location.key;
    });
    return () => cancelAnimationFrame(frame);
  }, [location.key, returnState.scrollY, isLoading, data]);

  const openTicket = (ticketId) => {
    const params = new URLSearchParams({
      ticket: String(ticketId),
      return: `/support/history/${filter}`,
    });
    navigate(`/support?${params.toString()}`, {
      state: {
        supportHistoryReturnState: {
          scrollY: window.scrollY,
          page,
          q,
          filtersOpen,
          selectedCategory,
          selectedZone,
          selectedAssignee,
          selectedCreator,
          selectedStatus,
          selectedPriority,
          complaintNo,
          fromDate,
          toDate,
          solvedFrom,
          solvedTo,
        },
      },
    });
  };

  const rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
  const total = Number(data?.total ?? rows.length) || 0;
  const totalPages = Number(data?.totalPages ?? 1) || 1;
  const isSearching = q.trim() !== debouncedQ;

  return (
    <div className="history-page">
      <div className="history-topbar">
        <div className="history-heading">
          <Link to="/support" className="history-back" aria-label="Back to Support">
            <i className="fas fa-arrow-left" aria-hidden="true" />
          </Link>
          <div className="history-title-block">
            <div className={`history-hero-icon ${cfg.cls}`} aria-hidden="true">
              <i className={`fas ${cfg.icon}`} />
            </div>
            <div className="history-title-copy">
              <h2>{cfg.title}</h2>
              <p>{cfg.sub} <span aria-hidden="true">·</span> {total} record{total === 1 ? '' : 's'}</p>
            </div>
          </div>
        </div>
        <div className="history-actions">
          <Link to="/support-reports" className="history-report-link">
            <i className="fas fa-chart-column" /> Support Reports
          </Link>
          <button type="button" className="history-print" onClick={() => window.print()} title="Print this history">
            <i className="fas fa-print" /> Print
          </button>
        </div>
      </div>

      {isHeadOfficeUser && (
        <div className="history-shortcuts">
          <SupportOfficeShortcuts
            selectedOffice={selectedZone}
            onSelect={(office) => { setSelectedZone(office); setPage(1); }}
          />
        </div>
      )}

      <div className="history-toolbar">
        <div className="history-search">
          <i className="fas fa-search" />
          <input
            type="text"
            placeholder="Search tickets, customers, phones, notes..."
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            aria-label="Search history"
          />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>

        <div className="history-filter-tools">
          <button type="button" className="history-filter-toggle" onClick={() => setFiltersOpen((open) => !open)}>
            <i className={`fas ${filtersOpen ? 'fa-chevron-up' : 'fa-sliders'}`} />
            <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
          </button>
          <button type="button" className="history-filter-reset" onClick={resetFilters}>
            <i className="fas fa-rotate-left" />
            <span>Reset Filters</span>
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="history-filter-grid">
          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-category">
              <i className="fas fa-layer-group text-primary me-1" /> Problem Category
            </label>
            <CategoryMultiSelect categories={categories} selected={selectedCategory} onChange={(next) => { setSelectedCategory(next); setPage(1); }} />
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-office">
              <i className="fas fa-building text-primary me-1" /> Office / Branch
            </label>
            <select id="hist-office" className="history-filter-control" value={selectedZone} onChange={(e) => { setSelectedZone(e.target.value); setPage(1); }} disabled={isBranchOfficeUser} title={isBranchOfficeUser ? 'Your view is limited to your assigned office.' : undefined}>
              <option value="">All Offices</option>
              {SUPPORT_OFFICES.map((b) => (
                <option key={b.code} value={b.name}>{b.displayName}</option>
              ))}
            </select>
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-assignee">
              <i className="fas fa-user-check text-primary me-1" /> Solved By (Assign To)
            </label>
            <select id="hist-assignee" className="history-filter-control" value={selectedAssignee} onChange={(e) => { setSelectedAssignee(e.target.value); setPage(1); }}>
              <option value="">All Assignees</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name || t.name}</option>
              ))}
            </select>
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-status">
              <i className="fas fa-traffic-light text-primary me-1" /> Status
            </label>
            <select id="hist-status" className="history-filter-control" value={selectedStatus} onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}>
              <option value="">All Statuses</option>
              <option value="new,waiting_customer,reopened">Pending (new / waiting_customer / reopened)</option>
              <option value="assigned,in_progress,waiting_vendor,verification_pending">Processing (assigned / in_progress / waiting_vendor)</option>
              <option value="closed,resolved">Solved (closed / resolved)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-priority">
              <i className="fas fa-flag text-primary me-1" /> Priority
            </label>
            <select id="hist-priority" className="history-filter-control" value={selectedPriority} onChange={(e) => { setSelectedPriority(e.target.value); setPage(1); }}>
              <option value="">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-complaint">
              <i className="fas fa-hashtag text-primary me-1" /> Complaint Number
            </label>
            <input id="hist-complaint" type="text" className="history-filter-control history-filter-input" placeholder="e.g. 01700000000" value={complaintNo} onChange={(e) => { setComplaintNo(e.target.value); setPage(1); }} />
          </div>

          <div className="history-filter-group">
            <label className="history-filter-label" htmlFor="hist-creator">
              <i className="fas fa-user-edit text-primary me-1" /> Created By
            </label>
            <input id="hist-creator" className="history-filter-control history-filter-input" placeholder="Creator name/ID" value={selectedCreator} onChange={(e) => { setSelectedCreator(e.target.value); setPage(1); }} />
          </div>

          <div className="history-filter-group history-date-range-group">
            <label className="history-filter-label" htmlFor="hist-from">
              <i className="fas fa-calendar-alt text-primary me-1" /> Complaint Date Range
            </label>
            <div className="history-range-inline">
              <input id="hist-from" type="date" className="history-filter-control history-date-input" value={fromDate} max={toDate || undefined} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
              <span>to</span>
              <input id="hist-to" type="date" className="history-filter-control history-date-input" value={toDate} min={fromDate || undefined} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
            </div>
            {fromDate && toDate && fromDate > toDate && (
              <small className="history-date-warn">From date must be on or before To date.</small>
            )}
          </div>

          {filter === 'solved' && (
            <div className="history-filter-group history-solved-dates-group">
              <label className="history-filter-label" htmlFor="hist-solved-from">
                <i className="fas fa-calendar-check text-primary me-1" /> Solved Date
              </label>
              <div className="history-date-presets">
                <button type="button" className={!dateActive ? 'on' : ''} onClick={() => applyPreset('all')}>All</button>
                <button type="button" className={solvedFrom && solvedFrom === solvedTo && solvedFrom === dayStr(new Date()) ? 'on' : ''} onClick={() => applyPreset('today')}>Today</button>
                <button type="button" onClick={() => applyPreset('yesterday')}>Yesterday</button>
                <button type="button" onClick={() => applyPreset('week')}>7d</button>
                <button type="button" onClick={() => applyPreset('month')}>30d</button>
              </div>
              <div className="history-range-inline">
                <input id="hist-solved-from" type="date" className="history-filter-control history-date-input" value={solvedFrom} max={solvedTo || undefined} onChange={(e) => { setSolvedFrom(e.target.value); setPage(1); }} />
                <span>to</span>
                <input id="hist-solved-to" type="date" className="history-filter-control history-date-input" value={solvedTo} min={solvedFrom || undefined} onChange={(e) => { setSolvedTo(e.target.value); setPage(1); }} />
              </div>
              {solvedFrom && solvedTo && solvedFrom > solvedTo && (
                <small className="history-date-warn">From date must be on or before To date.</small>
              )}
            </div>
          )}
        </div>
      )}

      {isSearching || isLoading || isPlaceholderData ? (
        <div className="history-state">Loading history...</div>
      ) : isError ? (
        <div className="history-state error">
          Failed to load history: {error?.response?.data?.message || error?.message || 'Unknown error.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="history-state">No records found{debouncedQ ? ` for "${debouncedQ}"` : ''}.</div>
      ) : (
        <div className="support-table-card">
          <div className="table-responsive">
            <table className="ticket-management-table history-matching-table">
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Problem / Office</th>
                  <th scope="col">Resolution / Remarks</th>
                  <th scope="col">Created</th>
                  <th scope="col">Solved / Age</th>
                  <th scope="col">Handled By</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const pill = statusPill(t.status);
                  const end = t.closed_at || t.resolved_at;
                  const handledBy = t.assigned_to_name ||
                    (hasOnCallSupport(t) ? t.created_by_name || t.created_by_username : '') ||
                    (t.assigned_to ? `ID:${t.assigned_to}` : 'Unassigned');
                  const note = t.resolution_note || t.description;
                  const customer = t.pppoe_username || t.customer_snapshot?.pppoe_username || '—';
                  const creator = t.created_by_name || t.created_by_username || '—';
                  const issue = getProblemCategoryLabel(t);
                  const office = t.office_name || t.zone || 'Corporate Office';
                  const priority = t.priority || 'Low';
                  const noteLabel = t.resolution_note ? 'Resolution' : 'Remarks';
                  const isSolved = ['closed', 'resolved'].includes(t.status);
                  const hasVerification = Boolean(t.verification_id);
                  const verified = isPersistedVerified(t);
                  return (
                    <tr key={t.id}>
                      {/* 1. Ticket */}
                      <td>
                        <span className="fw-bold text-primary" title={t.ticket_no || `#${t.id}`}>{t.ticket_no || `#${t.id}`}</span>
                        {t.complaint_no && (
                          <div className="text-muted" style={{ fontSize: '11px', fontWeight: 600 }} title={`Complaint: ${t.complaint_no}`}>{t.complaint_no}</div>
                        )}
                        <div className="history-support-flags">
                          {hasQcSupport(t) && <span className="support-flag-badge qc" title="QC Support">QC</span>}
                          {hasOnCallSupport(t) && <span className="support-flag-badge on-call" title="On-Call Support">On-Call</span>}
                        </div>
                      </td>
                      {/* 2. Customer */}
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <span className="fw-bold text-dark" style={{ textTransform: 'capitalize' }}>{customer}</span>
                          {t.phone && (
                            <span className="text-muted" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                              <i className="fas fa-phone-alt me-1 text-secondary" style={{ fontSize: '10px' }} />{t.phone}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* 3. Problem / Office */}
                      <td>
                        <div className="d-flex flex-column">
                          <span className="text-dark fw-semibold">{issue}</span>
                          {hasQcSupport(t) && (
                            <div className="support-flag-badges mt-1">
                              <span className="support-flag-badge qc"><i className="fas fa-clipboard-check me-1" aria-hidden="true" />QC Support</span>
                            </div>
                          )}
                          <span className="text-muted small" style={{ fontSize: '11px' }}>
                            <i className="fas fa-building me-1" style={{ fontSize: '10px' }} />{office}
                          </span>
                        </div>
                      </td>
                      {/* 4. Resolution / Remarks — moved here for visibility */}
                      <td className="hist-resolution-cell">
                        {note ? (
                          <div title={`${noteLabel}: ${note}`}>
                            <span className="hist-resolution-label">{noteLabel}</span>
                            <span className="hist-resolution-text">{note}</span>
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                      {/* 5. Created */}
                      <td>
                        <div className="d-flex flex-column">
                          <span style={{ fontSize: '12px', fontWeight: 500 }}>{fmtHistoryPrimaryDT(t.created_at)}</span>
                          <span className="text-muted small" style={{ fontSize: '11px' }}>by {creator}</span>
                        </div>
                      </td>
                      {/* 6. Solved / Age */}
                      <td>
                        <div className="d-flex flex-column">
                          <span style={{ fontSize: '12px', fontWeight: 500 }}>
                            {end ? fmtHistoryPrimaryDT(end) : fmtDur(t.created_at, null)}
                          </span>
                          <span className="text-muted small" style={{ fontSize: '11px' }}>
                            {end ? `took ${fmtDur(t.created_at, end)}` : 'open'}
                          </span>
                        </div>
                      </td>
                      {/* 7. Handled By */}
                      <td>
                        <span className="badge bg-light text-dark border" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                          <i className="fas fa-user-check me-1 text-secondary" style={{ fontSize: '10px' }} />
                          {handledBy}
                        </span>
                      </td>
                      {/* 8. Status */}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div className="d-flex flex-column align-items-center gap-1">
                          <span className={pill.cls}>{pill.label}</span>
                          <span className={`hst-prio ${(priority || 'low').toLowerCase()}`}>{priority}</span>
                          {isSolved && (
                            <span
                              className={`history-verification-status ${verified ? 'verified' : hasVerification ? 'incomplete' : 'not-called'}`}
                              aria-label={`Verification: ${verified ? 'Verified' : hasVerification ? 'Not verified' : 'Not called'}`}
                            >
                              <i className={`fas ${verified ? 'fa-circle-check' : hasVerification ? 'fa-circle-exclamation' : 'fa-minus-circle'}`} aria-hidden="true" />
                              {verified ? 'Verified' : hasVerification ? 'Not verified' : 'Not called'}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* 9. Actions */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="table-actions-group">
                          <button
                            type="button"
                            className="btn-table-action"
                            aria-label={`Open ticket ${t.ticket_no || t.id}`}
                            onClick={() => openTicket(t.id)}
                            title="Open Ticket"
                          >
                            <i className="fas fa-eye" aria-hidden="true" />
                          </button>
                          {isSolved && historyIsAdmin && (
                            <button
                              type="button"
                              className="btn-table-action text-danger"
                              aria-label={`Revert solved ticket ${t.ticket_no || t.id} (Admin only)`}
                              onClick={() => handleRevert(t)}
                              disabled={revertMut.isPending}
                              title="Undo solve — only Admin can revert"
                            >
                              <i className="fas fa-rotate-left" aria-hidden="true" />
                            </button>
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

      {totalPages > 1 && (
        <div className="history-pager">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span>Page {page} of {totalPages} ({total} records)</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default SupportHistory;
