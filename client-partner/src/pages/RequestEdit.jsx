import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api.js';

const BW_LABELS = ['IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'Other', 'NTTN'];

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export default function RequestEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/requests').then((r) => {
      const row = r.data.rows.find((x) => String(x.id) === String(id));
      if (!row) {
        setAlert({ type: 'danger', msg: 'রিকোয়েস্ট পাওয়া যায়নি।' });
        return;
      }
      const editable =
        String(row.admin_status || 'pending').toLowerCase() === 'pending' &&
        String(row.engineer_status || 'pending').toLowerCase() === 'pending';
      if (!editable) {
        setAlert({ type: 'warning', msg: 'এই রিকোয়েস্টটি আর সম্পাদনা করা যাবে না।' });
      }
      setForm({
        bw_type: row.bw_type,
        change_type: row.change_type,
        amount: row.amount,
        effective_date: toDateInput(row.requested_effective_date),
        reseller_note: row.reseller_note || '',
        editable,
      });
    });
  }, [id]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setAlert(null);
    if (form.change_type === 'decrease' && form.effective_date < todayPlus(30)) {
      setAlert({ type: 'danger', msg: 'ডাউনগ্রেডের জন্য কমপক্ষে ৩০ দিন নোটিশ পিরিয়ড প্রয়োজন।' });
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.put(`/requests/${id}`, {
        bw_type: form.bw_type,
        change_type: form.change_type,
        amount: Number(form.amount),
        effective_date: form.effective_date,
        reseller_note: form.reseller_note,
      });
      setAlert({ type: 'success', msg: data.message });
      setTimeout(() => navigate('/history'), 800);
    } catch (err) {
      setAlert({ type: 'danger', msg: err?.response?.data?.message || 'আপডেট ব্যর্থ হয়েছে।' });
    } finally {
      setBusy(false);
    }
  };

  if (!form) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <>
      <div className="mb-4">
        <h4 className="fw-bold m-0">রিকোয়েস্ট এডিট</h4>
        <p className="text-muted small m-0 mt-1">অপেক্ষমান রিকোয়েস্ট সম্পাদনা করুন</p>
      </div>

      {alert && <div className={`alert alert-${alert.type} shadow-sm`}>{alert.msg}</div>}

      <div className="card-custom" style={{ maxWidth: 640 }}>
        <form onSubmit={submit}>
          <div className="mb-3">
            <label className="form-label fw-bold">ব্যান্ডউইথ টাইপ</label>
            <select className="form-select" value={form.bw_type} disabled={!form.editable} onChange={(e) => set({ bw_type: e.target.value })}>
              {BW_LABELS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="mb-3">
            <label className="form-label fw-bold">অ্যাকশন</label>
            <select className="form-select" value={form.change_type} disabled={!form.editable} onChange={(e) => set({ change_type: e.target.value })}>
              <option value="increase">আপগ্রেড (Upgrade)</option>
              <option value="decrease">ডাউনগ্রেড (Downgrade)</option>
            </select>
          </div>
          <div className="mb-3">
            <label className="form-label fw-bold">পরিমাণ (Mbps)</label>
            <input type="number" min="1" className="form-control" value={form.amount} disabled={!form.editable} onChange={(e) => set({ amount: e.target.value })} />
          </div>
          <div className="mb-3">
            <label className="form-label fw-bold">কার্যকর তারিখ</label>
            <input type="date" className="form-control" value={form.effective_date} disabled={!form.editable} onChange={(e) => set({ effective_date: e.target.value })} />
          </div>
          <div className="mb-4">
            <label className="form-label fw-bold">নোট</label>
            <textarea className="form-control" rows="2" value={form.reseller_note} disabled={!form.editable} onChange={(e) => set({ reseller_note: e.target.value })} />
          </div>
          <div className="text-end">
            <button type="button" className="btn btn-light rounded-pill me-2" onClick={() => navigate('/history')}>ফিরে যান</button>
            <button type="submit" className="btn btn-primary fw-bold rounded-pill px-4" disabled={!form.editable || busy}>
              {busy ? <span className="spinner-border spinner-border-sm" /> : 'আপডেট করুন'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
