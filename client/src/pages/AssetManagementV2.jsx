import React, { useState } from 'react';
import { useAssetOverview } from '@/hooks/useAssetData';
import { DashboardTab, AssetsTab, DesksTab, StockTab, HistoryTab } from './asset-management/v2/tabs';
import '@styles/AssetManagementV2.css';

const AssetManagementV2 = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { masters, summary, loading: overviewLoading, error: overviewError } = useAssetOverview();

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
    { key: 'desks', label: 'Desks', icon: 'fa-table-cells-large' },
    { key: 'assets', label: 'Assets', icon: 'fa-laptop' },
    { key: 'stock', label: 'Stock', icon: 'fa-boxes-stacked' },
    { key: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
  ];

  if (overviewError) {
    return (
      <div className="asset-management-v2 container-fluid py-4">
        <div className="alert alert-warning">{overviewError}</div>
      </div>
    );
  }

  return (
    <div className="asset-management-v2 container-fluid py-4">
      <div className="page-header">
        <h1>Asset Management</h1>
        <p className="text-muted">Track IT assets, desk assignments, warranties, issues, and stock inventory</p>
      </div>

      {overviewLoading && (
        <div className="loading-state mb-4">
          <div className="spinner-border spinner-border-sm" />
          <span>Loading asset data...</span>
        </div>
      )}

      <div className="row g-3 mb-4">
        {summary && [
          { label: 'Offices', value: summary.offices ?? 0, icon: 'fa-building', color: 'primary', hint: 'Head office and branches' },
          { label: 'Assets', value: summary.assets ?? 0, icon: 'fa-laptop', color: 'warning', hint: 'Registered items' },
          { label: 'Warranty Soon', value: summary.warranty_soon ?? 0, icon: 'fa-shield-halved', color: 'danger', hint: 'Expiring within 30 days' },
          { label: 'Low Stock', value: summary.low_stock_items ?? 0, icon: 'fa-box-open', color: 'info', hint: 'Needs replenishment' },
        ].map((stat, i) => (
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

      <div className="tab-nav mb-4">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <i className={`fa-solid ${tab.icon} me-1`} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && (
        <DashboardTab setActiveTab={setActiveTab} />
      )}
      {activeTab === 'assets' && (
        <AssetsTab masters={masters} />
      )}
      {activeTab === 'desks' && (
        <DesksTab />
      )}
      {activeTab === 'stock' && (
        <StockTab />
      )}
      {activeTab === 'history' && (
        <HistoryTab />
      )}

    </div>
  );
};

export default AssetManagementV2;