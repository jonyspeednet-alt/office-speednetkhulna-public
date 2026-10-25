import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { resolveImage } from '../services/api.js';
import { fmt, fmtDate, statusBn } from '../utils/format.js';
import Modal from '../components/Modal.jsx';
import CommissionDashboard from './CommissionDashboard.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { normalizePartnerType } from '../components/Layout.jsx';

const BW_ROWS = [
  { key: 'iig_bw', rate: 'rate_iig', label: 'IIG', icon: 'fa-globe-americas', color: 'text-primary' },
  { key: 'bdix_bw', rate: 'rate_bdix', label: 'BDIX', icon: 'fa-exchange-alt', color: 'text-success' },
  { key: 'ggc_bw', rate: 'rate_ggc', label: 'GGC', icon: 'fa-google', color: 'text-warning', fab: true },
  { key: 'fna_bw', rate: 'rate_fna', label: 'FNA', icon: 'fa-network-wired', color: 'text-info' },
  { key: 'cdn_bw', rate: 'rate_cdn', label: 'CDN', icon: 'fa-server', color: 'text-danger' },
  { key: 'bcdn_bw', rate: 'rate_bcdn', label: 'Other', icon: 'fa-hdd', color: 'text-secondary' },
];

const MODAL_TITLES = {
  previous_due: 'পূর্ববর্তী বকেয়া ও বিলিং ইতিহাস',
  current_bill: 'চলতি মাসের বিলের বিবরণ (সম্ভাব্য)',
  paid_this_month: 'এই মাসের পেমেন্ট হিস্ট্রি',
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('payment');
  const [modal, setModal] = useState(null); // {type}
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const auth = useAuth();
  const authReseller = auth?.reseller;

  useEffect(() => {
    api
      .get('/dashboard')
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.message || 'লোড করতে সমস্যা হয়েছে।'));
  }, []);

  const openModal = async (type) => {
    setModal({ type });
    setModalData(null);
    setModalLoading(true);
    const url = {
      previous_due: '/billing/previous-due',
      current_bill: '/billing/current-bill',
      paid_this_month: '/billing/paid-this-month',
    }[type];
    try {
      const { data: d } = await api.get(url);
      setModalData(d);
    } catch (_) {
      setModalData({ error: true });
    } finally {
      setModalLoading(false);
    }
  };

  if (err) return <div className="alert alert-danger">{err}</div>;
  if (!data)
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status" />
      </div>
    );

  // Prefer the session reseller (same source as Layout/App guards); fall back
  // to the dashboard payload when the session isn't loaded yet.
  const r = authReseller || data.reseller;
  const sessionType = normalizePartnerType(authReseller?.partner_type);
  const apiType = normalizePartnerType(data.reseller?.partner_type);
  const typeMismatch = Boolean(authReseller) && sessionType !== apiType;
  const mismatchBanner = typeMismatch && (
    <div className="alert alert-warning py-1 px-2 small mb-3">
      অ্যাকাউন্টের ধরন মিলছে না: সেশন ({String(authReseller?.partner_type)}) বনাম ড্যাশবোর্ড ({String(data.reseller?.partner_type)})। সেশনের তথ্য অনুযায়ী দেখানো হচ্ছে।
    </div>
  );
  if (['channel_partner', 'mac_partner'].includes(normalizePartnerType(r.partner_type))) {
    return (
      <>
        {mismatchBanner}
        <CommissionDashboard reseller={r} />
      </>
    );
  }
  const s = data.stats;
  const totalBw =
    r.iig_bw + r.bdix_bw + r.ggc_bw + r.fna_bw + r.cdn_bw + r.bcdn_bw;
  const nttnPercent = r.nttn_capacity > 0 ? (totalBw / r.nttn_capacity) * 100 : 0;
  const barColor = nttnPercent > 95 ? 'bg-danger' : nttnPercent > 80 ? 'bg-warning' : 'bg-primary';

  return (
    <>
      {mismatchBanner}
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-3">
          <img
            src={resolveImage(r.profile_image, r.reseller_name)}
            className="rounded-circle shadow-sm d-none d-sm-block"
            width="50"
            height="50"
            style={{ objectFit: 'cover', border: '2px solid #fff' }}
            alt=""
          />
          <div>
            <h4 className="fw-bold m-0">
              {r.reseller_name}
              {r.nttn_type && (
                <span className="badge bg-dark ms-2" style={{ fontSize: '0.6em', verticalAlign: 'middle' }}>
                  {r.nttn_type}
                </span>
              )}
              {r.connection_type && (
                <span className="badge bg-primary ms-1" style={{ fontSize: '0.6em', verticalAlign: 'middle' }}>
                  {r.connection_type}
                </span>
              )}
            </h4>
            <p className="text-muted small m-0">{r.company_name}</p>
            {r.security_deposit > 0 && (
              <span className="badge bg-success bg-opacity-10 text-success border border-success mt-1">
                <i className="fas fa-shield-alt me-1" /> Advance: {fmt(r.security_deposit, 0)} ৳
              </span>
            )}
          </div>
        </div>
        <Link to="/request/new" className="btn btn-primary rounded-pill px-4 btn-sm d-none d-md-block">
          <i className="fas fa-plus-circle me-2" />রিকোয়েস্ট পাঠান
        </Link>
      </div>

      {/* Stat cards */}
      <div className="row g-3 mb-3">
        <div className="col-xl-3 col-md-6">
          <div className="stat-card">
            <div>
              <p className="text-muted small fw-bold mb-0 text-uppercase">মোট প্রদেয়</p>
              <h4 className={`fw-bold m-0 ${s.net_due > 0 ? 'text-danger' : 'text-success'}`}>
                {fmt(s.net_due)} ৳
              </h4>
              <small className="text-muted" style={{ fontSize: 11 }}>সর্বমোট বকেয়া</small>
            </div>
            <div className="stat-icon bg-light-danger"><i className="fas fa-file-invoice-dollar" /></div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="stat-card" onClick={() => openModal('previous_due')}>
            <div>
              <p className="text-muted small fw-bold mb-0 text-uppercase">পূর্ববর্তী বকেয়া</p>
              <h5 className="fw-bold m-0">{fmt(s.previous_due)} ৳</h5>
              <small className="text-muted" style={{ fontSize: 11 }}>গত মাস</small>
            </div>
            <div className="stat-icon bg-light-warning"><i className="fas fa-history" /></div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="stat-card" onClick={() => openModal('current_bill')}>
            <div>
              <p className="text-muted small fw-bold mb-0 text-uppercase">সম্ভাব্য বিল</p>
              <h5 className="fw-bold m-0">{fmt(s.projected_bill)} ৳</h5>
              <small className="text-muted" style={{ fontSize: 11 }}>চলতি মাস</small>
            </div>
            <div className="stat-icon bg-light-primary"><i className="fas fa-chart-line" /></div>
          </div>
        </div>
        <div className="col-xl-3 col-md-6">
          <div className="stat-card" onClick={() => openModal('paid_this_month')}>
            <div>
              <p className="text-muted small fw-bold mb-0 text-uppercase">এই মাসে জমা</p>
              <h5 className="fw-bold m-0">{fmt(s.paid_this_month)} ৳</h5>
              <small className="text-muted" style={{ fontSize: 11 }}>মোট কালেকশন</small>
            </div>
            <div className="stat-icon bg-light-success"><i className="fas fa-hand-holding-usd" /></div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* Bandwidth panel */}
        <div className="col-lg-4">
          <div className="card-custom p-3">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h6 className="fw-bold m-0">ব্যান্ডউইথ প্যাকেজ</h6>
              <Link to="/request/new" className="btn btn-sm btn-light text-primary rounded-pill px-2" style={{ fontSize: 11 }}>
                পরিবর্তন
              </Link>
            </div>

            <div className="mb-4 p-3 bg-light rounded-3 border">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="d-flex align-items-center">
                  <i className="fas fa-broadcast-tower me-2" />
                  <span className="fw-bold small">NTTN ক্যাপাসিটি</span>
                </div>
                <div className="text-end">
                  <span className="fw-bold">{r.nttn_capacity} Mbps</span>
                  <div className="small text-muted" style={{ fontSize: 10 }}>@ {r.rate_nttn} ৳</div>
                </div>
              </div>
              <div className="progress" style={{ height: 8, borderRadius: 4 }}>
                <div className={`progress-bar ${barColor}`} style={{ width: `${Math.min(nttnPercent, 100)}%` }} />
              </div>
              <div className="d-flex justify-content-between mt-2">
                <small className="text-muted" style={{ fontSize: 10 }}>ব্যবহার: {totalBw} Mbps</small>
                <small className="text-muted" style={{ fontSize: 10 }}>{fmt(nttnPercent, 1)}%</small>
              </div>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
              <span className="fw-bold text-secondary small">সর্বমোট ব্যান্ডউইথ</span>
              <span className="fw-bold text-primary">{totalBw} Mbps</span>
            </div>

            {BW_ROWS.filter((b) => r[b.key] > 0).map((b) => (
              <div className="bw-list-item" key={b.key}>
                <div className="d-flex align-items-center">
                  <i className={`${b.fab ? 'fab' : 'fas'} ${b.icon} ${b.color} me-3`} style={{ width: 20 }} />
                  <span className="fw-bold small">{b.label}</span>
                </div>
                <div className="text-end">
                  <div className="fw-bold">
                    {r[b.key]} <small className="text-muted" style={{ fontSize: 10 }}>Mbps</small>
                  </div>
                  <div className="small text-muted" style={{ fontSize: 10 }}>@ {r[b.rate]} ৳</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="col-lg-8">
          <div className="card-custom p-0 h-100">
            <div className="p-3 d-flex justify-content-between align-items-center">
              <ul className="nav nav-pills">
                <li className="nav-item">
                  <button className={`nav-link btn-sm py-1 px-3 ${tab === 'payment' ? 'active' : ''}`} onClick={() => setTab('payment')}>
                    পেমেন্ট
                  </button>
                </li>
                <li className="nav-item">
                  <button className={`nav-link btn-sm py-1 px-3 ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
                    রিকোয়েস্ট
                  </button>
                </li>
              </ul>
              <Link to="/payments" className="btn btn-sm btn-outline-primary rounded-pill px-2" style={{ fontSize: 11 }}>
                সব দেখুন
              </Link>
            </div>
            <div className="p-0">
              {tab === 'payment' ? (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>তারিখ</th>
                        <th>বিবরণ</th>
                        <th className="text-end">পরিমাণ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_payments.map((p) => (
                        <tr key={p.id}>
                          <td className="fw-bold">{fmtDate(p.effective_date, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                          <td>
                            <i className="fas fa-hand-holding-usd text-success me-2" />
                            <span className="small">{p.change_desc}</span>
                          </td>
                          <td className="text-end fw-bold text-success">+ {fmt(p.transaction_amount)}</td>
                        </tr>
                      ))}
                      {data.recent_payments.length === 0 && (
                        <tr><td colSpan="3" className="text-center text-muted py-4">কোনো পেমেন্ট পাওয়া যায়নি।</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>তারিখ</th>
                        <th>ধরন</th>
                        <th>পরিমাণ</th>
                        <th>অবস্থা</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_requests.map((rq) => (
                        <tr key={rq.id}>
                          <td>{fmtDate(rq.created_at, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                          <td><span className="badge bg-light text-dark border">{rq.bw_type}</span></td>
                          <td>
                            <span className={`fw-bold ${rq.change_type === 'increase' ? 'text-success' : 'text-danger'}`}>
                              <i className={`fas fa-arrow-${rq.change_type === 'increase' ? 'up' : 'down'}`} /> {rq.amount}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${rq.admin_status === 'approved' ? 'bg-success' : rq.admin_status === 'rejected' ? 'bg-danger' : 'bg-warning'} bg-opacity-10 text-dark border`}>
                              {statusBn(rq.admin_status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {data.recent_requests.length === 0 && (
                        <tr><td colSpan="4" className="text-center text-muted py-4">কোনো রিকোয়েস্ট পাওয়া যায়নি।</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <Modal title={MODAL_TITLES[modal.type]} size="modal-lg" onClose={() => setModal(null)}>
          {modalLoading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status" />
            </div>
          ) : modalData?.error ? (
            <div className="alert alert-danger">তথ্য লোড করতে সমস্যা হয়েছে।</div>
          ) : (
            <ModalBody type={modal.type} data={modalData} />
          )}
        </Modal>
      )}
    </>
  );
}

function ModalBody({ type, data }) {
  if (type === 'current_bill') {
    return (
      <div className="table-responsive">
        <table className="table table-bordered table-striped align-middle">
          <thead className="table-light">
            <tr>
              <th>বিবরণ</th><th>তারিখ</th><th>ব্যান্ডউইথ</th><th>রেট</th><th>দিন</th><th className="text-end">মোট</th>
            </tr>
          </thead>
          <tbody>
            {(data.items || []).map((it, i) => (
              <tr key={i}>
                <td>
                  <strong>{it.desc}</strong>{' '}
                  {it.change_type && <span className="badge bg-light text-dark border ms-1">{it.change_type}</span>}
                </td>
                <td className="small">{it.date_range}</td>
                <td>{it.bw} Mbps</td>
                <td>{it.rate}</td>
                <td>{it.days}</td>
                <td className="text-end fw-bold">{fmt(it.total)}</td>
              </tr>
            ))}
            {(data.items || []).length === 0 && (
              <tr><td colSpan="6" className="text-center text-muted">কোনো তথ্য নেই।</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="table-primary">
              <td colSpan="5" className="text-end fw-bold">সর্বমোট আনুমানিক বিল</td>
              <td className="text-end fw-bold">{fmt(data.total)} ৳</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  if (type === 'previous_due') {
    return (
      <div className="table-responsive">
        <table className="table table-bordered table-hover align-middle" style={{ fontSize: 13 }}>
          <thead className="table-light">
            <tr>
              <th>মাস</th><th className="text-end">পূর্ব বকেয়া</th><th className="text-end">বিল (+)</th>
              <th className="text-end">জমা (-)</th><th className="text-end">সর্বশেষ বকেয়া</th><th className="text-center">ইনভয়েস</th>
            </tr>
          </thead>
          <tbody>
            {(data.rows || []).map((b) => (
              <tr key={b.id}>
                <td>
                  <div className="fw-bold">{fmtDate(b.bill_month, { month: 'short', year: 'numeric' })}</div>
                  <small className="text-muted">{fmtDate(b.created_at, { day: '2-digit', month: 'short' })}</small>
                </td>
                <td className="text-end text-muted">{fmt(b.previous_due)}</td>
                <td className="text-end">
                  <div className="fw-bold">{fmt(b.amount)}</div>
                  {b.adjustment !== 0 && (
                    <small className={b.adjustment < 0 ? 'text-success' : 'text-danger'}>(Adj: {b.adjustment})</small>
                  )}
                </td>
                <td className="text-end text-success">{fmt(b.paid)}</td>
                <td className="text-end fw-bold text-danger">{fmt(b.closing_due)}</td>
                <td className="text-center">
                  <a href={`/invoice/${b.id}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary rounded-circle">
                    <i className="fas fa-file-invoice" />
                  </a>
                </td>
              </tr>
            ))}
            {(data.rows || []).length === 0 && (
              <tr><td colSpan="6" className="text-center text-muted">কোনো বিল পাওয়া যায়নি।</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // paid_this_month
  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle">
        <thead className="table-light">
          <tr><th>তারিখ</th><th>বিবরণ</th><th className="text-end">পরিমাণ</th></tr>
        </thead>
        <tbody>
          {(data.rows || []).map((p) => (
            <tr key={p.id}>
              <td>{fmtDate(p.effective_date)}</td>
              <td>{p.change_desc}</td>
              <td className="text-end fw-bold text-success">{fmt(p.transaction_amount)} ৳</td>
            </tr>
          ))}
          {(data.rows || []).length === 0 && (
            <tr><td colSpan="3" className="text-center text-muted py-4">এই মাসে কোনো পেমেন্ট নেই।</td></tr>
          )}
        </tbody>
        {(data.rows || []).length > 0 && (
          <tfoot>
            <tr className="table-success">
              <td colSpan="2" className="text-end fw-bold">মোট জমা</td>
              <td className="text-end fw-bold">{fmt(data.total)} ৳</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
