import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { fmtDate, statusBn } from '../utils/format.js';

const badge = (s) => {
  const v = String(s || 'pending').toLowerCase();
  if (v === 'approved' || v === 'implemented') return 'bg-success';
  if (v === 'rejected') return 'bg-danger';
  return 'bg-warning';
};

export default function History() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get('/requests')
      .then((r) => setRows(r.data.rows))
      .catch((e) => setErr(e?.response?.data?.message || 'লোড করতে সমস্যা হয়েছে।'));
  }, []);

  if (err) return <div className="alert alert-danger">{err}</div>;
  if (!rows) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <>
      <div className="mb-4">
        <h4 className="fw-bold m-0">রিকোয়েস্ট হিস্ট্রি</h4>
        <p className="text-muted small m-0 mt-1">আপনার সকল ব্যান্ডউইথ রিকোয়েস্টের তালিকা</p>
      </div>

      <div className="card-custom p-0">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>তারিখ</th>
                <th>টাইপ</th>
                <th>পরিমাণ</th>
                <th>কার্যকর তারিখ</th>
                <th>অ্যাডমিন</th>
                <th>ইঞ্জিনিয়ার</th>
                <th>বাস্তবায়ন</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rq) => {
                const editable =
                  String(rq.admin_status || 'pending').toLowerCase() === 'pending' &&
                  String(rq.engineer_status || 'pending').toLowerCase() === 'pending';
                return (
                  <tr key={rq.id}>
                    <td>{fmtDate(rq.created_at)}</td>
                    <td><span className="badge bg-light text-dark border">{rq.bw_type}</span></td>
                    <td>
                      <span className={`fw-bold ${rq.change_type === 'increase' ? 'text-success' : 'text-danger'}`}>
                        <i className={`fas fa-arrow-${rq.change_type === 'increase' ? 'up' : 'down'}`} /> {rq.amount}
                      </span>
                    </td>
                    <td>{fmtDate(rq.requested_effective_date)}</td>
                    <td><span className={`badge ${badge(rq.admin_status)} bg-opacity-10 text-dark border`}>{statusBn(rq.admin_status)}</span></td>
                    <td><span className={`badge ${badge(rq.engineer_status)} bg-opacity-10 text-dark border`}>{statusBn(rq.engineer_status)}</span></td>
                    <td>{rq.implementation_date ? fmtDate(rq.implementation_date) : '-'}</td>
                    <td className="text-end">
                      {editable && (
                        <Link to={`/request/edit/${rq.id}`} className="btn btn-sm btn-outline-primary rounded-pill px-3">
                          <i className="fas fa-edit" /> এডিট
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan="8" className="text-center text-muted py-4">কোনো রিকোয়েস্ট পাওয়া যায়নি।</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
