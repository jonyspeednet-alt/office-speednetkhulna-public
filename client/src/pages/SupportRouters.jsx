import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMikrotikRouters,
  createMikrotikRouter,
  updateMikrotikRouter,
  deleteMikrotikRouter,
  testMikrotikRouter,
  syncMikrotikRouter,
  getMikrotikSyncRuns,
  syncMikrotikCustomers,
} from '../services/supportService';
import RouterFormModal from '../components/support/RouterFormModal';
import { formatDateTime } from '../utils/formatters';
import apiClient from '../config/axiosConfig';
import '../styles/SupportRouters.css';
import { Modal } from 'react-bootstrap';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const mapTestErrorBn = (err) => {
  const rawData = err?.response?.data?.data ?? err?.response?.data ?? {};
  const code = String(rawData?.code || err?.response?.data?.code || '').toUpperCase();
  const retryAfter = rawData?.retry_after_seconds ?? err?.response?.data?.retry_after_seconds;
  const retrySuffix = retryAfter ? ` (retry after ~${retryAfter}s)` : '';
  if (code === 'AUTH') {
    return `username/password incorrect${retrySuffix}`;
  }
  if (code === 'TIMEOUT') {
    return `Router timed out (see timeout)${retrySuffix}`;
  }
  if (code === 'UNREACHABLE') {
    return `Router unreachable (check IP/port/firewall)${retrySuffix}`;
  }
  if (code === 'UNKNOWN') {
    return `${rawData?.message || err?.response?.data?.message || 'Test failed'}${retrySuffix}`;
  }
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.message || rawData?.message || err?.message || '').toLowerCase();
  if (status === 401 || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid user') || msg.includes('wrong')) {
    return `username/password incorrect${retrySuffix}`;
  }
  if (
    err?.code === 'ECONNABORTED' ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('refused') ||
    msg.includes('ehostunreach') ||
    msg.includes('network') ||
    status === 503
  ) {
    return `Router unreachable (check IP/port/firewall)${retrySuffix}`;
  }
  return `${err?.response?.data?.message || rawData?.message || 'Test failed'}${retrySuffix}`;
};

