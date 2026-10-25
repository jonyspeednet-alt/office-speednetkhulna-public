import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { getInvoiceByBillId, sendInvoiceEmailByBillId } from '../services/resellerService';
import BrandLogo from '../components/BrandLogo';
import { notify } from '../utils/notify';
import '../styles/Invoice.css';
import '../styles/ViewStaticInvoice.css';

const CURRENCY = '৳';

// Capture the complete table using a readable layout on narrow screens too.
const snapshotOptions = {
  scale: 2,
  useCORS: true,
  backgroundColor: '#ffffff',
  windowWidth: 1200,
  onclone: (documentClone) => {
    const invoice = documentClone.getElementById('invoiceContent');
    if (invoice) {
      invoice.style.width = '1000px';
      invoice.style.maxWidth = 'none';
    }
  }
};

const fmt = (n, decimals = 2) => {
  const num = Number(n || 0);
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const toMonthName = (monthStr) => {
  if (!monthStr) return '';
  const d = new Date(String(monthStr).slice(0, 7) + '-15');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const toInvoiceDate = (isoDate) => {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

const padInvoiceId = (id) => String(id || '').padStart(5, '0');

const parseStartDayNum = (item) => {
  if (item?.from_day_num != null && !isNaN(Number(item.from_day_num))) {
    return Number(item.from_day_num);
  }
  const dateRange = String(item?.date_range || '');
  const match = dateRange.match(/^\s*(\d{1,2})/);
  if (match) return parseInt(match[1], 10);
  return 0;
};

const ViewStaticInvoice = () => {
  const [searchParams] = useSearchParams();
  const billId = searchParams.get('id') || searchParams.get('billId') || searchParams.get('invoice_id') || '';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const invoiceRef = useRef(null);

  const loadStaticInvoice = useCallback(async () => {
    if (!billId) {
      setError('This invoice link is missing its invoice ID. Open the invoice again from billing history.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getInvoiceByBillId(billId);
      setData(result || null);
    } catch (e) {
      setError(e?.response?.data?.message || 'Invoice not found.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    loadStaticInvoice();
  }, [loadStaticInvoice]);

  const downloadPNG = async () => {
    if (!invoiceRef.current || downloading || !data) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(invoiceRef.current, snapshotOptions);
      const link = document.createElement('a');
      const resellerName = data?.reseller?.name || data?.reseller?.reseller_name || 'reseller';
      link.download = `Invoice_${resellerName}_${String(data?.month || '').slice(0, 7)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[ViewStaticInvoice] html2canvas:', e);
      notify.error('Could not download the invoice. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const captureInvoiceDataUrl = async () => {
    if (!invoiceRef.current) throw new Error('Invoice content not ready');
    const canvas = await html2canvas(invoiceRef.current, snapshotOptions);
    return canvas.toDataURL('image/png');
  };

  const handleSendEmail = async () => {
    const target = window.prompt('Send this invoice to which email address?');
    if (!target) return;
    const toEmail = target.trim();
    if (!toEmail) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      notify.error('Enter a valid email address.');
      return;
    }

    setSendingEmail(true);
    try {
      const snapshotDataUrl = await captureInvoiceDataUrl();
      await sendInvoiceEmailByBillId(billId, { to_email: toEmail, snapshot_data_url: snapshotDataUrl });
      notify.success('Invoice email sent successfully.');
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Could not send the invoice email. Please try again.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleShareWhatsApp = async () => {
    try {
      const snapshotDataUrl = await captureInvoiceDataUrl();
      const directLink = `${window.location.origin}/view-static-invoice?id=${encodeURIComponent(billId)}`;
      const resName = data?.reseller?.name || data?.reseller?.reseller_name || `Reseller #${data?.bill?.reseller_id || ''}`;
      const monthYm = String(data?.month || data?.bill?.bill_month || '').slice(0, 7);
      const text = `Invoice: ${resName} (${monthYm})\n${directLink}`;

      const response = await fetch(snapshotDataUrl);
      const blob = await response.blob();
      const file = new File([blob], `static_invoice_${billId}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Invoice Snapshot' });
        return;
      }

      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      notify.info('Direct file share not supported in your browser. Invoice link opened in WhatsApp.');
    } catch (e) {
      if (e?.name !== 'AbortError') notify.error('Could not share the invoice. Please try again.');
    }
  };

  const normalized = useMemo(() => {
    if (!data) return null;
    const reseller = data.reseller || {};
    const bill = data.bill || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const totalPaid = Number(data.total_paid || 0);
    const totalDiscount = Number(data.total_discount || 0);
    const otherCharges = Number(data.total_product_charges || 0);
    const totalAmount = Number(bill.final_amount ?? bill.amount ?? 0);
    const prevDue = Number(bill.previous_due ?? reseller.due_amount ?? 0);
    const adjustment = Number(bill.adjustment ?? 0);
    const adjustmentNote = bill.adjustment_note || '';
    const hasLegacyAdjustment = Math.abs(adjustment) > 0.0001;
    const netPayable = Number((prevDue + totalAmount + otherCharges + adjustment - totalPaid - totalDiscount).toFixed(2));

    const otcItems = Array.isArray(items) ? items.filter((item) => item?.desc === 'OTC') : [];
    const displayItems = Array.isArray(items) ? items.filter((item) => item?.desc !== 'OTC') : [];
    const otcAmount = otcItems.reduce((sum, item) => sum + Number(item?.total || 0), 0);
    const runningBillAmount = Math.max(0, Number(totalAmount || 0) - otcAmount);
    return {
      reseller,
      bill,
      items: displayItems,
      otcAmount,
      runningBillAmount,
      totalPaid,
      totalDiscount,
      otherCharges,
      totalAmount,
      prevDue,
      adjustment,
      adjustmentNote,
      hasLegacyAdjustment,
      netPayable
    };
  }, [data]);

  if (loading) return <div className="container py-5 text-center" role="status">Loading invoice...</div>;
  if (error || !normalized) return (
    <div className="container py-5 text-center">
      <h1 className="h4">Invoice unavailable</h1>
      <p role="alert">{error || 'No invoice was found for this link.'}</p>
      {billId && <button type="button" className="btn btn-primary me-2" onClick={loadStaticInvoice}>Try again</button>}
      <a href="/invoice" className="btn btn-outline-secondary">Back to invoices</a>
    </div>
  );

  const { reseller, bill, items, otcAmount, runningBillAmount, totalPaid, totalDiscount, totalAmount, otherCharges, prevDue, adjustment, adjustmentNote, hasLegacyAdjustment, netPayable } = normalized;
  const monthName = toMonthName(data?.month || bill?.bill_month);
  const invoiceDate = toInvoiceDate(bill?.created_at || data?.created_at);

  return (
    <div className="container-fluid py-3 reseller-page static-invoice-page">
      <div className={`inv-container ${netPayable <= 0 ? 'status-paid' : 'status-due'}`} id="invoiceContent" ref={invoiceRef} style={{ maxWidth: 850, margin: '0 auto' }}>
        <div className={`inv-watermark${netPayable <= 0 ? ' paid' : ''}`}>{netPayable < 0 ? 'CREDIT' : netPayable === 0 ? 'PAID' : 'DUE'}</div>

        <div className="inv-header d-flex justify-content-between align-items-center">
          <div className="inv-brand">
            <BrandLogo className="inv-logo" alt="Speed Net Khulna" />
          </div>
          <div className="text-end">
            <div className="inv-label">Invoice</div>
            <div className="inv-number">#{padInvoiceId(bill?.id)}</div>
          </div>
        </div>

        <div className="inv-body">
          <div className="row mb-4">
            <div className="col-6">
              <div className="inv-info-label">From</div>
              <div className="inv-info-text">
                <strong className="text-dark">Speed Net Khulna</strong><br />
                Khulna, Bangladesh<br />
                Phone: +880 1910365577<br />
                Email: billing@speednetkhulna.com
              </div>
            </div>
            <div className="col-6 text-end">
              <div className="inv-info-label">To</div>
              <div className="inv-info-text">
                <strong>{reseller.name || reseller.reseller_name}</strong><br />
                {reseller.company_name || '-'}<br />
                {reseller.pop_location || '-'}<br />
                Contact: {reseller.phone || reseller.contact_no || '-'}
              </div>
            </div>
          </div>

          <div className="inv-meta row mb-4">
            <div className="col-4 border-end"><small>Invoice Date</small><div className="inv-meta-val">{invoiceDate}</div></div>
            <div className="col-4 border-end text-center"><small>Billing Month</small><div className="inv-meta-val text-primary-custom">{monthName}</div></div>
            <div className="col-4 text-end"><small>Total Bill</small><div className="inv-meta-val">{fmt(totalAmount)} {CURRENCY}</div></div>
          </div>

          <div className="static-invoice-balance" aria-label="Invoice balance">
            <span>{netPayable < 0 ? 'Credit balance' : netPayable === 0 ? 'Fully paid' : 'Amount due'}</span>
            <strong>{fmt(Math.abs(netPayable))} {CURRENCY}</strong>
            <small>{netPayable < 0 ? 'Credit remaining after this invoice.' : netPayable === 0 ? 'No payment outstanding for this invoice.' : 'Balance after payments, discounts and adjustments.'}</small>
          </div>
          <h2 className="h6 mb-1">Service charges</h2>
          <p className="text-muted small mb-2">Package changes appear as separate billing periods.</p>
          <p className="static-invoice-scroll-hint no-print">Swipe across the table to see all charges.</p>
          <div className="table-responsive static-invoice-table" role="region" aria-label="Service charges" tabIndex={0}>
            <table className="inv-table">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Billing period</th>
                  <th scope="col" style={{ minWidth: 170 }}>Change Details</th>
                  <th scope="col" className="text-center">Quantity</th>
                  <th scope="col" className="text-center">Monthly unit rate (Tk)</th>
                  <th scope="col" className="text-center">Days</th>
                  <th scope="col" className="text-end">Total (Tk)</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={7} className="text-center text-muted py-4">No recurring service charges on this invoice. See the summary for other charges.</td></tr>}
                {(() => {
                  const groups = Object.create(null);
                  items.forEach((item) => {
                    if (!groups[item.desc]) groups[item.desc] = [];
                    groups[item.desc].push(item);
                  });

                  const rows = [];
                  Object.entries(groups).forEach(([desc, segItems]) => {
                    const isMulti = segItems.length > 1;
                    const subtotal = segItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

                    // Sort segments chronologically by day
                    segItems.sort((a, b) => parseStartDayNum(a) - parseStartDayNum(b));

                    segItems.forEach((item, segmentIndex) => {
                      const isFirst = segmentIndex === 0;

                      // Chronological previous segment within the same service
                      const prevSeg = isMulti && segmentIndex > 0 ? segItems[segmentIndex - 1] : null;

                      // Build the change details cell content
                      const changeDetails = (() => {
                        const badges = [];

                        // 1. Explicit note from backend (if present)
                        if (item.change_note) {
                          const noteParts = String(item.change_note).split(" | ");
                          noteParts.forEach((part, pIdx) => {
                            const isRate = part.startsWith('Rate') || part.includes('Tk/Mo');
                            const isUp = part.includes('increased') || part.includes('+') || part.includes('↑');
                            const cls = isRate ? 'note-rate' : (isUp ? 'note-bw-up' : 'note-bw-down');
                            const arrowIcon = isRate ? '→' : (isUp ? '↑' : '↓');

                            let displayNote = part;
                            // Normalize verbose rate notes: "Rate changed from X → Y Tk/Month" to "Rate: X → Y Tk/Mo"
                            const rateMatch = part.match(/Rate(?: changed)? from ([\d,]+) → ([\d,]+) Tk\/(?:Month|Mo)/i);
                            if (rateMatch) {
                              displayNote = `Rate: ${rateMatch[1]} → ${rateMatch[2]} Tk/Mo`;
                            }

                            const verboseMatch = part.match(/BW\s+(increased|decreased)\s+from\s+(\d+)\s*→\s*(\d+)\s*Mbps(?:\s+on\s+([0-9a-zA-Z\s]+))?/i);
                            if (verboseMatch) {
                              const action = verboseMatch[1].toLowerCase();
                              const fromBw = Number(verboseMatch[2]);
                              const toBw = Number(verboseMatch[3]);
                              const diff = Math.abs(toBw - fromBw);
                              const datePart = verboseMatch[4] ? ` (${verboseMatch[4].trim()})` : '';
                              const sign = action === 'increased' ? '+' : '-';
                              displayNote = `BW ${fromBw} ${sign} ${diff} = ${toBw} Mbps${datePart}`;
                            }

                            badges.push(
                              <span key={`note-${pIdx}`} className={`inv-change-note ${cls}`}>
                                <span className="inv-arrow-icon me-1">{arrowIcon}</span>
                                {displayNote}
                              </span>
                            );
                          });
                        }

                        // 2. Dynamic Bandwidth Change detection between consecutive segments
                        if (badges.length === 0 || !badges.some(b => !String(b.props?.children?.[1] || '').includes('Tk/Mo'))) {
                          let prevBw = null;
                          if (prevSeg) {
                            prevBw = Number(prevSeg.bw);
                          } else if (item.prev_bw !== undefined) {
                            prevBw = Number(item.prev_bw);
                          }

                          const currBw = Number(item.bw);
                          if (prevBw !== null && !isNaN(prevBw) && !isNaN(currBw) && prevBw !== currBw) {
                            const isUp = currBw > prevBw;
                            const diff = Math.abs(currBw - prevBw);
                            const sign = isUp ? '+' : '-';
                            const arrow = isUp ? '↑' : '↓';
                            badges.unshift(
                              <span key="dyn-bw" className={`inv-change-note ${isUp ? 'note-bw-up' : 'note-bw-down'}`}>
                                <span className="inv-arrow-icon me-1">{arrow}</span>
                                BW {prevBw} {sign} {diff} = {currBw} Mbps
                              </span>
                            );
                          }
                        }

                        // 3. Dynamic Rate Change detection between consecutive segments
                        if (prevSeg) {
                          const prevRate = Number(prevSeg.rate);
                          const currRate = Number(item.rate);
                          if (prevRate !== currRate && !badges.some(b => String(b.props?.className || '').includes('note-rate'))) {
                            const isRateUp = currRate > prevRate;
                            const rateDiff = Math.abs(currRate - prevRate);
                            const rateSign = isRateUp ? '+' : '-';
                            badges.push(
                              <span key="dyn-rate" className="inv-change-note note-rate">
                                <span className="inv-arrow-icon me-1">→</span>
                                Rate: {fmt(prevRate)} → {fmt(currRate)} Tk/Mo ({rateSign}{fmt(rateDiff)})
                              </span>
                            );
                          }
                        }

                        if (badges.length > 0) {
                          return <div className="d-flex flex-column gap-1 align-items-start">{badges}</div>;
                        }

                        return <span className="text-muted" style={{ fontSize: 11 }}>—</span>;
                      })();

                      rows.push(
                        <tr key={`${desc}-${segmentIndex}`} className={isMulti ? 'inv-segment-row' : ''}>
                          {isFirst && (
                            <td rowSpan={isMulti ? segItems.length + 1 : 1} className="fw-bold align-middle">{desc}</td>
                          )}
                          <td><small className="text-muted">{item.date_range}</small></td>
                          <td>{changeDetails}</td>
                          <td className="text-center fw-semibold">{item.bw}<small className="d-block text-muted">{item.desc === 'Real IP' ? 'IPs' : 'Mbps'}</small></td>
                          <td className="text-center">
                            {fmt(item.rate)}

                          </td>
                          <td className="text-center">{item.days}</td>
                          <td className="text-end fw-bold">{fmt(item.total)}</td>
                        </tr>
                      );
                    });

                    if (isMulti) {
                      rows.push(
                        <tr key={`${desc}-subtotal`} className="inv-subtotal-row">
                          <td colSpan={5} className="text-end text-muted" style={{ fontSize: 11, paddingTop: 6, paddingBottom: 6 }}>
                            <i className="fas fa-equals me-1" />{desc} Total ({segItems.length} Segments)
                          </td>
                          <td className="text-end fw-bold" style={{ paddingTop: 6, paddingBottom: 6 }}>
                            {fmt(subtotal)}
                          </td>
                        </tr>
                      );
                    }
                  });

                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          <div className="row mt-4">
            <div className="col-md-6" />
            <div className="col-md-6">
              <table className="table table-borderless inv-summary mb-0">
                <tbody>
                  <tr><td className="text-end text-muted">Previous Due</td><td className="text-end text-muted fw-semibold">{fmt(prevDue)} {CURRENCY}</td></tr>
                  <tr><td className="text-end">Current month Bill ({monthName})</td><td className="text-end fw-bold">{fmt(runningBillAmount)} {CURRENCY}</td></tr>
                  {otcAmount > 0 && <tr><td className="text-end text-warning-emphasis">One-time charge</td><td className="text-end fw-bold text-warning-emphasis">{fmt(otcAmount)} {CURRENCY}</td></tr>}
                  {otherCharges !== 0 && <tr><td className="text-end">Equipment / other charges</td><td className="text-end fw-bold">{fmt(otherCharges)} {CURRENCY}</td></tr>}
                  <tr><td className="text-end fw-bold" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>Subtotal before adjustments</td><td className="text-end fw-bold" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>{fmt(prevDue + totalAmount + otherCharges)} {CURRENCY}</td></tr>
                  {hasLegacyAdjustment && (
                    <tr>
                      <td className="text-end text-muted">
                        Adjustment
                        {adjustmentNote && <><br /><small className="fst-italic">({adjustmentNote})</small></>}
                      </td>
                      <td className="text-end text-muted">{fmt(adjustment)} {CURRENCY}</td>
                    </tr>
                  )}
                  <tr><td className="text-end text-success">Payments received</td><td className="text-end fw-bold text-success">(-) {fmt(totalPaid)} {CURRENCY}</td></tr>
                  {totalDiscount > 0 && <tr><td className="text-end text-info">Discount</td><td className="text-end fw-bold text-info">(-) {fmt(totalDiscount)} {CURRENCY}</td></tr>}
                  <tr className="inv-total-row"><td className="text-end">{netPayable < 0 ? 'Credit balance' : 'Amount due'}</td><td className="text-end"><span className="inv-summary-amount">{fmt(Math.abs(netPayable))} {CURRENCY}</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="inv-footer text-center">
          <p className="m-0"><strong>Terms:</strong> Pay your bill on time to avoid service interruption.</p>
          <p className="m-0 mt-1">Thank you for being with Speed Net Khulna.</p>
        </div>
      </div>

      <div className="static-invoice-actions mt-4 mb-5 no-print">
        <button onClick={() => window.print()} className="btn btn-dark px-4 rounded-pill shadow-sm me-2"><i className="fas fa-print me-2" /> Print Invoice</button>
        <button onClick={downloadPNG} disabled={downloading} className="btn btn-outline-dark px-4 rounded-pill shadow-sm me-2">
          <i className={`fas ${downloading ? 'fa-spinner fa-spin' : 'fa-download'} me-2`} />
          {downloading ? 'Processing...' : 'Download PNG'}
        </button>
        <button onClick={handleSendEmail} disabled={sendingEmail} className="btn btn-primary px-4 rounded-pill shadow-sm me-2">
          <i className={`fas ${sendingEmail ? 'fa-spinner fa-spin' : 'fa-envelope'} me-2`} />
          {sendingEmail ? 'Sending...' : 'Email invoice'}
        </button>
        <button onClick={handleShareWhatsApp} className="btn btn-success px-4 rounded-pill shadow-sm me-2">
          <i className="fab fa-whatsapp me-2" />
          WhatsApp
        </button>
        <a href="/invoice" className="btn btn-light border px-4 rounded-pill">Back to invoices</a>
      </div>
    </div>
  );
};

export default ViewStaticInvoice;
