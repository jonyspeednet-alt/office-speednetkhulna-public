import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { savePromotionLetter, getMyPromotionLetters, getPromotionLetterById, updatePromotionLetter, deletePromotionLetter, getNextPromotionNumbers } from '../services/promotionLetterService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const PromotionLetterGenerator = () => {
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
    refNo: 'SN/HR/PRO/' + moment().year() + '/01',
    issueDate: moment().format('DD/MM/YYYY'),
    employeeName: '',
    fatherHusbandName: '',
    nidNumber: '',
    designation: '',
    newDesignation: '',
    department: '',
    employeeId: '',
    reportingManager: '',
    workLocation: '',
    effectiveDate: moment().add(1, 'month').startOf('month').format('DD/MM/YYYY'),
    previousBasic: '',
    previousGross: '',
    newBasic: '',
    newGross: '',
    overtimePolicy: 'বাংলাদেশ শ্রম আইন অনুযায়ী (দ্বিগুণ)',
    pfPolicy: 'নবনির্ধারিত মূল বেতনের ৫% (পাঁচ শতাংশ)',
    festivalBonus: 'প্রতি বছর দুইটি প্রধান ঈদে নবনির্ধারিত মূল বেতনের ৫০%',
    signerName: '',
    signerDesignation: '',
    signerDate: moment().format('DD/MM/YYYY'),
    agreementDate: moment().format('DD/MM/YYYY'),
    fileNo: '',
    ehrId: '',
    hrApproval: '',
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedLetters, setSavedLetters] = useState([]);
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

  // Auto serial: running ref number for the current year (server count).
  const applyNextNumbers = async () => {
    try {
      const n = await getNextPromotionNumbers();
      if (n?.refNo) {
        setFormData((prev) => ({ ...prev, refNo: n.refNo }));
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
  // so the letter preview and server payload stay unchanged.
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
    try {
      const payload = {
        employee_name: formData.employeeName,
        employee_id: formData.employeeId,
        ref_no: formData.refNo,
        form_data: formData,
      };
      if (editingId) {
        await updatePromotionLetter(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await savePromotionLetter(payload);
        if (saved?.id) setEditingId(saved.id);
        setSaveMsg('Saved successfully!');
        notify.success('Saved successfully');
      }
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (err) {
      setSaveMsg('Save failed!');
      notify.error(err?.response?.data?.message || err?.response?.data?.error || 'Save failed');
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  const loadMyLetters = async () => {
    try {
      const data = await getMyPromotionLetters();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getPromotionLetterById(id);
      if (letter?.form_data) {
        const def = defaultForm();
        setFormData({ ...def, ...letter.form_data });
        setSelectedEmployeeId(letter.form_data.employeeId || '');
        setEditingId(letter.id);
        setShowEditModal(false);
        setSaveMsg('Letter loaded — edit mode');
        notify.success('Letter loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letter');
    }
  };

  const handleDeleteLetter = async (id) => {
    if (!(await confirmAction({ title: 'Delete this letter?', danger: true }))) return;
    try {
      await deletePromotionLetter(id);
      setSavedLetters(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewLetter = () => {
    setEditingId(null);
    setSelectedEmployeeId('');
    setFormData(defaultForm());
    applyNextNumbers();
  };

  const formatBanglaDate = (value) => {
    if (!value) return '________________';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return String(value);
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Promotion Letter. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #f59e0b;
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
          color: #fbbf24;
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
        .admin-sidebar-form input, .admin-sidebar-form textarea, .admin-sidebar-form select {
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
        .admin-sidebar-form input:focus, .admin-sidebar-form textarea:focus, .admin-sidebar-form select:focus {
          border-color: #3498db;
          outline: none;
        }
        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow: auto;
        }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto;
          background: #fff; color: #1e293b;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif;
          position: relative; display: flex; flex-direction: column;
        }
        .brand {
          text-align: center;
          font-size: 20px;
          font-weight: 800;
          line-height: 1.3;
        }
        .brand-sub {
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: #334155;
          margin-top: 4px;
        }
        .address {
          text-align: center;
          font-size: 11px;
          line-height: 1.7;
          color: #334155;
          margin-top: 8px;
        }
        .title-main {
          text-align: center;
          font-size: 23px;
          font-weight: 800;
          margin-top: 18px;
          margin-bottom: 6px;
        }
        .title-sub {
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .ref-bar {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          border-top: 1px solid #dfe7f0;
          border-bottom: 1px solid #dfe7f0;
          padding: 8px 0;
          margin-bottom: 16px;
        }
        .content {
          font-size: 12px;
          line-height: 1.9;
          text-align: justify;
        }
        .section-title {
          font-size: 14px;
          font-weight: 800;
          margin: 18px 0 8px;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 18px;
          margin-top: 8px;
          margin-bottom: 12px;
        }
        .info-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 10px;
          border: 1px solid #dfe7f0;
          background: #fffbeb;
        }
        .salary-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
          margin-bottom: 10px;
        }
        .salary-table th, .salary-table td {
          border: 1px solid #111827;
          padding: 8px 10px;
          text-align: center;
          font-size: 12px;
          vertical-align: top;
        }
        .signature-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          margin-top: 24px;
        }
        .signature-box {
          text-align: center;
        }
        .sig-line {
          border-bottom: 1.5px solid #111;
          height: 42px;
          margin-bottom: 8px;
        }
        .bottom-note {
          margin-top: 18px;
          padding-top: 10px;
          border-top: 1px solid #dfe7f0;
          font-size: 11px;
          line-height: 1.7;
          color: #334155;
        }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #f59e0b; }
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
          .letter-page { box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; min-height: auto !important; height: auto !important; display: flex !important; flex-direction: column !important; page-break-after: avoid !important; overflow: hidden !important; }
          .salary-table, .salary-table tr, .salary-table thead, .salary-table tbody, .signature-row { break-inside: avoid !important; page-break-inside: avoid !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #78350f 0%, #451a03 100%)', borderRadius: '8px', border: '1px solid #f59e0b' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-award me-2" style={{ color: '#fbbf24' }}></i>Promotion Letter Generator
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#f59e0b', color: '#1c1917' }} onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyLetters}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewLetter} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Letter
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>
        <div className="sec">
          <div className="sec-title">Promotion Letter</div>
          <div className="sec-body">
            <label htmlFor="pro-employee-select">Select Employee (auto-fill)</label>
            <select id="pro-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="pro-refNo">Reference No</label>
            <input id="pro-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />

            <label htmlFor="pro-issueDate">Issue Date</label>
            <input id="pro-issueDate" type="date" name="issueDate" value={toISODate(formData.issueDate)} onChange={handleDateChange} />

            <label htmlFor="pro-employeeName">Employee Name</label>
            <input id="pro-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />

            <label htmlFor="pro-fatherHusbandName">Father/Husband Name</label>
            <input id="pro-fatherHusbandName" name="fatherHusbandName" value={formData.fatherHusbandName} onChange={handleChange} />

            <label htmlFor="pro-nidNumber">NID Number</label>
            <input id="pro-nidNumber" name="nidNumber" value={formData.nidNumber} onChange={handleChange} />

            <label htmlFor="pro-designation">Current Designation</label>
            <input id="pro-designation" name="designation" value={formData.designation} onChange={handleChange} />

            <label htmlFor="pro-newDesignation">New Designation</label>
            <input id="pro-newDesignation" name="newDesignation" value={formData.newDesignation} onChange={handleChange} />

            <label htmlFor="pro-department">Department</label>
            <input id="pro-department" name="department" value={formData.department} onChange={handleChange} />

            <label htmlFor="pro-employeeId">Employee ID</label>
            <input id="pro-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} />

            <label htmlFor="pro-reportingManager">Reporting Manager</label>
            <input id="pro-reportingManager" name="reportingManager" value={formData.reportingManager} onChange={handleChange} />

            <label htmlFor="pro-workLocation">Work Location</label>
            <input id="pro-workLocation" name="workLocation" value={formData.workLocation} onChange={handleChange} />

            <label htmlFor="pro-effectiveDate">Effective Date</label>
            <input id="pro-effectiveDate" type="date" name="effectiveDate" value={toISODate(formData.effectiveDate)} onChange={handleDateChange} />

            <label htmlFor="pro-previousBasic">Previous Basic Salary</label>
            <input id="pro-previousBasic" name="previousBasic" value={formData.previousBasic} onChange={handleChange} placeholder="৮,০০০/-" />

            <label htmlFor="pro-newBasic">New Basic Salary</label>
            <input id="pro-newBasic" name="newBasic" value={formData.newBasic} onChange={handleChange} placeholder="১০,০০০/-" />

            <label htmlFor="pro-previousGross">Previous Gross Salary</label>
            <input id="pro-previousGross" name="previousGross" value={formData.previousGross} onChange={handleChange} placeholder="১২,০০০/-" />

            <label htmlFor="pro-newGross">New Gross Salary</label>
            <input id="pro-newGross" name="newGross" value={formData.newGross} onChange={handleChange} placeholder="১৫,০০০/-" />

            <label htmlFor="pro-signerName">Authorized Name</label>
            <input id="pro-signerName" name="signerName" value={formData.signerName} onChange={handleChange} />

            <label htmlFor="pro-signerDesignation">Authorized Designation</label>
            <input id="pro-signerDesignation" name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />

            <label htmlFor="pro-signerDate">Authorized Date</label>
            <input id="pro-signerDate" type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />

            <label htmlFor="pro-agreementDate">Acceptance Date</label>
            <input id="pro-agreementDate" type="date" name="agreementDate" value={toISODate(formData.agreementDate)} onChange={handleDateChange} />

            <label htmlFor="pro-fileNo">File No</label>
            <input id="pro-fileNo" name="fileNo" value={formData.fileNo} onChange={handleChange} />

            <label htmlFor="pro-ehrId">EHR ID</label>
            <input id="pro-ehrId" name="ehrId" value={formData.ehrId} onChange={handleChange} />

            <label htmlFor="pro-hrApproval">HR Approval</label>
            <input id="pro-hrApproval" name="hrApproval" value={formData.hrApproval} onChange={handleChange} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Letters</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedLetters.length === 0 ? (
                <p className="text-muted text-center py-4">No saved letters.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Ref No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedLetters.map(letter => (
                      <tr key={letter.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadLetter(letter.id)}>
                        <td>{letter.employee_name || '-'}</td>
                        <td>{letter.employee_id || '-'}</td>
                        <td>{letter.ref_no || '-'}</td>
                        <td>{letter.updated_at ? new Date(letter.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{letter.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadLetter(letter.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeleteLetter(letter.id); }}><i className="fas fa-trash"></i></button>
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

      <div className="preview-pane">
        <div className="letter-page">
          <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '420px', opacity: '0.04', zIndex: 0, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f59e0b', paddingBottom: '14px', marginBottom: '16px' }}>
            <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
            <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
              <div><strong>সূত্র:</strong> {formData.refNo}</div>
              <div><strong>তারিখ:</strong> {formatBanglaDate(formData.issueDate)}</div>
            </div>
          </div>

          <div className="title-main" style={{ color: '#78350f', fontFamily: "'Hind Siliguri',sans-serif" }}>পদোন্নতি পত্র</div>
          <div className="title-sub" style={{ color: '#d97706', letterSpacing: '1px' }}>PROMOTION LETTER</div>

          <div className="content">
            <p style={{ margin: '0 0 10px' }}><strong>বিষয়:</strong> পদোন্নতি সংক্রান্ত অফার লেটার (Promotion Letter) — গোপনীয়</p>
            <p style={{ margin: '0 0 10px' }}><strong>জনাব/জনাবা {formData.employeeName || '[Employee Name]'},</strong></p>
            <p style={{ margin: '0 0 10px' }}>
              আস-সালামু আলাইকুম। স্পিড নেট (Speed Net) কর্তৃপক্ষের পক্ষ থেকে আপনাকে আন্তরিক শুভেচ্ছা ও অভিনন্দন জানানো হচ্ছে।
              প্রতিষ্ঠানে আপনার বিগত কর্মকালের চমৎকার কর্মদক্ষতা, নিষ্ঠা, সততা এবং অসামান্য অবদানের স্বীকৃতিস্বরূপ ব্যবস্থাপনা
              কর্তৃপক্ষ আপনার পদোন্নতি প্রদানের সিদ্ধান্ত গ্রহণ করেছেন। এই সিদ্ধান্তটি স্পিড নেট এইচআর নীতিমালা অনুযায়ী
              সমন্বয় করা হয়েছে।
            </p>

            <div className="section-title">ধারা ১: কর্মী পরিচিতি ও বর্তমান বিবরণ</div>
            <div className="info-grid">
              <div className="info-box"><strong>১. কর্মীর নাম</strong><span>{formData.employeeName || '[Employee Name]'}</span></div>
              <div className="info-box"><strong>২. পিতা/স্বামীর নাম</strong><span>{formData.fatherHusbandName || '[Father/Husband Name]'}</span></div>
              <div className="info-box"><strong>৩. জাতীয় পরিচয়পত্র নং</strong><span>{formData.nidNumber || '[NID Number]'}</span></div>
              <div className="info-box"><strong>৪. পদবী (Designation)</strong><span>{formData.designation || '[Designation]'}</span></div>
              <div className="info-box"><strong>৫. নতুন পদবী</strong><span>{formData.newDesignation || '[New/Promoted Designation]'}</span></div>
              <div className="info-box"><strong>৬. বিভাগ (Department)</strong><span>{formData.department || '[Department]'}</span></div>
              <div className="info-box"><strong>৭. কর্মী আইডি</strong><span>{formData.employeeId || '[Employee ID]'}</span></div>
              <div className="info-box"><strong>৮. রিপোর্টিং কর্মকর্তা</strong><span>{formData.reportingManager || '[Reporting Manager]'}</span></div>
              <div className="info-box"><strong>৯. কর্মস্থল</strong><span>{formData.workLocation || '[Work Location]'}</span></div>
              <div className="info-box" style={{ gridColumn: '1 / -1' }}><strong>১০. কার্যকর হওয়ার তারিখ</strong><span>{formatBanglaDate(formData.effectiveDate)}</span></div>
            </div>

            <div className="section-title">ধারা ২: নতুন দায়িত্ব ও কর্তব্য (Revised Job Responsibilities)</div>
            <p>আপনার নতুন পদবী ও বর্ধিত দায়িত্বের আলোকে নিম্নবর্ণিত দায়িত্বসমূহ অর্পণ করা হলো:</p>
            <ul style={{ paddingLeft: '20px', margin: '0 0 12px' }}>
              <li>পদ সংশ্লিষ্ট উচ্চতর প্রযুক্তিগত ও প্রশাসনিক কার্যক্রম সততা ও পেশাদারিত্বের সাথে পরিচালনা করা।</li>
              <li>টিমের জুনিয়র সদস্যদের তদারকি, দিকনির্দেশনা প্রদান এবং কাজের সার্বিক মান নিশ্চিত করা।</li>
              <li>গ্রাহক সেবার মানোন্নয়ন, জটিল নেটওয়ার্ক সমস্যা দ্রুত সমাধান এবং ক্লায়েন্ট সন্তুষ্টি বৃদ্ধি করা।</li>
              <li>নেটওয়ার্ক ইনফ্রাস্ট্রাকচার আপগ্রেড ও জরুরি রক্ষণাবেক্ষণ কাজে সক্রিয় ভূমিকা পালন করা।</li>
              <li>কোম্পানির সার্বিক লক্ষ্যমাত্রা (KPI) অর্জনে নেতৃত্ব প্রদান এবং উর্ধ্বতন কর্তৃপক্ষের অর্পিত বিশেষ দায়িত্ব পালন করা।</li>
            </ul>

            <div className="section-title">ধারা ৩: সংশোধিত বেতন কাঠামো (Revised Salary & Compensation Structure)</div>
            <p>আপনার বর্ধিত নতুন বেতন কাঠামো নিম্নরূপ নির্ধারণ করা হয়েছে যা {formatBanglaDate(formData.effectiveDate)} হতে কার্যকর হবে:</p>
            <table className="salary-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>বেতনের খাত (Salary Component)</th>
                  <th style={{ width: '30%' }}>পূর্ববর্তী পরিমাণ (টাকা)</th>
                  <th style={{ width: '30%' }}>নবনির্ধারিত পরিমাণ (টাকা)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>মূল বেতন (Basic Salary)</td>
                  <td>{formData.previousBasic || '—'}</td>
                  <td>{formData.newBasic || '—'}</td>
                </tr>
                <tr>
                  <td>ওভারটাইম ভাতা (Overtime Rate)</td>
                  <td>{formData.overtimePolicy || 'শ্রম আইন অনুযায়ী'}</td>
                  <td>{formData.overtimePolicy || 'শ্রম আইন অনুযায়ী (দ্বিগুণ)'}</td>
                </tr>
                <tr>
                  <td><strong>মোট মাসিক বেতন (Gross Monthly Salary)</strong></td>
                  <td><strong>{formData.previousGross || '—'}</strong></td>
                  <td><strong>{formData.newGross || '—'}</strong></td>
                </tr>
              </tbody>
            </table>

            <div className="section-title">ধারা ৪: ওভারটাইম ও ভবিষ্যৎ তহবিল (Overtime & Provident Fund Policy)</div>
            <p>৪.১ বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ১০৮ অনুযায়ী নিয়মিত কর্মঘণ্টার অতিরিক্ত কাজের জন্য সাধারণ মজুরির দ্বিগুণ হারে ওভারটাইম প্রদেয় হবে।</p>
            <p>৪.২ স্থায়ী কর্মী হিসেবে নবনির্ধারিত মূল বেতনের ৫% (পাঁচ শতাংশ) ভবিষ্যৎ তহবিলে জমা হবে এবং কোম্পানি নির্ধারিত অংশ যোগ করবে।</p>

            <div className="section-title">ধারা ৫: উৎসব ভাতা ও ছুটি নীতি (Festival Bonus & Leave Policy)</div>
            <p>৫.১ বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ১৩২ অনুযায়ী প্রতি বছর দুইটি প্রধান ঈদে নবনির্ধারিত মূল বেতনের ৫০% হারে মোট ১ মাসের মূল বেতনের সমপরিমাণ উৎসব বোনাস প্রদেয় হবে।</p>
            <p>৫.২ সার্ভিস ওরিয়েন্টেড প্রতিষ্ঠান হওয়ায় পূর্বের নিয়ম অনুযায়ী মাসিক নির্ধারিত ছুটি, সরকারি ছুটি ও জরুরি ছুটির নীতি অপরিবর্তিত থাকবে।</p>

            <div className="section-title">ধারা ৬: গোপনীয়তা ও পেশাদার আচরণ (Confidentiality & Code of Conduct)</div>
            <p>৬.১ এই বর্ধিত বেতন কাঠামো সম্পূর্ণ গোপনীয় (Confidential)। অন্য কোনো সহকর্মীর নিকট এই তথ্য প্রকাশ করা শৃঙ্খলাভঙ্গ হিসেবে গণ্য হবে।</p>
            <p>৬.২ কোম্পানির যাবতীয় তথ্য, নেটওয়ার্ক সিকিউরিটি এবং ক্লায়েন্ট ডেটার গোপনীয়তা রক্ষা করা বাধ্যতামূলক।</p>

            <div className="section-title">ধারা ৭: সাধারণ বিধানাবলী (General Provisions)</div>
            <p>৭.১ নিয়োগপত্রের অন্যান্য সমস্ত মৌলিক শর্তাবলী, যা পূর্বের নিয়োগপত্রে (Ref: SN/HR/APPT/...) উল্লেখ ছিল, তা অপরিবর্তিত ও কার্যকর থাকবে।</p>
            <p>৭.২ এই বর্ধিত বেতন চিঠিটি মূল নিয়োগপত্রের একটি অবিচ্ছেদ্য অংশ (Integral Part) হিসেবে গণ্য হবে।</p>

            <div className="section-title">ধারা ৮: গ্রহণ ঘোষণা (Acceptance Declaration)</div>
            <p>আমি, {formData.employeeName || '[Employee Name]'}, এতদ্বারা ঘোষণা করছি যে আমি উপরোক্ত বেতন বৃদ্ধি ও পদোন্নতির শর্তাবলী সম্পূর্ণভাবে পাঠ করেছি, বুঝেছি এবং সজ্ঞান চিত্তে এতে সম্মত হয়েছি।</p>

            <div className="signature-row">
              <div className="signature-box">
                <div style={{ fontWeight: 800, marginBottom: '8px' }}>কর্তৃপক্ষের স্বাক্ষর ও সিল</div>
                <div className="sig-line"></div>
                <div>নাম: {formData.signerName || '_______________________'}</div>
                <div>পদবী: {formData.signerDesignation || '_______________________'}</div>
                <div>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
              </div>

              <div className="signature-box">
                <div style={{ fontWeight: 800, marginBottom: '8px' }}>কর্মীর স্বাক্ষর</div>
                <div className="sig-line"></div>
                <div>নাম: {formData.employeeName || '[Employee Name]'}</div>
                <div>পদবী: {formData.newDesignation || '[New Designation]'}</div>
                <div>তারিখ: {formatBanglaDate(formData.agreementDate)}</div>
              </div>
            </div>

            <div className="bottom-note">
              <p style={{ margin: '0 0 8px' }}><strong>⚠</strong> এই পদোন্নতি পত্রটি বাংলাদেশ শ্রম আইন ২০০৬ (সংশোধনী ২০১৩, ২০১৮) এবং কোম্পানির এইচআর নীতি অনুযায়ী প্রস্তুতকৃত। উভয় পক্ষের স্বাক্ষর সাপেক্ষে এটি কার্যকর হবে।</p>
              <p style={{ margin: '0 0 4px' }}><strong>✦ গ্রহণের তারিখ:</strong> {formData.agreementDate ? formatBanglaDate(formData.agreementDate) : '________________'}</p>
              <p style={{ margin: '0 0 4px' }}><strong>✦ ফাইল নং:</strong> {formData.fileNo || '________________'}</p>
              <p style={{ margin: '0 0 4px' }}><strong>✦ ইএইচআর আইডি:</strong> {formData.ehrId || '________________'}</p>
              <p style={{ margin: '0' }}><strong>✦ এইচআর অনুমোদন:</strong> {formData.hrApproval || '________________'}</p>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PromotionLetterGenerator;
