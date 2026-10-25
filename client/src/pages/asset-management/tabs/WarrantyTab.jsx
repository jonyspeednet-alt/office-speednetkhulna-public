import React from 'react';
import { inputClass, WARRANTY_STATUS_TONES } from '../constants';
import { toneBadge, toneFor, formatStatusLabel } from '../utils';

const WarrantyTab = ({ warrantyForm, setWarrantyForm, submitWarranty, assetOptions, masters, warranties, loading }) => (
  <div className="row g-4">
    <div className="col-lg-4">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Add / Update Warranty</div>
        <div className="card-body">
          <form className="d-grid gap-3" onSubmit={submitWarranty}>
            <select className={inputClass} value={warrantyForm.asset_id} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, asset_id: e.target.value }))}>
              <option value="">Select asset</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} - {asset.asset_name}</option>)}
            </select>
            <select className={inputClass} value={warrantyForm.vendor_id} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, vendor_id: e.target.value }))}>
              <option value="">Vendor</option>
              {masters.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <input className={inputClass} placeholder="Warranty type" value={warrantyForm.warranty_type} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, warranty_type: e.target.value }))} />
            <input className={inputClass} type="date" value={warrantyForm.warranty_start_date} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, warranty_start_date: e.target.value }))} />
            <input className={inputClass} type="date" value={warrantyForm.warranty_end_date} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, warranty_end_date: e.target.value }))} />
            <textarea className={inputClass} rows="3" placeholder="Coverage notes" value={warrantyForm.coverage_notes} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, coverage_notes: e.target.value }))} />
            <textarea className={inputClass} rows="2" placeholder="Notes" value={warrantyForm.notes} onChange={(e) => setWarrantyForm((prev) => ({ ...prev, notes: e.target.value }))} />
            <button className="btn btn-primary" type="submit">Save Warranty</button>
          </form>
        </div>
      </div>
    </div>
    <div className="col-lg-8">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Warranty Tracker</span>
          <span className="text-muted small">{warranties.length} records</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Office</th>
                <th>End Date</th>
                <th>Status</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {warranties.map((warranty) => (
                <tr key={warranty.id}>
                  <td>
                    <div className="fw-semibold">{warranty.asset_name}</div>
                    <div className="small text-muted">{warranty.asset_tag}</div>
                  </td>
                  <td>{warranty.office_name || '-'}</td>
                  <td>{warranty.warranty_end_date || '-'}</td>
                  <td><span className={toneBadge(toneFor(WARRANTY_STATUS_TONES, warranty.computed_status))}>{formatStatusLabel(warranty.computed_status)}</span></td>
                  <td>{warranty.claim_count}</td>
                </tr>
              ))}
              {!warranties.length && !loading && (
                <tr><td colSpan="5" className="text-muted text-center py-4">No warranty records found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

export default WarrantyTab;
