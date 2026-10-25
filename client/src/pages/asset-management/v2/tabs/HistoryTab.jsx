import React, { useState, useMemo } from 'react';
import { useHistory } from '../../../../hooks/useAssetData';
import { formatDateTime } from '../../../../utils/formatters';

const HistoryTab = () => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { items, issues, loading, refetch } = useHistory();

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!item.title.toLowerCase().includes(s) &&
            !item.details.toLowerCase().includes(s) &&
            !item.asset.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, filter, search]);

  const typeCounts = useMemo(() => {
    const counts = { all: items.length, movement: 0, warranty: 0, issue: 0, repair: 0, replacement: 0 };
    items.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
    return counts;
  }, [items]);

  const getTypeIcon = (type) => ({
    movement: 'fa-arrow-right',
    warranty: 'fa-shield-halved',
    issue: 'fa-triangle-exclamation',
    repair: 'fa-screwdriver-wrench',
    replacement: 'fa-rotate',
  }[type] || 'fa-clock-rotate-left');

  const getTypeColor = (type) => ({
    movement: 'primary',
    warranty: 'warning',
    issue: 'danger',
    repair: 'info',
    replacement: 'secondary',
  }[type] || 'secondary');

  return (
    <div className="asset-management-v2">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div>
          <h5 className="mb-0">Activity History</h5>
          <small className="text-muted">Unified timeline of all asset events</small>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary btn-sm" onClick={refetch} disabled={loading}>
            <i className="fa-solid fa-arrow-rotate-right me-1" /> Refresh
          </button>
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-4">
              <label className="form-label small text-muted">Search</label>
              <input type="text" className="form-control form-control-sm search-input" placeholder="Filter by asset, title, details..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-muted">Type</label>
              <select className="form-select form-select-sm" value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">All ({typeCounts.all})</option>
                <option value="movement">Movements ({typeCounts.movement})</option>
                <option value="warranty">Warranties ({typeCounts.warranty})</option>
                <option value="issue">Issues ({typeCounts.issue})</option>
                <option value="repair">Repairs ({typeCounts.repair})</option>
                <option value="replacement">Replacements ({typeCounts.replacement})</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="loading-state"><div className="spinner-border spinner-border-sm" /><span>Loading history...</span></div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state"><i className="fa-solid fa-clock-rotate-left" /><p>No history records found</p></div>
          ) : (
            <div className="timeline">
              {filteredItems.map(item => (
                <div key={item.id} className="timeline-item">
                  <div className="d-flex gap-3">
                    <div className={`bg-${getTypeColor(item.type)}-subtle text-${getTypeColor(item.type)} rounded-circle p-2 flex-shrink-0`}>
                      <i className={`fa-solid ${getTypeIcon(item.type)} fa-sm`} />
                    </div>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <div className="fw-medium">{item.title}</div>
                          <div className="small text-muted">{item.details}</div>
                        </div>
                        <span className={`badge bg-${getTypeColor(item.type)}-subtle text-${getTypeColor(item.type)}-emphasis small`}>{item.type}</span>
                      </div>
                      <div className="small text-muted mt-1">
                        {item.asset} · {formatDateTime(item.date) || 'Unknown date'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Open Issues</h5>
            <span className="badge bg-danger-subtle text-danger-emphasis">{issues.length} open</span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Asset</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Reported</th>
                </tr>
              </thead>
              <tbody>
                {issues.map(issue => (
                  <tr key={issue.id}>
                    <td>
                      <div className="fw-medium">{issue.issue_title}</div>
                      <div className="small text-muted">{issue.issue_description?.substring(0, 80)}...</div>
                    </td>
                    <td>{issue.asset_tag} - {issue.asset_name}</td>
                    <td><span className={`badge bg-${{low:'secondary',medium:'info',high:'warning',critical:'danger'}[issue.severity]}-subtle text-${{low:'secondary',medium:'info',high:'warning',critical:'danger'}[issue.severity]}-emphasis`}>{issue.severity}</span></td>
                    <td><span className={`badge bg-${issue.status==='open'?'danger':issue.status==='in_progress'?'warning':'success'}-subtle text-${issue.status==='open'?'danger':issue.status==='in_progress'?'warning':'success'}-emphasis`}>{issue.status}</span></td>
                    <td className="small text-muted">{formatDateTime(issue.reported_at) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryTab;