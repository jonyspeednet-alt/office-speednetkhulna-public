import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getResellers, submitBandwidthRequest } from '../services/resellerService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const bwTypes = [
  ['IIG', 'iig_bw'],
  ['BDIX', 'bdix_bw'],
  ['GGC', 'ggc_bw'],
  ['FNA', 'fna_bw'],
  ['CDN', 'cdn_bw'],
  ['Other', 'bcdn_bw'],
  ['NTTN', 'nttn_capacity']
];

const RequestBw = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [resellers, setResellers] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get('reseller_id') || '');
  const [bwData, setBwData] = useState(() => Object.fromEntries(bwTypes.map(([name]) => [name, { action: '', amount: '' }])));
  const [effectiveDate, setEffectiveDate] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getResellers('').then((d) => setResellers(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    const q = searchParams.get('reseller_id') || '';
    if (q && q !== selectedId) setSelectedId(q);
  }, [searchParams, selectedId]);

  const selected = useMemo(
    () => resellers.find((r) => String(r.id) === String(selectedId)),
    [resellers, selectedId]
  );

  const totalBwNoNttn = useMemo(() => {
    if (!selected) return 0;
    return Number(selected.iig_bw || 0) + Number(selected.bdix_bw || 0) + Number(selected.ggc_bw || 0) + Number(selected.fna_bw || 0) + Number(selected.cdn_bw || 0) + Number(selected.bcdn_bw || 0);
  }, [selected]);

  const onResellerChange = (id) => {
    setSelectedId(id);
    if (id) setSearchParams({ reseller_id: id });
    else setSearchParams({});
  };

  const setRow = (type, key, value) => {
    setBwData((prev) => ({ ...prev, [type]: { ...prev[type], [key]: value } }));
  };

  const resetForm = () => {
    setBwData(Object.fromEntries(bwTypes.map(([name]) => [name, { action: '', amount: '' }])));
    setEffectiveDate('');
    setAdminNote('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedId) {
      notify.error('Select a reseller.');
      return;
    }
    const filled = Object.entries(bwData).filter(([, v]) => v.action && Number(v.amount) > 0);
    if (filled.length === 0) { notify.error('Select at least one bandwidth change'); return; }
    const summary = filled.map(([k, v]) => `${k}: ${v.action === 'increase' ? '+' : '-'}${v.amount}M`).join(', ');
    if (!(await confirmAction({ title: `Submit request?`, text: `${selected?.name || ''} — ${summary} (${filled.length})`, danger: false }))) return;
    setSubmitting(true);
    try {
      const resp = await submitBandwidthRequest({ reseller_id: selectedId, bw_data: bwData, effective_date: effectiveDate || undefined, admin_note: adminNote });
      const count = Number(resp?.count || 0);
      if (count > 0) {
        notify.success(`Successfully submitted ${count} bandwidth request(s).`);
        resetForm();
      } else {
        notify.error('No valid requests found.');
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to submit request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container py-4 reseller-page">
      <style>{`
        .current-bw-box { background:#fff; border-radius:12px; border-left:5px solid #0d6efd; transition:.3s; }
        .current-bw-box:hover { transform: translateY(-3px); }
        .request-form-card { border-radius:15px; border:none; box-shadow:0 5px 20px rgba(0,0,0,.05); }
      `}</style>

      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h3 className="fw-bold mb-0">Bandwidth Change Request</h3>
          <p className="text-muted mb-0">{selected ? `${selected.name || ''} (${selected.company_name || ''})` : 'Select a reseller'}</p>
        </div>
        <Link to="/reseller-list" className="btn btn-outline-dark btn-sm"><i className="fas fa-arrow-left me-1" /> View List</Link>
      </div>

      <div className="mb-3">
        <label className="form-label fw-bold">Select Reseller</label>
        <select className="form-select" value={selectedId} onChange={(e) => onResellerChange(e.target.value)}>
          <option value="">-- Select reseller --</option>
          {resellers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.company_name || '-'})</option>)}
        </select>
      </div>

      <div className="row">
        <div className="col-lg-4 mb-4">
          <div className="card border-0 shadow-sm rounded-4 p-4 h-100 current-bw-box">
            <h5 className="fw-bold text-secondary mb-3">Bandwidth Summary</h5>
            <div className="text-center py-4 bg-light rounded-3 mb-3 border border-primary border-opacity-25">
              <small className="text-muted d-block fw-bold mb-1">Total Bandwidth</small>
              <h1 className="fw-bold text-primary m-0">{totalBwNoNttn}</h1>
              <span className="badge bg-primary bg-opacity-10 text-primary">Mbps</span>
            </div>
            <p className="text-muted small text-center mb-0">This total includes IIG, BDIX, GGC, FNA, CDN, and Other.</p>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card request-form-card p-4">
            <h5 className="fw-bold mb-4">Request Details</h5>
            <form onSubmit={submit}>
              <div className="table-responsive mb-3">
                <table className="table table-bordered align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>Type</th>
                      <th>Current</th>
                      <th style={{ width: '35%' }}>Action</th>
                      <th>Amount (Mbps)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bwTypes.map(([name, col]) => (
                      <tr key={name}>
                        <td className="fw-bold">{name}</td>
                        <td><span className="badge bg-secondary">{selected ? Number(selected[col] || 0) : 0}</span></td>
                        <td>
                          <select className="form-select form-select-sm" value={bwData[name].action} onChange={(e) => setRow(name, 'action', e.target.value)}>
                            <option value="">-- Select --</option>
                            <option value="increase">Increase</option>
                            <option value="decrease">Decrease</option>
                          </select>
                        </td>
                        <td>
                          <input type="number" min="1" className="form-control form-control-sm" placeholder="0" value={bwData[name].amount} onChange={(e) => setRow(name, 'amount', e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mb-3">
                <label className="form-label fw-bold">Effective Date (optional)</label>
                <input type="date" className="form-control" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                <small className="text-muted">If not set, it takes effect from the application date.</small>
              </div>
              <div className="mb-4">
                <label className="form-label fw-bold">Admin Note (optional)</label>
                <textarea className="form-control" rows={2} placeholder="Write any special note for these requests..." value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
              </div>

              <div className="text-end">
                <button type="submit" className="btn btn-primary px-5 shadow" disabled={submitting || !selectedId}>
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestBw;
