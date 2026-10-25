import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveNoDuesCertificate, getMyNoDuesCertificates, getNoDuesCertificateById, updateNoDuesCertificate, deleteNoDuesCertificate, getNextNoDuesNumbers } from '../services/noDuesCertificateService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const NoDuesCertificateGenerator = () => {
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

  const departments = [
    'রিপোর্টিং ম্যানেজার',
    'মানবসম্পদ (HR) বিভাগ',
    'হিসাব ও অর্থ বিভাগ',
    'আইটি বিভাগ',
    'নেটওয়ার্ক অপারেশন (NOC)',
    'প্রশাসন বিভাগ',
    'স্টোর / ইনভেন্টরি',
  ];

  const defaultForm = () => ({
    refNo: 'SNKHL/HR/NDC/' + moment().year() + '/01',
    issueDate: moment().format('DD/MM/YYYY'),
    certificateNo: 'SN/HR/NDC/' + moment().format('YYMM') + '/01',
    certificateDate: moment().format('DD/MM/YYYY'),
    employeeName: '',
    designation: '',
    employeeId: '',
    clearanceDate: moment().format('DD/MM/YYYY'),
    authName: user?.full_name || '',
    authDesignation: user?.role || 'ব্যবস্থাপনা কর্তৃপক্ষ',
    authDate: moment().format('DD/MM/YYYY'),
    clearances: departments.map((dept) => ({ dept, status: 'clear', sign: '' })),
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
      const n = await getNextNoDuesNumbers();
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

  const handleClearanceChange = (idx, field, value) => {
    setFormData((prev) => ({
      ...prev,
      clearances: prev.clearances.map((c, i) => (i === idx ? { ...c, [field]: value } : c)),
    }));
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
        certificate_no: formData.certificateNo,
        form_data: formData,
      };
      if (editingId) {
        await updateNoDuesCertificate(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveNoDuesCertificate(payload);
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
      const data = await getMyNoDuesCertificates();
      setSavedCerts(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load certificates');
    }
  };

  const handleLoadCert = async (id) => {
    try {
      const cert = await getNoDuesCertificateById(id);
      if (cert?.form_data) {
        const def = defaultForm();
        const loaded = cert.form_data;
        const clearances = def.clearances.map((c) => {
          const found = (loaded.clearances || []).find((x) => x && x.dept === c.dept);
          return found
            ? { dept: c.dept, status: found.status === 'pending' ? 'pending' : 'clear', sign: found.sign || '' }
            : c;
        });
        setFormData({ ...def, ...loaded, clearances });
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
      await deleteNoDuesCertificate(id);
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
        <div className="alert alert-danger mb-0">No permission to generate No-Dues Certificate. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .admin-sidebar-form {
          width: 380px; min-width: 320px; background: #0d1f3c; color: #e0e8f5;
          padding: 16px; overflow-y: auto; max-height: calc(100vh - 70px);
          border-right: 3px solid #059669;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #34d399; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 14mm 16mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .clearance-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
        .clearance-table th {
          background: #059669; color: #ffffff; padding: 6px 10px;
          text-align: left; font-weight: 700;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .clearance-table td { padding: 6px 10px; border: 1px solid #d1fae5; vertical-align: middle; }
        .clearance-table tr:nth-child(even) td { background: #f0fdf4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .status-badge {
          display: inline-block; background: #d1fae5; color: #065f46;
          padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .status-badge.status-pending {
          background: #fef3c7; color: #92400e;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #059669; }
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

      {/* Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #065f46 0%, #022c22 100%)', borderRadius: '8px', border: '1px solid #059669' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-file-contract text-success me-2"></i>No-Dues Certificate Generator
          </h5>
        </div>
        <button className="btn btn-success w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
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
            <label>Select Employee (auto-fill)</label>
            <select value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label>Reference No</label>
            <input name="refNo" value={formData.refNo} onChange={handleChange} />
            <label>Issue Date</label>
            <input type="date" name="issueDate" value={toISODate(formData.issueDate)} onChange={handleDateChange} />
            <label>Certificate No</label>
            <input name="certificateNo" value={formData.certificateNo} onChange={handleChange} />
            <label>Certificate Date</label>
            <input type="date" name="certificateDate" value={toISODate(formData.certificateDate)} onChange={handleDateChange} />
            <label>Employee Name</label>
            <input name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label>Designation</label>
            <input name="designation" value={formData.designation} onChange={handleChange} />
            <label>Employee ID</label>
            <input name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label>Clearance Date</label>
            <input type="date" name="clearanceDate" value={toISODate(formData.clearanceDate)} onChange={handleDateChange} />
            <label>Authorizer Name</label>
            <input name="authName" value={formData.authName} onChange={handleChange} />
            <label>Authorizer Designation</label>
            <input name="authDesignation" value={formData.authDesignation} onChange={handleChange} />
            <label>Authorizer Date</label>
            <input type="date" name="authDate" value={toISODate(formData.authDate)} onChange={handleDateChange} />
          </div>
        </div>
        <div className="sec">
          <div className="sec-title">Department Clearance</div>
          <div className="sec-body">
            {formData.clearances.map((c, idx) => (
              <div key={c.dept} style={{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #2a4a7a' }}>
                <label>{c.dept}</label>
                <select value={c.status} onChange={(e) => handleClearanceChange(idx, 'status', e.target.value)}>
                  <option value="clear">✓ Cleared</option>
                  <option value="pending">⏳ Pending</option>
                </select>
                <input value={c.sign} onChange={(e) => handleClearanceChange(idx, 'sign', e.target.value)} placeholder="Sign & date" style={{ marginBottom: 0 }} />
              </div>
            ))}
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

      {/* Preview */}
      <div className="preview-pane">
        <div className="letter-page">
          <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '420px', opacity: '0.04', zIndex: 0, pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #059669', paddingBottom: '10px', marginBottom: '12px' }}>
              <div>
                <BrandLogo alt="Logo" style={{ height: '78px', width: 'auto', objectFit: 'contain' }} />
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>সূত্র:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.issueDate)}</div>
              </div>
            </div>

            {/* Title */}
            <div style={{ textAlign: 'center', fontSize: '22px', fontWeight: 800, color: '#1e293b' }}>কোনো বকেয়া নেই সনদপত্র</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '12px' }}>NO DUES CERTIFICATE</div>

            {/* Ref bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #d1fae5', fontSize: '12.5px', marginBottom: '12px' }}>
              <div><strong>সনদ নং:</strong> {formData.certificateNo}</div>
              <div><strong>তারিখ:</strong> {formatBanglaDate(formData.certificateDate)}</div>
            </div>

            {/* Content */}
            <div style={{ fontSize: '13.5px', lineHeight: 1.7, textAlign: 'justify', color: '#334155' }}>
              <p style={{ margin: '0 0 8px' }}>
                এতদ্বারা প্রত্যয়ন করা যাচ্ছে যে, <strong>জনাব/জনাবা {formData.employeeName || '__________________________________'}</strong>, পদবী: <strong>{formData.designation || '____________________________'}</strong>, কর্মী আইডি: <strong>{formData.employeeId || '________________'}</strong>, যিনি <strong>স্পিড নেট খুলনা (Speed Net Khulna)</strong>-এ কর্মরত ছিলেন, তিনি প্রতিষ্ঠানের চাকরি হতে অব্যাহতির প্রেক্ষিতে নির্ধারিত সকল হস্তান্তর (Handover) ও ক্লিয়ারেন্স কার্যক্রম যথাযথভাবে সম্পন্ন করেছেন।
              </p>
              <p style={{ margin: '0 0 8px' }}>
                অতএব, <strong>{formatBanglaDate(formData.clearanceDate)}</strong> তারিখ পর্যন্ত স্পিড নেট খুলনার নিকট উপরোক্ত কর্মীর <strong>কোনো প্রকার আর্থিক বকেয়া, প্রশাসনিক দায় বা সম্পদ সংক্রান্ত অনিষ্পন্ন বিষয় অবশিষ্ট নেই</strong> মর্মে এই সনদপত্র প্রদান করা হলো।
              </p>
            </div>

            {/* Clearance Table */}
            <div style={{ marginTop: '10px', fontWeight: 700, fontSize: '13px', color: '#065f46' }}>বিভাগীয় ক্লিয়ারেন্স তালিকা</div>
            <table className="clearance-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>বিভাগ / Department</th>
                  <th style={{ width: '20%' }}>অবস্থা / Status</th>
                  <th style={{ width: '40%' }}>স্বাক্ষর ও তারিখ / Sign & Date</th>
                </tr>
              </thead>
              <tbody>
                {formData.clearances.map((c) => (
                  <tr key={c.dept}>
                    <td>{c.dept}</td>
                    <td>{c.status === 'pending'
                      ? <span className="status-badge status-pending">⏳ বাকি</span>
                      : <span className="status-badge">✓ ক্লিয়ার</span>}</td>
                    <td>{c.sign}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Signature */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '24px' }}>
              <div style={{ textAlign: 'center', width: '230px' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '32px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{formData.authName || '__________________'}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>{formData.authDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>তারিখ: {formatBanglaDate(formData.authDate)}</div>
              </div>
            </div>

            <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
              Speed Net Khulna | Head Office: Notun Bazar, Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoDuesCertificateGenerator;
