import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveSalaryIncrement, getMySalaryIncrements, getSalaryIncrementById, updateSalaryIncrement, deleteSalaryIncrement, getNextSalaryIncrementNumbers } from '../services/salaryIncrementService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const SalaryIncrementLetterGenerator = () => {
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
    refNo: 'SNKHL/HR/SIL/' + moment().year() + '/01',
    date: moment().format('DD/MM/YYYY'),
    employeeName: '',
    designation: '',
    department: '',
    employeeId: '',
    reportingManager: '',
    workLocation: 'স্পিড নেট খুলনা, প্রধান কার্যালয়',
    effectiveDate: moment().add(1, 'month').startOf('month').format('DD/MM/YYYY'),
    basicSalaryPrev: '',
    basicSalaryNew: '',
    overtime: 'বাংলাদেশ শ্রম আইন ও কোম্পানির নীতিমালা অনুযায়ী',
    grossPrev: '',
    grossNew: '',
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
      const n = await getNextSalaryIncrementNumbers();
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
        await updateSalaryIncrement(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveSalaryIncrement(payload);
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
      const data = await getMySalaryIncrements();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getSalaryIncrementById(id);
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
      await deleteSalaryIncrement(id);
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
        <div className="alert alert-danger mb-0">No permission to generate Salary Increment Letter. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  const SalaryRow = ({ label, prev, next, isTotal }) => (
    <tr style={{ background: isTotal ? '#f0fdf4' : undefined }}>
      <td style={{ padding: '10px 14px', border: '1px solid #e2e8f0', fontWeight: isTotal ? 800 : 500, fontSize: '14px' }}>{label}</td>
      <td style={{ padding: '10px 14px', border: '1px solid #e2e8f0', textAlign: 'center', fontSize: '14px', color: '#ef4444', fontWeight: isTotal ? 800 : 500 }}>{prev}</td>
      <td style={{ padding: '10px 14px', border: '1px solid #e2e8f0', textAlign: 'center', fontSize: '14px', color: '#16a34a', fontWeight: isTotal ? 800 : 500 }}>{next}</td>
    </tr>
  );

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .admin-sidebar-form {
          width: 380px; min-width: 320px; background: #0d1f3c; color: #e0e8f5;
          padding: 16px; overflow-y: auto; max-height: calc(100vh - 70px);
          border-right: 3px solid #16a34a;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #4ade80; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .salary-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
        .salary-table thead tr {
          background: linear-gradient(90deg, #15803d, #16a34a);
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .salary-table thead th { padding: 10px 14px; color: #fff; font-weight: 700; font-size: 14px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
        .info-cell { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 8px 12px; border-radius: 6px; font-size: 13px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .info-cell strong { display: block; font-size: 10px; color: #15803d; text-transform: uppercase; margin-bottom: 2px; font-weight: 700; }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #16a34a; }
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
          .salary-table, .salary-table tr, .salary-table thead, .salary-table tbody { break-inside: avoid !important; page-break-inside: avoid !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)', borderRadius: '8px', border: '1px solid #16a34a' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-chart-line me-2" style={{ color: '#4ade80' }}></i>Salary Increment Letter
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#16a34a', color: '#fff' }} onClick={() => window.print()}>
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
          <div className="sec-title">Employee Info</div>
          <div className="sec-body">
            <label htmlFor="sil-employee-select">Select Employee (auto-fill)</label>
            <select id="sil-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="sil-refNo">Reference No</label>
            <input id="sil-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />
            <label htmlFor="sil-date">Date</label>
            <input id="sil-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
            <label htmlFor="sil-employeeName">Employee Name</label>
            <input id="sil-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label htmlFor="sil-designation">Designation</label>
            <input id="sil-designation" name="designation" value={formData.designation} onChange={handleChange} />
            <label htmlFor="sil-department">Department</label>
            <input id="sil-department" name="department" value={formData.department} onChange={handleChange} />
            <label htmlFor="sil-employeeId">Employee ID</label>
            <input id="sil-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label htmlFor="sil-reportingManager">Reporting Manager</label>
            <input id="sil-reportingManager" name="reportingManager" value={formData.reportingManager} onChange={handleChange} />
            <label htmlFor="sil-effectiveDate">Effective Date</label>
            <input id="sil-effectiveDate" type="date" name="effectiveDate" value={toISODate(formData.effectiveDate)} onChange={handleDateChange} />
          </div>
        </div>
        <div className="sec">
          <div className="sec-title">Salary Info</div>
          <div className="sec-body">
            <label htmlFor="sil-basicPrev">Previous Basic Salary</label>
            <input id="sil-basicPrev" name="basicSalaryPrev" value={formData.basicSalaryPrev} onChange={handleChange} placeholder="8,000/-" />
            <label htmlFor="sil-basicNew">New Basic Salary</label>
            <input id="sil-basicNew" name="basicSalaryNew" value={formData.basicSalaryNew} onChange={handleChange} placeholder="10,000/-" />
            <label htmlFor="sil-grossPrev">Previous Gross Salary</label>
            <input id="sil-grossPrev" name="grossPrev" value={formData.grossPrev} onChange={handleChange} placeholder="12,000/-" />
            <label htmlFor="sil-grossNew">New Gross Salary</label>
            <input id="sil-grossNew" name="grossNew" value={formData.grossNew} onChange={handleChange} placeholder="15,000/-" />
            <label htmlFor="sil-signerName">Signer Name</label>
            <input id="sil-signerName" name="signerName" value={formData.signerName} onChange={handleChange} />
            <label htmlFor="sil-signerDesignation">Signer Designation</label>
            <input id="sil-signerDesignation" name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />
            <label htmlFor="sil-signerDate">Signer Date</label>
            <input id="sil-signerDate" type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #16a34a', paddingBottom: '14px', marginBottom: '16px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>সূত্র:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '26px', fontWeight: 800, color: '#1e293b' }}>বেতন বৃদ্ধি পত্র</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '16px' }}>
              SALARY INCREMENT LETTER
            </div>

            {/* Employee Info Grid */}
            <div className="info-grid">
              <div className="info-cell"><strong>কর্মীর নাম</strong>{formData.employeeName || '[Employee Name]'}</div>
              <div className="info-cell"><strong>পদবী</strong>{formData.designation || '[Designation]'}</div>
              <div className="info-cell"><strong>বিভাগ</strong>{formData.department || '[Department]'}</div>
              <div className="info-cell"><strong>কর্মী আইডি</strong>{formData.employeeId || '[ID]'}</div>
              <div className="info-cell"><strong>রিপোর্টিং ম্যানেজার</strong>{formData.reportingManager || '[Manager]'}</div>
              <div className="info-cell"><strong>কার্যকর তারিখ</strong>{formatBanglaDate(formData.effectiveDate)}</div>
            </div>

            {/* Body */}
            <div style={{ fontSize: '15px', lineHeight: 1.85, textAlign: 'justify', color: '#334155', marginTop: '8px' }}>
              আস-সালামু আলাইকুম। স্পিড নেট খুলনা (Speed Net Khulna) কর্তৃপক্ষের পক্ষ থেকে আন্তরিক শুভেচ্ছা। প্রতিষ্ঠানে আপনার কর্মদক্ষতা, নিষ্ঠা, সততা এবং দায়িত্বশীলতার স্বীকৃতিস্বরূপ ব্যবস্থাপনা কর্তৃপক্ষ আপনার মাসিক বেতন বৃদ্ধি করার সিদ্ধান্ত গ্রহণ করেছে। নিম্নে সংশোধিত বেতন কাঠামো প্রদান করা হলো, যা <strong>{formatBanglaDate(formData.effectiveDate)}</strong> হতে কার্যকর হবে।
            </div>

            {/* Salary Table */}
            <table className="salary-table">
              <thead>
                <tr>
                  <th style={{ width: '45%', textAlign: 'left' }}>বেতনের খাত</th>
                  <th style={{ width: '27.5%' }}>পূর্ববর্তী (টাকা)</th>
                  <th style={{ width: '27.5%' }}>নতুন (টাকা)</th>
                </tr>
              </thead>
              <tbody>
                <SalaryRow label="মূল বেতন (Basic Salary)" prev={formData.basicSalaryPrev || '—'} next={formData.basicSalaryNew || '—'} />
                <SalaryRow label="ওভারটাইম" prev={formData.overtime} next={formData.overtime} />
                <SalaryRow label="মোট মাসিক বেতন (Gross Salary)" prev={formData.grossPrev || '—'} next={formData.grossNew || '—'} isTotal={true} />
              </tbody>
            </table>

            {/* Terms */}
            <div style={{ fontWeight: 800, fontSize: '14px', color: '#1e293b', marginBottom: '8px', marginTop: '4px' }}>শর্তাবলী:</div>
            <ol style={{ paddingLeft: '20px', margin: '0', fontSize: '15px', lineHeight: 1.85, color: '#334155' }}>
              <li>এই বেতন বৃদ্ধি {formatBanglaDate(formData.effectiveDate)} থেকে কার্যকর হবে।</li>
              <li>পূর্ববর্তী নিয়োগপত্রের অন্যান্য সকল শর্ত ও নীতিমালা অপরিবর্তিত থাকবে।</li>
              <li>বেতন ও আর্থিক তথ্য গোপনীয় — কর্তৃপক্ষের অনুমতি ব্যতীত প্রকাশ করা যাবে না।</li>
            </ol>

            <div style={{ fontSize: '15px', lineHeight: 1.85, marginTop: '12px', textAlign: 'justify', color: '#334155' }}>
              আমরা আশা করি, ভবিষ্যতেও আপনি একই নিষ্ঠা ও পেশাদারিত্বের সাথে দায়িত্ব পালন করবেন।
            </div>

            {/* Dual Signature */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginTop: 'auto', paddingTop: '24px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '44px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{formData.signerName || '__________________'}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>{formData.signerDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '44px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{formData.employeeName || '__________________'}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>কর্মীর স্বাক্ষর</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>তারিখ: _______________</div>
              </div>
            </div>

            <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalaryIncrementLetterGenerator;
