import React from 'react';
import { inputClass, SEVERITY_TONES, ISSUE_STATUS_TONES } from '../constants';
import { toneBadge, toneFor, formatStatusLabel } from '../utils';

const IssuesTab = ({ issueForm, setIssueForm, submitIssue, assetOptions, masters, issues, issueComplete, loading }) => (
  <div className="row g-4">
    <div className="col-lg-4">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Report Issue</div>
        <div className="card-body">
          <form className="d-grid gap-3" onSubmit={submitIssue}>
            <select className={inputClass} value={issueForm.asset_id} onChange={(e) => setIssueForm((prev) => ({ ...prev, asset_id: e.target.value }))}>
              <option value="">Select asset</option>
              {assetOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_tag} - {asset.asset_name}</option>)}
            </select>
            <select className={inputClass} value={issueForm.office_id} onChange={(e) => setIssueForm((prev) => ({ ...prev, office_id: e.target.value }))}>
              <option value="">Office</option>
              {masters.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
            </select>
            <select className={inputClass} value={issueForm.desk_id} onChange={(e) => setIssueForm((prev) => ({ ...prev, desk_id: e.target.value }))}>
              <option value="">Desk</option>
              {masters.desks.map((desk) => <option key={desk.id} value={desk.id}>Desk {desk.desk_no} - {desk.office_name}</option>)}
            </select>
            <input className={inputClass} placeholder="Issue title" value={issueForm.issue_title} onChange={(e) => setIssueForm((prev) => ({ ...prev, issue_title: e.target.value }))} />
            <textarea className={inputClass} rows="3" placeholder="Issue description" value={issueForm.issue_description} onChange={(e) => setIssueForm((prev) => ({ ...prev, issue_description: e.target.value }))} />
            <select className={inputClass} value={issueForm.severity} onChange={(e) => setIssueForm((prev) => ({ ...prev, severity: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <label className="form-check d-flex align-items-center gap-2">
              <input className="form-check-input" type="checkbox" checked={issueForm.warranty_claimed} onChange={(e) => setIssueForm((prev) => ({ ...prev, warranty_claimed: e.target.checked }))} />
              <span className="form-check-label">Warranty claim required</span>
            </label>
            <button className="btn btn-primary" type="submit">Save Issue</button>
          </form>
        </div>
      </div>
    </div>
    <div className="col-lg-8">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Issue Log</span>
          <span className="text-muted small">{issues.length} records</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Asset</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Claim</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <div className="fw-semibold">{issue.issue_title}</div>
                    <div className="small text-muted">{issue.issue_description || '-'}</div>
                  </td>
                  <td>
                    <div>{issue.asset_name}</div>
                    <div className="small text-muted">{issue.asset_tag}</div>
                  </td>
                  <td><span className={toneBadge(toneFor(SEVERITY_TONES, issue.severity))}>{formatStatusLabel(issue.severity)}</span></td>
                  <td><span className={toneBadge(toneFor(ISSUE_STATUS_TONES, issue.status))}>{formatStatusLabel(issue.status)}</span></td>
                  <td>{issue.warranty_claimed ? 'Yes' : 'No'}</td>
                  <td>
                    {issue.status !== 'resolved' ? (
                      <button className="btn btn-sm btn-outline-success" onClick={() => issueComplete(issue)}>Mark resolved</button>
                    ) : (
                      <span className="text-success small">Resolved</span>
                    )}
                  </td>
                </tr>
              ))}
              {!issues.length && !loading && (
                <tr><td colSpan="6" className="text-muted text-center py-4">No issues found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

export default IssuesTab;
