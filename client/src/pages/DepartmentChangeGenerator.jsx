import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveDepartmentChange, getMyDepartmentChanges, getDepartmentChangeById, updateDepartmentChange, deleteDepartmentChange, getNextDepartmentChangeNumbers } from '../services/departmentChangeService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const DepartmentChangeGenerator = () => {
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
    refNo: 'SNKHL/HR/DC/' + moment().year() + '/01',
    date: moment().format('DD/MM/YYYY'),
    employeeName: '',
    employeeId: '',
    currentDesignation: '',
    currentDepartment: '',
    newDepartment: '',
    newDesignation: '',
    effectiveDate: '',
    reportingManagerTitle: '',
    handoverDate: '',
    salaryPolicy: 'বর্তমান বেতন কাঠামো ও অন্যান্য দাপ্তরিক সুবিধাদি অপরিবর্তিত থাকবে।',
    signerName: user?.full_name || '',
    signerDesignation: user?.role || 'ব্যবস্থাপনা কর্তৃপক্ষ',
    signerDate: moment().format('DD/MM/YYYY'),
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
      const n = await getNextDepartmentChangeNumbers();
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
        currentDesignation: found.designation || prev.currentDesignation,
        currentDepartment: found.department || prev.currentDepartment,
      }));
    }
  };

  const handleSaveToServer = async () => {
    if (!formData.employeeName?.trim()) {
      notify.error('Employee name is required');
      return;
    }
    if (!formData.refNo?.trim()) {
      notify.error('Reference no is required');
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
        await updateDepartmentChange(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveDepartmentChange(payload);
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
      const data = await getMyDepartmentChanges();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getDepartmentChangeById(id);
      if (letter?.form_data) {
        const def = defaultForm();
        const loaded = letter.form_data;
        setFormData({ ...def, ...loaded });
        setSelectedEmployeeId(loaded.employeeId || '');
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
      await deleteDepartmentChange(id);
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

  const formatBanglaDate = (dateString) => {
    if (!dateString) return '________________';
    const date = moment(dateString, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!date.isValid()) return String(dateString);
    return date.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Department Change Letter. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #6366f1;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #a5b4fc; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form textarea { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; resize: vertical; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .transfer-badge {
          background: linear-gradient(135deg, #4f46e5, #6366f1);
          color: #fff; padding: 4px 14px; border-radius: 20px;
          font-size: 12px; font-weight: 700; display: inline-block;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
        .info-cell { background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 14px; line-height: 1.6; }
        .info-cell strong { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
        .arrow-row {
          display: flex; align-items: center; gap: 12px; margin: 14px 0;
          background: #f0f4ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px 16px;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .dept-box { flex: 1; text-align: center; }
        .dept-label { font-size: 11px; color: #6366f1; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
        .dept-name { font-size: 16px; font-weight: 800; color: #1e293b; }
        .dept-sub { font-size: 13px; color: #475569; }
        .arrow-icon { font-size: 24px; color: #6366f1; }
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
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)', borderRadius: '8px', border: '1px solid #6366f1' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-exchange-alt me-2" style={{ color: '#a5b4fc' }}></i>Department Change Letter
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#6366f1', color: '#fff' }} onClick={() => window.print()}>
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
          <div className="sec-title">Letter Info</div>
          <div className="sec-body">
            <label htmlFor="dc-employee-select">Select Employee (auto-fill)</label>
            <select id="dc-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="dc-refNo">Reference No</label>
            <input id="dc-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />
            <label htmlFor="dc-date">Date</label>
            <input id="dc-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
            <label htmlFor="dc-employeeName">Employee Name</label>
            <input id="dc-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label htmlFor="dc-employeeId">Employee ID</label>
            <input id="dc-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label htmlFor="dc-currentDesignation">Current Designation</label>
            <input id="dc-currentDesignation" name="currentDesignation" value={formData.currentDesignation} onChange={handleChange} />
            <label htmlFor="dc-currentDepartment">Current Department</label>
            <input id="dc-currentDepartment" name="currentDepartment" value={formData.currentDepartment} onChange={handleChange} />
            <label htmlFor="dc-newDepartment">New Department</label>
            <input id="dc-newDepartment" name="newDepartment" value={formData.newDepartment} onChange={handleChange} />
            <label htmlFor="dc-newDesignation">New Designation</label>
            <input id="dc-newDesignation" name="newDesignation" value={formData.newDesignation} onChange={handleChange} />
            <label htmlFor="dc-effectiveDate">Effective Date</label>
            <input id="dc-effectiveDate" type="date" name="effectiveDate" value={toISODate(formData.effectiveDate)} onChange={handleDateChange} />
            <label htmlFor="dc-reportingManagerTitle">New Department Manager Title</label>
            <input id="dc-reportingManagerTitle" name="reportingManagerTitle" value={formData.reportingManagerTitle} onChange={handleChange} />
            <label htmlFor="dc-handoverDate">Handover Completion Date</label>
            <input id="dc-handoverDate" type="date" name="handoverDate" value={toISODate(formData.handoverDate)} onChange={handleDateChange} />
            <label htmlFor="dc-salaryPolicy">Salary Policy</label>
            <textarea id="dc-salaryPolicy" name="salaryPolicy" value={formData.salaryPolicy} onChange={handleChange} rows={3} />
            <label htmlFor="dc-signerName">Signer Name</label>
            <input id="dc-signerName" name="signerName" value={formData.signerName} onChange={handleChange} />
            <label htmlFor="dc-signerDesignation">Signer Designation</label>
            <input id="dc-signerDesignation" name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />
            <label htmlFor="dc-signerDate">Signer Date</label>
            <input id="dc-signerDate" type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />
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

      {/* Preview */}
      <div className="preview-pane">
        <div className="letter-page">
          <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '420px', opacity: '0.04', zIndex: 0, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #6366f1', paddingBottom: '14px', marginBottom: '18px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', lineHeight: 1.8, fontSize: '13px', color: '#475569' }}>
                <div><strong>সূত্র:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
                <span className="transfer-badge">বিভাগ পরিবর্তন পত্র</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '26px', fontWeight: 800, color: '#1e293b' }}>বিভাগ পরিবর্তন সংক্রান্ত পত্র</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '16px' }}>
              DEPARTMENT TRANSFER LETTER
            </div>

            {/* Recipient */}
            <div style={{ fontSize: '15px', lineHeight: 1.8, marginBottom: '14px', color: '#334155' }}>
              <strong>বরাবর,</strong><br />
              {formData.employeeName || '[কর্মীর নাম]'}<br />
              আইডি: {formData.employeeId || '[ID]'} | পদবী: {formData.currentDesignation || '[বর্তমান পদবী]'}<br />
              বিভাগ: {formData.currentDepartment || '[বর্তমান বিভাগ]'}<br />
              <strong>স্পিড নেট খুলনা।</strong>
            </div>

            {/* Department Transfer Visualization */}
            <div className="arrow-row">
              <div className="dept-box">
                <div className="dept-label">বর্তমান বিভাগ</div>
                <div className="dept-name">{formData.currentDepartment || '—'}</div>
                <div className="dept-sub">{formData.currentDesignation || '—'}</div>
              </div>
              <div className="arrow-icon">→</div>
              <div className="dept-box">
                <div className="dept-label" style={{ color: '#059669' }}>নতুন বিভাগ</div>
                <div className="dept-name" style={{ color: '#059669' }}>{formData.newDepartment || '—'}</div>
                <div className="dept-sub">{formData.newDesignation || '—'}</div>
              </div>
            </div>

            {/* Body */}
            <div style={{ fontSize: '15px', lineHeight: 1.85, textAlign: 'justify', color: '#334155' }}>
              আপনাকে অবগতির সাথে জানানো যাচ্ছে যে, আপনার কাজের দক্ষতা, অভিজ্ঞতা এবং কোম্পানির বর্তমান প্রশাসনিক প্রয়োজন বিবেচনায় <strong>স্পিড নেট খুলনা</strong> ব্যবস্থাপনা কর্তৃপক্ষ আপনাকে <strong>{formData.currentDepartment || '[বর্তমান বিভাগ]'}</strong> থেকে <strong>{formData.newDepartment || '[নতুন বিভাগ]'}</strong>-এ <strong>{formData.newDesignation || '[নতুন পদবী]'}</strong> হিসেবে স্থানান্তরের সিদ্ধান্ত গ্রহণ করেছে। এই পরিবর্তন <strong>{formatBanglaDate(formData.effectiveDate)}</strong> তারিখ থেকে কার্যকর হবে।
            </div>

            {/* Terms */}
            <div style={{ fontWeight: 800, fontSize: '14px', color: '#1e293b', marginTop: '16px', marginBottom: '8px' }}>শর্তাবলী:</div>
            <ol style={{ paddingLeft: '20px', margin: '0', fontSize: '15px', lineHeight: 1.85, color: '#334155' }}>
              <li><strong>দায়িত্ব গ্রহণ:</strong> আপনাকে <strong>{formatBanglaDate(formData.effectiveDate)}</strong> তারিখে <strong>{formData.reportingManagerTitle || '[নতুন বিভাগীয় প্রধানের পদবী]'}</strong>-এর নিকট রিপোর্ট করতে হবে।</li>
              <li><strong>বেতন ও সুবিধাদি:</strong> {formData.salaryPolicy}</li>
              <li><strong>হস্তান্তর প্রক্রিয়া:</strong> নতুন দায়িত্ব গ্রহণের পূর্বে <strong>{formatBanglaDate(formData.handoverDate)}</strong>-এর মধ্যে বর্তমান বিভাগের সকল কাজ ও সম্পদ যথাযথভাবে হস্তান্তর করতে হবে।</li>
            </ol>

            <div style={{ fontSize: '15px', lineHeight: 1.85, marginTop: '14px', textAlign: 'justify', color: '#334155' }}>
              কোম্পানির পূর্ববর্তী বিভাগে আপনার অবদান প্রশংসনীয় ছিল। আমরা বিশ্বাস করি, নতুন দায়িত্বে আপনি আরও বেশি ভূমিকা রাখতে সক্ষম হবেন। আপনার পেশাগত জীবনের উত্তরোত্তর সাফল্য কামনা করছি।
            </div>

            {/* Signature */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '24px' }}>
              <div style={{ textAlign: 'center', width: '230px' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '44px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{formData.signerName || '__________________'}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>{formData.signerDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
              </div>
            </div>

            {/* CC */}
            <div style={{ marginTop: '16px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '13px', color: '#475569' }}>
              <strong>অনুলিপি:</strong> এইচআর ও অ্যাডমিন বিভাগ | ফাইন্যান্স ও অ্যাকাউন্টস | {formData.currentDepartment || '[বর্তমান বিভাগ]'} | {formData.newDepartment || '[নতুন বিভাগ]'} | ব্যক্তিগত নথি
            </div>

            <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DepartmentChangeGenerator;
