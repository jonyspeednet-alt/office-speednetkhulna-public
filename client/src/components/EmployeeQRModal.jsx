import React, { useRef, useCallback } from 'react';
import { Modal } from 'react-bootstrap';
import QRCode from 'react-qr-code';
import html2canvas from 'html2canvas';
import ImageWithFallback from './ImageWithFallback';
import { t } from '../i18n';

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
};

const getProfileUrl = (employee_id) => {
  const base = window.location.origin;
  return `${base}/employee/${employee_id}`;
};

const downloadAsPng = (svgEl, fileName, scale = 1) => {
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
};

const EmployeeQRModal = ({ show, onHide, employee }) => {
  const printRef = useRef(null);
  const qrRef = useRef(null);

  const handleDownloadQr = useCallback(() => {
    const svgEl = qrRef.current?.querySelector('svg');
    if (!svgEl) return;
    downloadAsPng(svgEl, `QR_${employee?.full_name || 'employee'}.png`, 4);
  }, [employee]);

  const handleDownloadCard = useCallback(async () => {
    const cardEl = printRef.current?.querySelector('.id-card');
    if (!cardEl) return;
    const canvas = await html2canvas(cardEl, { scale: 2, useCORS: true, backgroundColor: '#fff' });
    const link = document.createElement('a');
    link.download = `IDCard_${employee?.full_name || 'employee'}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [employee]);

  if (!employee) return null;

  const profileUrl = getProfileUrl(employee.employee_id);
  const isActive = String(employee.status || 'Active').toLowerCase() === 'active';

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;
    const win = window.open('', '_blank', 'width=400,height=650');
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ID Card - ${escapeHtml(employee.full_name)}</title>
          <meta charset="utf-8" />
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Hind Siliguri', 'Noto Sans Bengali', 'Segoe UI', Arial, sans-serif; background: #f0f4f8; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .id-card { width: 320px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
            .card-header { background: linear-gradient(135deg, #1a56db 0%, #0e3a99 100%); padding: 20px 20px 14px; text-align: center; color: #fff; }
            .company-name { font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.9; }
            .card-type { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7; margin-top: 2px; }
            .card-body { padding: 20px; text-align: center; }
            .photo-wrap { width: 80px; height: 80px; border-radius: 50%; overflow: hidden; margin: 0 auto 12px; border: 3px solid #1a56db; background: #e8eef8; }
            .photo-wrap img { width: 100%; height: 100%; object-fit: cover; }
            .photo-initial { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: #1a56db; background: #dbeafe; }
            .emp-name { font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 2px; }
            .emp-designation { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
            .emp-dept { font-size: 12px; color: #475569; margin-bottom: 8px; }
            .emp-id-badge { display: inline-block; background: #eff6ff; color: #1a56db; border: 1px solid #bfdbfe; border-radius: 20px; padding: 3px 12px; font-size: 11px; font-weight: 600; margin-bottom: 14px; }
            .info-row { display: flex; justify-content: space-around; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; padding: 10px 0; margin-bottom: 14px; }
            .info-item { text-align: center; }
            .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
            .info-value { font-size: 11px; font-weight: 600; color: #334155; margin-top: 2px; }
            .qr-section { display: flex; flex-direction: column; align-items: center; gap: 6px; }
            .qr-label { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
            .qr-box { padding: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
            .card-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 10px; text-align: center; }
            .status-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
            .status-active { background: #d1fae5; color: #065f46; }
            .status-inactive { background: #fee2e2; color: #991b1b; }
            .inactive-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 34px; font-weight: 800; letter-spacing: 4px; color: rgba(220, 38, 38, 0.35); border: 3px solid rgba(220, 38, 38, 0.35); border-radius: 8px; padding: 4px 18px; pointer-events: none; white-space: nowrap; z-index: 5; }
            .void-message { font-size: 12px; font-weight: 700; color: #991b1b; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 16px; text-align: center; }
            @media print {
              body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .id-card { box-shadow: none; border: 1pt solid #999; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .inactive-watermark { color: rgba(220, 38, 38, 0.35); border-color: rgba(220, 38, 38, 0.35); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
          </style>
        </head>
        <body>
        </body>
      </html>
    `);
    // cloneNode approach: avoids re-parsing innerHTML — prevents any
    // <img onerror>/<svg onload> embedded in React output from executing.
    const cardClone = printContent.querySelector('.id-card')?.cloneNode(true);
    if (cardClone) {
      if (!isActive) {
        // Inactive cards print void: grayscale photo is already inline-styled,
        // watermark clones along — replace the QR section with a void notice.
        const qrSec = cardClone.querySelector('.qr-section');
        if (qrSec) {
          const voidBox = win.document.createElement('div');
          voidBox.setAttribute('class', 'void-message');
          voidBox.textContent = 'Card void \u2014 reissue required';
          qrSec.replaceChildren(voidBox);
        }
      }
      win.document.body.appendChild(cardClone);
    }
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  const resolveUploadUrl = (pic) => {
    if (!pic || pic === 'default.png') return null;
    if (/^https?:\/\//i.test(pic)) return pic;
    if (String(pic).startsWith('/api/')) return pic;
    const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const path = String(pic).startsWith('/') ? pic : `/uploads/${pic}`;
    return `${base}${path}`;
  };

  const photoSrc = resolveUploadUrl(employee.profile_pic);
  const initial = (employee.full_name || 'E').charAt(0).toUpperCase();

  return (
    <Modal show={show} onHide={onHide} centered size="sm" dialogClassName="qr-id-modal">
      <style>{`@media (max-width: 400px) { .qr-id-modal { max-width: 340px; margin-left: auto; margin-right: auto; } }`}</style>
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title style={{ fontSize: 16, fontWeight: 700 }}>
          <i className="fas fa-id-card text-primary me-2"></i>
          ID Card &amp; QR Code
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-2 pb-3 px-3">
        {/* Printable ID Card */}
        <div ref={printRef}>
          <div className="id-card" style={{
            width: '100%',
            background: '#fff',
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
            fontFamily: "'Segoe UI', Arial, sans-serif",
            position: 'relative',
          }}>
            {!isActive && (
              <div className="inactive-watermark" aria-hidden="true">
                INACTIVE
              </div>
            )}
            {/* Card Header */}
            <div style={{
              background: 'linear-gradient(135deg, #1a56db 0%, #0e3a99 100%)',
              padding: '18px 20px 12px',
              textAlign: 'center',
              color: '#fff',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                Speednet Khulna
              </div>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.75, marginTop: 2 }}>
                Employee Identity Card
              </div>
            </div>

            {/* Card Body */}
            <div style={{ padding: '18px 20px', textAlign: 'center' }}>
              {/* Photo */}
              <div className="photo-wrap" style={{
                width: 76, height: 76, borderRadius: '50%', overflow: 'hidden',
                margin: '0 auto 10px', border: '3px solid #1a56db', background: '#dbeafe',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {photoSrc
                  ? (
                    <ImageWithFallback
                      src={photoSrc}
                      fallbackName={employee.full_name}
                      alt={employee.full_name}
                      width="100%"
                      height="100%"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', ...(isActive ? {} : { filter: 'grayscale(1)' }) }}
                    />
                  )
                  : <span style={{ fontSize: 26, fontWeight: 700, color: '#1a56db', ...(isActive ? {} : { filter: 'grayscale(1)' }) }}>{initial}</span>
                }
              </div>

              {/* Name & Designation */}
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>
                {employee.full_name}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>
                {employee.designation || 'Staff'}
              </div>
              <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                {employee.department || '—'}
              </div>

              {/* Father / Husband */}
              {employee.father_name ? (
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                  Father/Husband: {employee.father_name}
                </div>
              ) : null}

              {/* Employee ID Badge */}
              <div style={{
                display: 'inline-block', background: '#eff6ff', color: '#1a56db',
                border: '1px solid #bfdbfe', borderRadius: 20, padding: '3px 14px',
                fontSize: 11, fontWeight: 600, marginBottom: 12,
              }}>
                {employee.employee_id}
              </div>

              {/* Info Row */}
              <div style={{
                display: 'flex', justifyContent: 'space-around',
                borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                padding: '10px 0', marginBottom: 14,
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8' }}>Blood</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginTop: 2 }}>
                    {employee.blood_group || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#94a3b8' }}>Joined</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginTop: 2 }}>
                    {employee.joining_date
                      ? new Date(employee.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </div>
                </div>
              </div>

              {/* QR Code */}
              <div ref={qrRef} className="qr-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Scan to Verify
                </div>
                <div style={{ padding: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <QRCode value={profileUrl} size={90} level="M" />
                </div>
              </div>
            </div>

            {/* Card Footer */}
            <div style={{
              background: '#f8fafc', borderTop: '1px solid #e2e8f0',
              padding: '10px', textAlign: 'center',
            }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 10, fontWeight: 600, padding: '3px 12px', borderRadius: 20,
                background: isActive ? '#d1fae5' : '#fee2e2',
                color: isActive ? '#065f46' : '#991b1b',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: isActive ? '#10b981' : '#ef4444',
                  display: 'inline-block',
                }}></span>
                {isActive ? 'Active Employee' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handlePrint}
              className="btn btn-primary btn-sm flex-fill"
              style={{ fontWeight: 600 }}
            >
              <i className="fas fa-print me-2"></i>{t('invoice.print')}
            </button>
            <button
              onClick={handleDownloadCard}
              className="btn btn-outline-primary btn-sm"
              style={{ fontWeight: 600 }}
              title={t('invoice.downloadPng')}
            >
              <i className="fas fa-image me-1"></i>PNG
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleDownloadQr}
              className="btn btn-outline-success btn-sm flex-fill"
              style={{ fontWeight: 600 }}
            >
              <i className="fas fa-download me-2"></i>{t('invoice.downloadPng')}
            </button>
            <button
              onClick={onHide}
              className="btn btn-outline-secondary btn-sm"
              style={{ minWidth: 60 }}
            >
              Close
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <small style={{ color: '#94a3b8', fontSize: 10, wordBreak: 'break-all' }}>
            {profileUrl}
          </small>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default EmployeeQRModal;
