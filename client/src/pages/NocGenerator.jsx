import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import { useLocation } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import { saveNocLetter, getMyNocLetters, getNocLetterById, updateNocLetter, deleteNocLetter, getNextNocNumbers } from '../services/nocLetterService';
import html2canvas from 'html2canvas';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const NocGenerator = () => {
  const location = useLocation();
  const initialData = location.state || {};

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
    refno: '001',
    year: moment().year().toString(),
    date: moment().format('DD/MM/YYYY'),
    name: initialData.full_name || initialData.name || '',
    gender: '',
    empid: initialData.employee_id || '',
    fatherName: '',
    designation: initialData.designation || '',
    joining: initialData.joining_date ? moment(initialData.joining_date).format('DD/MM/YYYY') : '',
    accountNumber: '',
    accountType: 'সঞ্চয়',
    accountPurpose: 'প্রতিষ্ঠানে কর্মরত থাকাকালীন খোলা হয়েছিল',
    bankName: 'পূর্বালী ব্যাংক',
    bankBranch: 'কেডিএ এভিনিউ রোড, খুলনা-৯১০০',
    hrContactNumber: '',
    signername: '',
    signerdesignation: '',
    signerdate: moment().format('DD/MM/YYYY'),
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
      const n = await getNextNocNumbers();
      if (n?.refNo || n?.year) {
        setFormData((prev) => ({
          ...prev,
          refno: n.refNo || prev.refno,
          year: n.year || prev.year,
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

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate NOC. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

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

  const handleEmployeeSelect = (employeeId) => {
    setSelectedEmployeeId(employeeId);
    if (!employeeId) return;
    const found = employees.find((emp) => emp.employee_id === employeeId);
    if (found) {
      const strictJoining = found.joining_date
        ? (() => {
            const m = moment(found.joining_date, [moment.ISO_8601, 'DD/MM/YYYY', 'YYYY-MM-DD'], true);
            return m.isValid() ? m.format('DD/MM/YYYY') : '';
          })()
        : '';
      setFormData((prev) => ({
        ...prev,
        name: found.full_name || '',
        empid: found.employee_id || '',
        designation: found.designation || '',
        fatherName: found.father_name || prev.fatherName,
        joining: strictJoining || prev.joining,
      }));
    }
  };

  const genderPrefix = formData.gender === 'পুরুষ' ? 'Mr.' : formData.gender === 'মহিলা' ? 'Ms.' : 'Mr./Ms.';

  const handleReset = () => {
    setFormData(defaultForm());
    setEditingId(null);
    setSelectedEmployeeId('');
    applyNextNumbers();
  };

  const handleSave = async () => {
    const previewEl = document.querySelector('.preview-pane .letter-page');
    if (!previewEl) return;
    try {
      const canvas = await html2canvas(previewEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `noc-${formData.name || 'letter'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      notify.error('Failed to save image: ' + (err?.message || ''));
    }
  };

  const handleSaveToServer = async () => {
    if (!formData.name?.trim()) {
      notify.error('Employee name is required');
      return;
    }
    if (!formData.accountNumber?.trim()) {
      notify.error('Bank account number is required');
      return;
    }
    try {
      const payload = {
        employee_name: formData.name,
        employee_id: formData.empid,
        ref_no: `SN/NOC/${formData.year || moment().year()}/${formData.refno || '001'}`,
        form_data: formData,
      };
      if (editingId) {
        await updateNocLetter(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveNocLetter(payload);
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

  const loadMyLetters = async () => {
    try {
      const data = await getMyNocLetters();
      setSavedLetters(data || []);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getNocLetterById(id);
      if (letter?.form_data) {
        setFormData({ ...defaultForm(), ...letter.form_data });
        setSelectedEmployeeId(letter.form_data.empid || '');
        setEditingId(letter.id);
        setShowEditModal(false);
        setSaveMsg('Letter loaded — edit mode');
        notify.success('Letter loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleDeleteLetter = async (id) => {
    if (!(await confirmAction({ title: 'Delete this letter?', danger: true }))) return;
    try {
      await deleteNocLetter(id);
      setSavedLetters(prev => prev.filter(l => l.id !== id));
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

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        .admin-sidebar-form {
          width: 380px;
          min-width: 320px;
          background: #0d1f3c;
          color: #e0e8f5;
          padding: 16px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          border-right: 3px solid #c0392b;
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
          color: #3498db;
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

        .admin-sidebar-form input:focus, .admin-sidebar-form textarea:focus, .admin-sidebar-form select:focus {
          border-color: #3498db;
          outline: none;
        }

        .admin-sidebar-form input[type="date"] {
          color-scheme: dark;
        }

        .admin-sidebar-form select option {
          background: #162d50;
        }

        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          background: #b8b8b8;
        }

        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Serif+Bengali:wght@400;700&display=swap');

        .letter-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #fff;
          padding: 0.45in 0.45in 0.55in;
          font-family: 'Kalpurush', 'Noto Serif Bengali', 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', 'Vrinda', serif;
          font-size: 11pt;
          line-height: 1.7;
          color: #000;
          box-shadow: 0 0 15px rgba(0,0,0,0.2);
        }

        .dyn-val {
          color: #c0392b;
          font-weight: 700;
        }

        .hdr-left { background: #1a3a6b; width: 19%; padding: 8px 10px; vertical-align: middle; }
        .hdr-center { background: #1a3a6b; padding: 8px 6px; vertical-align: middle; text-align: center; }
        .hdr-right { background: #c0392b; width: 19%; padding: 8px 10px; vertical-align: middle; text-align: center; }
        .hdr-brand { font-size: 15pt; font-weight: 700; color: #fff; display: block; line-height: 1.2; }
        .hdr-brand-sub { font-size: 9pt; color: #fff; display: block; line-height: 1.2; }
        .hdr-co-bn { font-size: 13pt; font-weight: 700; color: #fff; display: block; line-height: 1.3; }
        .hdr-co-addr { font-size: 9pt; color: #fff; display: block; line-height: 1.4; }
        .hdr-noc { font-size: 12.5pt; font-weight: 700; color: #fff; display: block; line-height: 1.3; }
        .hdr-noc-en { font-size: 8pt; color: #fff; display: block; line-height: 1.4; }
        .hdr-rule { height: 0; border: 0; border-top: 5px solid #c0392b; margin: 0 0 5px; }

        .info-bar td { font-size: 9pt; color: #555; padding: 2px 0; }
        .ref-bar { background: #d6e4f7; margin: 5px 0 4px; }
        .ref-bar td { padding: 4px 10px; font-size: 10pt; }

        .noc-title {
          text-align: center;
          margin: 14px 0 6px;
          font-size: 15pt;
          font-weight: 700;
          color: #1a3a6b;
          line-height: 1.4;
        }
        .noc-subtitle {
          text-align: center;
          margin: 0 0 10px;
          font-size: 10.5pt;
          font-weight: 600;
          color: #444;
        }
        .for-whom {
          margin: 10px 0 4px;
          font-weight: 700;
          font-size: 11pt;
        }
        .noc-body p {
          text-align: justify;
          margin: 8px 0;
        }

        .sig-block { margin-top: 30px; }
        .sig-title { font-weight: 700; font-size: 11pt; color: #1a3a6b; margin: 0 0 4px; }
        .sig-en { font-size: 9.5pt; color: #555; margin: 0 0 14px; }
        .sig-line { border-top: 1.5px solid #000; width: 200px; margin: 30px 0 8px; }

        .footer { margin-top: 14px; border-top: 2px solid #c0392b; padding-top: 5px; font-size: 9pt; color: #555; display: flex; justify-content: space-between; }

        @media print {
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          .admin-sidebar-form, .no-print, nav, header, button, .app-sidebar, .sidebar, .sidebar-toggle, .btn-hamburger, .hamburger, .navbar, [class*="sidebar"], [class*="toggle"], [class*="navbar"] {
            display: none !important;
            visibility: hidden !important;
          }

          .admin-wrapper { display: block !important; min-height: auto !important; width: 100% !important; }
          .main-content, #main-content, .main-content.admin-dashboard-page { margin-left: 0 !important; width: 100% !important; max-width: 100% !important; min-height: auto !important; padding: 0 !important; }
          .appointment-generator-wrapper { display: block !important; min-height: auto !important; height: auto !important; background: #fff !important; }
          .preview-pane {
            padding: 0 !important;
            margin: 0 !important;
            background: #fff !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
          }

          .letter-page {
            box-shadow: none !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            background: #fff !important;
            min-height: auto !important;
            height: auto !important;
          }

          .ref-bar, .sig-block, .footer {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
        }
      `}</style>

      {/* Form Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #1a3a6b 0%, #0d1f3c 100%)', borderRadius: '8px', border: '1px solid #2a4a7a' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px', letterSpacing: '0.5px' }}>
            <i className="fas fa-file-circle-check text-danger me-2"></i>NO OBJECTION CERTIFICATE
          </h5>
        </div>

        <button className="btn btn-danger w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <button className="btn btn-success w-100 fw-bold mb-3 shadow-sm" onClick={handleSave}>
          <i className="fas fa-download me-2"></i>Save as Image
        </button>

        <div className="d-flex gap-2 mb-3">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyLetters}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-3 shadow-sm" onClick={handleNewLetter} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Letter
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}

        {/* Reference */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-calendar-alt me-1"></i> Reference &amp; Date</div>
          <div className="sec-body">
            <div className="row g-2">
              <div className="col-6">
                <label>Ref No</label>
                <input type="text" name="refno" value={formData.refno} onChange={handleChange} placeholder="042" />
              </div>
              <div className="col-6">
                <label>Year</label>
                <input type="text" name="year" value={formData.year} onChange={handleChange} placeholder="2026" />
              </div>
            </div>
            <label htmlFor="noc-date">Issue Date</label>
            <input id="noc-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
          </div>
        </div>

        {/* Employee Details */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-user me-1"></i> Employee Information</div>
          <div className="sec-body">
            <label htmlFor="noc-employee-select">Select Employee (auto-fill)</label>
            <select id="noc-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label>Employee Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Enter name" />
            <label>Gender</label>
            <select name="gender" value={formData.gender} onChange={handleChange}>
              <option value="">Mr./Ms.</option>
              <option value="পুরুষ">Male (Mr.)</option>
              <option value="মহিলা">Female (Ms.)</option>
            </select>
            <div className="row g-2">
              <div className="col-6">
                <label>Employee ID</label>
                <input type="text" name="empid" value={formData.empid} onChange={handleChange} placeholder="SN-2024-001" />
              </div>
              <div className="col-6">
                <label htmlFor="noc-joining">Joining Date</label>
                <input id="noc-joining" type="date" name="joining" value={toISODate(formData.joining)} onChange={handleDateChange} />
              </div>
            </div>
            <label>Designation</label>
            <input type="text" name="designation" value={formData.designation} onChange={handleChange} placeholder="Designation" />
            <label>Father / Husband Name</label>
            <input type="text" name="fatherName" value={formData.fatherName} onChange={handleChange} placeholder="Father / husband name" />
            <label>Bank Account Number</label>
            <input type="text" name="accountNumber" value={formData.accountNumber} onChange={handleChange} placeholder="[Account Number]" />
            <label>Account Type</label>
            <select name="accountType" value={formData.accountType} onChange={handleChange}>
              <option value="সঞ্চয়">সঞ্চয়</option>
              <option value="কল্যাণ">কল্যাণ</option>
              <option value="ডিপিএস">ডিপিএস</option>
              <option value="অন্যান্য">অন্যান্য</option>
            </select>
            <label>Account Opening Purpose</label>
            <input type="text" name="accountPurpose" value={formData.accountPurpose} onChange={handleChange} placeholder="Opened while employed at the organization" />
          </div>
        </div>

        <div className="sec">
          <div className="sec-title"><i className="fas fa-building-columns me-1"></i> Bank Details</div>
          <div className="sec-body">
            <label>Bank Name</label>
            <input type="text" name="bankName" value={formData.bankName} onChange={handleChange} placeholder="Bank name" />
            <label>Branch Address</label>
            <input type="text" name="bankBranch" value={formData.bankBranch} onChange={handleChange} placeholder="Branch address" />
            <label>HR Contact</label>
            <input type="text" name="hrContactNumber" value={formData.hrContactNumber} onChange={handleChange} placeholder="hr@speednetkhulna.com | Phone: 01700000000" />
          </div>
        </div>

        {/* Signatory */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-pen-nib me-1"></i> Authorized Signatory</div>
          <div className="sec-body">
            <label>Name</label>
            <input type="text" name="signername" value={formData.signername} onChange={handleChange} placeholder="Signer name" />
            <label>Designation</label>
            <input type="text" name="signerdesignation" value={formData.signerdesignation} onChange={handleChange} placeholder="Designation" />
            <label htmlFor="noc-signerdate">Date</label>
            <input id="noc-signerdate" type="date" name="signerdate" value={toISODate(formData.signerdate)} onChange={handleDateChange} />
          </div>
        </div>

        <button className="btn btn-outline-secondary w-100 btn-sm text-light mb-3" onClick={handleReset}>
          <i className="fas fa-undo me-1"></i> Form Reset
        </button>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved NOCs</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedLetters.length === 0 ? (
                <p className="text-muted text-center py-4">No saved NOCs.</p>
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

      {/* Preview Pane */}
      <div className="preview-pane">
        <div className="letter-page">
          <table style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td className="hdr-left" style={{ verticalAlign: 'middle', textAlign: 'center', width: '22%' }}>
                  <img src="/speednet_logo.webp?v=20260912" alt="Speed Net" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} style={{ height: '70px', maxWidth: '100%', objectFit: 'contain', background: 'transparent', filter: 'brightness(0) invert(1)' }} />
                  <div style={{ display: 'none', color: '#fff', fontWeight: 800, fontSize: '15px', lineHeight: 1.2 }}>
                    Speed Net<br/><span style={{ fontSize: '10px', fontWeight: 600, opacity: 0.85 }}>Khulna</span>
                  </div>
                </td>
                <td className="hdr-center">
                  <span className="hdr-brand">Speed Net ISP</span>
                  <span className="hdr-brand-sub">Internet Service Provider</span>
                  <span className="hdr-co-addr">83/3, Gagoon Babu Road, Khulna, Bangladesh</span>
                </td>
                <td className="hdr-right">
                  <span className="hdr-noc">NO OBJECTION</span>
                  <span className="hdr-noc-en">CERTIFICATE</span>
                  <span className="hdr-noc-en">(NOC)</span>
                </td>
              </tr>
            </tbody>
          </table>
          <hr className="hdr-rule" />

          <table className="ref-bar" style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td><strong>Reference No.: </strong><span className="dyn-val">SN/NOC/{formData.year || '2026'}/{formData.refno || '[Serial No.]'}</span></td>
                <td style={{ textAlign: 'right' }}><strong>Date: </strong><span className="dyn-val">{formData.date || '____ / ____ / ______'}</span></td>
              </tr>
            </tbody>
          </table>

          <div className="noc-title">NO OBJECTION CERTIFICATE</div>
          <div className="noc-subtitle">(NOC)</div>

          <div className="for-whom">TO WHOM IT MAY CONCERN</div>

          <div className="noc-body">
            <p>
              This is to certify that <span className="dyn-val">{genderPrefix}</span> <span className="dyn-val">{formData.name || '[Employee Name]'}</span>, Employee ID <span className="dyn-val">{formData.empid || '[Employee ID]'}</span>, has been employed with <strong>Speed Net</strong> as <span className="dyn-val">{formData.designation || '[Job Title]'}</span> since <span className="dyn-val">{formData.joining || '[Joining Date]'}</span> and is currently serving the organization.
            </p>
            <p>
              This certificate is issued upon the employee&apos;s request for submission to the concerned authority for any lawful purpose. <strong>Speed Net</strong> has no objection to the employee using this certificate in connection with visa processing, passport application or renewal, higher education, employment application, travel, immigration, banking, or any other legitimate official purpose, as applicable.
            </p>
            <p>
              To the best of our knowledge, the employee has been performing assigned duties with sincerity and professionalism and has no known record of misconduct or disciplinary action during the course of employment.
            </p>
            <p>
              This No Objection Certificate is issued without any liability on the part of <strong>Speed Net</strong> and solely for the purpose stated above. It does not constitute a guarantee, sponsorship, or financial commitment by the Company.
            </p>
            <p>
              Should you require any further information or verification, please feel free to contact us.
            </p>
          </div>

          <div className="sig-block">
            <p className="sig-title">Sincerely,</p>
            <div className="sig-line"></div>
            <p style={{ margin: '10px 0 2px', fontWeight: 700 }}>Authorized Signatory</p>
            <p style={{ margin: '2px 0', fontWeight: 700 }}>Official Company Seal</p>
            <p style={{ margin: '18px 0 2px', fontWeight: 700 }}>Name: <span className="dyn-val">{formData.signername || '__________________________________'}</span></p>
            <p style={{ margin: '2px 0', fontWeight: 700 }}>Designation: <span className="dyn-val">{formData.signerdesignation || '____________________________'}</span></p>
            <p style={{ margin: '2px 0', fontWeight: 700 }}>Company: Speed Net</p>
            <p style={{ margin: '2px 0', fontWeight: 700 }}>Signature: <span className="dyn-val">__________________________________</span></p>
            <p style={{ margin: '2px 0', fontWeight: 700 }}>Date: <span className="dyn-val">{formData.signerdate || '____ / ____ / ______'}</span></p>
          </div>

          <div className="footer">
            <span>Speed Net</span>
            <span>info@speednetkhulna.com | www.speednetkhulna.com</span>
            <span>NOC v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NocGenerator;
