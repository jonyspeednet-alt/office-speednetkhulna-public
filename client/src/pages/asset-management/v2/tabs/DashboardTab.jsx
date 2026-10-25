import React, { useMemo } from 'react';
import { useAssets, useHistory } from '@hooks/useAssetData';
import { formatDateTime } from '../../../../utils/formatters';

const DashboardTab = ({ setActiveTab }) => {
  const { items: assets } = useAssets();
  const { items, issues } = useHistory();

  const stats = useMemo(() => {
    const activeAssets = assets.filter(a => a.status === 'active').length;
    const warrantySoon = assets.filter(a => {
      if (!a.warranty_end_date) return false;
      const end = new Date(a.warranty_end_date);
      const now = new Date();
      const diff = (end - now) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff <= 30;
    }).length;
    const openIssues = issues.filter(i => i.status !== 'resolved').length;
    const lowStock = 0;
    return { activeAssets, warrantySoon, openIssues, lowStock };
  }, [assets, issues]);

  const recentActivity = useMemo(() => items.slice(0, 10), [items]);

  const statCards = [
    { label: 'Active Assets', value: stats.activeAssets, icon: 'fa-laptop', color: 'primary', hint: `${assets.length} total` },
    { label: 'Warranty Expiring', value: stats.warrantySoon, icon: 'fa-shield-halved', color: 'warning', hint: 'Within 30 days' },
    { label: 'Open Issues', value: stats.openIssues, icon: 'fa-triangle-exclamation', color: 'danger', hint: `${issues.length} total` },
    { label: 'Recent Activity', value: recentActivity.length, icon: 'fa-clock-rotate-left', color: 'info', hint: 'Last 10 events' },
  ];

  return (
    <div className="asset-management-v2">
      <div className="row g-3 mb-4">
        {statCards.map((stat, i) => (
          <div key={i} className="col-md-3">
            <div className="card metric-card h-100">
              <div className="card-body d-flex align-items-center gap-3">
                <div className={`bg-${stat.color}-subtle text-${stat.color} rounded-3 p-3`}>
                  <i className={`fa-solid ${stat.icon} fa-1.5x`} />
                </div>
                <div>
                  <div className="metric-value fw-bold">{stat.value}</div>
                  <div className="metric-label text-muted small">{stat.label}</div>
                  <div className="metric-hint text-muted small">{stat.hint}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3">
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span className="fw-semibold">Recent Activity</span>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setActiveTab('history')}>
                View All
              </button>
            </div>
            <div className="card-body p-0">
              {recentActivity.length === 0 ? (
                <div className="empty-state p-4">
                  <i className="fa-solid fa-clock-rotate-left" />
                  <p className="mb-0">No recent activity</p>
                </div>
              ) : (
                <div className="list-group list-group-flush">
                  {recentActivity.map(item => (
                    <div key={item.id} className="list-group-item px-3 py-2 border-0 border-bottom">
                      <div className="d-flex align-items-start gap-3">
                        <div className={`bg-${item.type === 'movement' ? 'primary' : item.type === 'warranty' ? 'warning' : item.type === 'issue' ? 'danger' : item.type === 'repair' ? 'info' : 'secondary'}-subtle text-${item.type === 'movement' ? 'primary' : item.type === 'warranty' ? 'warning' : item.type === 'issue' ? 'danger' : item.type === 'repair' ? 'info' : 'secondary'} rounded-circle p-2 flex-shrink-0`}>
                          <i className={`fa-solid ${item.type === 'movement' ? 'fa-arrow-right' : item.type === 'warranty' ? 'fa-shield' : item.type === 'issue' ? 'fa-triangle-exclamation' : item.type === 'repair' ? 'fa-screwdriver-wrench' : 'fa-rotate'} fa-sm`} />
                        </div>
                        <div className="flex-grow-1 min-width-0">
                          <div className="fw-medium">{item.title}</div>
                          <div className="small text-muted">{item.details}</div>
                          <div className="small text-muted">{item.asset} · {formatDateTime(item.date)}</div>
                        </div>
                        <span className="badge bg-secondary-subtle text-secondary text-uppercase small">{item.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card h-100">
            <div className="card-header">
              <span className="fw-semibold">Quick Actions</span>
            </div>
            <div className="card-body">
              <div className="d-grid gap-2">
                <button className="btn btn-primary" onClick={() => setActiveTab('assets')}>
                  <i className="fa-solid fa-plus me-2" /> Add Asset
                </button>
                <button className="btn btn-outline-secondary" onClick={() => setActiveTab('desks')}>
                  <i className="fa-solid fa-table-cells-large me-2" /> Manage Desks
                </button>
                <button className="btn btn-outline-secondary" onClick={() => setActiveTab('stock')}>
                  <i className="fa-solid fa-box me-2" /> Stock Room
                </button>
                <button className="btn btn-outline-secondary" onClick={() => setActiveTab('history')}>
                  <i className="fa-solid fa-clock-rotate-left me-2" /> Full History
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardTab;