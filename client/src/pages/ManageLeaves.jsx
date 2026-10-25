import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import moment from 'moment';
import Swal from 'sweetalert2';
import ImageWithFallback from '../components/ImageWithFallback';
import QRCode from 'react-qr-code';
import { getLeaveRequests, updateLeaveStatus, updateLeaveEndDate } from '../services/leaveService';
import { getWhatsAppSessions, reconnectWhatsAppSession, disconnectWhatsAppSession } from '../services/supportService';
import { formatDateTime } from '../utils/formatters';
import { t } from '../i18n';
import '../styles/AdminDashboard.css';
import '../styles/ManageLeaves.css';

const STATUS_TABS = ['All', 'Pending', 'Approved', 'Rejected'];
const statusPriority = (status) => (String(status || '').toLowerCase() === 'pending' ? 0 : 1);
const PAGE_SIZE = 20;
const now = new Date();
const DEFAULT_MONTH = String(now.getMonth() + 1);
const DEFAULT_YEAR = String(now.getFullYear());

const statusLabel = (status) => {
  if (status === 'Pending') return t('manageLeaves.statusPending');
  if (status === 'Approved') return t('manageLeaves.statusApproved');
  if (status === 'Rejected') return t('manageLeaves.statusRejected');
  return t('manageLeaves.statusAll');
};

