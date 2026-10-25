import React from 'react';
import { QuickActionCard } from '../SummaryCards';

const DashboardTab = ({ assets, openIssueCount, lowStockCount, reports, loading, setActiveTab }) => {
  const maxOfficeCount = Math.max(1, ...reports.assets_by_office.map((row) => Number(row.asset_count) || 0));
  const maxCategoryCount = Math.max(1, ...reports.assets_by_category.map((row) => Number(row.asset_count) || 0));

  return (
    <div className="row g-4">
      <div className="col-lg-4">
        <QuickActionCard
          title="Asset Register"
          value={assets.length}
          hint="Search, filter, and update device records quickly."
          buttonLabel="Assets"
          onClick={() => setActiveTab('assets')}
          tone="primary"
        />
      </div>
      <div className="col-lg-4">
        <QuickActionCard
          title="Open Issues"
          value={openIssueCount}
          hint="Jump straight to unresolved hardware issues and warranty claims."
          buttonLabel="Issues"
          onClick={() => setActiveTab('issues')}
          tone="danger"
        />
      </div>
      <div className="col-lg-4">
        <QuickActionCard
          title="Low Stock"
          value={lowStockCount}
          hint="See spare parts that need replenishment before stock-outs happen."
          buttonLabel="Stock"
          onClick={() => setActiveTab('stock')}
          tone="warning"
        />
      </div>
      <div className="col-lg-7">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
            <span>Assets by Office</span>
            <span className="text-muted small">Distribution</span>
          </div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Office</th>
                  <th>Assets</th>
                </tr>
              </thead>
              <tbody>
                {reports.assets_by_office.map((row) => (
                  <tr key={row.id}>
                    <td>{row.office_name}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="asset-bar flex-grow-1"><span style={{ width: `${((Number(row.asset_count) || 0) / maxOfficeCount) * 100}%` }} /></div>
                        <strong>{row.asset_count}</strong>
                      </div>
                    </td>
                  </tr>
                ))}
                {!reports.assets_by_office.length && !loading && (
                  <tr><td colSpan="2" className="text-muted text-center py-4">No office data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-5">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Asset Status</div>
          <div className="card-body">
            <div className="d-grid gap-2">
              {reports.asset_status_counts.map((row) => (
                <div key={row.status} className="d-flex justify-content-between border rounded-3 px-3 py-2">
                  <span className="text-capitalize">{row.status.replace(/_/g, ' ')}</span>
                  <strong>{row.count}</strong>
                </div>
              ))}
              {!reports.asset_status_counts.length && !loading && (
                <div className="text-muted text-center py-4">No status data found</div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Assets by Category</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Assets</th>
                </tr>
              </thead>
              <tbody>
                {reports.assets_by_category.map((row) => (
                  <tr key={row.id}>
                    <td>{row.category_name}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div className="asset-bar flex-grow-1"><span style={{ width: `${((Number(row.asset_count) || 0) / maxCategoryCount) * 100}%` }} /></div>
                        <strong>{row.asset_count}</strong>
                      </div>
                    </td>
                  </tr>
                ))}
                {!reports.assets_by_category.length && !loading && (
                  <tr><td colSpan="2" className="text-muted text-center py-4">No category data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Vendor Spend</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Assets</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {reports.vendor_spend.map((row) => (
                  <tr key={row.vendor_name}>
                    <td>{row.vendor_name}</td>
                    <td>{row.asset_count}</td>
                    <td>{row.total_spend}</td>
                  </tr>
                ))}
                {!reports.vendor_spend.length && !loading && (
                  <tr><td colSpan="3" className="text-muted text-center py-4">No vendor spend data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Warranty Expiring Soon</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Office</th>
                  <th>End Date</th>
                </tr>
              </thead>
              <tbody>
                {reports.warranty_soon_assets.map((row) => (
                  <tr key={`${row.asset_tag}-${row.warranty_end_date}`}>
                    <td>{row.asset_tag} - {row.asset_name}</td>
                    <td>{row.office_name || '-'}</td>
                    <td>{row.warranty_end_date || '-'}</td>
                  </tr>
                ))}
                {!reports.warranty_soon_assets.length && !loading && (
                  <tr><td colSpan="3" className="text-muted text-center py-4">No warranty alerts found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Low Stock Items</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Min</th>
                </tr>
              </thead>
              <tbody>
                {reports.low_stock_items.map((row) => (
                  <tr key={`${row.item_code}-${row.item_name}`}>
                    <td>{row.item_name}</td>
                    <td>{row.quantity_on_hand}</td>
                    <td>{row.minimum_quantity}</td>
                  </tr>
                ))}
                {!reports.low_stock_items.length && !loading && (
                  <tr><td colSpan="3" className="text-muted text-center py-4">No low stock items</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Monthly Purchase Summary</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Assets</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {reports.monthly_purchase_summary.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{row.asset_count}</td>
                    <td>{row.total_spend}</td>
                  </tr>
                ))}
                {!reports.monthly_purchase_summary.length && !loading && (
                  <tr><td colSpan="3" className="text-muted text-center py-4">No purchase data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card shadow-sm h-100">
          <div className="card-header bg-white fw-bold">Repair Cost Summary</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Repairs</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {reports.repair_cost_summary.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{row.repair_count}</td>
                    <td>{row.total_cost}</td>
                  </tr>
                ))}
                {!reports.repair_cost_summary.length && !loading && (
                  <tr><td colSpan="3" className="text-muted text-center py-4">No repair cost data found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="col-12">
        <div className="card shadow-sm">
          <div className="card-header bg-white fw-bold">Open Issues</div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Asset</th>
                  <th>Severity</th>
                  <th>Office</th>
                </tr>
              </thead>
              <tbody>
                {reports.open_issues.map((row) => (
                  <tr key={`${row.asset_tag}-${row.issue_title}`}>
                    <td>{row.issue_title}</td>
                    <td>{row.asset_tag} - {row.asset_name}</td>
                    <td>{row.severity}</td>
                    <td>{row.office_name || '-'}</td>
                  </tr>
                ))}
                {!reports.open_issues.length && !loading && (
                  <tr><td colSpan="4" className="text-muted text-center py-4">No open issues found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardTab;
