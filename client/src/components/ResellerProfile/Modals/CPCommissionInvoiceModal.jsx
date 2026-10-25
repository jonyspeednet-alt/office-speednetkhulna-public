import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import ModalWrap from "../ModalWrap";
import { money } from "../../../utils/formatters";
import BrandLogo from "../../BrandLogo";
import CPCommissionTable from "../../ResellerProfile/ChannelPartner/CPCommissionTable";
import { notify } from "../../../utils/notify";

const CPCommissionInvoiceModal = ({ reseller, summary, onClose }) => {
  const [downloading, setDownloading] = useState(false);
  const invoiceRef = useRef(null);

  const closing      = Number(summary.closing_balance    || 0);
  const totalPayable = Number(summary.total_payable      || 0);
  const profitPct    = Number(summary.profit_share_percentage ?? reseller.profit_share_percentage ?? 0);
  const net          = Number(summary.net_commission     || 0);
  const status       = summary.commission_status || 'draft';

  const formatMonthLabel = (ym) => {
    if (!ym || !/^\d{4}-\d{2}$/.test(String(ym))) return '';
    const [y, m] = String(ym).split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const getDhakaDateStr = () =>
    new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });

  const downloadPNG = async () => {
    if (!invoiceRef.current || downloading) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(invoiceRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `Commission_Invoice_${reseller?.name || "reseller"}_${summary.month}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("[Invoice] html2canvas failed:", e);
    } finally {
      setDownloading(false);
    }
  };

  const handleShareWhatsApp = () => {
    try {
      const resName = reseller?.name || `Reseller ${reseller?.id}`;
      const text = `Speed Net Khulna - Commission Invoice\nPartner: ${resName}\nMonth: ${formatMonthLabel(summary.month)}\nTotal Payable: ${money(totalPayable)}\nClosing Due: ${money(closing)}\nStatus: ${status.toUpperCase()}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify.error("WhatsApp share failed");
    }
  };

  return (
    <ModalWrap title="Commission Invoice" onClose={onClose} size="lg">
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body > #root, .navbar, .sidebar, .modal-backdrop, .rp-modal-backdrop, .no-print {
            display: none !important;
          }
          body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
          #commissionInvoicePrintArea {
            display: block !important; position: absolute !important; left: 0 !important;
            top: 0 !important; width: 100% !important; background: #ffffff !important;
            box-shadow: none !important; border: none !important; z-index: 9999999 !important;
          }
          .inv-container { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
        }
      `}} />

      {/* Action buttons */}
      <div className="no-print d-flex gap-2 justify-content-end mb-3">
        <button className="btn btn-dark btn-sm rounded-pill px-3" onClick={() => window.print()}>
          <i className="fas fa-print me-1" /> Print
        </button>
        <button className="btn btn-outline-dark btn-sm rounded-pill px-3" onClick={downloadPNG} disabled={downloading}>
          {downloading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="fas fa-download me-1" />}
          Download PNG
        </button>
        <button className="btn btn-success btn-sm rounded-pill px-3" onClick={handleShareWhatsApp}>
          <i className="fab fa-whatsapp me-1" /> WhatsApp Share
        </button>
      </div>

      <div id="commissionInvoicePrintArea">
        <div
          className={`inv-container ${closing <= 0 ? 'status-paid' : 'status-due'} p-0`}
          ref={invoiceRef}
          style={{ border: '1px solid #cbd5e1' }}
        >
          <div className={`inv-watermark ${closing <= 0 ? 'paid' : ''}`}>
            {closing <= 0 ? 'PAID' : 'DUE'}
          </div>

          {/* ── Header ── */}
          <div className="inv-header d-flex justify-content-between align-items-center py-4 px-5">
            <div>
              <div className="inv-brand">
                <BrandLogo className="inv-logo" alt="Speed Net Khulna" />
              </div>
              <p className="text-muted small mb-0 mt-1">
                Khulna&apos;s Leading Internet Service Provider
              </p>
            </div>
            <div className="text-end">
              <div className="inv-label">Commission Month</div>
              <div className="inv-number text-primary">{formatMonthLabel(summary.month)}</div>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="inv-body p-5">
            {/* From / To */}
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

            {/* Meta bar */}
            <div className="inv-meta row mb-4 mx-0 bg-light rounded py-3">
              <div className="col-4 border-end">
                <small>Invoice Date</small>
                <div className="inv-meta-val">{getDhakaDateStr()}</div>
              </div>
              <div className="col-4 border-end text-center">
                <small>Profit Share</small>
                <div className="inv-meta-val text-primary-custom">{profitPct}%</div>
              </div>
              <div className="col-4 text-end">
                <small>Net Commission</small>
                <div className="inv-meta-val text-success">{money(net)}</div>
              </div>
            </div>

            {/* ── Single Unified Table ── */}
            <CPCommissionTable summary={summary} reseller={reseller} />
          </div>

          {/* ── Footer ── */}
          <div className="inv-footer text-center py-4 px-5 bg-light">
            <p className="m-0 fw-semibold">
              For any commission or settlement related inquiries, contact Speed Net Billing Department.
            </p>
            <p className="m-0 mt-1 small text-muted">Speed Net Khulna - Prosperity through Partnership!</p>
          </div>
        </div>
      </div>
    </ModalWrap>
  );
};

export default CPCommissionInvoiceModal;
