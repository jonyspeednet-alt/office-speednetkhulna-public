import React from 'react';
import { ASSET_STATUS_TONES, CONDITION_TONES } from '../constants';
import { toneBadge, toneFor, formatStatusLabel, getWarrantyMeta } from '../utils';

const AssetsTab = ({
  masters,
  assets,
  filteredAssets,
  filteredAssetSummary,
  assetOfficeFilter,
  setAssetOfficeFilter,
  assetCategoryFilter,
  setAssetCategoryFilter,
  assetStatusFilter,
  setAssetStatusFilter,
  assetStatusOptions,
  openAddAsset,
  openAssetEdit,
  loading
}) => (
  <div className="card shadow-sm">
    <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
      <div>
        <div>Assets</div>
        <div className="text-muted small">Use Add Asset to register new devices with office/desk assignment.</div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <span className="text-muted small">{filteredAssets.length} / {assets.length} records</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={openAddAsset}>
          Add Asset
        </button>
      </div>
    </div>
    <div className="card-body border-bottom bg-light-subtle">
      <div className="row g-3 align-items-end">
        <div className="col-md-3">
          <label className="form-label small text-muted">Office</label>
          <select className="form-select" value={assetOfficeFilter} onChange={(e) => setAssetOfficeFilter(e.target.value)}>
            <option value="all">All offices</option>
            {masters.offices.map((office) => (
              <option key={office.id} value={office.id}>{office.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label small text-muted">Category</label>
          <select className="form-select" value={assetCategoryFilter} onChange={(e) => setAssetCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {masters.categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label small text-muted">Status</label>
          <select className="form-select" value={assetStatusFilter} onChange={(e) => setAssetStatusFilter(e.target.value)}>
            <option value="all">All status</option>
            {assetStatusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <div className="asset-inline-stats">
            <span><strong>{filteredAssetSummary.active}</strong> active</span>
            <span><strong>{filteredAssetSummary.assigned}</strong> assigned</span>
            <span><strong>{filteredAssetSummary.warrantySoon}</strong> expiring</span>
          </div>
        </div>
      </div>
    </div>
    <div className="table-responsive">
      <table className="table align-middle mb-0">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Category</th>
            <th>Components</th>
            <th>Location</th>
            <th>Vendor</th>
            <th>Warranty</th>
            <th>Status</th>
            <th>Condition</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredAssets.map((asset) => {
            const warrantyMeta = getWarrantyMeta(asset.warranty_end_date);
            return (
              <tr key={asset.id} className="asset-row" onClick={() => openAssetEdit(asset)} role="button">
                <td>
                  <div className="fw-bold">{asset.asset_name}</div>
                  <div className="small text-muted">{asset.asset_tag} {asset.serial_number ? `- ${asset.serial_number}` : ''}</div>
                  <div className="small text-muted">{asset.brand || '-'} {asset.model ? `- ${asset.model}` : ''}</div>
                </td>
                <td>{asset.category_name || '-'}</td>
                <td>
                  <span className="badge bg-primary-subtle text-primary-emphasis">{asset.component_count || 0}</span>
                </td>
                <td>
                  <div>{asset.office_name || '-'}</div>
                  <div className="small text-muted">{asset.desk_no ? `Desk ${asset.desk_no}` : '-'}</div>
                  {asset.desk_label && <div className="small text-info">{asset.desk_label}</div>}
                </td>
                <td>{asset.vendor_name || '-'}</td>
                <td>
                  <div>{asset.warranty_end_date || '-'}</div>
                  {warrantyMeta ? (
                    <span className={toneBadge(warrantyMeta.tone)}>{warrantyMeta.label}</span>
                  ) : (
                    <div className="small text-muted">{asset.warranty_type || '-'}</div>
                  )}
                </td>
                <td><span className={toneBadge(toneFor(ASSET_STATUS_TONES, asset.status))}>{formatStatusLabel(asset.status)}</span></td>
                <td><span className={toneBadge(toneFor(CONDITION_TONES, asset.condition))}>{formatStatusLabel(asset.condition)}</span></td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={(event) => {
                      event.stopPropagation();
                      openAssetEdit(asset);
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
          {!filteredAssets.length && !loading && (
            <tr>
              <td colSpan="9" className="text-muted text-center py-4">No assets found</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default AssetsTab;
