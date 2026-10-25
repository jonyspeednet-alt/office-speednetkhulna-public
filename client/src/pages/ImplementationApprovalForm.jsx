import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const management = [
  { name: 'Fardous Tusher', role: 'Managing Partner', type: 'approval' },
  { name: 'Foysal Alam', role: 'Managing Partner', type: 'approval' },
  { name: 'Tanjil Fardous Tarin', role: 'CEO', type: 'information' },
  { name: 'Shaikh Azmal Hossain', role: 'COO', type: 'information' },
  { name: 'Purnima Mistry', role: 'CFO', type: 'information' },
  { name: 'Sk. Rafath Uddin', role: 'CNO', type: 'information' },
  { name: 'Md. Sabbir Hossain', role: 'Senior Manager', type: 'information' },
];

const inputStyle = {
  width: '100%',
  minWidth: 0,
  padding: '9px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  color: '#0f172a',
  font: 'inherit',
  background: '#fff',
};

const fieldLabelStyle = {
  display: 'block',
  marginBottom: 5,
  color: '#334155',
  fontSize: 12,
  fontWeight: 700,
};

function SectionHeading({ number, title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 9, borderBottom: '1px solid #dbe3ee' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: '#0f766e', color: '#fff', fontSize: 13, fontWeight: 800 }}>{number}</span>
      <h2 style={{ margin: 0, color: '#0f172a', fontSize: 16, fontWeight: 800 }}>{title}</h2>
      {subtitle && <span style={{ color: '#64748b', fontSize: 12 }}>{subtitle}</span>}
    </div>
  );
}

