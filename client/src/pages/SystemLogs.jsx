import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSystemLogs } from '../services/systemLogService';
import { formatDateTime } from '../utils/formatters';
import { t } from '../i18n';

const fmtDate = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return formatDateTime(d);
};

const toLabel = (value = '') =>
  String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const actionText = (action) => {
  const raw = String(action || '').trim();
  if (!raw) return '-';
  const upper = raw.toUpperCase();
  if (upper.includes('LOGIN_SUCCESS')) return t('systemLogs.loginSuccess');
  if (upper.includes('LOGIN_FAILED')) return t('systemLogs.loginFailed');
  if (upper.includes('LOGOUT')) return t('systemLogs.logoutText');
  if (upper.includes('CREATE')) return `${t('systemLogs.create')} (${toLabel(raw)})`;
  if (upper.includes('UPDATE')) return `${t('systemLogs.update')} (${toLabel(raw)})`;
  if (upper.includes('DELETE')) return `${t('systemLogs.delete')} (${toLabel(raw)})`;
  if (upper.includes('APPROVE')) return `${t('systemLogs.approve')} (${toLabel(raw)})`;
  if (upper.includes('REJECT')) return `${t('systemLogs.reject')} (${toLabel(raw)})`;
  return toLabel(raw);
};

const moneyText = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const hasLogAccess = (u) => {
  if (!u) return false;
  const p = u.permissions || {};
  return (
    isSuperAdminRole(u.role) ||
    u.is_super_admin ||
    u.all_access ||
    p.all_access ||
    p['system.all_access'] ||
    p['audit.system_logs.view'] ||
    p['p_system_logs']
  );
};