const ManageLeaves = () => {
  const queryClient = useQueryClient();
  const [activeStatus, setActiveStatus] = useState('All');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [filters, setFilters] = useState({ search: '', month: DEFAULT_MONTH, year: DEFAULT_YEAR });
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [page, setPage] = useState(1);
  const [busyActionId, setBusyActionId] = useState(null);
  const [earlyReturn, setEarlyReturn] = useState(null); // { leaveId, groupId, startDate, currentEndDate }
  const [returnDate, setReturnDate] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [showWaModal, setShowWaModal] = useState(false);

  useEffect(() => {
    if (earlyReturn) {
      setReturnDate(earlyReturn.currentEnd);
      setReturnReason('');
    }
  }, [earlyReturn]);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(filters.search), 400);
    return () => clearTimeout(handler);
  }, [filters.search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters.month, filters.year, activeStatus]);

  const { data, isLoading: loading, error: fetchError } = useQuery({
    queryKey: ['leaveRequests', debouncedSearch, filters.month, filters.year, activeStatus, page],
    queryFn: () =>
      getLeaveRequests({
        search: debouncedSearch,
        month: filters.month,
        year: filters.year,
        status: activeStatus,
        page,
        limit: PAGE_SIZE
      }),
    placeholderData: (prev) => prev,
  });

  // Leave WhatsApp sender number (login maintenance): status + QR + reconnect.
  // Poll fast while unconnected so a fresh QR appears within seconds;
  // slow down once connected.
  const waLeaveQ = useQuery({
    queryKey: ['waLeaveSession'],
    queryFn: getWhatsAppSessions,
    refetchInterval: (query) => (query.state.data?.sessions?.leave?.connected ? 30000 : 5000),
    retry: false,
  });
  // Timestamp of the last Connect press — drives the inline "preparing" state
  // (worker boots Chrome + WhatsApp Web first, so the QR needs ~30-60s).
  const waConnectAt = useRef(0);
  const waLeaveMut = useMutation({
    mutationFn: () => reconnectWhatsAppSession('leave'),
    onMutate: () => { waConnectAt.current = Date.now(); },
    // No success popup: the card itself shows live progress (standard inline
    // feedback instead of a "queued" toast).
    onError: (err) => {
      Swal.fire({ title: 'WhatsApp', text: err?.response?.data?.message || err.message || 'Connect failed.', icon: 'error' });
    },
  });
  const waDisconnectMut = useMutation({
    mutationFn: () => disconnectWhatsAppSession('leave'),
    onSuccess: (res) => {
      Swal.fire({ title: 'WhatsApp', text: res?.message || 'Disconnect queued — number will unlink shortly.', icon: 'success', timer: 2000, showConfirmButton: false });
      setTimeout(() => waLeaveQ.refetch(), 4000);
    },
    onError: (err) => {
      Swal.fire({ title: 'WhatsApp', text: err?.response?.data?.message || err.message || 'Disconnect failed.', icon: 'error' });
    },
  });
  const confirmDisconnectLeave = async () => {
    const r = await Swal.fire({
      title: 'Disconnect WhatsApp?',
      text: `Unlink ${waLeave.account?.number || 'this number'} from the leave sender? Approval notifications will stop until you connect again.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Disconnect',
      cancelButtonText: 'Keep',
    });
    if (r.isConfirmed) waDisconnectMut.mutate();
  };
  const waLeave = waLeaveQ.data?.sessions?.leave || {};
  // Inline progress after Connect: worker boots a browser first, QR follows.
  const waConnecting = waLeaveMut.isPending
    || (Date.now() - waConnectAt.current < 90000 && !waLeave.connected && !waLeave.hasQr);
  const requests = useMemo(() => data?.items || [], [data?.items]);
  const pagination = data?.pagination || { page: 1, total_pages: 1, total_items: requests.length };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => updateLeaveStatus(id, status),
    onMutate: async ({ id, status }) => {
      const previousQueries = queryClient.getQueriesData({ queryKey: ['leaveRequests'] });
      setBusyActionId(id);
      queryClient.setQueriesData({ queryKey: ['leaveRequests'] }, (oldData) => {
        if (!oldData || !Array.isArray(oldData.items)) return oldData;
        return {
          ...oldData,
          items: oldData.items.map((group) => {
            if (String(group.first_id) !== String(id)) return group;
            return {
              ...group,
              status,
              leaves: Array.isArray(group.leaves)
                ? group.leaves.map((leaf) => ({ ...leaf, status }))
                : group.leaves
            };
          })
        };
      });
      return { previousQueries };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leaveRequests'], exact: false });
      await queryClient.refetchQueries({ queryKey: ['leaveRequests'], exact: false, type: 'active' });
      Swal.fire({
        title: t('manageLeaves.updateTitle'),
        text: t('manageLeaves.updateSuccess'),
        icon: 'success',
        timer: 1400,
        showConfirmButton: false
      });
    },
    onError: (err, _variables, context) => {
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      Swal.fire({
        title: t('manageLeaves.updateFailedTitle'),
        text: err.message || t('manageLeaves.updateFailed'),
        icon: 'error'
      });
    },
    onSettled: () => {
      setBusyActionId(null);
    }
  });

  const stats = useMemo(
    () =>
      requests.reduce(
        (acc, group) => {
          const currentStatus = String(group.status || '').toLowerCase();
          if (currentStatus === 'pending') acc.pending += 1;
          if (currentStatus === 'approved') acc.approved += 1;
          if (currentStatus === 'rejected') acc.rejected += 1;
          acc.total += 1;
          return acc;
        },
        { pending: 0, approved: 0, rejected: 0, total: 0 }
      ),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    const base = Array.isArray(requests) ? [...requests] : [];
    base.sort((a, b) => {
      const byPending = statusPriority(a?.status) - statusPriority(b?.status);
      if (byPending !== 0) return byPending;
      return Number(b?.first_id || 0) - Number(a?.first_id || 0);
    });

    return base;
  }, [requests]);

  const handleFilterChange = (event) => {
    setFilters((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleReset = () => {
    setFilters({ search: '', month: DEFAULT_MONTH, year: DEFAULT_YEAR });
    setActiveStatus('All');
    setPage(1);
  };

  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getStatusClass = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'approved') return 'approved';
    if (normalized === 'rejected') return 'rejected';
    return 'pending';
  };

  const openReasonModal = (text) => {
    Swal.fire({
      title: t('manageLeaves.leaveReasonTitle'),
      text: text || t('manageLeaves.noReason'),
      icon: 'info',
      confirmButtonColor: '#1756d9'
    });
  };

  const handleEarlyReturn = async () => {
    if (!earlyReturn || !returnDate) return;
    try {
      setBusyActionId(earlyReturn.leaveId);
      await updateLeaveEndDate(earlyReturn.leaveId, returnDate, returnReason);
      setEarlyReturn(null);
      await queryClient.invalidateQueries({ queryKey: ['leaveRequests'], exact: false });
      await queryClient.refetchQueries({ queryKey: ['leaveRequests'], exact: false, type: 'active' });
      Swal.fire({ title: 'Updated', text: `End date changed to ${returnDate}`, icon: 'success', timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: 'Failed', text: err.message, icon: 'error' });
    } finally {
      setBusyActionId(null);
    }
  };

  const handleStatusUpdate = async (id, status) => {
    if (statusMutation.isPending || busyActionId) return;

    const actionLabel =
      status === 'Approved'
        ? t('manageLeaves.actionApprove')
        : status === 'Rejected'
          ? t('manageLeaves.actionReject')
          : t('manageLeaves.actionPending');

    const confirmColor = status === 'Approved' ? '#0f9d58' : status === 'Rejected' ? '#dc3545' : '#f59f00';

    const result = await Swal.fire({
      title: t('manageLeaves.confirmTitle'),
      text: t('manageLeaves.confirmText', { action: actionLabel }),
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: confirmColor,
      confirmButtonText: t('manageLeaves.confirmYes'),
      cancelButtonText: t('manageLeaves.cancel')
    });

    if (result.isConfirmed) {
      statusMutation.mutate({ id, status });
    }
  };

  const error = fetchError?.response?.data?.message || fetchError?.message;

  return (
    <>
      <section className="mlv-hero">
        <div>
          <span className="mlv-label">
            <i className="fas fa-calendar-check"></i>
            {t('manageLeaves.heroTag')}
          </span>
          <h1>{t('manageLeaves.heroTitle')}</h1>
          <p>{t('manageLeaves.heroSubtitle')}</p>
          <div className="mlv-meta">
            <span>
              <i className="fas fa-building"></i>
              Speed Net Khulna
            </span>
            <span>
              <i className="fas fa-calendar-day"></i>
              {moment().format('DD MMMM, YYYY')}
            </span>
          </div>
        </div>
        <div className="mlv-kpi-grid">
          <article className="mlv-kpi total">
            <span>{t('manageLeaves.total')}</span>
            <strong>{stats.total}</strong>
          </article>
          <article className="mlv-kpi pending">
            <span>{t('manageLeaves.pending')}</span>
            <strong>{stats.pending}</strong>
          </article>
          <article className="mlv-kpi approved">
            <span>{t('manageLeaves.approved')}</span>
            <strong>{stats.approved}</strong>
          </article>
          <article className="mlv-kpi rejected">
            <span>{t('manageLeaves.rejected')}</span>
            <strong>{stats.rejected}</strong>
          </article>
        </div>
      </section>

      <section className="mlv-wa-card mlv-wa-compact">
        <span className="mlv-wa-dot" style={{ background: waLeave.connected ? '#16a34a' : (waLeave.hasQr ? '#f59e0b' : '#dc2626') }} />
        <div className="mlv-wa-title">
          <strong>Leave WhatsApp</strong>
          <span className="mlv-wa-state" style={{ color: waLeave.connected ? '#16a34a' : (waLeave.hasQr ? '#b45309' : '#dc2626') }}>
            {waLeaveQ.isLoading ? 'Loading...' : waLeave.connected ? (waLeave.account?.number || 'Connected') : (waLeave.state === 'qr' || waLeave.hasQr ? 'Scan QR' : (waLeave.state || 'Disconnected'))}
          </span>
        </div>
        {!waLeave.connected && waLeave.hasQr && waLeave.qr && !waLeaveQ.isError && (
          <QRCode value={waLeave.qr} size={72} level="M" aria-label="Leave WhatsApp QR" />
        )}
        {waConnecting && !waLeaveQ.isError && (
          <span className="small text-muted">Starting secure session — QR appears in about a minute…</span>
        )}
        {!waLeaveQ.isError && (
          <button type="button" className="mlv-btn secondary mlv-wa-btn" disabled={waLeaveMut.isPending || waConnecting} onClick={() => waLeaveMut.mutate()}>
            <i className={`fas ${waConnecting ? 'fa-spinner fa-spin' : 'fa-sync'}`}></i>
            {waConnecting ? 'Connecting…' : (waLeave.connected ? 'Reconnect' : 'Connect')}
          </button>
        )}
        {waLeave.connected && (
          <button type="button" className="mlv-btn secondary mlv-wa-btn" disabled={waDisconnectMut.isPending} onClick={confirmDisconnectLeave} title="Unlink this WhatsApp number">
            <i className="fas fa-unlink"></i>
            Disconnect
          </button>
        )}
        <button type="button" className="mlv-btn secondary mlv-wa-btn" onClick={() => setShowWaModal(true)} title="Open QR details">
          <i className="fas fa-expand"></i>
        </button>
      </section>

      {showWaModal && (
        <div className="mlv-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowWaModal(false); }}>
          <div className="mlv-modal" role="dialog" aria-modal="true" aria-label="Leave WhatsApp connection">
            <button type="button" className="mlv-modal-close" aria-label="Close dialog" onClick={() => setShowWaModal(false)}>×</button>
            <h3><i className="fab fa-whatsapp" style={{ color: '#16a34a' }}></i> Leave WhatsApp Number</h3>
            <p className="mlv-modal-sub">HR leave approval sender</p>
            <div className="mlv-modal-status">
              <span className="mlv-wa-dot" style={{ background: waLeave.connected ? '#16a34a' : (waLeave.hasQr ? '#f59e0b' : '#dc2626') }} />
              <strong style={{ color: waLeave.connected ? '#16a34a' : (waLeave.hasQr ? '#b45309' : '#dc2626') }}>
                {waLeave.connected ? 'Connected' : (waLeave.state === 'qr' || waLeave.hasQr ? 'Scan QR to connect' : (waLeave.state || 'Disconnected'))}
              </strong>
            </div>
            <div className="mlv-modal-account">
              {waLeave.account?.number
                ? <span>Number: <strong>{waLeave.account.number}</strong>{waLeave.account?.name ? ` (${waLeave.account.name})` : ''}</span>
                : <span className="text-muted">Number will appear after login</span>}
              {waLeave.lastSeenAt && <span className="text-muted"> • last seen {formatDateTime(waLeave.lastSeenAt)}</span>}
            </div>
            {waLeave.error && <div className="small text-danger mb-2">{waLeave.error}</div>}
            {!waLeave.connected && waLeave.hasQr && waLeave.qr ? (
              <div className="mlv-modal-qr">
                <QRCode value={waLeave.qr} size={220} level="M" aria-label="Leave WhatsApp QR" />
                <small className="text-muted">Scan with the office WhatsApp account</small>
              </div>
            ) : !waLeave.connected ? (
              <div className="small text-muted mb-3">
                {waConnecting
                  ? 'Starting secure session — the browser is opening WhatsApp Web, QR appears in about a minute…'
                  : 'Press Connect to generate a fresh QR.'}
              </div>
            ) : null}
            <div className="mlv-modal-actions">
              <button type="button" className="mlv-btn secondary" onClick={() => setShowWaModal(false)}>Close</button>
              {waLeave.connected && (
                <button type="button" className="mlv-btn secondary" disabled={waDisconnectMut.isPending} onClick={confirmDisconnectLeave}>
                  <i className="fas fa-unlink"></i>
                  Disconnect
                </button>
              )}
              <button type="button" className="mlv-btn primary" disabled={waLeaveMut.isPending || waConnecting} onClick={() => waLeaveMut.mutate()}>
                <i className={`fas ${waConnecting ? 'fa-spinner fa-spin' : 'fa-sync'}`}></i>
                {waConnecting ? 'Connecting…' : (waLeave.connected ? 'Reconnect' : 'Connect')}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="mlv-toolbar">
        <form onSubmit={(e) => e.preventDefault()} className="mlv-filter-form">
          <div className="mlv-input with-icon">
            <i className="fas fa-search"></i>
            <input
              type="text"
              name="search"
              placeholder={t('manageLeaves.searchPlaceholder')}
              value={filters.search}
              onChange={handleFilterChange}
            />
          </div>
          <select name="month" value={filters.month} onChange={handleFilterChange}>
            {Array.from({ length: 12 }, (_, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {moment(idx + 1, 'M').format('MMMM')}
              </option>
            ))}
          </select>
          <select name="year" value={filters.year} onChange={handleFilterChange}>
            {Array.from({ length: 6 }, (_, idx) => {
              const year = new Date().getFullYear() - 3 + idx;
              return (
                <option key={year} value={year}>
                  {year}
                </option>
              );
            })}
          </select>
          <button type="button" className="mlv-btn secondary" onClick={handleReset}>
            <i className="fas fa-rotate"></i>
            {t('manageLeaves.reset')}
          </button>
        </form>

        <div className="mlv-status-tabs" role="tablist" aria-label={t('manageLeaves.errorAria')}>
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              type="button"
              className={`mlv-status-tab ${activeStatus === status ? 'active' : ''}`}
              onClick={() => setActiveStatus(status)}
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <section className="mlv-error">
          <i className="fas fa-circle-exclamation"></i>
          <span>{error}</span>
        </section>
      )}

      <section className="mlv-table-card">
        <header>
          <h2>{t('manageLeaves.listTitle')}</h2>
          <p>
            {loading
              ? t('manageLeaves.loadingData')
              : `${t('manageLeaves.groupFound', { count: filteredRequests.length })} | Total: ${pagination.total_items}`}
          </p>
        </header>
        <div className="table-responsive">
          <table className="table align-middle mb-0 mlv-table">
            <thead>
              <tr>
                <th className="expand-col"></th>
                <th>{t('manageLeaves.employee')}</th>
                <th>{t('manageLeaves.leaveDetails')}</th>
                <th>{t('manageLeaves.dateRange')}</th>
                <th>{t('manageLeaves.days')}</th>
                <th>{t('manageLeaves.status')}</th>
                <th className="text-end">{t('manageLeaves.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="7" className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">{t('manageLeaves.loading')}</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && filteredRequests.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-5 text-muted">
                    <i className="fas fa-folder-open d-block mb-3 fs-1 opacity-25"></i>
                    {t('manageLeaves.noRecords')}
                  </td>
                </tr>
              )}

              {!loading &&
                filteredRequests.map((group, index) => {
                  const leaves = Array.isArray(group.leaves) ? group.leaves : [];
                  if (leaves.length === 0) return null;

                  const groupId = `group_${group.first_id || index}`;
                  const isExpanded = Boolean(expandedGroups[groupId]);
                  const hasMultipleRows = leaves.length > 1;
                  const totalDays = leaves.reduce((sum, item) => sum + Number(item.actual_days || 0), 0);
                  const minStart = leaves.reduce(
                    (minDate, current) =>
                      !minDate || new Date(current.start_date) < new Date(minDate) ? current.start_date : minDate,
                    null
                  );
                  const maxEnd = leaves.reduce(
                    (maxDate, current) =>
                      !maxDate || new Date(current.end_date) > new Date(maxDate) ? current.end_date : maxDate,
                    null
                  );
                  const statusClass = getStatusClass(group.status);

                  return (
                    <React.Fragment key={groupId}>
                      <tr
                        className={`mlv-main-row ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => hasMultipleRows && toggleGroup(groupId)}
                      >
                        <td className="expand-col">
                          {hasMultipleRows ? (
                            <i className={`fas fa-chevron-right ${isExpanded ? 'rotated' : ''}`}></i>
                          ) : (
                            <i className="fas fa-circle static-dot"></i>
                          )}
                        </td>
                        <td>
                          <div className="mlv-employee">
                            <ImageWithFallback
                              src={group.user_info?.profile_pic ? `/uploads/${group.user_info.profile_pic}` : null}
                              fallbackName={group.user_info?.full_name || t('manageLeaves.employeeFallback')}
                              className="mlv-avatar"
                              width="44px"
                              height="44px"
                            />
                            <div>
                              <strong>{group.user_info?.full_name || t('manageLeaves.unknownEmployee')}</strong>
                              <small>{t('manageLeaves.idLabel')}: {group.user_info?.employee_id || '-'}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="mlv-detail">
                            <strong>{hasMultipleRows ? t('manageLeaves.segments', { count: leaves.length }) : leaves[0].leave_type_name}</strong>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openReasonModal(group.reason);
                              }}
                            >
                              {t('manageLeaves.viewReason')}
                            </button>
                          </div>
                        </td>
                        <td>
                          <strong>
                            {moment(minStart).format('DD MMM')} - {moment(maxEnd).format('DD MMM, YYYY')}
                          </strong>
                          {hasMultipleRows && <small>{t('manageLeaves.groupedLines', { count: leaves.length })}</small>}
                        </td>
                        <td>
                          <span className="mlv-days-badge">{totalDays}</span>
                        </td>
                        <td>
                          <span className={`mlv-status ${statusClass}`}>{statusLabel(group.status)}</span>
                        </td>
                        <td className="text-end" onClick={(event) => event.stopPropagation()}>
                          <div className="mlv-actions">
                            {group.status === 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  className="ok"
                                  title={t('manageLeaves.approve')}
                                disabled={statusMutation.isPending && busyActionId === group.first_id}
                                onClick={() => handleStatusUpdate(group.first_id, 'Approved')}
                              >
                                  <i className="fas fa-check"></i>
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  title={t('manageLeaves.reject')}
                                disabled={statusMutation.isPending && busyActionId === group.first_id}
                                onClick={() => handleStatusUpdate(group.first_id, 'Rejected')}
                              >
                                  <i className="fas fa-xmark"></i>
                                </button>
                              </>
                            )}

                            {group.status !== 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  className="warn"
                                  title={t('manageLeaves.movePending')}
                                  disabled={statusMutation.isPending && busyActionId === group.first_id}
                                  onClick={() => handleStatusUpdate(group.first_id, 'Pending')}
                                >
                                  <i className="fas fa-rotate-left"></i>
                                </button>
                                {group.status === 'Approved' && !hasMultipleRows && (
                                  <button
                                    type="button"
                                    className="info"
                                    title="Short Return"
                                    disabled={busyActionId === group.first_id}
                                    onClick={() => {
                                      const leaf = leaves[0];
                                      setEarlyReturn({ leaveId: leaf.id, startDate: leaf.start_date, currentEnd: leaf.end_date });
                                    }}
                                  >
                                    <i className="fas fa-calendar-minus"></i>
                                  </button>
                                )}
                                {group.status === 'Approved' && (
                                  <a href={`/approval/${group.first_id}`} target="_blank" rel="noreferrer" title={t('manageLeaves.printApproval')}>
                                    <i className="fas fa-print"></i>
                                  </a>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isExpanded &&
                        leaves.map((leaf) => (
                          <tr key={leaf.id} className="mlv-sub-row">
                            <td></td>
                            <td></td>
                            <td>
                              <div className="mlv-sub-detail">
                                <span className="line-mark"></span>
                                <div>
                                  <strong>{leaf.leave_type_name}</strong>
                                  {Number(leaf.leave_type_id) === 3 && leaf.half_day_period && <small>{leaf.half_day_period}</small>}
                                </div>
                              </div>
                            </td>
                            <td>
                              {moment(leaf.start_date).format('DD MMM')} - {moment(leaf.end_date).format('DD MMM, YYYY')}
                            </td>
                            <td>{leaf.actual_days}</td>
                            <td></td>
                            <td className="text-end">
                              {leaf.status === 'Approved' && (
                                <button
                                  type="button"
                                  className="mlv-btn-sub-action"
                                  title="Short Return"
                                  disabled={busyActionId === leaf.id}
                                  onClick={() => setEarlyReturn({ leaveId: leaf.id, startDate: leaf.start_date, currentEnd: leaf.end_date })}
                                >
                                  <i className="fas fa-calendar-minus"></i>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!loading && pagination.total_pages > 1 && (
          <div className="d-flex align-items-center justify-content-between px-3 py-3 border-top">
            <small className="text-muted">
              Page {pagination.page} of {pagination.total_pages}
            </small>
            <div className="btn-group">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={pagination.page >= pagination.total_pages}
                onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {earlyReturn && (
        <>
          <div className="modal-backdrop fade show" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1080 }} onClick={() => setEarlyReturn(null)}></div>
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1090, pointerEvents: 'none' }}>
            <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: '100%', maxWidth: '520px', margin: '0 16px', pointerEvents: 'auto' }}>
              <div style={{ padding: '1.25rem 1.5rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h5 style={{ margin: 0, fontWeight: 800, fontSize: '1.15rem' }}>
                    <i className="fas fa-calendar-minus" style={{ color: '#0ea5e9', marginRight: '0.5rem' }}></i>
                    {t('manageLeaves.shortReturnTitle', 'Short Return')}
                  </h5>
                  <button type="button" style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#9ca3af', padding: '0.25rem' }} onClick={() => setEarlyReturn(null)} disabled={busyActionId === earlyReturn?.leaveId}>&times;</button>
                </div>
                <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.88rem' }}>{t('manageLeaves.shortReturnSubtitle', 'Set the actual return date for this leave.')}</p>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); if (!returnDate) { Swal.fire({ title: 'Error', text: 'Please select a return date', icon: 'warning' }); return; } handleEarlyReturn(); }}>
                <div style={{ padding: '1rem 1.5rem' }}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', color: '#374151', marginBottom: '0.35rem' }}>{t('manageLeaves.currentPeriod', 'Current Period')}</label>
                    <div style={{ backgroundColor: '#f3f4f6', borderRadius: '10px', padding: '0.55rem 0.85rem', fontSize: '0.92rem', fontWeight: 600, color: '#1f2937' }}>
                      {moment(earlyReturn.startDate).format('DD MMM')} - {moment(earlyReturn.currentEnd).format('DD MMM, YYYY')}
                    </div>
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', color: '#374151', marginBottom: '0.35rem' }}>{t('manageLeaves.actualReturnDate', 'Actual Return Date')}</label>
                    <input
                      type="date"
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '0.55rem 0.85rem', fontSize: '0.92rem', outline: 'none', boxSizing: 'border-box' }}
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      min={earlyReturn.startDate}
                      max={earlyReturn.currentEnd}
                      required
                    />
                  </div>
                  <div style={{ marginBottom: '0.25rem' }}>
                    <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', color: '#374151', marginBottom: '0.35rem' }}>{t('manageLeaves.reasonOptional', 'Reason (optional)')}</label>
                    <textarea
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '0.55rem 0.85rem', fontSize: '0.92rem', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                      rows="2"
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      placeholder={t('manageLeaves.reasonPlaceholder', 'e.g. Employee returned early')}
                    />
                  </div>
                </div>
                <div style={{ padding: '0.75rem 1.5rem 1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
                  <button type="button" style={{ border: '1px solid #e5e7eb', borderRadius: '999px', padding: '0.5rem 1.3rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#374151' }} onClick={() => setEarlyReturn(null)} disabled={busyActionId === earlyReturn?.leaveId}>
                    {t('manageLeaves.cancel', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    style={{ border: 'none', borderRadius: '999px', padding: '0.5rem 1.3rem', fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer', background: '#06b6d4', color: '#fff' }}
                    disabled={busyActionId === earlyReturn?.leaveId}
                  >
                    {busyActionId === earlyReturn?.leaveId ? t('manageLeaves.saving', 'Saving...') : t('manageLeaves.confirm', 'Confirm')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default ManageLeaves;