const ImplementationApprovalForm = () => {
  const [consents, setConsents] = useState({});
  const [status, setStatus] = useState('');

  const setConsent = (index, value) => setConsents((current) => ({ ...current, [index]: value }));

  return (
    <div className="implementation-form-page" style={{ minHeight: '100vh', background: '#f1f5f9', padding: '24px 14px 48px', color: '#0f172a' }}>
      <style>{`
        .implementation-form-page * { box-sizing: border-box; }
        .ia-paper { max-width: 900px; margin: 0 auto; padding: 36px 42px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 35px rgba(15,23,42,.08); }
        .ia-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; }
        .ia-field { margin-bottom: 13px; }
        .ia-management { width: 100%; border-collapse: collapse; font-size: 12px; }
        .ia-management th, .ia-management td { border: 1px solid #cbd5e1; padding: 7px 6px; text-align: left; vertical-align: middle; }
        .ia-management th { background: #f1f5f9; color: #334155; font-weight: 800; }
        .ia-management .ia-consent { white-space: nowrap; }
        .ia-check-label { display: inline-flex; align-items: center; gap: 4px; margin-right: 8px; white-space: nowrap; }
        @media(max-width:650px) { .ia-paper { padding: 22px 16px; } .ia-grid { grid-template-columns: 1fr; } .ia-management-wrap { overflow-x: auto; } .ia-management { min-width: 680px; } }
        @page { size: A4 portrait; margin: 6mm; }
        @media print {
          html, body, #root { background: #fff !important; }
          .admin-wrapper { display: block !important; width: auto !important; min-height: 0 !important; }
          .sidebar, .mobile-toggle, .sidebar-overlay { display: none !important; }
          .main-content.admin-dashboard-page { display: block !important; width: 100% !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          .implementation-form-page { min-height: 0 !important; padding: 0 !important; background: #fff !important; }
          .ia-toolbar, .ia-back, .ia-print-hint { display: none !important; }
          .ia-paper { max-width: none !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; font-size: 10px !important; line-height: 1.2 !important; }
          .ia-paper header { grid-template-columns: 105px 1fr !important; gap: 10px !important; min-height: 62px !important; padding-bottom: 9px !important; margin-bottom: 13px !important; }
          .ia-paper header img { width: 100px !important; height: 50px !important; }
          .ia-paper header h1 { font-size: 17px !important; line-height: 1.25 !important; margin-bottom: 3px !important; }
          .ia-paper header div { font-size: 11px !important; }
          .ia-section { margin-bottom: 13px !important; break-inside: avoid; }
          .ia-section > div:first-child { gap: 8px !important; margin-bottom: 8px !important; padding-bottom: 5px !important; }
          .ia-section > div:first-child > span { width: 22px !important; height: 22px !important; font-size: 10px !important; }
          .ia-section h2 { font-size: 13px !important; }
          .ia-section > div:first-child > span:last-child { font-size: 10px !important; white-space: nowrap !important; flex-shrink: 0 !important; }
          .ia-field { margin-bottom: 7px !important; }
          .ia-paper label { font-size: 9px !important; margin-bottom: 2px !important; }
          .ia-paper input[type="text"], .ia-paper input[type="date"], .ia-paper textarea { color: #111827 !important; font-size: 10px !important; line-height: 1.15 !important; padding: 3px 4px !important; border: 0 !important; border-bottom: 1px solid #64748b !important; border-radius: 0 !important; }
          .ia-paper textarea { border: 1px solid #64748b !important; }
          .ia-section textarea { min-height: 43px !important; height: 43px !important; }
          .ia-section:nth-of-type(2) .ia-grid > div { padding: 9px !important; }
          .ia-section:nth-of-type(2) h3 { font-size: 11px !important; margin-bottom: 6px !important; }
          .ia-section:nth-of-type(2) .ia-grid { gap: 7px !important; margin-top: 6px !important; }
          .ia-section:nth-of-type(3) p { font-size: 9px !important; line-height: 1.25 !important; margin: 0 0 7px !important; }
          .ia-management { font-size: 9px !important; }
          .ia-management th, .ia-management td { padding: 4px 5px !important; }
          .ia-management tbody td { height: 32px !important; }
          .ia-management .ia-consent { font-size: 9px !important; }
          .ia-check-label { gap: 3px !important; margin-right: 6px !important; font-size: 9px !important; }
          .ia-check-label input { width: 10px; height: 10px; margin: 0; }
          .ia-section:nth-of-type(4) > div:nth-child(2) { gap: 7px 13px !important; margin-bottom: 7px !important; }
          .ia-paper footer { padding-top: 7px !important; font-size: 9px !important; }
          .ia-management th { background: #e2e8f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="ia-toolbar" style={{ maxWidth: 900, margin: '0 auto 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <Link className="ia-back" to="/hr-documents" style={{ color: '#334155', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          <i className="fa-solid fa-arrow-left me-2" />HR Documents
        </Link>
        <button type="button" onClick={() => window.print()} style={{ border: 0, borderRadius: 8, padding: '10px 16px', color: '#fff', background: '#0f766e', fontWeight: 700, cursor: 'pointer' }}>
          <i className="fa-solid fa-print me-2" />Print / Save as PDF
        </button>
      </div>

      <main className="ia-paper">
        <header style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 12, paddingBottom: 18, marginBottom: 22, borderBottom: '2px solid #0f766e' }}>
          <BrandLogo alt="Speed Net Khulna" style={{ width: 120, height: 60, objectFit: 'contain', objectPosition: 'left center' }} />
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 4px', color: '#0f172a', fontSize: 22, lineHeight: 1.3, fontWeight: 900 }}>কাজ/নিয়ম বাস্তবায়ন অনুমোদন ও দায়িত্ব অর্পণ ফরম</h1>
            <div style={{ color: '#475569', fontSize: 14, fontWeight: 700 }}>Implementation Approval &amp; Responsibility Assignment Form</div>
          </div>
        </header>

        <section className="ia-section" style={{ marginBottom: 22 }}>
          <SectionHeading number="01" title="বাস্তবায়নের বিষয়" subtitle="/ Implementation Details" />
          <div className="ia-field">
            <label style={fieldLabelStyle}>কাজ/নিয়ম/সিদ্ধান্তের নাম / Implementation title</label>
            <input style={inputStyle} type="text" />
          </div>
          <div className="ia-field">
            <label style={fieldLabelStyle}>বিস্তারিত বিবরণ / Description</label>
            <textarea style={{ ...inputStyle, minHeight: 76, resize: 'vertical' }} />
          </div>
          <div className="ia-grid">
            <div className="ia-field" style={{ marginBottom: 0 }}>
              <label style={fieldLabelStyle}>কার্যকর তারিখ / Effective date</label>
              <input style={inputStyle} type="date" />
            </div>
            <div className="ia-field" style={{ marginBottom: 0 }}>
              <label style={fieldLabelStyle}>শেষ সময়সীমা / Deadline</label>
              <input style={inputStyle} type="date" />
            </div>
          </div>
        </section>

        <section className="ia-section" style={{ marginBottom: 22 }}>
          <SectionHeading number="02" title="নির্দেশ ও দায়িত্ব" subtitle="/ Instruction & Assignment" />
          <div className="ia-grid">
            {[{ title: 'নির্দেশ প্রদানকারী / Assigned By', key: 'by' }, { title: 'দায়িত্বপ্রাপ্ত ব্যক্তি / Assigned To', key: 'to' }].map((person) => (
              <div key={person.key} style={{ padding: 14, border: '1px solid #dbe3ee', borderRadius: 9 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#0f766e', fontWeight: 800 }}>{person.title}</h3>
                <div className="ia-field">
                  <label style={fieldLabelStyle}>নাম / Name</label>
                  <input style={inputStyle} type="text" />
                </div>
                <div className="ia-field" style={{ marginBottom: 0 }}>
                  <label style={fieldLabelStyle}>পদবী/বিভাগ / Designation or department</label>
                  <input style={inputStyle} type="text" />
                </div>
                <div className="ia-grid" style={{ gap: 9, marginTop: 12 }}>
                  <div><label style={fieldLabelStyle}>স্বাক্ষর / Signature</label><input style={inputStyle} type="text" /></div>
                  <div><label style={fieldLabelStyle}>তারিখ / Date</label><input style={inputStyle} type="date" /></div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ia-section" style={{ marginBottom: 22 }}>
          <SectionHeading number="03" title="Management Consent / Approval" />
          <p style={{ margin: '-4px 0 12px', color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
            উপরোক্ত কাজ/নিয়ম/সিদ্ধান্ত বাস্তবায়ন ও দায়িত্ব অর্পণের বিষয়ে নিম্নস্বাক্ষরকারী Management প্রতিনিধিগণের সম্মতি:
          </p>
          <div className="ia-management-wrap">
            <table className="ia-management">
              <thead><tr><th style={{ width: 36 }}>ক্রম</th><th>নাম ও পদবী / Name &amp; Designation</th><th>সম্মতি / Consent</th><th>স্বাক্ষর / Signature</th><th>তারিখ / Date</th></tr></thead>
              <tbody>{management.map((person, index) => (
                <tr key={person.name}>
                  <td>{index + 1}</td>
                  <td><strong>{person.name}</strong><br /><span style={{ color: '#64748b' }}>{person.role}</span></td>
                  <td className="ia-consent">
                    {person.type === 'approval' ? (
                      <>
                        <label className="ia-check-label"><input type="radio" name={`consent-${index}`} checked={consents[index] === 'agree'} onChange={() => setConsent(index, 'agree')} /> সম্মত</label>
                        <label className="ia-check-label"><input type="radio" name={`consent-${index}`} checked={consents[index] === 'disagree'} onChange={() => setConsent(index, 'disagree')} /> অসম্মত</label>
                      </>
                    ) : <label className="ia-check-label"><input type="checkbox" /> অবগত</label>}
                  </td>
                  <td style={{ minWidth: 105 }}>&nbsp;</td>
                  <td style={{ minWidth: 80 }}>&nbsp;</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className="ia-section" style={{ marginBottom: 20 }}>
          <SectionHeading number="04" title="বাস্তবায়ন অবস্থা" subtitle="/ Implementation Status" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginBottom: 14 }}>
            {[
              ['completed', 'সম্পন্ন'], ['partial', 'আংশিক সম্পন্ন'], ['pending', 'Pending'], ['cancelled', 'স্থগিত/বাতিল'],
            ].map(([value, label]) => (
              <label key={value} className="ia-check-label" style={{ color: '#334155', fontSize: 13 }}>
                <input type="radio" name="implementation-status" value={value} checked={status === value} onChange={() => setStatus(value)} />{label}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: 'auto', fontSize: 12, fontWeight: 700 }}>সম্পন্নের তারিখ: <input type="date" style={{ ...inputStyle, width: 'auto' }} /></label>
          </div>
          <label style={fieldLabelStyle}>মন্তব্য / Comments</label>
          <textarea style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} />
        </section>

        <footer style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #cbd5e1', paddingTop: 10, color: '#64748b', fontSize: 10, fontWeight: 700 }}>
          <span>Internal Use Only</span><span>Speed Net Khulna</span>
        </footer>
      </main>
      <p className="ia-print-hint" style={{ maxWidth: 900, margin: '12px auto 0', color: '#64748b', fontSize: 12, textAlign: 'center' }}>ফর্মটি পূরণ করে Print / Save as PDF চাপুন। Management-এর স্বাক্ষর কাগজে নেওয়া যাবে।</p>
    </div>
  );
};

export default ImplementationApprovalForm;
