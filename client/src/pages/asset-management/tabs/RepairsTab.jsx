import React from 'react';
import { inputClass } from '../constants';

const RepairsTab = ({ repairForm, setRepairForm, submitRepair, assetOptions, issues, masters, repairs, loading }) => (
  <div className="row g-4">
    <div className="col-lg-4">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Add Repair Log</div>
        <div className="card-body">
          <form className="d-grid gap-3" onSubmit={submitRepair}>
            <select className={inputClass} value={repairForm.asset_id} onChange={(e) => setRepairForm((prev) => ({ ...prev, asset_id: e.target.value }))}>
              <option value="">Select asset</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} - {asset.asset_name}</option>)}
            </select>
            <select className={inputClass} value={repairForm.issue_id} onChange={(e) => setRepairForm((prev) => ({ ...prev, issue_id: e.target.value }))}>
              <option value="">Issue (optional)</option>
              {issues.map((issue) => <option key={issue.id} value={issue.id}>#{issue.id} - {issue.issue_title}</option>)}
            </select>
            <select className={inputClass} value={repairForm.vendor_id} onChange={(e) => setRepairForm((prev) => ({ ...prev, vendor_id: e.target.value }))}>
              <option value="">Vendor</option>
              {masters.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <input className={inputClass} placeholder="Technician name" value={repairForm.technician_name} onChange={(e) => setRepairForm((prev) => ({ ...prev, technician_name: e.target.value }))} />
            <textarea className={inputClass} rows="3" placeholder="Repair action" value={repairForm.repair_action} onChange={(e) => setRepairForm((prev) => ({ ...prev, repair_action: e.target.value }))} />
            <textarea className={inputClass} rows="2" placeholder="Parts used" value={repairForm.parts_used} onChange={(e) => setRepairForm((prev) => ({ ...prev, parts_used: e.target.value }))} />
            <input className={inputClass} type="number" step="0.01" placeholder="Repair cost" value={repairForm.repair_cost} onChange={(e) => setRepairForm((prev) => ({ ...prev, repair_cost: e.target.value }))} />
            <input className={inputClass} type="datetime-local" value={repairForm.started_at} onChange={(e) => setRepairForm((prev) => ({ ...prev, started_at: e.target.value }))} />
            <input className={inputClass} type="datetime-local" value={repairForm.completed_at} onChange={(e) => setRepairForm((prev) => ({ ...prev, completed_at: e.target.value }))} />
            <input className={inputClass} placeholder="Outcome" value={repairForm.outcome} onChange={(e) => setRepairForm((prev) => ({ ...prev, outcome: e.target.value }))} />
            <textarea className={inputClass} rows="2" placeholder="Notes" value={repairForm.notes} onChange={(e) => setRepairForm((prev) => ({ ...prev, notes: e.target.value }))} />
            <button className="btn btn-primary" type="submit">Save Repair</button>
          </form>
        </div>
      </div>
    </div>
    <div className="col-lg-8">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Repair History</span>
          <span className="text-muted small">{repairs.length} records</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Repair Action</th>
                <th>Vendor</th>
                <th>Cost</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {repairs.map((repair) => (
                <tr key={repair.id}>
                  <td>
                    <div className="fw-semibold">{repair.asset_name}</div>
                    <div className="small text-muted">{repair.asset_tag}</div>
                  </td>
                  <td>
                    <div>{repair.repair_action}</div>
                    <div className="small text-muted">{repair.parts_used || '-'}</div>
                  </td>
                  <td>{repair.vendor_name || '-'}</td>
                  <td>{repair.repair_cost}</td>
                  <td>{repair.outcome || '-'}</td>
                </tr>
              ))}
              {!repairs.length && !loading && (
                <tr><td colSpan="5" className="text-muted text-center py-4">No repair logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

export default RepairsTab;
