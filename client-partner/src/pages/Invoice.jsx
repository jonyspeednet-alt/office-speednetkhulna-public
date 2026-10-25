import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import api from '../services/api.js';
import { fmt, fmtDate } from '../utils/format.js';
import './invoice.css';

const LOGO = 'https://speednetkhulna.com/assets/img/logo-b.png';

export default function Invoice() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    api
      .get(`/invoice/${id}`)
      .then((r) => setInv(r.data.invoice))
      .catch((e) => setErr(e?.response?.data?.message || 'ইনভয়েস পাওয়া যায়নি।'));
  }, [id]);

  const downloadPNG = async () => {
    if (!ref.current) return;
    const canvas = await html2canvas(ref.current, { scale: 2, useCORS: true });
    const link = document.createElement('a');
    const ym = fmtDate(inv.bill_month, { year: 'numeric', month: '2-digit' }).replace(/\s/g, '-');
    link.download = `Invoice_${inv.reseller_name}_${ym}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (err) return <div className="alert alert-danger m-4">{err}</div>;
  if (!inv) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  // Group consecutive items by desc for rowspan effect
  const typeCounts = {};
  inv.items.forEach((it) => { typeCounts[it.desc] = (typeCounts[it.desc] || 0) + 1; });
  let prevType = '';

  const statusBadge = (t) =>
    t === 'increase' ? ['Increased', 'bg-soft-success']
      : t === 'decrease' ? ['Decreased', 'bg-soft-danger']
        : t === 'standard' ? ['Current Pkg', 'bg-soft-info']
          : [t || '', 'bg-soft-info'];

  return (
    <div className="invoice-page">
      <div className="container">
        <div className="invoice-container" ref={ref}>
          {inv.net_payable > 0
            ? <div className="watermark">DUE</div>
            : <div className="watermark paid">PAID</div>}

          <div className="invoice-header d-flex justify-content-between align-items-center">
            <div>
              <img src={LOGO} alt="Speed Net Khulna" crossOrigin="anonymous" style={{ maxHeight: 50, maxWidth: 200 }} />
              <p className="text-muted small mb-0 mt-1">Reliable Internet Service Provider</p>
            </div>
            <div className="text-end">
              <div className="invoice-title">INVOICE</div>
              <div className="invoice-number">#{inv.invoice_no}</div>
            </div>
          </div>

          <div className="invoice-body">
            <div className="row mb-4">
              <div className="col-6">
                <div className="info-label">From</div>
                <div className="info-text">
                  <strong>Speed Net Khulna</strong><br />
                  Khulna, Bangladesh<br />
                  Email: billing@speednetkhulna.com
                </div>
              </div>
              <div className="col-6 text-end">
                <div className="info-label">Bill To</div>
                <div className="info-text">
                  <strong>{inv.reseller_name}</strong><br />
                  {inv.company_name}<br />
                  {inv.pop_location}<br />
                  Contact: {inv.contact_no}
                </div>
              </div>
            </div>

            <div className="meta-container">
              <div className="row">
                <div className="col-4 border-end meta-item">
                  <small>Invoice Date</small>
                  <div>{fmtDate(inv.created_at)}</div>
                </div>
                <div className="col-4 border-end text-center meta-item">
                  <small>Billing Month</small>
                  <div className="text-primary-custom">{fmtDate(inv.bill_month, { month: 'long', year: 'numeric' })}</div>
                </div>
                <div className="col-4 text-end meta-item">
                  <small>Total Amount</small>
                  <div>{fmt(inv.amount)} ৳</div>
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table className="table-invoice">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="text-center">Status</th>
                    <th>Date Range</th>
                    <th className="text-center">Bandwidth</th>
                    <th className="text-center">Rate</th>
                    <th className="text-center">Days</th>
                    <th className="text-end">Total (Tk)</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((it, i) => {
                    const showType = it.desc !== prevType;
                    prevType = it.desc;
                    const [label, cls] = statusBadge(it.change_type);
                    return (
                      <tr key={i}>
                        {showType && <td rowSpan={typeCounts[it.desc] || 1} className="fw-bold">{it.desc}</td>}
                        <td className="text-center">{label && <span className={`badge-inv ${cls}`}>{label}</span>}</td>
                        <td><small className="text-muted">{it.date_range}</small></td>
                        <td className="text-center">{it.bw}</td>
                        <td className="text-center">{fmt(it.rate)}</td>
                        <td className="text-center">{it.days}</td>
                        <td className="text-end fw-bold">{fmt(it.total)}</td>
                      </tr>
                    );
                  })}
                  {inv.items.length === 0 && (
                    <tr><td colSpan="7" className="text-center text-muted">No line items.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row mt-4">
              <div className="col-md-6" />
              <div className="col-md-6">
                <table className="table table-borderless summary-table mb-0">
                  <tbody>
                    <tr><td className="text-end text-muted">Previous Due</td><td className="text-end text-muted">{fmt(inv.previous_due)} ৳</td></tr>
                    <tr><td className="text-end">Current Bill Amount</td><td className="text-end fw-bold">{fmt(inv.amount)} ৳</td></tr>
                    <tr className="border-top"><td className="text-end fw-bold">Sub Total</td><td className="text-end fw-bold">{fmt(inv.previous_due + inv.amount)} ৳</td></tr>
                    <tr>
                      <td className="text-end text-muted">
                        Adjustment
                        {inv.adjustment_note && <><br /><small className="fst-italic" style={{ fontSize: 11 }}>({inv.adjustment_note})</small></>}
                      </td>
                      <td className="text-end text-muted">{fmt(inv.adjustment)} ৳</td>
                    </tr>
                    <tr><td className="text-end text-success">Paid (This Period)</td><td className="text-end fw-bold text-success">(-) {fmt(inv.total_paid)} ৳</td></tr>
                    <tr className="total-row">
                      <td className="text-end">{inv.net_payable < 0 ? 'Net Payable (Advance)' : 'Net Payable (Month End Due)'}</td>
                      <td className="text-end">{fmt(Math.abs(inv.net_payable))} ৳</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="invoice-footer">
            <p className="m-0"><strong>Terms &amp; Conditions:</strong> Please pay the bill within the due date to avoid service interruption.</p>
            <p className="m-0 mt-1">Thank you for your business!</p>
          </div>
        </div>

        <div className="text-center mt-4 mb-5 no-print">
          <button onClick={() => window.print()} className="btn btn-dark px-4 rounded-pill me-2"><i className="fas fa-print me-2" />Print Invoice</button>
          <button onClick={downloadPNG} className="btn btn-outline-dark px-4 rounded-pill me-2"><i className="fas fa-download me-2" />Download PNG</button>
          <button onClick={() => window.close()} className="btn btn-light border px-4 rounded-pill">Close</button>
        </div>
      </div>
    </div>
  );
}
