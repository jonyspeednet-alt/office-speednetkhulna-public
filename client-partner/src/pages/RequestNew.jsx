import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { fmt } from '../utils/format.js';
import Modal from '../components/Modal.jsx';

const ROWS = [
  { label: 'IIG', bw: 'iig_bw', rate: 'rate_iig' },
  { label: 'BDIX', bw: 'bdix_bw', rate: 'rate_bdix' },
  { label: 'GGC', bw: 'ggc_bw', rate: 'rate_ggc' },
  { label: 'FNA', bw: 'fna_bw', rate: 'rate_fna' },
  { label: 'CDN', bw: 'cdn_bw', rate: 'rate_cdn' },
  { label: 'Other', bw: 'bcdn_bw', rate: 'rate_bcdn' },
  { label: 'NTTN', bw: 'nttn_capacity', rate: 'rate_nttn' },
];

const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function RequestNew() {
  const navigate = useNavigate();
  const [reseller, setReseller] = useState(null);
  const [form, setForm] = useState({}); // { IIG: {action, amount} }
  const [effectiveDate, setEffectiveDate] = useState('');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState(null); // {type, msg}
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/dashboard').then((r) => setReseller(r.data.reseller));
  }, []);

  const hasDowngrade = useMemo(
    () => Object.values(form).some((v) => v?.action === 'decrease' && Number(v.amount) > 0),
    [form],
  );
  const minDate = hasDowngrade ? todayPlus(30) : todayPlus(0);

  const setRow = (label, patch) =>
    setForm((f) => ({ ...f, [label]: { ...f[label], ...patch } }));

  const valid = Object.entries(form)
    .filter(([, v]) => v?.action && Number(v.amount) > 0)
    .map(([label, v]) => ({ label, ...v }));

  const costImpact = valid.reduce((sum, v) => {
    const row = ROWS.find((r) => r.label === v.label);
    const rate = reseller?.[row.rate] || 0;
    const cost = Number(v.amount) * rate;
    return sum + (v.action === 'increase' ? cost : -cost);
  }, 0);

  const openConfirm = () => {
    setAlert(null);
    if (valid.length === 0) {
      setAlert({ type: 'warning', msg: 'অনুগ্রহ করে অন্তত একটি রিকোয়েস্টের পরিমাণ উল্লেখ করুন।' });
      return;
    }
    if (!effectiveDate) {
      setAlert({ type: 'warning', msg: 'কার্যকর হওয়ার তারিখ নির্বাচন করুন।' });
      return;
    }
    if (hasDowngrade && effectiveDate < todayPlus(30)) {
      setAlert({ type: 'danger', msg: 'ডাউনগ্রেডের জন্য কমপক্ষে ৩০ দিন নোটিশ পিরিয়ড প্রয়োজন।' });
      return;
    }
    setConfirm(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        effective_date: effectiveDate,
        reseller_note: note,
        requests: valid.map((v) => ({ bw_type: v.label, action: v.action, amount: Number(v.amount) })),
      };
      const { data } = await api.post('/requests', payload);
      setConfirm(false);
      setForm({});
      setNote('');
      setEffectiveDate('');
      setAlert({ type: 'success', msg: data.message });
    } catch (e) {
      setConfirm(false);
      setAlert({ type: 'danger', msg: e?.response?.data?.message || 'রিকোয়েস্ট পাঠাতে সমস্যা হয়েছে।' });
    } finally {
      setBusy(false);
    }
  };

  if (!reseller)
    return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <>
      <div className="mb-4">
        <h4 className="fw-bold m-0">ব্যান্ডউইথ রিকোয়েস্ট</h4>
        <p className="text-muted small m-0 mt-1">আপনার প্যাকেজ আপগ্রেড বা ডাউনগ্রেড করতে আবেদন করুন</p>
      </div>

      {alert && <div className={`alert alert-${alert.type} shadow-sm`}>{alert.msg}</div>}

      <div className="card-custom">
        <h5 className="fw-bold mb-4">নতুন রিকোয়েস্ট ফরম</h5>
        <div className="table-responsive mb-3">
          <table className="table table-hover align-middle">
            <thead className="table-light small text-uppercase text-muted">
              <tr>
                <th style={{ width: '35%' }}>প্যাকেজ ও রেট</th>
                <th style={{ width: '15%' }}>বর্তমান</th>
                <th style={{ width: '25%' }}>অ্যাকশন</th>
                <th style={{ width: '25%' }}>পরিমাণ (Mbps)</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td>
                    <div className="fw-bold">{row.label}</div>
                    <div className="small text-muted" style={{ fontSize: 11 }}>{reseller[row.rate]} ৳ / Mbps</div>
                  </td>
                  <td><span className="badge bg-light text-dark border fw-bold">{reseller[row.bw]}</span></td>
                  <td>
                    <select
                      className="form-select form-select-sm"
                      value={form[row.label]?.action || ''}
                      onChange={(e) => setRow(row.label, { action: e.target.value })}
                    >
                      <option value="">-- সিলেক্ট --</option>
                      <option value="increase">আপগ্রেড (Upgrade)</option>
                      <option value="decrease">ডাউনগ্রেড (Downgrade)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      className="form-control form-control-sm"
                      placeholder="0"
                      value={form[row.label]?.amount || ''}
                      onChange={(e) => setRow(row.label, { amount: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label fw-bold">কার্যকর হওয়ার তারিখ</label>
            <input
              type="date"
              className="form-control"
              min={minDate}
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <small className={`d-block mt-1 ${hasDowngrade ? 'text-danger' : 'text-muted'}`} style={{ fontSize: 11 }}>
              {hasDowngrade ? 'ডাউনগ্রেডের জন্য কমপক্ষে ৩০ দিন নোটিশ পিরিয়ড প্রযোজ্য' : 'যেকোনো ভবিষ্যৎ তারিখ নির্বাচন করতে পারেন'}
            </small>
          </div>
          <div className="col-md-6 mb-3">
            <label className="form-label fw-bold">অতিরিক্ত নোট (ঐচ্ছিক)</label>
            <textarea className="form-control" rows="1" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="text-end">
          <button className="btn btn-primary px-4 py-2 rounded-pill fw-bold" onClick={openConfirm}>
            রিকোয়েস্ট পাঠান <i className="fas fa-paper-plane ms-2" />
          </button>
        </div>
      </div>

      {confirm && (
        <Modal title="রিকোয়েস্ট নিশ্চিত করুন" onClose={() => setConfirm(false)}>
          <p className="text-muted mb-3">আপনি কি নিশ্চিত যে আপনি এই রিকোয়েস্টটি পাঠাতে চান?</p>
          <div className="bg-light p-3 rounded-3 border">
            <div className="d-flex justify-content-between mb-2 pb-2 border-bottom">
              <span className="text-muted">কার্যকর তারিখ:</span>
              <strong className="text-primary">{effectiveDate}</strong>
            </div>
            <div className="d-flex justify-content-between mb-2 pb-2 border-bottom">
              <span className="text-muted">সম্ভাব্য বিল পরিবর্তন:</span>
              <strong className={costImpact >= 0 ? 'text-success' : 'text-danger'}>
                {costImpact >= 0 ? '+' : ''}{fmt(costImpact)} ৳ / মাস
              </strong>
            </div>
            <ul className="list-group list-group-flush">
              {valid.map((v) => (
                <li key={v.label} className="list-group-item d-flex justify-content-between bg-transparent px-0 py-1">
                  <span>{v.label} {v.action === 'increase' ? 'আপগ্রেড' : 'ডাউনগ্রেড'}</span>
                  <strong>{v.amount} Mbps</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-end mt-3">
            <button className="btn btn-light rounded-pill me-2" onClick={() => setConfirm(false)}>ফিরে যান</button>
            <button className="btn btn-primary fw-bold rounded-pill px-4" disabled={busy} onClick={submit}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : 'হ্যাঁ, নিশ্চিত'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