const SystemLogs = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const [filters, setFilters] = useState({
    source: 'all',
    limit: 50,
    from: '',
    to: '',
    action_type: '',
    user_id: '',
    actor_user_id: '',
    reseller_id: '',
  });
  const [page, setPage] = useState(1);

  const enabled = hasLogAccess(user);
  const queryParams = useMemo(() => {
    const out = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) out[k] = v;
    });
    out.page = page;
    return out;
  }, [filters, page]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['systemLogs', queryParams],
    queryFn: () => getSystemLogs(queryParams),
    enabled,
    keepPreviousData: true,
  });

  if (!enabled) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">{t('systemLogs.accessDenied')}</div>
      </div>
    );
  }

  const onFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const auditRows = data?.audit?.rows || [];
  const finRows = data?.financial?.rows || [];
  const errRows = data?.errors?.rows || [];
  const sourceTotalPages = {
    audit: data?.audit?.totalPages || 0,
    financial: data?.financial?.totalPages || 0,
    errors: data?.errors?.totalPages || 0,
  };
  const totalPages =
    filters.source === 'all'
      ? Math.max(sourceTotalPages.audit, sourceTotalPages.financial, sourceTotalPages.errors)
      : sourceTotalPages[filters.source] || 0;
  const auditSuccess = auditRows.filter((r) => !!r.success).length;
  const auditFailed = auditRows.length - auditSuccess;

  return (
    <div className="container-fluid p-3">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h4 className="mb-0">{t('systemLogs.title')}</h4>
        <button className="btn btn-sm btn-outline-primary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? t('systemLogs.refreshing') : t('systemLogs.refresh')}
        </button>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.source')}</label>
              <select className="form-select form-select-sm" value={filters.source} onChange={(e) => onFilter('source', e.target.value)}>
                <option value="all">{t('systemLogs.all')}</option>
                <option value="audit">{t('systemLogs.audit')}</option>
                <option value="financial">{t('systemLogs.financial')}</option>
                <option value="errors">{t('systemLogs.errors', {}, 'Errors')}</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.limit')}</label>
              <input className="form-control form-control-sm" type="number" min="1" max="200" value={filters.limit} onChange={(e) => onFilter('limit', e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.from')}</label>
              <input className="form-control form-control-sm" type="datetime-local" value={filters.from} onChange={(e) => onFilter('from', e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.to')}</label>
              <input className="form-control form-control-sm" type="datetime-local" value={filters.to} onChange={(e) => onFilter('to', e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.action')}</label>
              <input className="form-control form-control-sm" value={filters.action_type} onChange={(e) => onFilter('action_type', e.target.value)} placeholder={t('systemLogs.actionPlaceholder')} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.userId')}</label>
              <input className="form-control form-control-sm" value={filters.user_id} onChange={(e) => onFilter('user_id', e.target.value)} placeholder={t('systemLogs.auditUserPlaceholder')} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.actorUserId')}</label>
              <input className="form-control form-control-sm" value={filters.actor_user_id} onChange={(e) => onFilter('actor_user_id', e.target.value)} placeholder={t('systemLogs.actorPlaceholder')} />
            </div>
            <div className="col-md-2">
              <label className="form-label mb-1">{t('systemLogs.resellerId')}</label>
              <input className="form-control form-control-sm" value={filters.reseller_id} onChange={(e) => onFilter('reseller_id', e.target.value)} placeholder={t('systemLogs.resellerPlaceholder')} />
            </div>
          </div>
        </div>
      </div>

      {!isLoading && !isError && (
        <div className="d-flex justify-content-end align-items-center gap-2 mb-2">
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isFetching}
          >
            {t('systemLogs.prev', {}, 'Prev')}
          </button>
          <span className="small text-muted">
            {t('systemLogs.page', {}, 'Page')} {page}
            {totalPages ? ` / ${totalPages}` : ''}
          </span>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setPage((p) => (totalPages ? Math.min(totalPages, p + 1) : p + 1))}
            disabled={isFetching || (totalPages ? page >= totalPages : false)}
          >
            {t('systemLogs.next', {}, 'Next')}
          </button>
        </div>
      )}

      {isLoading && <div className="alert alert-info">{t('systemLogs.loading')}</div>}
      {isError && (
        <div className="alert alert-danger">
          {t('systemLogs.loadError')} {error?.response?.data?.message || error?.message || ''}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {(filters.source === 'all' || filters.source === 'audit') && (
            <div className="card mb-3">
              <div className="card-header d-flex justify-content-between">
                <strong>{t('systemLogs.auditLogs')}</strong>
                <div className="d-flex gap-2">
                  <span className="badge text-bg-success">{t('systemLogs.success')}: {auditSuccess}</span>
                  <span className="badge text-bg-danger">{t('systemLogs.failed')}: {auditFailed}</span>
                  <span className="badge text-bg-secondary">{t('systemLogs.total')}: {data?.audit?.total || 0}</span>
                </div>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-striped mb-0">
                  <thead>
                    <tr>
                      <th>{t('systemLogs.time')}</th>
                      <th>{t('systemLogs.user')}</th>
                      <th>{t('systemLogs.happened')}</th>
                      <th>{t('systemLogs.result')}</th>
                      <th>{t('systemLogs.request')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.length === 0 && (
                      <tr><td colSpan="5" className="text-center py-3">{t('systemLogs.noneAudit')}</td></tr>
                    )}
                    {auditRows.map((r) => (
                      <tr key={`a-${r.id}`}>
                        <td>{fmtDate(r.created_at)}</td>
                        <td>
                          <div className="fw-semibold">{r.user_name || '-'}</div>
                          <small className="text-muted">{t('systemLogs.id')}: {r.user_id || '-'} | {t('systemLogs.roleLabel')}: {r.role_name || '-'}</small>
                        </td>
                        <td>
                          <div className="fw-semibold">{actionText(r.action_type)}</div>
                          <small className="text-muted">{t('systemLogs.log')} #{r.id}</small>
                        </td>
                        <td>
                          <span className={`badge ${r.success ? 'text-bg-success' : 'text-bg-danger'}`}>
                            {r.success ? t('systemLogs.success') : t('systemLogs.failed')}
                          </span>
                          {r.error_message ? (
                            <div className="small text-danger mt-1">{String(r.error_message).slice(0, 120)}</div>
                          ) : null}
                        </td>
                        <td>
                          <div>{r.http_method || '-'} {r.route_path || '-'}</div>
                          <small className="text-muted">{t('systemLogs.http')} {r.response_status || '-'} | {r.duration_ms ?? '-'} ms</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(filters.source === 'all' || filters.source === 'financial') && (
            <div className="card">
              <div className="card-header d-flex justify-content-between">
                <strong>{t('systemLogs.financialLogs')}</strong>
                <span className="badge text-bg-secondary">{t('systemLogs.total')}: {data?.financial?.total || 0}</span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-striped mb-0">
                  <thead>
                    <tr>
                      <th>{t('systemLogs.time')}</th>
                      <th>{t('systemLogs.reseller')}</th>
                      <th>{t('systemLogs.actor')}</th>
                      <th>{t('systemLogs.changed')}</th>
                      <th>{t('systemLogs.amountEffect')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finRows.length === 0 && (
                      <tr><td colSpan="5" className="text-center py-3">{t('systemLogs.noneFinancial')}</td></tr>
                    )}
                    {finRows.map((r) => (
                      <tr key={`f-${r.id}`}>
                        <td>{fmtDate(r.created_at)}</td>
                        <td>
                          <div className="fw-semibold">{r.reseller_name || '-'}</div>
                          <small className="text-muted">{t('systemLogs.resellerId')}: {r.reseller_id || '-'}</small>
                        </td>
                        <td>
                          <div className="fw-semibold">{r.actor_user_name || '-'}</div>
                          <small className="text-muted">{t('systemLogs.actorUserId')}: {r.actor_user_id || '-'}</small>
                        </td>
                        <td>
                          <div className="fw-semibold">{actionText(r.action_type)}</div>
                          <small className="text-muted">
                            {r.field_name ? `${toLabel(r.field_name)} | ` : ''}
                            {r.old_value ?? '-'} {' -> '} {r.new_value ?? '-'}
                          </small>
                        </td>
                        <td>
                          <span className={`badge ${Number(r.amount_delta) < 0 ? 'text-bg-danger' : 'text-bg-success'}`}>
                            {Number(r.amount_delta) < 0 ? t('systemLogs.decrease') : t('systemLogs.increase')}
                          </span>
                          <div className="small mt-1">{moneyText(r.amount_delta)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(filters.source === 'all' || filters.source === 'errors') && (
            <div className="card mt-3">
              <div className="card-header d-flex justify-content-between">
                <strong>{t('systemLogs.errors', {}, 'Errors')}</strong>
                <span className="badge text-bg-secondary">{t('systemLogs.total')}: {data?.errors?.total || 0}</span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm table-striped mb-0">
                  <thead>
                    <tr>
                      <th>{t('systemLogs.time')}</th>
                      <th>{t('systemLogs.errorSource', {}, 'Source')}</th>
                      <th>{t('systemLogs.errorMessage', {}, 'Message')}</th>
                      <th>{t('systemLogs.request')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errRows.length === 0 && (
                      <tr><td colSpan="4" className="text-center py-3">{t('systemLogs.noneErrors', {}, 'No errors found')}</td></tr>
                    )}
                    {errRows.map((r) => (
                      <tr key={`e-${r.id}`}>
                        <td>{fmtDate(r.created_at)}</td>
                        <td>
                          <span className="badge text-bg-danger">{r.source || '-'}</span>
                          <div className="small text-muted mt-1">{t('systemLogs.id')}: {r.user_id || '-'}</div>
                        </td>
                        <td>
                          <div className="fw-semibold text-danger">{String(r.message || '-').slice(0, 200)}</div>
                          {r.stack ? (
                            <details className="small text-muted mt-1">
                              <summary>{t('systemLogs.stackTrace', {}, 'Stack trace')}</summary>
                              <pre className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{String(r.stack).slice(0, 2000)}</pre>
                            </details>
                          ) : null}
                        </td>
                        <td>
                          <div>{r.http_method || '-'} {r.route_path || '-'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SystemLogs;