const SupportRouters = () => {
  const queryClient = useQueryClient();
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  // Server is the source of truth for permissions (/api/auth/me). A grant
  // issued after login would otherwise keep showing "No access" until the
  // user logs out and back in (cached localStorage user is stale).
  const [serverUser, setServerUser] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get('/api/auth/me');
        if (!cancelled && data?.user) {
          setServerUser(data.user);
          try {
            const cached = JSON.parse(localStorage.getItem('user') || '{}');
            localStorage.setItem('user', JSON.stringify({ ...cached, ...data.user, permissions: data.user.permissions || cached.permissions }));
          } catch { /* ignore */ }
        }
      } catch { /* non-blocking: fall back to cached user */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveUser = serverUser || user;
  const isSuperAdmin = isSuperAdminRole(effectiveUser?.role);
  const hasPermission = (perm) => {
    if (isSuperAdmin) return true;
    return Boolean(
      effectiveUser?.all_access ||
      effectiveUser?.permissions?.all_access ||
      effectiveUser?.permissions?.[perm] ||
      effectiveUser?.[perm]
    );
  };
  const canManage =
    hasPermission('support.router.manage') || hasPermission('p_support_router_manage');
  const canSync =
    canManage || hasPermission('support.mikrotik.sync') || hasPermission('p_support_mikrotik_sync');
  // Routers UI is manage-only (mirrors sidebar gate): sync or ticket-view
  // alone never opens /support/routers. hasPermission already covers
  // super-admin + all_access, so canManage is the full check.
  const canView = canManage;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [page, setPage] = useState(1);
  const limit = 10;

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const { data: routersPayload, isLoading: loading } = useQuery({
    queryKey: ['mikrotikRouters', page, debouncedSearch],
    queryFn: () => getMikrotikRouters({ page, limit, q: debouncedSearch || undefined }),
    placeholderData: (prev) => prev,
    enabled: canView,
  });

  const rows = Array.isArray(routersPayload?.rows)
    ? routersPayload.rows
    : Array.isArray(routersPayload)
      ? routersPayload
      : [];
  const total = Number(routersPayload?.total ?? rows.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const { data: syncRunsPayload } = useQuery({
    queryKey: ['mikrotikSyncRuns', 'latest'],
    queryFn: () => getMikrotikSyncRuns({ limit: 100 }),
    enabled: canView,
  });
  const syncRuns = useMemo(() => (
    Array.isArray(syncRunsPayload?.rows)
      ? syncRunsPayload.rows
      : Array.isArray(syncRunsPayload)
        ? syncRunsPayload
        : []
  ), [syncRunsPayload]);
  const latestByRouter = useMemo(() => {
    const map = {};
    for (const run of syncRuns) {
      const rid = run.router_id || run.routerId || run.id;
      if (!rid || map[rid]) continue;
      map[rid] = run;
    }
    return map;
  }, [syncRuns]);

  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editingRouter, setEditingRouter] = useState(null);
  const [testingIds, setTestingIds] = useState(new Set());
  const [syncingIds, setSyncingIds] = useState(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRouterId, setHistoryRouterId] = useState('');
  const historyLimit = 10;

  const { data: historyPayload, isLoading: historyLoading } = useQuery({
    queryKey: ['mikrotikSyncRuns', 'history', historyPage, historyRouterId],
    queryFn: () =>
      getMikrotikSyncRuns({
        page: historyPage,
        limit: historyLimit,
        router_id: historyRouterId || undefined,
      }),
    enabled: canView && showHistory,
    placeholderData: (prev) => prev,
  });
  const historyRows = Array.isArray(historyPayload?.rows)
    ? historyPayload.rows
    : Array.isArray(historyPayload)
      ? historyPayload
      : [];
  const historyTotal = Number(historyPayload?.total ?? historyRows.length ?? 0);
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyLimit));

  const upsertMutation = useMutation({
    mutationFn: ({ payload, editId }) =>
      editId ? updateMikrotikRouter(editId, payload) : createMikrotikRouter(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotikRouters'] });
      notify.success(isEdit ? 'Router updated' : 'Router added');
      setShowModal(false);
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, hard }) => deleteMikrotikRouter(id, hard),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['mikrotikRouters'] });
      const isHard = Boolean(res?.hard ?? res?.data?.hard ?? vars?.hard);
      notify.success(isHard ? 'Router permanently deleted' : 'Router deactivated (can be reactivated)');
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Delete failed'),
  });

  const markSet = (setter, id, on) => {
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleTest = async (router) => {
    markSet(setTestingIds, router.id, true);
    try {
      const res = await testMikrotikRouter(router.id);
      notify.success(`Success (${res?.records_seen ?? 0} records, ${res?.latency_ms ?? '?'}ms)`);
    } catch (e) {
      notify.error(mapTestErrorBn(e));
    } finally {
      markSet(setTestingIds, router.id, false);
    }
  };

  const handleSyncOne = async (router) => {
    markSet(setSyncingIds, router.id, true);
    try {
      const res = await syncMikrotikRouter(router.id);
      notify.success(`Synced (${res?.synced ?? 0})`);
      queryClient.invalidateQueries({ queryKey: ['mikrotikRouters'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotikSyncRuns'] });
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Sync failed');
    } finally {
      markSet(setSyncingIds, router.id, false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      const res = await syncMikrotikCustomers();
      const synced = Array.isArray(res?.synced) ? res.synced : [];
      const failed = Array.isArray(res?.failed) ? res.failed : [];
      notify.success(`Sync All: ${synced.length} synced, ${failed.length} failed`);
      if (failed.length > 0 && res?.warning) {
        (notify.warning || notify.info)(res.warning);
      }
      queryClient.invalidateQueries({ queryKey: ['mikrotikRouters'] });
      queryClient.invalidateQueries({ queryKey: ['mikrotikSyncRuns'] });
    } catch (e) {
      const errData = e?.response?.data?.data ?? e?.response?.data ?? {};
      const synced = Array.isArray(errData?.synced) ? errData.synced : [];
      const failed = Array.isArray(errData?.failed) ? errData.failed : [];
      if (e?.response?.status === 503 && (synced.length > 0 || failed.length > 0)) {
        const failedLabels = failed.map((f) => f?.router_id || f?.routerId || f?.id || f?.label || JSON.stringify(f)).join(', ');
        notify.error(`Sync All: ${synced.length} synced, ${failed.length} failed${failedLabels ? ` — failed: ${failedLabels}` : ''}`);
      } else {
        notify.error(e?.response?.data?.message || errData?.message || 'Sync All failed');
      }
    } finally {
      setSyncingAll(false);
    }
  };

  const handleDelete = async (router) => {
    const ok = await confirmAction({ title: `Delete ${router.label || router.id}?`, danger: true });
    if (!ok) return;
    let hard = false;
    if (isSuperAdmin) {
      hard = await confirmAction({
        title: 'Permanently delete (hard)?',
        text: 'Cancel = soft delete',
        danger: true,
        confirmText: 'Hard delete',
      });
    }
    deleteMutation.mutate({ id: router.id, hard });
  };

  const openAddModal = () => {
    setIsEdit(false);
    setEditingRouter(null);
    setShowModal(true);
  };

  const openEditModal = (router) => {
    setIsEdit(true);
    setEditingRouter(router);
    setShowModal(true);
  };

  const formatSyncAge = (dateStr) => {
    if (!dateStr) return '';
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return '';
    const diffMs = Date.now() - t;
    if (diffMs < 0) return 'synced just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'synced just now';
    if (mins < 60) return `synced ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `synced ${hours}h ago`;
    return `synced ${Math.floor(hours / 24)}d ago`;
  };

  const isStaleSync = (dateStr) => {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t > 2 * 60 * 60 * 1000;
  };

  const renderLastSync = (router) => {
    const run = latestByRouter[router.id] || (router.last_synced_at ? router : null);
    if (!run || (!run.completed_at && !run.created_at && !router.last_synced_at)) {
      return <span className="text-muted small">never synced</span>;
    }
    const status = run.last_sync_status || run.status || (run.success === false ? 'failed' : 'completed');
    const date = run.last_synced_at || run.completed_at || run.created_at || '';
    const records = run.records_synced ?? run.records_seen ?? run.synced ?? null;
    const age = formatSyncAge(date);
    const stale = isStaleSync(date);
    if (String(status).toLowerCase().includes('fail') || run.success === false) {
      return (
        <span className="text-danger small">
          failed: {String(run.last_error || run.error || run.message || '').slice(0, 80) || 'error'}
          {age ? ` · ${age}` : ''}
          {stale && <span className="badge bg-danger ms-1">STALE</span>}
        </span>
      );
    }
    return (
      <span className="small text-muted">
        completed{records != null ? ` · ${records} records` : ''}{age ? ` · ${age}` : ''}{date ? ` · ${formatDateTime(date)}` : ''}
        {stale && <span className="badge bg-danger ms-1">STALE</span>}
      </span>
    );
  };

  if (!canView) {
    return (
      <div className="container-fluid p-3 p-md-4">
        <div className="alert alert-danger">No access (permission to view MikroTik routers is required).</div>
      </div>
    );
  }

  const fromRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const toRecord = Math.min(page * limit, total);

  return (
    <div className="container-fluid p-3 p-md-4">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-4 gap-3">
        <div>
          <h3 className="fw-bold mb-1">MikroTik Routers</h3>
          <p className="text-muted small mb-0">Add, test & sync routers</p>
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-center d-print-none">
          <form onSubmit={(e) => e.preventDefault()} className="d-flex" style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div className="input-group">
              <span className="input-group-text bg-white border-end-0 rounded-start-pill ps-3"><i className="fas fa-search text-muted"></i></span>
              <input
                type="text"
                className="form-control border-start-0 rounded-end-pill"
                placeholder="Search routers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </form>
          {canSync && (
            <button className="btn btn-outline-success rounded-pill px-3 px-md-4 fw-bold text-nowrap flex-shrink-0" onClick={handleSyncAll} disabled={syncingAll}>
              {syncingAll && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
              <i className="fas fa-sync me-2"></i>Sync All
            </button>
          )}
          <button className="btn btn-outline-secondary rounded-pill px-3 px-md-4 fw-bold text-nowrap flex-shrink-0" onClick={() => { setHistoryPage(1); setShowHistory(true); }}>
            <i className="fas fa-history me-2"></i>Sync history
          </button>
          {canManage && (
            <button className="btn btn-primary px-3 px-md-4 shadow-sm rounded-pill fw-bold text-nowrap flex-shrink-0" onClick={openAddModal}>
              <i className="fas fa-plus me-2"></i>Add Router
            </button>
          )}
        </div>
      </div>

      <div className="ui-card p-3 p-md-4">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Name / ID</th>
                <th>Host / IP</th>
                <th>Port / Protocol</th>
                <th>Username</th>
                <th>Connection</th>
                <th>Last Sync</th>
                <th className="text-end d-print-none">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {[...Array(7)].map((__, c) => (
                      <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="ui-empty">
                      <i className="fas fa-network-wired ui-empty-icon"></i>
                      <span className="ui-empty-title">No routers found</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((router) => {
                  const testing = testingIds.has(router.id);
                  const syncing = syncingIds.has(router.id);
                  const busy = testing || syncing;
                  return (
                    <tr key={router.id}>
                      <td>
                        <div className="fw-bold text-dark">{router.label || router.id}</div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>{router.id}</div>
                      </td>
                      <td className="small">{router.host || '-'}</td>
                      <td>
                        <span className="d-inline-flex flex-wrap gap-1">
                          <span className="badge bg-light text-primary fw-bold px-2 py-1 rounded">{router.port ?? '-'}</span>
                          <span className={`badge px-2 py-1 rounded ${router.protocol === 'api' ? 'bg-warning text-dark' : 'bg-info text-dark'}`}>
                            {router.protocol || 'rest'}
                          </span>
                        </span>
                      </td>
                      <td className="small">{router.username || '-'}</td>
                      <td>
                        <span
                          title={router.last_sync_status || router.is_active ? 'active' : 'inactive'}
                          style={{
                            display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                            background: router.is_active === false ? '#dc3545' : '#198754',
                          }}
                        />
                      </td>
                      <td><span className="d-inline-block text-truncate" style={{ maxWidth: 180 }}>{renderLastSync(router)}</span></td>
                      <td className="text-end text-nowrap d-print-none">
                        <span className="d-inline-flex gap-1">
                        {canSync && (
                          <>
                            <button
                              className="router-icon-btn test"
                              onClick={() => handleTest(router)}
                              disabled={busy}
                              title="Test"
                              aria-label={`Test connection to ${router.label || router.id}`}
                            >
                              {testing ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> : <i className="fas fa-plug" aria-hidden="true"></i>}
                            </button>
                            <button
                              className="router-icon-btn sync"
                              onClick={() => handleSyncOne(router)}
                              disabled={busy}
                              title="Sync"
                              aria-label={`Sync ${router.label || router.id}`}
                            >
                              {syncing ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> : <i className="fas fa-sync" aria-hidden="true"></i>}
                            </button>
                          </>
                        )}
                        {canManage && (
                          <>
                            <button className="router-icon-btn edit" onClick={() => openEditModal(router)} disabled={busy} title="Edit" aria-label={`Edit ${router.label || router.id}`}>
                              <i className="fas fa-edit" aria-hidden="true"></i>
                            </button>
                            <button className="router-icon-btn del" onClick={() => handleDelete(router)} disabled={busy} title="Delete" aria-label={`Delete ${router.label || router.id}`}>
                              <i className="fas fa-trash" aria-hidden="true"></i>
                            </button>
                          </>
                        )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center pt-3 border-top d-print-none">
            <div className="text-muted small">Showing {fromRecord}-{toRecord} of {total}</div>
            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
                  <button className="page-link rounded-start-pill" onClick={() => setPage(page - 1)}>Previous</button>
                </li>
                {[...Array(totalPages)].map((_, i) => (
                  <li key={i + 1} className={`page-item ${page === i + 1 ? 'active' : ''}`}>
                    <button className="page-link" onClick={() => setPage(i + 1)}>{i + 1}</button>
                  </li>
                ))}
                <li className={`page-item ${page >= totalPages ? 'disabled' : ''}`}>
                  <button className="page-link rounded-end-pill" onClick={() => setPage(page + 1)}>Next</button>
                </li>
              </ul>
            </nav>
          </div>
        )}
      </div>

      <Modal show={showHistory} onHide={() => setShowHistory(false)} centered size="lg" scrollable>
        <Modal.Header closeButton className="border-0 px-3 px-md-4 pt-4">
          <Modal.Title className="fw-bold">Sync history</Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-3 px-md-4">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <label htmlFor="sync-history-router" className="small fw-bold text-muted mb-0">Router</label>
            <select
              id="sync-history-router"
              className="form-select rounded-3"
              style={{ maxWidth: 260 }}
              value={historyRouterId}
              onChange={(e) => { setHistoryRouterId(e.target.value); setHistoryPage(1); }}
            >
              <option value="">All routers</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.label || r.id}</option>
              ))}
            </select>
          </div>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Router</th>
                  <th>Status</th>
                  <th>Seen</th>
                  <th>Synced</th>
                  <th>Error</th>
                  <th>Started</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={`hsk-${i}`}>
                      {[...Array(7)].map((__, c) => (
                        <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                      ))}
                    </tr>
                  ))
                ) : historyRows.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <div className="ui-empty">
                        <span className="ui-empty-title">No sync history found</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  historyRows.map((run, idx) => (
                    <tr key={run.id || idx}>
                      <td className="small fw-bold">{run.router_id || run.routerId || run.router_label || run.id || '-'}</td>
                      <td className="small">{run.status || (run.success === false ? 'failed' : 'completed')}</td>
                      <td className="small">{run.records_seen ?? run.seen ?? '-'}</td>
                      <td className="small">{run.records_synced ?? run.synced ?? '-'}</td>
                      <td className="small" style={{ whiteSpace: 'normal', wordBreak: 'break-word', minWidth: 180 }}>
                        {run.error_message || run.last_error || run.error || run.message || '-'}
                      </td>
                      <td className="small">{formatDateTime(run.started_at || run.created_at) || '-'}</td>
                      <td className="small">{formatDateTime(run.completed_at) || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center pt-3">
            <div className="text-muted small">Page {historyPage} of {historyTotalPages} ({historyTotal} total)</div>
            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${historyPage <= 1 ? 'disabled' : ''}`}>
                  <button className="page-link rounded-start-pill" onClick={() => setHistoryPage(1)} disabled={historyPage <= 1}>First</button>
                </li>
                <li className={`page-item ${historyPage <= 1 ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1}>Prev</button>
                </li>
                <li className={`page-item ${historyPage >= historyTotalPages ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))} disabled={historyPage >= historyTotalPages}>Next</button>
                </li>
                <li className={`page-item ${historyPage >= historyTotalPages ? 'disabled' : ''}`}>
                  <button className="page-link rounded-end-pill" onClick={() => setHistoryPage(historyTotalPages)} disabled={historyPage >= historyTotalPages}>Last</button>
                </li>
              </ul>
            </nav>
          </div>
        </Modal.Body>
      </Modal>

      <RouterFormModal
        show={showModal}
        onHide={() => setShowModal(false)}
        isEdit={isEdit}
        initialData={editingRouter || {}}
        submitting={upsertMutation.isPending}
        onSubmit={(payload) => upsertMutation.mutate({ payload, editId: isEdit ? editingRouter?.id : null })}
      />
    </div>
  );
};

export default SupportRouters;
