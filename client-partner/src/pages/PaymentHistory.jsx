import { useEffect, useState } from 'react';
import api from '../services/api.js';
import { fmt, fmtDate } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function PaymentHistory() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const { reseller } = useAuth();
  const isCommissionPartner = ['channel_partner', 'mac_partner'].includes(reseller?.partner_type);

  useEffect(() => {
    api
      .get(isCommissionPartner ? '/commission-payments' : '/payments')
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.message || 'লোড করতে সমস্যা হয়েছে।'));
  }, [isCommissionPartner]);

  if (err) return <div className="alert alert-danger">{err}</div>;
  if (!data) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <>
      <div className="mb-4">
        <h4 className="fw-bold m-0">{isCommissionPartner ? 'কমিশন পেমেন্ট হিস্ট্রি' : 'পেমেন্ট হিস্ট্রি'}</h4>
        <p className="text-muted small m-0 mt-1">{isCommissionPartner ? 'আপনার কমিশন থেকে পরিশোধিত অর্থের তালিকা' : 'আপনার সকল জমা লেনদেনের তালিকা'}</p>
      </div>

      <div className="card-custom p-0">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>তারিখ</th>
                <th>{isCommissionPartner ? 'কমিশন মাস / মাধ্যম' : 'বিবরণ'}</th>
                <th className="text-end">পরিমাণ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td className="fw-bold">{fmtDate(isCommissionPartner ? p.payment_date : p.effective_date)}</td>
                  <td>
                    <i className="fas fa-hand-holding-usd text-success me-2" />
                    {isCommissionPartner ? `${p.commission_month || '—'} · ${p.payment_method || 'Payment'}${p.reference_no ? ` · Ref: ${p.reference_no}` : ''}` : p.change_desc}
                  </td>
                  <td className="text-end fw-bold text-success">+ {fmt(p.transaction_amount)} ৳</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan="3" className="text-center text-muted py-4">কোনো পেমেন্ট পাওয়া যায়নি।</td></tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="table-success">
                  <td colSpan="2" className="text-end fw-bold">মোট জমা</td>
                  <td className="text-end fw-bold">{fmt(data.total)} ৳</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
