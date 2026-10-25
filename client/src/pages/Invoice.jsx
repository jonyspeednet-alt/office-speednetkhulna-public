import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { getInvoice, getInvoiceByBillId, getResellers, sendInvoiceEmail, sendInvoiceEmailByBillId, finalizeInvoice } from '../services/resellerService';
import { getCommissionSummary, getUserPayments } from '../services/channelPartnerService';
import BrandLogo from '../components/BrandLogo';
import CPCommissionTable from '../components/ResellerProfile/ChannelPartner/CPCommissionTable';
import RetroactiveCorrectionModal from '../components/Billing/RetroactiveCorrectionModal';
import BillingRulesPanel from '../components/Billing/BillingRulesPanel';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';
import { formatDateTime } from '../utils/formatters';
import '../styles/Invoice.css';

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
      invoice.querySelectorAll('.table-responsive').forEach((table) => { table.style.overflow = 'visible'; });
    }
  }
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmt = (n, decimals = 2) => {
  const num = Number(n || 0);
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const fmtTk = (n, decimals = 2) => `${fmt(n, decimals)} ৳`;

const toMonthName = (monthStr) => {
  if (!monthStr) return '';
  const d = new Date(monthStr.slice(0, 7) + '-15');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const todayStr = () =>
  new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
const getDhakaMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

const parseStartDayNum = (item) => {
  if (item?.from_day_num != null && !isNaN(Number(item.from_day_num))) {
    return Number(item.from_day_num);
  }
  const dateRange = String(item?.date_range || '');
  const match = dateRange.match(/^\s*(\d{1,2})/);
  if (match) return parseInt(match[1], 10);
  return 0;
};

const Invoice = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialResellerId = searchParams.get('resellerId') || '';
  const initialMonth = (searchParams.get('month') || '').slice(0, 7);
  const initialBillId = searchParams.get('id') || searchParams.get('billId') || '';

  const [resellers, setResellers] = useState([]);
  const [resellersLoaded, setResellersLoaded] = useState(false);
  const [resellerId, setResellerId] = useState(initialResellerId);
  const [month, setMonth] = useState(initialMonth || getDhakaMonth());
  const [billId, setBillId] = useState(initialBillId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [rulesRefetching, setRulesRefetching] = useState(false);
  const [showRetroactiveModal, setShowRetroactiveModal] = useState(false);
  const invoiceRef = useRef(null);
  const requestSequence = useRef(0);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const monthDays = validMonth ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 31;
  const validDay = (value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= monthDays);
  const periodError = !validMonth ? 'Choose a valid billing month.'
    : !validDay(fromDay) || !validDay(toDay) ? `Enter whole days between 1 and ${monthDays}.`
    : fromDay && toDay && Number(fromDay) > Number(toDay) ? 'The end day must be on or after the start day.' : '';
  const invoiceMonth = String(data?.month || month).slice(0, 7);
  const actionsDisabled = loading || rulesRefetching || Boolean(loadError) || Boolean(periodError) || finalizing;
  const resetInvoice = () => {
    requestSequence.current += 1;
    setData(null);
    setResellerId('');
    setBillId('');
    setFromDay('');
    setToDay('');
    setLoading(false);
    setLoadError('');
    setSearchParams({ month }, { replace: true });
  };

  useEffect(() => {
    if (resellersLoaded) return;
    getResellers()
      .then((list) => {
        setResellers(Array.isArray(list) ? list : []);
        setResellersLoaded(true);
      })
      .catch((e) => {
        console.error('[Invoice] getResellers:', e);
        notify.error('Failed to load resellers');
      });
  }, [resellersLoaded]);

  const loadInvoice = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if ((!billId && (!resellerId || periodError))) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      if (billId) {
        const result = await getInvoiceByBillId(billId);
        if (sequence !== requestSequence.current) return;
        if (result?.reseller?.partner_type === 'channel_partner') {
          const cpMonthYm = String(result.month || '').slice(0, 7);
          const [cpSummary, cpUserPayments] = await Promise.all([
            getCommissionSummary(result.reseller.id, cpMonthYm),
            getUserPayments(result.reseller.id, cpMonthYm).catch(() => [])
          ]);
          if (sequence !== requestSequence.current) return;
          setData({
            reseller: result.reseller,
            isChannel: true,
            cpCommission: cpSummary,
            cpUserPayments,
            month: result.month
          });
          setResellerId(String(result.reseller.id));
          if (result.month) setMonth(String(result.month).slice(0, 7));
          return;
        }
        setData(result);
        setResellerId(String(result?.reseller?.id || ''));
        if (result?.month) setMonth(String(result.month).slice(0, 7));
        return;
      }

      if (!resellerId) return;

      const selectedReseller = resellers.find(r => String(r.id) === String(resellerId));
      if (selectedReseller?.partner_type === 'channel_partner') {
        const [cpSummary, cpUserPayments] = await Promise.all([
          getCommissionSummary(resellerId, month),
          getUserPayments(resellerId, month).catch(() => [])
        ]);
        let resellerDetail = selectedReseller;
        try {
          const resInvoice = await getInvoice(resellerId, `${month}-01`);
          if (resInvoice?.reseller) resellerDetail = resInvoice.reseller;
        } catch (err) {
          console.error("Error loading reseller details:", err);
          notify.error('Failed to load reseller details');
        }
        if (sequence !== requestSequence.current) return;
        setData({
          reseller: resellerDetail,
          isChannel: true,
          cpCommission: cpSummary,
          cpUserPayments,
          month: `${month}-01`
        });
        return;
      }

      const params = { month: `${month}-01` };
      if (fromDay) params.from_day = fromDay;
      if (toDay) params.to_day = toDay;
      const result = await getInvoice(resellerId, params);
      if (sequence !== requestSequence.current) return;
      if (result?.reseller?.partner_type === 'channel_partner') {
        const [cpSummary, cpUserPayments] = await Promise.all([
          getCommissionSummary(resellerId, month),
          getUserPayments(resellerId, month).catch(() => [])
        ]);
        if (sequence !== requestSequence.current) return;
        setData({
          reseller: result.reseller,
          isChannel: true,
          cpCommission: cpSummary,
          cpUserPayments,
          month: `${month}-01`
        });
        return;
      }
      setData(result);
    } catch (e) {
      if (sequence !== requestSequence.current) return;
      console.error('[Invoice] getInvoice:', e);
      setLoadError(e?.response?.data?.message || 'Failed to load invoice. Please try again.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [resellerId, month, billId, resellers, fromDay, toDay, periodError]);

  useEffect(() => {
    loadInvoice();
    return () => { requestSequence.current += 1; };
  }, [billId, resellerId, month, loadInvoice]);

  const handleRulesChanged = useCallback(async () => {
    setRulesRefetching(true);
    try {
      await loadInvoice();
    } finally {
      setRulesRefetching(false);
    }
  }, [loadInvoice]);

  useEffect(() => {
    const rid = resellerId || data?.reseller?.id;
    if (!rid) return;
  }, [resellerId, data?.reseller?.id]);

  const downloadPNG = async () => {
    if (!invoiceRef.current || downloading || actionsDisabled) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(invoiceRef.current, snapshotOptions);
      const link = document.createElement('a');
      link.download = `Invoice_${data?.reseller?.name || 'reseller'}_${invoiceMonth}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[Invoice] html2canvas:', e);
      notify.error('Failed to download invoice image');
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
    if (actionsDisabled || sendingEmail) return;
    const target = window.prompt('Enter email address (to send invoice):');
    if (!target) return;
    const toEmail = target.trim();
    if (!toEmail) return;

    setSendingEmail(true);
    try {
      const snapshotDataUrl = await captureInvoiceDataUrl();
      if (bill?.id) {
        await sendInvoiceEmailByBillId(bill.id, { to_email: toEmail, snapshot_data_url: snapshotDataUrl });
      } else if (resellerId) {
        await sendInvoiceEmail(resellerId, { to_email: toEmail, month: invoiceMonth, snapshot_data_url: snapshotDataUrl });
      } else {
        notify.error('Select a reseller');
        return;
      }
      notify.success('Invoice email sent successfully.');
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Failed to send invoice email');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (actionsDisabled) return;
    try {
      const snapshotDataUrl = await captureInvoiceDataUrl();
      const resName = data?.reseller?.name || data?.reseller?.reseller_name || `Reseller ${resellerId}`;
      let text = '';
      if (data?.isChannel) {
        const summary = data.cpCommission;
        const totalPayable = Number(summary.total_payable || 0);
        const closing = Number(summary.closing_balance || 0);
        const formatMonthLabel = (ym) => {
          if (!ym || !/^\d{4}-\d{2}$/.test(String(ym))) return '';
          const [y, m] = String(ym).split('-');
          const d = new Date(Number(y), Number(m) - 1, 1);
          return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        };
        text = `Speed Net Khulna - Commission Invoice\nPartner: ${resName}\nMonth: ${formatMonthLabel(summary.month)}\nTotal Payable: ${totalPayable.toFixed(2)} ৳\nClosing Due: ${closing.toFixed(2)} ৳\nStatus: ${String(summary.commission_status || 'draft').toUpperCase()}`;
      } else {
        const directLink = bill?.id
          ? `${window.location.origin}/view-static-invoice?id=${bill.id}`
          : `${window.location.origin}/invoice?resellerId=${encodeURIComponent(resellerId)}&month=${encodeURIComponent(invoiceMonth)}`;
        text = `Invoice: ${resName} (${invoiceMonth})\n${directLink}`;
      }

      const response = await fetch(snapshotDataUrl);
      const blob = await response.blob();
      const file = new File([blob], `invoice_${resellerId || 'reseller'}_${invoiceMonth}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Invoice Snapshot' });
        return;
      }

      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      notify.info('Direct file share not supported in your browser. Invoice details opened in WhatsApp.');
    } catch (e) {
      notify.error('WhatsApp share failed');
    }
  };

  const handleFinalize = async () => {
    if (actionsDisabled || !data) return;
    const resellerName = data?.reseller?.name || data?.reseller?.reseller_name || `Reseller ${resellerId}`;
    const periodText = fromDay || toDay
      ? `${fromDay || '1'}-${toDay || monthDays} ${toMonthName(invoiceMonth)}`
      : toMonthName(invoiceMonth);
    const msg = `Are you sure you want to finalize the bill for ${resellerName} (${periodText})? This action cannot be undone.`;
    if (!(await confirmAction({ title: 'Finalize bill?', text: msg, confirmText: 'Finalize', danger: true }))) return;

    setFinalizing(true);
    try {
      const payload = { month: invoiceMonth };
      if (fromDay) payload.from_day = fromDay;
      if (toDay) payload.to_day = toDay;
      const result = await finalizeInvoice(resellerId, payload);
      notify.success(result.message || 'Bill finalized successfully.');
      const newBillId = String(result.bill_id);
      setBillId(newBillId);
      setSearchParams({ id: newBillId }, { replace: true });
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Failed to finalize bill');
    } finally {
      setFinalizing(false);
    }
  };

  const selectorBar = (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <select
        aria-label="Reseller"
        disabled={finalizing}
        className="form-select form-select-sm shadow-sm border-0"
        style={{ width: 'auto', minWidth: 180 }}
        value={resellerId}
        onChange={(e) => { const v = e.target.value; setResellerId(v); setBillId(''); setFromDay(''); setToDay(''); setData(null); setSearchParams({ resellerId: v, month }, { replace: true }); }}
      >
        <option value="">{'- Select Reseller -'}</option>
        {resellers.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>

      <input
        type="month"
        aria-label="Billing month"
        disabled={finalizing}
        className="form-control form-control-sm shadow-sm border-0"
        style={{ width: 'auto' }}
        value={month}
        onChange={(e) => { const v = e.target.value; setMonth(v); setBillId(''); setFromDay(''); setToDay(''); setData(null); setSearchParams({ resellerId, month: v }, { replace: true }); }}
      />
    </div>
  );

  if (!data) {
    return (
      <div className="container-fluid py-3 reseller-page invoice-page">
        <div className="card p-4">
          <h5 className="fw-bold mb-3">
            <i className="fas fa-file-invoice me-2 text-primary" />{'Invoice'}
          </h5>
          {loading && <div className="small text-muted mb-2"><span className="spinner-border spinner-border-sm me-1" />{'Loading...'}</div>}
          {selectorBar}
          {periodError && <p className="text-danger small mt-2" role="alert">{periodError}</p>}
          {loadError && <div className="alert alert-danger mt-3" role="alert">{loadError} <button className="btn btn-sm btn-outline-danger ms-2" onClick={loadInvoice}>Retry</button></div>}
        </div>
      </div>
    );
  }

  const { reseller, bill, items = [], total_paid = 0, total_discount = 0, total_product_charges = 0, discounts = [], retroactive_corrections = [] } = data;

  const dynamicTotal = Array.isArray(items) ? items.reduce((sum, row) => sum + Number(row?.total || 0), 0) : 0;
  const totalAmount = parseFloat(bill?.final_amount ?? (dynamicTotal > 0 ? dynamicTotal : (reseller?.projected_bill ?? 0)));
  const otcItems = Array.isArray(items) ? items.filter((item) => item?.desc === 'OTC') : [];
  const displayItems = Array.isArray(items) ? items.filter((item) => item?.desc !== 'OTC') : [];
  const otcAmount = otcItems.reduce((sum, item) => sum + Number(item?.total || 0), 0);
  const runningBillAmount = Math.max(0, Number(totalAmount || 0) - otcAmount);
  const adj = parseFloat(bill?.adjustment ?? 0);
  const adjNote = bill?.adjustment_note ?? '';
  const prevDue = parseFloat(bill?.previous_due ?? reseller?.due_amount ?? 0);
  const netPayable = prevDue + totalAmount + adj + Number(total_product_charges) - Number(total_paid) - Number(total_discount);
  const netPayableRounded = Number(netPayable.toFixed(2));
  const hasLegacyAdjustment = Math.abs(adj) > 0.0001;

  if (data?.isChannel) {
    const reseller = data.reseller;
    const summary = data.cpCommission;
    const net          = Number(summary.net_commission     || 0);
    const closing      = Number(summary.closing_balance    || 0);
    const profitPct    = Number(summary.profit_share_percentage ?? reseller.profit_share_percentage ?? 0);
    const status       = summary.commission_status || 'draft';

    const formatMonthLabel = (ym) => {
      if (!ym || !/^\d{4}-\d{2}$/.test(String(ym))) return '';
      const [y, m] = String(ym).split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    const getDhakaDateStr = () => {
      return new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    return (
      <div className="container-fluid py-3 reseller-page invoice-page">
        <div className="d-flex justify-content-between align-items-center mb-3 no-print" style={{ maxWidth: 850, margin: '0 auto 16px' }}>
          {selectorBar}

          <div className="d-flex gap-2 align-items-center">
            {status === 'finalized' ? (
              <span className="badge bg-success rounded-pill px-3 py-2">
                <i className="fas fa-check-circle me-1" />Finalized
              </span>
            ) : (
              <span className="badge bg-warning text-dark rounded-pill px-3 py-2">
                <i className="fas fa-clock me-1" />Draft View
              </span>
            )}

            <button className="btn btn-dark btn-sm rounded-pill shadow-sm" onClick={() => window.print()} disabled={actionsDisabled}>
              <i className="fas fa-print me-1" />Print
            </button>
            <button className="btn btn-outline-dark btn-sm rounded-pill shadow-sm" onClick={downloadPNG} disabled={downloading || actionsDisabled}>
              {downloading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-download me-1" />}
              PNG
            </button>
            <button className="btn btn-primary btn-sm rounded-pill shadow-sm" onClick={handleSendEmail} disabled={sendingEmail || actionsDisabled}>
              {sendingEmail ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-envelope me-1" />}
              Email
            </button>
            <button className="btn btn-success btn-sm rounded-pill shadow-sm" onClick={handleShareWhatsApp} disabled={actionsDisabled}>
              <i className="fab fa-whatsapp me-1" />
              WhatsApp
            </button>
          </div>
        </div>

        {loadError && <div className="alert alert-danger no-print" role="alert">{loadError} <button className="btn btn-sm btn-outline-danger ms-2" onClick={loadInvoice}>Retry</button></div>}
        {loading && <p className="text-center no-print" role="status">Updating invoice…</p>}
        <div className={`inv-container ${closing <= 0 ? 'status-paid' : 'status-due'} p-0`} id="invoiceContent" ref={invoiceRef} style={{ maxWidth: 850, margin: '0 auto', border: '1px solid #cbd5e1', fontFamily: '"Hind Siliguri","Noto Sans Bengali","Nirmala UI",Arial,Helvetica,sans-serif' }}>

          <div className={`inv-watermark ${closing <= 0 ? 'paid' : ''}`}>
            {closing <= 0 ? 'PAID' : 'DUE'}
          </div>

          <div className="inv-header d-flex justify-content-between align-items-center py-4 px-5">
            <div className="inv-brand">
              <BrandLogo className="inv-logo" alt="Speed Net Khulna" />
            </div>
            <div className="text-end">
              <div className="inv-label">Commission Month</div>
              <div className="inv-number text-primary">{formatMonthLabel(summary.month)}</div>
            </div>
          </div>

          <div className="inv-body p-5">
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
                <div className="inv-info-label">Partner</div>
                <div className="inv-info-text">
                  <strong>{reseller.name || reseller.reseller_name}</strong><br />
                  {reseller.company_name && <>{reseller.company_name}<br /></>}
                  {reseller.pop_location && <>{reseller.pop_location}<br /></>}
                  {reseller.phone && <>Phone: {reseller.phone}</>}
                </div>
              </div>
            </div>

            <div className="inv-meta row mb-4 mx-0 bg-light rounded py-3">
              <div className="col-4 border-end"><small>Invoice Date</small><div className="inv-meta-val">{getDhakaDateStr()}</div></div>
              <div className="col-4 border-end text-center"><small>Profit Share</small><div className="inv-meta-val text-primary-custom">{profitPct}%</div></div>
              <div className="col-4 text-end"><small>Net Commission</small><div className="inv-meta-val text-success">{fmtTk(net)}</div></div>
            </div>

            {/* ── Single Unified Commission Table ── */}
            <CPCommissionTable summary={summary} reseller={reseller} fmtMoney={fmtTk} />

            {/* Detailed Customer Summary Table */}
            {Array.isArray(data.cpUserPayments) && data.cpUserPayments.length > 0 && (
              <div className="mt-5">
                <h5 className="mb-3 text-dark fw-bold border-bottom pb-2 d-flex align-items-center" style={{ borderBottomColor: '#cbd5e1' }}>
                  <i className="fas fa-list-alt me-2 text-primary" />
                  Detailed Customer Summary
                </h5>
                <div className="table-responsive">
                  <table className="table table-bordered table-striped align-middle text-center" style={{ fontSize: '0.85rem' }}>
                    <thead className="table-light text-dark fw-semibold">
                      <tr>
                        <th scope="col" className="py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>#</th>
                        <th scope="col" className="text-start py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Customer</th>
                        <th scope="col" className="py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>ID</th>
                        <th scope="col" className="py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Package</th>
                        <th scope="col" className="text-end py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Monthly Bill</th>
                        <th scope="col" className="text-end py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Collected</th>
                        <th scope="col" className="text-end py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Deferred</th>
                        <th scope="col" className="py-2" style={{ backgroundColor: '#f8fafc', color: '#1e293b' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cpUserPayments.map((user, idx) => {
                        const amountDue = Number(user.amount_due || 0);
                        const amountPaid = Number(user.amount_paid || 0);
                        const remaining = Math.max(0, amountDue - amountPaid);

                        let badgeClass = "bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25";
                        let statusText = "Deferred";
                        if (amountPaid >= amountDue && amountDue > 0) {
                          badgeClass = "bg-success bg-opacity-10 text-success border border-success border-opacity-25";
                          statusText = "Paid";
                        } else if (amountPaid > 0) {
                          badgeClass = "bg-warning bg-opacity-10 text-warning border border-warning border-opacity-25";
                          statusText = "Partial";
                        }

                        return (
                          <tr key={user.id || idx}>
                            <td className="py-2">{idx + 1}</td>
                            <td className="text-start fw-semibold text-dark py-2">{user.user_name}</td>
                            <td className="py-2 text-muted">{user.user_id_code || '-'}</td>
                            <td className="py-2">{user.package_name || '-'}</td>
                            <td className="text-end fw-semibold py-2">{fmtTk(amountDue)}</td>
                            <td className="text-end text-success fw-semibold py-2">{fmtTk(amountPaid)}</td>
                            <td className="text-end text-danger fw-semibold py-2">{fmtTk(remaining)}</td>
                            <td className="py-2">
                              <span className={`badge rounded-pill ${badgeClass} px-2 py-1`} style={{ fontSize: '0.75rem' }}>
                                {statusText}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
<div className="inv-footer text-center py-4 px-5 bg-light">
            <p className="m-0 fw-semibold">For any commission or settlement related inquiries, contact Speed Net Billing Department.</p>
            <p className="m-0 mt-1 small text-muted">Speed Net Khulna - Prosperity through Partnership!</p>
          </div>

        </div>

        <div className="text-center mt-4 mb-5 no-print">
          <button className="btn btn-light border px-4 rounded-pill" onClick={resetInvoice}>
            <i className="fas fa-arrow-left me-1" />{'Choose another invoice'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3 reseller-page invoice-page">
      {/* Top toolbar: selector + action buttons */}
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2 no-print" style={{ maxWidth: 850, margin: '0 auto 16px' }}>
        {selectorBar}
        <div className="d-flex gap-2 align-items-center">
          {bill ? (
            <a href={`/view-static-invoice?id=${bill.id}`} target="_blank" rel="noreferrer" className="btn btn-success btn-sm rounded-pill shadow-sm">
              <i className="fas fa-check-circle me-1" />{'View Final Bill'}
            </a>
          ) : (
            <span className="badge bg-warning text-dark rounded-pill px-3 py-2"><i className="fas fa-clock me-1" />{'Projected'}</span>
          )}
          {data?.reseller?.partner_type !== 'channel_partner' && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm rounded-pill shadow-sm fw-semibold"
              disabled={actionsDisabled}
              onClick={() => setShowRetroactiveModal(true)}
              title="Fix missed back-dated bandwidth change and recalculate bills"
            >
              <i className="fas fa-history me-1" />
              Correction
            </button>
          )}
          <button className="btn btn-dark btn-sm rounded-pill shadow-sm" onClick={() => window.print()} disabled={actionsDisabled}>
            <i className="fas fa-print me-1" />{'Print'}
          </button>
          <button className="btn btn-outline-dark btn-sm rounded-pill shadow-sm" onClick={downloadPNG} disabled={downloading || actionsDisabled}>
            {downloading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-download me-1" />}
            PNG
          </button>
          <button className="btn btn-primary btn-sm rounded-pill shadow-sm" onClick={handleSendEmail} disabled={sendingEmail || actionsDisabled}>
            {sendingEmail ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-envelope me-1" />}
            Email
          </button>
          <button className="btn btn-success btn-sm rounded-pill shadow-sm" onClick={handleShareWhatsApp} disabled={actionsDisabled}>
            <i className="fab fa-whatsapp me-1" />
            WhatsApp
          </button>
        </div>
      </div>

      {/* Billing period row (only before finalization) */}
      {!bill && (() => {
        const daysInMonth = month ? new Date(parseInt(month.slice(0,4)), parseInt(month.slice(5,7)), 0).getDate() : 30;
        const dayCount = fromDay && toDay && parseInt(toDay) >= parseInt(fromDay) ? parseInt(toDay) - parseInt(fromDay) + 1 : 0;
        const handleDayClick = (day) => {
          const dayStr = String(day);
          if (!fromDay) { setFromDay(dayStr); }
          else if (!toDay) {
            if (day >= parseInt(fromDay)) setToDay(dayStr);
            else setFromDay(dayStr);
          } else {
            setFromDay(dayStr); setToDay('');
          }
        };
        return (
        <div className="billing-period-card no-print" style={{ maxWidth: 850, margin: '0 auto 16px' }}>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <span className="fw-semibold" style={{ fontSize: '0.85rem', color: '#1e293b', whiteSpace: 'nowrap' }}>
              <i className="fas fa-calendar-alt me-1 text-primary" />Billing Period:
            </span>
            <label className="d-flex align-items-center gap-1">
              <span className="text-muted small">From</span>
              <input type="number" min="1" max={daysInMonth} className="form-control form-control-sm day-input"
                value={fromDay} placeholder="1" disabled={finalizing} aria-invalid={Boolean(periodError)}
                onChange={(e) => { setFromDay(e.target.value); }} />
            </label>
            <label className="d-flex align-items-center gap-1">
              <span className="text-muted small">To</span>
              <input type="number" min="1" max={daysInMonth} className="form-control form-control-sm day-input"
                value={toDay} placeholder={String(daysInMonth)} disabled={finalizing} aria-invalid={Boolean(periodError)}
                onChange={(e) => { setToDay(e.target.value); }} />
            </label>
            {dayCount > 0 && (
              <span className="badge bg-primary bg-opacity-10 text-primary rounded-pill px-2 py-1" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                {dayCount} days
              </span>
            )}
            {dayCount > 0 && data && (
              <span className="text-success fw-semibold small" style={{ whiteSpace: 'nowrap' }}>
                ≈ {fmtTk(dynamicTotal)}
              </span>
            )}
            <span className="text-muted" style={{ fontSize: '0.7rem' }}>(blank = full month)</span>
          </div>
          <details className="inv-period-picker">
          <summary>Choose dates on a calendar</summary>
          {/* Visual day strip */}
          <div className="day-strip d-flex flex-wrap gap-1 mb-2">
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const from = parseInt(fromDay);
              const to = parseInt(toDay);
              const inRange = from && to && day >= from && day <= to;
              const isEdge = day === from || day === to;
              const isFromOnly = String(day) === fromDay && !toDay;
              return (
                <button key={day} type="button"
                  className={`day-pill ${inRange ? 'in-range' : ''} ${isEdge && from !== to ? 'edge' : ''} ${isFromOnly ? 'selected' : ''}`}
                  onClick={() => handleDayClick(day)} disabled={finalizing} aria-pressed={Boolean(inRange || isEdge)} aria-label={`Day ${day}`}>
                  {day}
                </button>
              );
            })}
          </div>
          </details>
          <div className="d-flex justify-content-between align-items-center">
            <small className="text-muted">Leave both days blank for the full month.</small>
            <button className="btn btn-danger btn-sm rounded-pill shadow-sm px-4" onClick={handleFinalize} disabled={actionsDisabled}>
              {finalizing ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-check-circle me-1" />}
              {finalizing ? 'Finalizing...' : 'Finalize Bill'}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Recurring billing rules (hidden for channel partners inside the panel) */}
      {!bill && (
        <BillingRulesPanel
          resellerId={resellerId || data?.reseller?.id}
          monthYm={invoiceMonth}
          partnerType={data?.reseller?.partner_type}
          onChanged={handleRulesChanged}
        />
      )}

      {periodError && <div className="alert alert-warning no-print" role="alert">{periodError}</div>}
      {loadError && <div className="alert alert-danger no-print" role="alert">{loadError} <button className="btn btn-sm btn-outline-danger ms-2" onClick={loadInvoice}>Retry</button></div>}
      {loading && data && (
        <div className="text-center py-1 no-print" style={{ maxWidth: 850, margin: '0 auto' }}>
          <span className="spinner-border spinner-border-sm text-primary me-2" role="status" />
          <span className="small text-muted">Recalculating...</span>
        </div>
      )}
      <div className={`inv-container ${netPayableRounded <= 0 ? 'status-paid' : 'status-due'}`} id="invoiceContent" ref={invoiceRef} style={{ maxWidth: 850, margin: '0 auto', fontFamily: '"Hind Siliguri","Noto Sans Bengali","Nirmala UI",Arial,Helvetica,sans-serif' }}>
        <div className={`inv-watermark${netPayableRounded <= 0 ? ' paid' : ''}`}>{!bill ? 'ESTIMATE' : netPayableRounded < 0 ? 'CREDIT' : netPayableRounded === 0 ? 'PAID' : 'DUE'}</div>

        <div className="inv-header d-flex justify-content-between align-items-center">
          <div className="inv-brand">
            <BrandLogo className="inv-logo" alt="Speed Net Khulna" />
          </div>
          <div className="text-end">
            <div className="inv-label">{fromDay && toDay ? 'Billing Period' : 'Billing Month'}</div>
            <div className="inv-number">{fromDay && toDay ? `${fromDay} - ${toDay} ${toMonthName(invoiceMonth)}` : toMonthName(invoiceMonth)}</div>
          </div>
        </div>

        <div className="inv-body">
          <div className="row mb-4">
            <div className="col-6">
              <div className="inv-info-label">{'From'}</div>
              <div className="inv-info-text">
                <strong className="text-dark">Speed Net Khulna</strong><br />
                Khulna, Bangladesh<br />
                Phone: +880 1910365577<br />
                Email: billing@speednetkhulna.com
              </div>
            </div>
            <div className="col-6 text-end">
              <div className="inv-info-label">{'To'}</div>
              <div className="inv-info-text">
                <strong>{reseller.name || reseller.reseller_name}</strong><br />
                {reseller.company_name && <>{reseller.company_name}<br /></>}
                {reseller.pop_location && <>{reseller.pop_location}<br /></>}
                {reseller.phone && <>{'Contact'}: {reseller.phone}</>}
              </div>
            </div>
          </div>

          <div className="inv-balance-overview">
            <div><span className="inv-info-label">{!bill ? 'Estimated balance' : 'Invoice balance'}</span>
              <h2>{netPayableRounded < 0 ? 'Advance credit' : netPayableRounded === 0 ? 'Nothing due' : 'Amount due'}</h2>
              <p>{netPayableRounded < 0 ? 'Credit remains after the charges and payments below.' : !bill ? 'This is an estimate. Finalize the bill to confirm it.' : 'Includes previous balance, charges, payments and discounts below.'}</p>
            </div>
            <strong>{fmtTk(Math.abs(netPayableRounded))}</strong>
          </div>

          <div className="inv-meta row mb-4">
            <div className="col-4 border-end"><small>{bill?.created_at ? 'Invoice date' : 'Prepared on'}</small><div className="inv-meta-val">{bill?.created_at ? new Date(bill.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : todayStr()}</div></div>
            <div className="col-4 border-end text-center"><small>{fromDay && toDay ? 'Billing Period' : 'Billing Month'}</small><div className="inv-meta-val text-primary-custom">{fromDay && toDay ? `${fromDay} - ${toDay} ${toMonthName(invoiceMonth)}` : toMonthName(invoiceMonth)}</div></div>
            <div className="col-4 text-end"><small>{'Total Bill'}</small><div className="inv-meta-val">{fmtTk(totalAmount)}</div></div>
          </div>

          <h3 className="inv-section-title">Bill breakdown</h3>
          <p className="inv-calculation-help">Each row covers one service period. Amount = quantity × monthly unit rate × billed days ÷ days in the month. Quantity is Mbps for bandwidth, or the number of IPs for Real IP.</p>
          <div className="table-responsive inv-breakdown-scroll" role="region" aria-label="Bill breakdown — scroll horizontally for all columns" tabIndex={0}>
            {displayItems.length > 0 ? (
              <table className="inv-table">
                <thead>
                  <tr>
                    <th scope="col">{'Description'}</th>
                    <th scope="col">{'Date Range'}</th>
                    <th scope="col" style={{ minWidth: 170 }}>{'Change Details'}</th>
                    <th scope="col" className="text-center">{'Quantity'}</th>
                    <th scope="col" className="text-center">Monthly unit rate (Tk)</th>
                    <th scope="col" className="text-center">{'Days'}</th>
                    <th scope="col" className="text-end">{'Total (Tk)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const groups = Object.create(null);
                    displayItems.forEach((item) => {
                      if (!groups[item.desc]) groups[item.desc] = [];
                      groups[item.desc].push(item);
                    });

                    const rows = [];

                    // Retroactive-correction markers: flag line-item segments whose billed
                    // day-range contains a correction's effective date for that BW type,
                    // so the invoice table visibly links to the correction history panel.
                    const correctedMarks = new Map();
                    try {
                      (Array.isArray(retroactive_corrections) ? retroactive_corrections : []).forEach((rc) => {
                        let fc = {};
                        try {
                          fc = typeof rc.field_changes === 'string' ? JSON.parse(rc.field_changes) : (rc.field_changes || {});
                        } catch (_) { fc = {}; }
                        if (fc.affected_month && fc.affected_month !== month) return;
                        (Array.isArray(fc.corrections) ? fc.corrections : []).forEach((c) => {
                          const eff = String(c.effective_date || '').slice(0, 10);
                          const day = Number(eff.slice(8, 10));
                          const bw = String(c.bw_type || '').toUpperCase();
                          if (!eff || !day || !bw) return;
                          if (!correctedMarks.has(bw)) correctedMarks.set(bw, []);
                          correctedMarks.get(bw).push(eff);
                        });
                      });
                    } catch (_) { /* marker lookup is best-effort */ }
                    const correctedMarkFor = (item) => {
                      const bw = String(item.desc || '').toUpperCase();
                      const list = correctedMarks.get(bw);
                      if (!list || list.length === 0) return null;
                      const from = Number(item.from_day_num);
                      const to = Number(item.to_day_num);
                      if (!from || !to) return list[0];
                      const hit = list.find((eff) => {
                        const d = Number(String(eff).slice(8, 10));
                        return d >= from && d <= to;
                      });
                      return hit || null;
                    };
                    Object.entries(groups).forEach(([desc, segItems]) => {
                      const isMulti = segItems.length > 1;
                      const subtotal = segItems.reduce((s, i) => s + Number(i.total || 0), 0);

                      // Sort segments chronologically by day
                      segItems.sort((a, b) => parseStartDayNum(a) - parseStartDayNum(b));

                      segItems.forEach((item, si) => {
                        const isFirst = si === 0;

                        // Chronological previous segment within the same service
                        const prevSeg = isMulti && si > 0 ? segItems[si - 1] : null;

                        // Build the change details cell content
                        const changeDetails = (() => {
                          const badges = [];

                          // 1. Explicit note from backend (if present)
                          if (item.change_note) {
                            const noteParts = String(item.change_note).split(" | ");
                            noteParts.forEach((part, pIdx) => {
                              const isRate = part.startsWith('Rate') || part.includes('Tk/Mo') || part.includes('Tk/Month');
                              const isUp = part.includes('increased') || part.includes('+') || part.includes('↑');
                              const cls = isRate ? 'note-rate' : (isUp ? 'note-bw-up' : 'note-bw-down');
                              const arrowIcon = isRate ? '→' : (isUp ? '↑' : '↓');

                              let displayNote = part;
                              // Normalize verbose rate notes: "Rate changed from X → Y Tk/Month" to "Rate: X → Y Tk/Mo"
                              const rateMatch = part.match(/Rate(?: changed)? from ([\d,]+) → ([\d,]+) Tk\/(?:Month|Mo)/i);
                              if (rateMatch) {
                                displayNote = `Rate: ${rateMatch[1]} → ${rateMatch[2]} Tk/Mo`;
                              }

                              // Normalize any older verbose "BW increased from X → Y Mbps on DD Mon" to concise "BW X + Y = Z Mbps"
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

                          // 2. Dynamic Bandwidth Change detection between consecutive chronological segments
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
                                  Rate: {fmt(prevRate, 0)} → {fmt(currRate, 0)} Tk/Mo ({rateSign}{fmt(rateDiff, 0)})
                                </span>
                              );
                            }
                          }

                          // 4. Retroactive-correction marker (links row to history panel)
                          const correctedEff = correctedMarkFor(item);
                          if (correctedEff) {
                            badges.push(
                              <span key="corrected" className="inv-change-note note-corrected">
                                <span className="inv-arrow-icon me-1">✓</span>
                                Corrected (eff. {String(correctedEff).slice(0, 10)})
                              </span>
                            );
                          }

                          if (badges.length > 0) {
                            return <div className="d-flex flex-column gap-1 align-items-start">{badges}</div>;
                          }

                          return <span className="text-muted" style={{ fontSize: 11 }}>—</span>;
                        })();

                        rows.push(
                          <tr key={`${desc}-${si}`} className={isMulti ? 'inv-segment-row' : ''}>
                            {isFirst && (
                              <td
                                rowSpan={isMulti ? segItems.length + 1 : 1}
                                className="fw-bold align-middle"
                              >
                                {desc}
                              </td>
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
                              {desc} total · {segItems.length} periods
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
            ) : (
              <table className="inv-table">
                <thead><tr><th scope="col">{'Description'}</th><th scope="col" className="text-end">{'Amount (Tk)'}</th></tr></thead>
                <tbody><tr><td className="fw-bold">{bill ? 'Monthly Bill' : 'Projected Bill'} - {toMonthName(invoiceMonth)}</td><td className="text-end fw-bold">{fmt(totalAmount)}</td></tr></tbody>
              </table>
            )}
          </div>

          <div className="row mt-4">
            <div className="col-md-6"></div>
            <div className="col-md-6">
              <table className="table table-borderless inv-summary mb-0">
                <tbody>
                  <tr><td className="text-end text-muted">Previous Due</td><td className="text-end text-muted fw-semibold">{fmtTk(prevDue)}</td></tr>
                  <tr><td className="text-end">Current month Bill ({toMonthName(invoiceMonth)})</td><td className="text-end fw-bold">{fmtTk(runningBillAmount)}</td></tr>
                  {otcAmount > 0 && <tr><td className="text-end">One-time charge</td><td className="text-end fw-bold">{fmtTk(otcAmount)}</td></tr>}
                  {Number(total_product_charges) !== 0 && <tr><td className="text-end">Equipment / other charges</td><td className="text-end fw-bold">{fmtTk(total_product_charges)}</td></tr>}
                  <tr><td className="text-end fw-bold" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>Subtotal</td><td className="text-end fw-bold" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>{fmtTk(prevDue + totalAmount + Number(total_product_charges))}</td></tr>
                  {hasLegacyAdjustment && (
                    <tr>
                      <td className="text-end text-muted">
                        {'Adjustment'}
                        {adjNote && <><br /><small className="fst-italic">({adjNote})</small></>}
                      </td>
                      <td className="text-end text-muted">{fmtTk(adj)}</td>
                    </tr>
                  )}
                  <tr><td className="text-end text-success fw-bold">Total Paid</td><td className="text-end fw-bold text-success">(-) {fmtTk(total_paid)}</td></tr>
                  {discounts.length > 0 ? discounts.map((disc, i) => {
                    return (
                    <tr key={disc.id || `d-${i}`}>
                      <td className="text-end text-info" style={{ fontSize: '0.85rem' }}>
                        Discount <span className="text-muted">{formatDate(disc.effective_date || disc.created_at)}</span>
                      </td>
                      <td className="text-end fw-bold text-info" style={{ fontSize: '0.85rem' }}>(-) {fmtTk(disc.amount)}</td>
                    </tr>
                    );
                  }) : total_discount > 0 ? (
                    <tr><td className="text-end text-info">Discount</td><td className="text-end fw-bold text-info">(-) {fmtTk(total_discount)}</td></tr>
                  ) : null}
                  <tr className="inv-total-row"><td className="text-end">{netPayableRounded < 0 ? 'Advance credit' : netPayableRounded === 0 ? 'Nothing due' : 'Amount due'}</td><td className="text-end"><span className="inv-summary-amount">{fmtTk(Math.abs(netPayableRounded))}</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Retroactive Corrections Audit Panel ── */}
        {Array.isArray(retroactive_corrections) && retroactive_corrections.length > 0 && (
          <div className="inv-retro-panel">
            <div className="inv-retro-header">
              <i className="fas fa-history me-2" />
              Correction history for this bill
              <span className="inv-retro-count">{retroactive_corrections.length}</span>
            </div>
            <div className="table-responsive" role="region" aria-label="Correction history" tabIndex={0}>
            <table className="inv-retro-table">
              <thead>
                <tr>
                  <th scope="col">Applied On</th>
                  <th scope="col">Applied By</th>
                  <th scope="col">Details</th>
                  <th scope="col" className="text-end">Bill Before</th>
                  <th scope="col" className="text-end">Bill After</th>
                  <th scope="col" className="text-end">Δ Change</th>
                </tr>
              </thead>
              <tbody>
                {retroactive_corrections.map((rc, i) => {
                  const appliedOn = formatDateTime(rc.created_at) || '—';
                  const delta = Number(rc.amount_delta || 0);
                  const fieldChanges = (() => {
                    try {
                      const fc = typeof rc.field_changes === 'string' ? JSON.parse(rc.field_changes) : (rc.field_changes || {});
                      return fc;
                    } catch (_) { return {}; }
                  })();
                  const noteText = rc.note || (() => {
                    const list = Array.isArray(fieldChanges.corrections) ? fieldChanges.corrections : [];
                    if (list.length > 0) {
                      return list.map((c) => c.correction_type === 'rate'
                        ? `Rate ${c.bw_type || ''} → ${c.new_rate} Tk/Mo${c.effective_date ? ` (eff. ${String(c.effective_date).slice(0, 10)})` : ''}`
                        : `BW ${c.change_type || ''} ${c.amount || ''} Mbps ${c.bw_type || ''}${c.effective_date ? ` (eff. ${String(c.effective_date).slice(0, 10)})` : ''}`).join('; ');
                    }
                    return fieldChanges.correction_type
                      ? `${fieldChanges.correction_type} correction on ${fieldChanges.bw_type || ''}${fieldChanges.effective_date ? ` (eff. ${fieldChanges.effective_date})` : ''}`
                      : 'Retroactive correction';
                  })();
                  return (
                    <tr key={rc.id || i}>
                      <td><small>{appliedOn}</small></td>
                      <td>
                        <small>{rc.actor_user_name || '—'}</small>
                        {rc.actor_role && <small className="text-muted ms-1">({rc.actor_role})</small>}
                      </td>
                      <td><small className="inv-retro-note">{noteText}</small></td>
                      <td className="text-end"><small>{rc.amount_before != null ? fmtTk(rc.amount_before) : '—'}</small></td>
                      <td className="text-end"><small>{rc.amount_after != null ? fmtTk(rc.amount_after) : '—'}</small></td>
                      <td className={`text-end fw-bold ${delta > 0 ? 'text-danger' : delta < 0 ? 'text-success' : 'text-muted'}`}>
                        <small>{delta !== 0 ? `${delta > 0 ? '+' : ''}${fmtTk(delta)}` : '—'}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div className="inv-retro-footer">
              <i className="fas fa-info-circle me-1 text-primary" />
              Bill amounts above have been recalculated to reflect back-dated changes.               Each correction entry shows the net impact on this month&apos;s bill.
            </div>
          </div>
        )}

        <div className="inv-footer text-center">
          <p className="m-0"><strong>{'Terms:'}</strong> {'Pay your bill on time to avoid service interruption.'}</p>
          <p className="m-0 mt-1">{'Thank you for being with Speed Net Khulna.'}</p>
        </div>
      </div>

      <div className="text-center mt-4 mb-5 no-print">
        <button className="btn btn-light border px-4 rounded-pill" onClick={resetInvoice} disabled={finalizing}>
          <i className="fas fa-arrow-left me-1" />{'Choose another invoice'}
        </button>
      </div>

      <RetroactiveCorrectionModal
        reseller={data?.reseller}
        isOpen={showRetroactiveModal}
        onClose={() => setShowRetroactiveModal(false)}
        onSuccess={() => {
          loadInvoice();
        }}
      />
    </div>
  );
};

export default Invoice;
