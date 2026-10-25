import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveExperienceCertificate, getMyExperienceCertificates, getExperienceCertificateById, updateExperienceCertificate, deleteExperienceCertificate, getNextExperienceCertificateNumbers } from '../services/experienceCertificateService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const ExperienceCertificateGenerator = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const isSuperAdmin = isSuperAdminRole(user?.role);
  const hasPermission = (perm) => {
    if (isSuperAdmin) return true;
    return Boolean(
      user?.all_access ||
      user?.permissions?.all_access ||
      user?.permissions?.[perm] ||
      user?.[perm]
    );
  };
  const canAccess = hasPermission('appointment_letters.generate') || hasPermission('p_appointment_letter');

  const defaultForm = () => ({
    refNo: 'SNKHL/HR/EC/' + moment().year() + '/01',
    date: moment().format('DD/MM/YYYY'),
    certificateNo: 'SN/HR/EC/' + moment().format('YYMM') + '/01',
    certificateDate: moment().format('DD/MM/YYYY'),
    employeeName: '',
    employeeId: '',
    joiningDate: '',
    lastWorkingDay: '',
    designation: '',
    department: '',
    signerName: user?.full_name || 'ম্যানেজিং ডিরেক্টর',
    signerDesignation: user?.role || 'ব্যবস্থাপনা কর্তৃপক্ষ',
    signerDate: moment().format('DD/MM/YYYY'),
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedCerts, setSavedCerts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const data = await getEmployees();
        setEmployees(Array.isArray(data) ? data : []);
      } catch {
        // silent fallback
      }
    };
    loadEmployees();
  }, []);

  // Auto serial: running ref/cert numbers for the current year (server count).
  const applyNextNumbers = async () => {
    try {
      const n = await getNextExperienceCertificateNumbers();
      if (n?.refNo || n?.certificateNo) {
        setFormData((prev) => ({
          ...prev,
          refNo: n.refNo || prev.refNo,
          certificateNo: n.certificateNo || prev.certificateNo,
        }));
      }
    } catch {
      // keep manual defaults
    }
  };

  useEffect(() => {
    if (!canAccess) return;
    applyNextNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Native date inputs work with ISO values; formData keeps DD/MM/YYYY shape
  // so the certificate preview and server payload stay unchanged.
  const toISODate = (d) => {
    const m = moment(d, 'DD/MM/YYYY', true);
    return m.isValid() ? m.format('YYYY-MM-DD') : '';
  };
  const fromISODate = (iso) => (iso ? moment(iso).format('DD/MM/YYYY') : '');
  const handleDateChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: fromISODate(value) }));
  };

  const handleReset = () => {
    setFormData(defaultForm());
    setEditingId(null);
    setSelectedEmployeeId('');
    applyNextNumbers();
  };

  const handleEmployeeSelect = (employeeId) => {
    setSelectedEmployeeId(employeeId);
    if (!employeeId) return;
    const found = employees.find((emp) => emp.employee_id === employeeId);
    if (found) {
      setFormData((prev) => ({
        ...prev,
        employeeName: found.full_name || '',
        employeeId: found.employee_id || '',
        designation: found.designation || '',
      }));
    }
  };

  const handleSaveToServer = async () => {
    if (!formData.employeeName?.trim()) {
      notify.error('Employee name is required');
      return;
    }
    if (!formData.certificateNo?.trim()) {
      notify.error('Certificate no is required');
      return;
    }
    try {
      const payload = {
        employee_name: formData.employeeName,
        employee_id: formData.employeeId,
        ref_no: formData.refNo,
        certificate_no: formData.certificateNo,
        form_data: formData,
      };
      if (editingId) {
        await updateExperienceCertificate(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveExperienceCertificate(payload);
        if (saved?.id) setEditingId(saved.id);
        setSaveMsg('Saved successfully!');
        notify.success('Saved successfully');
      }
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg('Save failed!');
      notify.error(err?.response?.data?.message || 'Save failed');
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const loadMyCerts = async () => {
    try {
      const data = await getMyExperienceCertificates();
      setSavedCerts(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load certificates');
    }
  };

  const handleLoadCert = async (id) => {
    try {
      const cert = await getExperienceCertificateById(id);
      if (cert?.form_data) {
        const def = defaultForm();
        const loaded = cert.form_data;
        setFormData({ ...def, ...loaded });
        setSelectedEmployeeId(loaded.employeeId || '');
        setEditingId(cert.id);
        setShowEditModal(false);
        setSaveMsg('Certificate loaded — edit mode');
        notify.success('Certificate loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load certificate');
    }
  };

  const handleDeleteCert = async (id) => {
    if (!(await confirmAction({ title: 'Delete this certificate?', danger: true }))) return;
    try {
      await deleteExperienceCertificate(id);
      setSavedCerts(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewCert = () => {
    setEditingId(null);
    setSelectedEmployeeId('');
    setFormData(defaultForm());
    applyNextNumbers();
  };

  const formatBanglaDate = (value) => {
    if (!value) return '____ / ____ / ______';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return value;
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Experience Certificate. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');

        .admin-sidebar-form {
          width: 380px;
          min-width: 320px;
          background: #0d1f3c;
          color: #e0e8f5;
          padding: 16px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          border-right: 3px solid #2563eb;
        }

        .admin-sidebar-form .sec {
          background: rgba(22, 45, 80, 0.6);
          border: 1px solid #2a4a7a;
          border-radius: 8px;
          margin-bottom: 14px;
          overflow: hidden;
        }

        .admin-sidebar-form .sec-title {
          background: #162d50;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 700;
          color: #60a5fa;
          text-transform: uppercase;
          border-bottom: 1px solid #2a4a7a;
        }

        .admin-sidebar-form .sec-body {
          padding: 10px;
        }

        .admin-sidebar-form label {
          font-size: 10px;
          color: #8ab0d8;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 4px;
          display: block;
        }

        .admin-sidebar-form input, .admin-sidebar-form select {
          width: 100%;
          background: #162d50;
          border: 1px solid #2a4a7a;
          border-radius: 4px;
          color: #fff;
          padding: 6px 10px;
          font-size: 12px;
          margin-bottom: 8px;
        }

        .admin-sidebar-form input[type="date"] { color-scheme: dark; }

        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          background: #e2e8f0;
        }

        .letter-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #ffffff;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          padding: 20mm;
          box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif;
          color: #1e293b;
          position: relative;
          display: flex;
          flex-direction: column;
        }

        .header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 16px;
          border-bottom: 2px solid #2563eb;
          margin-bottom: 24px;
        }

        .title-main {
          text-align: center;
          font-size: 26px;
          font-weight: 800;
          color: #1e293b;
          margin-top: 10px;
          margin-bottom: 2px;
          letter-spacing: 1px;
        }

        .title-sub {
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          color: #2563eb;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          margin-bottom: 20px;
        }

        .content {
          font-size: 15px;
          line-height: 1.85;
          text-align: justify;
          margin-top: 16px;
          color: #334155;
        }

        .signature-box {
          width: 240px;
          margin-top: auto;
          margin-left: auto;
          text-align: center;
          position: relative;
        }

        .sig-line {
          border-bottom: 1.5px solid #0f172a;
          margin-bottom: 8px;
        }

        .bottom-text {
          margin-top: 24px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
          font-size: 11px;
          text-align: center;
          color: #64748b;
        }

        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #2563eb; }
          .preview-pane { padding: 12px !important; overflow-x: auto; }
          .letter-page { width: 100% !important; max-width: 210mm; }
        }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          .admin-sidebar-form, .no-print, nav, header, button, .app-sidebar, .sidebar, .sidebar-toggle, .btn-hamburger, .hamburger, .navbar, [class*="sidebar"], [class*="toggle"], [class*="navbar"] { display: none !important; visibility: hidden !important; }
          .admin-wrapper { display: block !important; min-height: auto !important; width: 100% !important; }
          .main-content, #main-content, .main-content.admin-dashboard-page { margin-left: 0 !important; width: 100% !important; max-width: 100% !important; min-height: auto !important; padding: 0 !important; }
          .appointment-generator-wrapper { display: block !important; min-height: auto !important; height: auto !important; background: #fff !important; }
          .preview-pane { padding: 0 !important; margin: 0 !important; background: #fff !important; overflow: visible !important; max-height: none !important; height: auto !important; }
          .letter-page { box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; min-height: 255mm !important; height: auto !important; display: flex !important; flex-direction: column !important; page-break-after: avoid !important; overflow: hidden !important; }
          .clearance-table, .clearance-table tr, .clearance-table thead, .clearance-table tbody { break-inside: avoid !important; page-break-inside: avoid !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Form Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '8px', border: '1px solid #334155' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-certificate text-primary me-2"></i>Experience Certificate Generator
          </h5>
        </div>

        <button className="btn btn-primary w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyCerts}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewCert} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Certificate
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>

        <div className="sec">
          <div className="sec-title">Certificate Info</div>
          <div className="sec-body">
            <label htmlFor="exp-emp-select">Select Employee (auto-fill)</label>
            <select id="exp-emp-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>

            <label>Reference No</label>
            <input name="refNo" value={formData.refNo} onChange={handleChange} />

            <label htmlFor="exp-date">Issue Date</label>
            <input id="exp-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />

            <label>Certificate No</label>
            <input name="certificateNo" value={formData.certificateNo} onChange={handleChange} />

            <label htmlFor="exp-cert-date">Certificate Date</label>
            <input id="exp-cert-date" type="date" name="certificateDate" value={toISODate(formData.certificateDate)} onChange={handleDateChange} />

            <label>Employee ID</label>
            <input name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />

            <label>Employee Name</label>
            <input name="employeeName" value={formData.employeeName} onChange={handleChange} placeholder="Mr. ..." />

            <label>Designation</label>
            <input name="designation" value={formData.designation} onChange={handleChange} placeholder="Senior Network Engineer" />

            <label>Department</label>
            <input name="department" value={formData.department} onChange={handleChange} placeholder="Network Operations" />

            <label htmlFor="exp-joining">Joining Date</label>
            <input id="exp-joining" type="date" name="joiningDate" value={toISODate(formData.joiningDate)} onChange={handleDateChange} />

            <label htmlFor="exp-lastday">Last Working Day</label>
            <input id="exp-lastday" type="date" name="lastWorkingDay" value={toISODate(formData.lastWorkingDay)} onChange={handleDateChange} />

            <label>Signer Name</label>
            <input name="signerName" value={formData.signerName} onChange={handleChange} />

            <label>Signer Designation</label>
            <input name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />

            <label htmlFor="exp-signer-date">Signer Date</label>
            <input id="exp-signer-date" type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Certificates</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedCerts.length === 0 ? (
                <p className="text-muted text-center py-4">No saved certificates.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Cert No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedCerts.map(cert => (
                      <tr key={cert.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadCert(cert.id)}>
                        <td>{cert.employee_name || '-'}</td>
                        <td>{cert.employee_id || '-'}</td>
                        <td>{cert.certificate_no || '-'}</td>
                        <td>{cert.updated_at ? new Date(cert.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{cert.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadCert(cert.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeleteCert(cert.id); }}><i className="fas fa-trash"></i></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview Pane */}
      <div className="preview-pane">
        <div className="letter-page">
          {/* Watermark Logo */}
          <BrandLogo
            alt="watermark"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '450px',
              opacity: '0.04',
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />

          <div className="header-bar">
            <div>
              <BrandLogo alt="Speed Net Logo" style={{ height: '70px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ fontWeight: 800, fontSize: '20px', color: '#1e293b', marginTop: '4px' }}>স্পিড নেট খুলনা</div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>ইন্টারনেট সার্ভিস প্রোভাইডার</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
              <div><strong>সূত্র:</strong> {formData.refNo}</div>
              <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
            </div>
          </div>

          <div className="title-main">অভিজ্ঞতা সনদপত্র</div>
          <div className="title-sub">EXPERIENCE CERTIFICATE</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
            <div><strong>সনদ নং:</strong> {formData.certificateNo}</div>
            <div><strong>তারিখ:</strong> {formatBanglaDate(formData.certificateDate)}</div>
          </div>

          <div className="content">
            <p>
              এতদ্বারা প্রত্যয়ন করা যাচ্ছে যে, <strong>{formData.employeeName || 'জনাব/জনাবা [কর্মচারীর নাম]'}</strong>, কর্মী আইডি{' '}
              <strong>{formData.employeeId || '[Employee ID]'}</strong>, গত{' '}
              <strong>{formData.joiningDate ? formatBanglaDate(formData.joiningDate) : '[যোগদানের তারিখ]'}</strong> হতে{' '}
              <strong>{formData.lastWorkingDay ? formatBanglaDate(formData.lastWorkingDay) : '[শেষ কর্মদিবস]'}</strong> তারিখ পর্যন্ত{' '}
              <strong>স্পিড নেট খুলনা (Speed Net Khulna)</strong>-এ{' '}
              <strong>{formData.designation || '[পদবী]'}</strong> হিসেবে{' '}
              <strong>{formData.department || '[বিভাগের নাম]'}</strong> বিভাগে সততা, নিষ্ঠা ও পেশাদারিত্বের সঙ্গে সফলভাবে কর্মরত ছিলেন।
            </p>

            <p>
              কর্মকালীন সময়ে তিনি প্রতিষ্ঠানের নীতিমালা ও নির্দেশিকা যথাযথভাবে অনুসরণ করে অর্পিত দায়িত্ব অত্যন্ত দক্ষতা ও আন্তরিকতার সঙ্গে পালন করেছেন। সহকর্মীদের সঙ্গে সমন্বয়, সময়ানুবর্তিতা এবং কর্মদক্ষতার মাধ্যমে তিনি প্রতিষ্ঠানের অগ্রযাত্রায় ইতিবাচক অবদান রেখেছেন।
            </p>

            <p>
              চাকরি শেষে তিনি প্রতিষ্ঠানের নির্ধারিত সকল দায়িত্ব যথাযথভাবে হস্তান্তর করেছেন এবং সংশ্লিষ্ট বিভাগসমূহ থেকে প্রয়োজনীয় ক্লিয়ারেন্স গ্রহণ করেছেন। প্রতিষ্ঠানের রেকর্ড অনুযায়ী তার নিকট কোনো প্রকার আর্থিক বা প্রশাসনিক বকেয়া পাওনা নেই।
            </p>

            <p>
              আমরা তাঁর কর্মদক্ষতা ও অবদানের জন্য আন্তরিক ধন্যবাদ জানাচ্ছি এবং তাঁর ভবিষ্যৎ কর্মজীবনের সর্বাঙ্গীণ সাফল্য ও সমৃদ্ধি কামনা করছি।
            </p>
          </div>

          <div className="signature-box">
            <div className="sig-line"></div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{formData.signerName}</div>
            <div style={{ fontSize: '12px', color: '#475569' }}>{formData.signerDesignation}</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>স্পিড নেট খুলনা</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
          </div>

          <div className="bottom-text">
            Speed Net Khulna | Head Office: Notun Bazar, Khulna | Email: info@speednetkhulna.com | Web: www.speednetkhulna.com
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExperienceCertificateGenerator;
