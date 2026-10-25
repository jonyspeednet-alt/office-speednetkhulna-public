import React, { useState } from 'react';
import { previewRetroactiveBandwidthCorrection, applyRetroactiveBandwidthCorrection } from '../../services/resellerService';
import { notify } from '../../utils/notify';
import { confirmAction } from '../../utils/confirm';

const BW_TYPES = [
  { label: 'NTTN Capacity', value: 'NTTN' },
  { label: 'IIG Bandwidth', value: 'IIG' },
  { label: 'BDIX Bandwidth', value: 'BDIX' },
  { label: 'CDN Bandwidth', value: 'CDN' },
  { label: 'BCDN Bandwidth', value: 'BCDN' },
  { label: 'GGC Bandwidth', value: 'GGC' },
  { label: 'FNA Bandwidth', value: 'FNA' },
];

const CORRECTION_TYPES = [
  { label: 'Bandwidth Quantity', value: 'bandwidth', icon: 'fa-tachometer-alt', color: '#3b82f6' },
  { label: 'Rate (Price/Mbps)', value: 'rate', icon: 'fa-tags', color: '#8b5cf6' },
];

const fmtTk = (n) => {
  const num = Number(n || 0);
  return `${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ৳`;
};

const emptyCorrection = () => ({
  correction_type: 'bandwidth',
  bw_type: 'NTTN',
  change_type: 'increase',
  amount: '',
  new_rate: '',
  effective_date: '',
});

