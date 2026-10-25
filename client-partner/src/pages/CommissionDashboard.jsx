import { useEffect, useState } from 'react';
import api, { resolveImage } from '../services/api.js';
import { fmt } from '../utils/format.js';

const CARDS = [
  { key: 'closing_balance', label: 'বর্তমান পাওনা', icon: 'fa-wallet', tone: 'text-primary' },
  { key: 'net_commission', label: 'এই মাসের নেট কমিশন', icon: 'fa-chart-line', tone: 'text-success' },
  { key: 'paid_to_partner', label: 'এই মাসে পরিশোধ', icon: 'fa-hand-holding-usd', tone: 'text-info' },
  { key: 'total_realized', label: 'বাস্তব কালেকশন', icon: 'fa-coins', tone: 'text-warning' },
];

export default function CommissionDashboard({ reseller }) {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/commission-summary'), api.get('/commission-history')])
      .then(([summaryResponse, historyResponse]) => {
        setSummary(summaryResponse.data);
        setHistory(historyResponse.data.rows || []);
      })
      .catch((e) => setError(e?.response?.data?.message || 'কমিশনের তথ্য লোড করতে সমস্যা হয়েছে।'));
  }, []);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!summary) return <div className="text-center py-5"><div className="spinner-border text-primary" role="status" /></div>;

  const partnerLabel = reseller.partner_type === 'mac_partner' ? 'MAC Partner' : 'Channel Partner';

  return (
    <>
      <div className="d-flex align-items-center gap-3 mb-4">
        <img src={resolveImage(reseller.profile_image, reseller.reseller_name)} className="rounded-circle shadow-sm" width="50" height="50" style={{ objectFit: 'cover' }} alt="" />
        <div>
          <h4 className="fw-bold m-0">{reseller.reseller_name}</h4>
          <div className="text-muted small">{reseller.company_name} · {partnerLabel}</div>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 className="fw-bold m-0">কমিশন ও প্রফিট-শেয়ার</h5>
          <small className="text-muted">মাস: {summary.month} · Profit share: {summary.profit_share_percentage}%</small>
        </div>
        <span className={`badge ${summary.finalized ? 'bg-success' : 'bg-warning text-dark'}`}>
          {summary.finalized ? 'চূড়ান্ত' : 'সম্ভাব্য হিসাব'}
        </span>
      </div>

      <div className="row g-3 mb-4">
        {CARDS.map((card) => (
          <div className="col-xl-3 col-md-6" key={card.key}>
            <div className="stat-card">
              <div>
                <p className="text-muted small fw-bold mb-1">{card.label}</p>
                <h4 className={`fw-bold m-0 ${card.tone}`}>{fmt(summary[card.key])} ৳</h4>
              </div>
              <div className="stat-icon bg-light"><i className={`fas ${card.icon} ${card.tone}`} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-4"><div className="card-custom h-100">
          <h6 className="fw-bold mb-3">পার্টনার সারাংশ</h6>
          <div className="d-flex justify-content-between mb-2"><span>মোট user</span><strong>{summary.total_users}</strong></div>
          <div className="d-flex justify-content-between mb-2"><span>Active user</span><strong>{summary.active_users}</strong></div>
          <div className="d-flex justify-content-between"><span>Paying user</span><strong>{summary.paying_users}</strong></div>
        </div></div>
        <div className="col-lg-8"><div className="card-custom h-100">
          <h6 className="fw-bold mb-3">এই মাসের হিসাব</h6>
          <div className="row g-3 small">
            <div className="col-sm-6 d-flex justify-content-between"><span>Gross commission</span><strong>{fmt(summary.gross_commission)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>Advance সমন্বয়</span><strong>{fmt(summary.partner_advances)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>Product deduction</span><strong>{fmt(summary.product_deduction)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>Deferred amount</span><strong>{fmt(summary.total_deferred)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>Adjustment</span><strong>{fmt(summary.adjustments)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>Deduction</span><strong>{fmt(summary.deductions)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>আগের balance</span><strong>{fmt(summary.previous_balance)} ৳</strong></div>
            <div className="col-sm-6 d-flex justify-content-between"><span>সর্বমোট payable</span><strong>{fmt(summary.total_payable)} ৳</strong></div>
          </div>
        </div></div>
      </div>

      <div className="card-custom p-0">
        <div className="p-3 border-bottom"><h6 className="fw-bold m-0">চূড়ান্ত কমিশন হিস্ট্রি</h6></div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light"><tr><th>মাস</th><th>Profit share</th><th>Collection</th><th>Net commission</th><th>পরিশোধ</th><th>Closing balance</th></tr></thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.month}>
                  <td className="fw-bold">{row.month}</td>
                  <td>{fmt(row.profit_share_pct, 2)}%</td>
                  <td>{fmt(row.total_collection)} ৳</td>
                  <td>{fmt(row.net_commission)} ৳</td>
                  <td>{fmt(row.paid_amount)} ৳</td>
                  <td className="fw-bold">{fmt(row.closing_balance)} ৳</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan="6" className="text-center text-muted py-4">এখনো কোনো চূড়ান্ত কমিশন তৈরি হয়নি।</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
