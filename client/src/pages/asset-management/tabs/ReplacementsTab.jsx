import React from 'react';
import { inputClass } from '../constants';

const ReplacementsTab = ({ replacementForm, setReplacementForm, submitReplacement, assetOptions, replacements, loading }) => (
  <div className="row g-4">
    <div className="col-lg-4">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Replacement Entry</div>
        <div className="card-body">
          <form className="d-grid gap-3" onSubmit={submitReplacement}>
            <select className={inputClass} value={replacementForm.old_asset_id} onChange={(e) => setReplacementForm((prev) => ({ ...prev, old_asset_id: e.target.value }))}>
              <option value="">Old asset</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} - {asset.asset_name}</option>)}
            </select>
            <select className={inputClass} value={replacementForm.new_asset_id} onChange={(e) => setReplacementForm((prev) => ({ ...prev, new_asset_id: e.target.value }))}>
              <option value="">New asset (optional)</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} - {asset.asset_name}</option>)}
            </select>
            <textarea className={inputClass} rows="3" placeholder="Replacement reason" value={replacementForm.replacement_reason} onChange={(e) => setReplacementForm((prev) => ({ ...prev, replacement_reason: e.target.value }))} />
            <input className={inputClass} placeholder="Disposal method" value={replacementForm.disposal_method} onChange={(e) => setReplacementForm((prev) => ({ ...prev, disposal_method: e.target.value }))} />
            <textarea className={inputClass} rows="2" placeholder="Notes" value={replacementForm.notes} onChange={(e) => setReplacementForm((prev) => ({ ...prev, notes: e.target.value }))} />
            <button className="btn btn-primary" type="submit">Save Replacement</button>
          </form>
        </div>
      </div>
    </div>
    <div className="col-lg-8">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Replacement History</span>
          <span className="text-muted small">{replacements.length} records</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Old Asset</th>
                <th>New Asset</th>
                <th>Reason</th>
                <th>Disposal</th>
              </tr>
            </thead>
            <tbody>
              {replacements.map((replacement) => (
                <tr key={replacement.id}>
                  <td>
                    <div className="fw-semibold">{replacement.old_asset_name}</div>
                    <div className="small text-muted">{replacement.old_asset_tag}</div>
                  </td>
                  <td>
                    <div>{replacement.new_asset_name || '-'}</div>
                    <div className="small text-muted">{replacement.new_asset_tag || '-'}</div>
                  </td>
                  <td>{replacement.replacement_reason}</td>
                  <td>{replacement.disposal_method || '-'}</td>
                </tr>
              ))}
              {!replacements.length && !loading && (
                <tr><td colSpan="4" className="text-muted text-center py-4">No replacements found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

export default ReplacementsTab;