const CorrectionRow = ({ item, idx, onChange, onRemove, disabled, canRemove }) => {
  const isBw = item.correction_type === 'bandwidth';
  const isRate = item.correction_type === 'rate';

  return (
    <div
      className="border rounded-3 p-3 mb-3 position-relative"
      style={{ background: isBw ? 'rgba(59,130,246,0.04)' : 'rgba(139,92,246,0.04)', borderColor: isBw ? 'rgba(59,130,246,0.25)' : 'rgba(139,92,246,0.25)' }}
    >
      {/* Row header */}
      <div className="d-flex align-items-center justify-content-between mb-2">
        <div className="d-flex align-items-center gap-2">
          <span
            className="badge rounded-pill px-2 py-1 small fw-semibold"
            style={{ background: isBw ? '#3b82f6' : '#8b5cf6', color: '#fff', fontSize: '0.72rem' }}
          >
            <i className={`fas ${isBw ? 'fa-tachometer-alt' : 'fa-tags'} me-1`} />
            {isBw ? 'Bandwidth Qty' : 'Rate Change'}
          </span>
          <span className="text-muted small">Correction #{idx + 1}</span>
        </div>
        {canRemove && (
          <button
            type="button"
            className="btn btn-sm btn-outline-danger rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: 26, height: 26, padding: 0, fontSize: '0.75rem' }}
            onClick={() => onRemove(idx)}
            disabled={disabled}
            title="Remove this correction"
          >
            <i className="fas fa-times" />
          </button>
        )}
      </div>

      <div className="row g-2">
        {/* Correction Type */}
        <div className="col-md-4">
          <label className="form-label small fw-semibold text-muted mb-1">Type</label>
          <select
            className="form-select form-select-sm shadow-none"
            value={item.correction_type}
            onChange={(e) => onChange(idx, 'correction_type', e.target.value)}
            disabled={disabled}
          >
            {CORRECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* BW Type */}
        <div className="col-md-4">
          <label className="form-label small fw-semibold text-muted mb-1">Bandwidth Type</label>
          <select
            className="form-select form-select-sm shadow-none"
            value={item.bw_type}
            onChange={(e) => onChange(idx, 'bw_type', e.target.value)}
            disabled={disabled}
          >
            {BW_TYPES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {/* Effective Date */}
        <div className="col-md-4">
          <label className="form-label small fw-semibold text-muted mb-1">Effective Date</label>
          <input
            type="date"
            className="form-control form-control-sm shadow-none"
            value={item.effective_date}
            onChange={(e) => onChange(idx, 'effective_date', e.target.value)}
            required
            disabled={disabled}
          />
        </div>

        {/* Bandwidth-specific fields */}
        {isBw && (
          <>
            <div className="col-md-6">
              <label className="form-label small fw-semibold text-muted mb-1">Action</label>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className={`btn btn-sm flex-fill rounded-pill fw-semibold ${item.change_type === 'increase' ? 'btn-success text-white' : 'btn-outline-secondary'}`}
                  onClick={() => onChange(idx, 'change_type', 'increase')}
                  disabled={disabled}
                >
                  <i className="fas fa-arrow-up me-1" /> Increase
                </button>
                <button
                  type="button"
                  className={`btn btn-sm flex-fill rounded-pill fw-semibold ${item.change_type === 'decrease' ? 'btn-danger text-white' : 'btn-outline-secondary'}`}
                  onClick={() => onChange(idx, 'change_type', 'decrease')}
                  disabled={disabled}
                >
                  <i className="fas fa-arrow-down me-1" /> Decrease
                </button>
              </div>
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-semibold text-muted mb-1">Amount (Mbps)</label>
              <input
                type="number"
                min="1"
                step="1"
                className="form-control form-control-sm shadow-none"
                placeholder="e.g. 500"
                value={item.amount}
                onChange={(e) => onChange(idx, 'amount', e.target.value)}
                required
                disabled={disabled}
              />
            </div>
          </>
        )}

        {/* Rate-specific fields */}
        {isRate && (
          <div className="col-md-6">
            <label className="form-label small fw-semibold text-muted mb-1">New Rate (৳ / Mbps / month)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="form-control form-control-sm shadow-none"
              placeholder="e.g. 800"
              value={item.new_rate}
              onChange={(e) => onChange(idx, 'new_rate', e.target.value)}
              required
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const RetroactiveCorrectionModal = ({ reseller, isOpen, onClose, onSuccess }) => {
  const [corrections, setCorrections] = useState([emptyCorrection()]);
  const [adminNote, setAdminNote] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [applying, setApplying] = useState(false);

  if (!isOpen) return null;

  const handleChangeItem = (idx, field, value) => {
    setCorrections((prev) => {
      const next = prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        // Reset type-specific fields when switching correction type
        if (field === 'correction_type') {
          updated.amount = '';
          updated.new_rate = '';
          updated.change_type = 'increase';
        }
        return updated;
      });
      return next;
    });
    setPreviewData(null);
  };

  const handleAddCorrection = () => {
    setCorrections((prev) => [...prev, emptyCorrection()]);
    setPreviewData(null);
  };

  const handleRemoveCorrection = (idx) => {
    setCorrections((prev) => prev.filter((_, i) => i !== idx));
    setPreviewData(null);
  };

  const validateAll = () => {
    for (let i = 0; i < corrections.length; i++) {
      const c = corrections[i];
      if (!c.effective_date) {
        notify.error(`Correction #${i + 1}: effective date is required`);
        return false;
      }
      if (c.correction_type === 'bandwidth') {
        if (!c.amount || Number(c.amount) <= 0) {
          notify.error(`Correction #${i + 1}: bandwidth amount must be > 0`);
          return false;
        }
      } else {
        if (c.new_rate === '' || c.new_rate === undefined || Number(c.new_rate) < 0) {
          notify.error(`Correction #${i + 1}: new rate must be ≥ 0`);
          return false;
        }
      }
    }
    return true;
  };

  const buildPayload = () => ({
    corrections: corrections.map((c) => ({
      correction_type: c.correction_type,
      bw_type: c.bw_type,
      effective_date: c.effective_date,
      ...(c.correction_type === 'bandwidth'
        ? { change_type: c.change_type, amount: Number(c.amount) }
        : { new_rate: Number(c.new_rate) }),
    })),
    admin_note: adminNote.trim(),
  });

  const handlePreview = async (e) => {
    e?.preventDefault();
    if (!validateAll()) return;
    setLoadingPreview(true);
    try {
      const res = await previewRetroactiveBandwidthCorrection(reseller.id, buildPayload());
      setPreviewData(res);
      notify.info('Impact preview calculated successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to simulate retroactive correction');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleApply = async () => {
    if (!adminNote.trim()) {
      notify.error('Admin justification note is required');
      return;
    }

    const bwCorrSummary = corrections
      .filter((c) => c.correction_type === 'bandwidth')
      .map((c) => `${c.change_type === 'increase' ? '↑' : '↓'} ${c.amount} Mbps ${c.bw_type} from ${c.effective_date}`)
      .join(', ');
    const rateCorrSummary = corrections
      .filter((c) => c.correction_type === 'rate')
      .map((c) => `${c.bw_type} rate → ${c.new_rate}৳ from ${c.effective_date}`)
      .join(', ');
    const summary = [bwCorrSummary, rateCorrSummary].filter(Boolean).join(' | ');

    const confirmed = await confirmAction({
      title: 'Apply Retroactive Correction?',
      text: `Apply: ${summary}. This will permanently recalculate ${previewData?.affected_finalized_count || 0} finalized bill(s) and synchronize all ledger dues.`,
      confirmText: 'Yes, Apply & Recalculate',
      danger: true,
    });

    if (!confirmed) return;

    setApplying(true);
    try {
      const res = await applyRetroactiveBandwidthCorrection(reseller.id, buildPayload());
      notify.success(res.message || 'Correction applied successfully!');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to apply retroactive correction');
    } finally {
      setApplying(false);
    }
  };

  const bwCount = corrections.filter((c) => c.correction_type === 'bandwidth').length;
  const rateCount = corrections.filter((c) => c.correction_type === 'rate').length;

  return (
    <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(15,23,42,0.65)', zIndex: 1060 }}>
      <div className="modal-dialog modal-dialog-centered modal-xl">
        <div className="modal-content shadow-lg border-0 rounded-4 overflow-hidden">

          {/* Header */}
          <div className="modal-header border-bottom border-secondary border-opacity-25 py-3 px-4" style={{ background: '#0f172a' }}>
            <div className="d-flex align-items-center gap-3">
              <div className="p-2 rounded-3 d-flex align-items-center justify-content-center" style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', width: 38, height: 38 }}>
                <i className="fas fa-history fs-5 text-white" />
              </div>
              <div>
                <h5 className="modal-title fw-bold m-0 text-white" style={{ fontSize: '1.05rem' }}>
                  Retroactive Correction
                </h5>
                <div className="small" style={{ color: '#94a3b8' }}>
                  Reseller:{' '}
                  <span className="text-white fw-semibold">
                    {reseller?.name || reseller?.reseller_name || reseller?.company_name || `#${reseller?.id}`}
                  </span>
                  <span className="badge bg-secondary ms-2">ID: {reseller?.id}</span>
                  {bwCount > 0 && <span className="badge ms-1" style={{ background: '#3b82f6' }}>{bwCount} BW</span>}
                  {rateCount > 0 && <span className="badge ms-1" style={{ background: '#8b5cf6' }}>{rateCount} Rate</span>}
                </div>
              </div>
            </div>
            <button type="button" className="btn-close btn-close-white shadow-none" onClick={onClose} disabled={applying} />
          </div>

          <div className="modal-body p-4" style={{ maxHeight: '78vh', overflowY: 'auto' }}>

            {/* Corrections list */}
            <form onSubmit={handlePreview}>
              <div className="d-flex align-items-center justify-content-between mb-3">
                <div>
                  <span className="fw-semibold text-dark" style={{ fontSize: '0.9rem' }}>
                    <i className="fas fa-list-ul me-1 text-primary" /> Corrections
                  </span>
                  <span className="text-muted small ms-2">
                    ({corrections.length} item{corrections.length !== 1 ? 's' : ''})
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm rounded-pill px-3"
                  onClick={handleAddCorrection}
                  disabled={applying}
                >
                  <i className="fas fa-plus me-1" /> Add Correction
                </button>
              </div>

              {corrections.map((item, idx) => (
                <CorrectionRow
                  key={idx}
                  item={item}
                  idx={idx}
                  onChange={handleChangeItem}
                  onRemove={handleRemoveCorrection}
                  disabled={applying}
                  canRemove={corrections.length > 1}
                />
              ))}

              <div className="d-flex justify-content-end mt-1">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm rounded-pill px-4 shadow-sm"
                  disabled={loadingPreview || applying}
                >
                  {loadingPreview ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" />
                      Calculating Impact...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-calculator me-1" />
                      Preview Financial Impact
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Impact Preview Section */}
            {previewData && (
              <div className="mt-4 pt-3 border-top">
                {/* Summary Bar */}
                <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                  <h6 className="fw-bold m-0 text-dark">
                    <i className="fas fa-chart-line me-1 text-primary" />
                    Cascading Impact Timeline
                  </h6>
                  <div className="d-flex gap-2 flex-wrap">
                    <span className="badge rounded-pill px-3 py-1" style={{ background: '#3b82f620', color: '#3b82f6', border: '1px solid #3b82f640' }}>
                      {previewData.affected_finalized_count} Bill(s) Affected
                    </span>
                    <span className={`badge rounded-pill px-3 py-1 ${previewData.total_financial_delta >= 0 ? 'bg-danger bg-opacity-10 text-danger' : 'bg-success bg-opacity-10 text-success'}`}
                      style={{ border: `1px solid ${previewData.total_financial_delta >= 0 ? '#ef444440' : '#22c55e40'}` }}>
                      Net Δ {previewData.total_financial_delta >= 0 ? '+' : ''}{fmtTk(previewData.total_financial_delta)}
                    </span>
                  </div>
                </div>

                {/* Correction summary chips */}
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {(previewData.corrections || []).map((c, i) => (
                    <span key={i} className="badge rounded-pill py-1 px-3 small" style={{ background: c.correction_type === 'rate' ? '#8b5cf620' : '#3b82f620', color: c.correction_type === 'rate' ? '#7c3aed' : '#2563eb', border: `1px solid ${c.correction_type === 'rate' ? '#8b5cf640' : '#3b82f640'}`, fontWeight: 500 }}>
                      {c.correction_type === 'bandwidth'
                        ? `${c.change_type === 'increase' ? '↑' : '↓'} ${c.amount} Mbps ${c.bw_type} (from ${c.effective_date})`
                        : `${c.bw_type} rate → ${fmtTk(c.new_rate)} (from ${c.effective_date})`}
                    </span>
                  ))}
                </div>

                {/* Timeline table */}
                <div className="table-responsive rounded-3 border mb-3">
                  <table className="table table-sm table-hover align-middle mb-0 text-center" style={{ fontSize: '0.81rem' }}>
                    <thead className="table-light text-muted">
                      <tr>
                        <th className="py-2 text-start ps-3">Month</th>
                        <th className="py-2">Old Bill</th>
                        <th className="py-2">New Bill</th>
                        <th className="py-2">Old Prev Due</th>
                        <th className="py-2">New Prev Due</th>
                        <th className="py-2">Old Closing Due</th>
                        <th className="py-2 text-end pe-3">New Closing Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.timeline?.map((row) => {
                        const billDiff = row.new_amount - row.old_amount;
                        return (
                          <tr key={row.month}>
                            <td className="text-start ps-3 fw-bold text-dark">{row.month}</td>
                            <td className="text-muted">{fmtTk(row.old_amount)}</td>
                            <td className={`fw-semibold ${billDiff > 0 ? 'text-danger' : billDiff < 0 ? 'text-success' : 'text-muted'}`}>
                              {fmtTk(row.new_amount)}
                              {billDiff !== 0 && (
                                <span className="ms-1 small opacity-75">
                                  ({billDiff > 0 ? '+' : ''}{fmtTk(billDiff)})
                                </span>
                              )}
                            </td>
                            <td className="text-muted">{fmtTk(row.old_previous_due)}</td>
                            <td className="fw-semibold">{fmtTk(row.new_previous_due)}</td>
                            <td className="text-muted">{fmtTk(row.old_closing_due)}</td>
                            <td className={`text-end pe-3 fw-bold ${row.new_closing_due > row.old_closing_due ? 'text-danger' : row.new_closing_due < row.old_closing_due ? 'text-success' : 'text-dark'}`}>
                              {fmtTk(row.new_closing_due)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Projected current month */}
                {previewData.projected_month && (
                  <div className="alert border rounded-3 p-3 mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2"
                    style={{ background: '#fefce8', borderColor: '#fde047 !important' }}>
                    <div>
                      <span className="badge bg-warning text-dark me-2">
                        Current Month ({previewData.projected_month.month})
                      </span>
                      <small className="text-muted">Will inherit updated Previous Due:</small>{' '}
                      <strong>{fmtTk(previewData.projected_month.new_previous_due)}</strong>
                    </div>
                    <div className="text-end">
                      <small className="text-muted">New Projected Total:</small>{' '}
                      <strong className="text-primary">{fmtTk(previewData.projected_month.new_projected_total)}</strong>
                    </div>
                  </div>
                )}

                {/* Admin justification */}
                <div className="rounded-3 border p-3 mb-2" style={{ background: '#f8fafc' }}>
                  <label className="form-label small fw-bold text-dark d-flex justify-content-between mb-2">
                    <span><i className="fas fa-sticky-note me-1 text-warning" /> Admin Justification (Mandatory)</span>
                    <span className="text-danger small">* Required for Audit Trail</span>
                  </label>
                  <textarea
                    className="form-control form-control-sm"
                    rows="2"
                    placeholder="e.g. Approved NTTN upgrade from 12 Aug 2026 was missed in portal entries. Rate correction for Sep per agreement."
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    disabled={applying}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer px-4 py-2 border-top d-flex justify-content-between" style={{ background: '#f8fafc' }}>
            <button type="button" className="btn btn-outline-secondary btn-sm rounded-pill px-3" onClick={onClose} disabled={applying}>
              Cancel
            </button>
            {previewData && (
              <button
                type="button"
                className="btn btn-sm rounded-pill px-4 shadow-sm text-white fw-semibold"
                style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}
                onClick={handleApply}
                disabled={applying || !adminNote.trim()}
              >
                {applying ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-1" />
                    Recalculating & Synchronizing...
                  </>
                ) : (
                  <>
                    <i className="fas fa-check-circle me-1" />
                    Confirm & Recalculate {previewData.affected_finalized_count} Bill(s)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RetroactiveCorrectionModal;
