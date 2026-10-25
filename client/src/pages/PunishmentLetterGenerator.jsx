import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { savePunishmentLetter, getMyPunishmentLetters, getPunishmentLetterById, updatePunishmentLetter, deletePunishmentLetter, getNextPunishmentNumbers } from '../services/punishmentLetterService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const PunishmentLetterGenerator = () => {
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
    refNo: 'SNKHL/HR/PL/' + moment().year() + '/01',
    issueDate: moment().format('DD/MM/YYYY'),
    employeeName: '',
    employeeId: '',
    designation: '',
    department: '',
    incidentDate: '',
    incidentSummary: '',
    showCauseRef: '',
    punishmentType: '',
    signerName: user?.full_name || '',
    signerDesignation: user?.role || 'মানবসম্পদ ব্যবস্থাপক',
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
      const n = await getNextPunishmentNumbers();
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
        await updatePunishmentLetter(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await savePunishmentLetter(payload);
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
      const data = await getMyPunishmentLetters();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getPunishmentLetterById(id);
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
      await deletePunishmentLetter(id);
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
    if (!value) return '____ / ____ / ______';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return value;
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Punishment Letter. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #dc2626;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #f87171; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form textarea, .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form textarea { resize: vertical; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 18mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .punishment-notice {
          background: #fef2f2; border-left: 4px solid #dc2626;
          padding: 14px 16px; border-radius: 0 8px 8px 0; margin: 14px 0;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #dc2626; }
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
          .punishment-notice { break-inside: avoid !important; page-break-inside: avoid !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', borderRadius: '8px', border: '1px solid #dc2626' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-gavel text-danger me-2"></i>Disciplinary Notice Generator
          </h5>
        </div>
        <button className="btn btn-danger w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
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
            <label htmlFor="pun-employee-select">Select Employee (auto-fill)</label>
            <select id="pun-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="pun-refNo">Reference No</label>
            <input id="pun-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />
            <label htmlFor="pun-issueDate">Date</label>
            <input id="pun-issueDate" type="date" name="issueDate" value={toISODate(formData.issueDate)} onChange={handleDateChange} />
            <label htmlFor="pun-employeeName">Employee Name</label>
            <input id="pun-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label htmlFor="pun-employeeId">Employee ID</label>
            <input id="pun-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label htmlFor="pun-designation">Designation</label>
            <input id="pun-designation" name="designation" value={formData.designation} onChange={handleChange} />
            <label htmlFor="pun-department">Department</label>
            <input id="pun-department" name="department" value={formData.department} onChange={handleChange} placeholder="e.g. Network Operation" />
            <label htmlFor="pun-incidentDate">Incident Date</label>
            <input id="pun-incidentDate" type="date" name="incidentDate" value={toISODate(formData.incidentDate)} onChange={handleDateChange} />
            <label htmlFor="pun-incidentSummary">Incident Details</label>
            <textarea id="pun-incidentSummary" name="incidentSummary" value={formData.incidentSummary} onChange={handleChange} rows={5} placeholder="Describe the incident in detail..." />
            <label htmlFor="pun-showCauseRef">Show-Cause Reference</label>
            <input id="pun-showCauseRef" name="showCauseRef" value={formData.showCauseRef} onChange={handleChange} placeholder="e.g. SNKHL/HR/SC/2026/03" />
            <label htmlFor="pun-punishmentType">Punishment Type</label>
            <textarea id="pun-punishmentType" name="punishmentType" value={formData.punishmentType} onChange={handleChange} rows={4} placeholder="e.g. ১ (এক) দিনের বেতন কর্তন / লিখিত সতর্কবার্তা..." />
            <label htmlFor="pun-signerName">Signer Name</label>
            <input id="pun-signerName" name="signerName" value={formData.signerName} onChange={handleChange} />
            <label htmlFor="pun-signerDesignation">Signer Designation</label>
            <input id="pun-signerDesignation" name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />
            <label htmlFor="pun-signerDate">Signer Date</label>
            <input id="pun-signerDate" type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #dc2626', paddingBottom: '14px', marginBottom: '18px' }}>
              <div>
                <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
                <div style={{ fontWeight: 800, fontSize: '18px', color: '#1e293b', marginTop: '4px' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>ইন্টারনেট সার্ভিস প্রোভাইডার</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>সূত্র:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.issueDate)}</div>
              </div>
            </div>

            {/* Title */}
            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 800, color: '#991b1b' }}>শৃঙ্খলামূলক ব্যবস্থা গ্রহণের নোটিশ</div>
            <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '20px' }}>DISCIPLINARY NOTICE / PUNISHMENT LETTER</div>

            {/* Recipient */}
            <div style={{ fontSize: '15px', lineHeight: 1.8, marginBottom: '14px', color: '#334155' }}>
              <strong>প্রাপক:</strong> {formData.employeeName || '[কর্মীর নাম]'}<br />
              <strong>কর্মী আইডি:</strong> {formData.employeeId || '[আইডি]'}<br />
              <strong>পদবী:</strong> {formData.designation || '[পদবি]'}<br />
              <strong>বিভাগ:</strong> {formData.department || '[বিভাগ]'}<br />
              <strong>প্রতিষ্ঠান:</strong> স্পিড নেট খুলনা (Speed Net Khulna)
            </div>

            <div style={{ fontSize: '15px', lineHeight: 1.8, marginBottom: '14px', color: '#334155' }}>
              <strong>বিষয়:</strong> কর্তব্যে অবহেলা / প্রতিষ্ঠানের নিয়ম ভঙ্গের জন্য শাস্তিমূলক নোটিশ।
            </div>

            <div style={{ fontSize: '15px', lineHeight: 1.85, color: '#334155' }}>
              প্রিয় <strong>{formData.employeeName || '[কর্মীর নাম]'}</strong>,
            </div>

            <div style={{ fontSize: '15px', lineHeight: 1.85, textAlign: 'justify', marginTop: '10px', color: '#334155' }}>
              আপনাকে জানানো যাচ্ছে যে, {formData.incidentDate ? <strong>{formatBanglaDate(formData.incidentDate)}</strong> : 'সাম্প্রতিক'} তারিখে আপনার <strong>{formData.incidentSummary || '[ঘটনার বিবরণ / কর্তব্যে অবহেলা]'}</strong> বিষয়টি প্রতিষ্ঠানের নজরে এসেছে{formData.showCauseRef ? <>। এ বিষয়ে ইতোপূর্বে জারিকৃত কারণ দর্শানোর নোটিশ (<strong>{formData.showCauseRef}</strong>)-এর পরিপ্রেক্ষিতে</> : ''}। স্পিড নেট খুলনার একজন কর্মী হিসেবে আপনার কাছ থেকে দায়িত্বশীলতা, পেশাদার আচরণ এবং প্রতিষ্ঠানের নীতিমালা যথাযথভাবে অনুসরণের প্রত্যাশা করা হয়।
            </div>

            {/* Punishment box */}
            <div className="punishment-notice">
              <div style={{ fontWeight: 800, color: '#991b1b', fontSize: '14px', marginBottom: '6px' }}>⚠ গৃহীত শাস্তিমূলক ব্যবস্থা</div>
              <div style={{ fontSize: '15px', lineHeight: 1.8, color: '#7f1d1d' }}>
                {formData.punishmentType || '[শাস্তির বিবরণ এখানে লিখুন]'}
              </div>
            </div>

            <div style={{ fontSize: '15px', lineHeight: 1.85, textAlign: 'justify', color: '#334155', marginTop: '10px' }}>
              আমরা আশা করি, আপনি এই বিষয়টি গুরুত্বের সাথে বিবেচনা করবেন এবং ভবিষ্যতে আরও দায়িত্বশীল ও পেশাদার আচরণ বজায় রাখবেন। পুনরায় একই ধরনের ঘটনা ঘটলে প্রতিষ্ঠানের নিয়মানুযায়ী আরও কঠোর ব্যবস্থা গ্রহণ করা হতে পারে।
            </div>

            <div style={{ fontSize: '15px', lineHeight: 1.85, marginTop: '14px', color: '#334155' }}>
              <strong>বিনীত,</strong>
            </div>

            {/* Signature */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: '24px' }}>
              <div style={{ textAlign: 'center', width: '230px' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '44px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{formData.signerName || '_____________________'}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>{formData.signerDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
              </div>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PunishmentLetterGenerator;
