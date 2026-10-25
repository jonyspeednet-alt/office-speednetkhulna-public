import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import { useLocation, useNavigate } from 'react-router-dom';
import { getEmployees } from '../services/employeeService';
import { saveAppointmentLetter, getMyAppointmentLetters, getAppointmentLetterById, updateAppointmentLetter, deleteAppointmentLetter } from '../services/appointmentLetterService';
import apiClient from '../config/axiosConfig';
import html2canvas from 'html2canvas';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

import { BRANCH_OFFICES, EMPLOYMENT_TYPES } from '../constants/workLocations';

const AppointmentGenerator = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Prefill from Profile ("Appointment Letter" action) persists across refresh
  // via sessionStorage; cleared explicitly with the banner's Clear button.
  const [prefill, setPrefill] = useState(() => {
    if (location.state && Object.keys(location.state).length) return location.state;
    try {
      const raw = sessionStorage.getItem('appointment-prefill');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return {};
  });
  useEffect(() => {
    if (location.state && Object.keys(location.state).length) setPrefill(location.state);
  }, [location.state]);
  useEffect(() => {
    try {
      if (prefill && Object.keys(prefill).length) sessionStorage.setItem('appointment-prefill', JSON.stringify(prefill));
    } catch { /* ignore */ }
  }, [prefill]);
  const initialData = prefill || {};
  const isPrefilled = Boolean(initialData.full_name || initialData.name || initialData.employee_id);

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

  const [formData, setFormData] = useState({
    refno: initialData.refno || '001',
    year: moment().year().toString(),
    date: moment().format('DD/MM/YYYY'),
    name: initialData.full_name || initialData.name || '',
    father: initialData.father_name || initialData.father || '',
    present: initialData.present_address || '',
    perm: initialData.permanent_address || '',
    nid: initialData.nid_number || '',
    gender: '',
    letterType: 'probationary',
    confirmationDate: '',
    designation: initialData.designation || '',
    dept: initialData.department || '',
    empid: initialData.employee_id || '',
    joining: initialData.joining_date ? moment(initialData.joining_date).format('DD/MM/YYYY') : '',
    reporting: initialData.reporting_manager || '',
    location: initialData.work_location || '',
    employmentType: initialData.employment_type || '',
    probation: '3',
    bond: '1',
    gross: '12000',
    signdate: moment().format('DD/MM/YYYY'),
  });

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedLetters, setSavedLetters] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const isConfirmation = formData.letterType === 'confirmation';

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

  // Auto serial: running ref number for the current year + letter type (server count).
  const applyNextNumbers = async (letterType) => {
    try {
      const { data: n } = await apiClient.get('/api/appointment-letters/next-numbers', {
        params: { letter_type: letterType || formData.letterType },
      });
      if (n?.refNo || n?.year) {
        setFormData((prev) => ({
          ...prev,
          refno: n.refNo || prev.refno,
          year: n.year || prev.year,
        }));
      }
    } catch {
      // keep manual defaults (route wires up centrally)
    }
  };

  useEffect(() => {
    if (!canAccess) return;
    applyNextNumbers(formData.letterType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Appointment Letter. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  const grossAmount = Number(formData.gross || 0);
  const basicSalary = Math.round(grossAmount * (2 / 3));

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
      // Strict parse guard: only accept known date shapes, never jatuh to "now".
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
        dept: found.department || '',
        father: found.father_name || '',
        present: found.present_address || '',
        perm: found.permanent_address || '',
        nid: found.nid_number || '',
        joining: strictJoining || prev.joining,
        reporting: found.reporting_manager || prev.reporting,
        location: found.work_location || prev.location,
        employmentType: found.employment_type || prev.employmentType,
      }));
    }
  };

  const defaultForm = () => ({
    refno: '001',
    year: moment().year().toString(),
    date: moment().format('DD/MM/YYYY'),
    name: '',
    father: '',
    present: '',
    perm: '',
    nid: '',
    gender: '',
    letterType: 'probationary',
    confirmationDate: '',
    designation: '',
    dept: '',
    empid: '',
    joining: '',
    reporting: '',
    location: '',
    employmentType: '',
    probation: '3',
    bond: '1',
    gross: '12000',
    signdate: moment().format('DD/MM/YYYY'),
  });

  const handleReset = async () => {
    if (isPrefilled && !(await confirmAction({ title: 'Prefilled data will be cleared. Reset the form?', danger: true }))) return;
    setFormData(defaultForm());
    setEditingId(null);
    setSelectedEmployeeId('');
    applyNextNumbers();
  };

  const handleClearPrefill = () => {
    try { sessionStorage.removeItem('appointment-prefill'); } catch { /* ignore */ }
    setPrefill({});
    setFormData(defaultForm());
  };

  const handleBackFromAppointment = () => {
    if (location.state?.from && window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      const pid = prefill?.employee_id || prefill?.id;
      navigate(pid ? `/profile/${pid}` : '/employees');
    }
  };

  const formatNumber = (val) => {
    if (!val) return '___';
    const num = parseInt(String(val).replace(/,/g, ''), 10);
    return isNaN(num) ? val : num.toLocaleString('en-IN');
  };

  const handleSave = async () => {
    const previewEl = document.querySelector('.preview-pane .letter-page');
    if (!previewEl) return;
    try {
      const canvas = await html2canvas(previewEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `appointment-letter-${formData.name || 'letter'}.png`;
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
    try {
      const payload = {
        employee_name: formData.name,
        employee_id: formData.empid,
        letter_type: formData.letterType,
        form_data: formData,
      };
      if (editingId) {
        await updateAppointmentLetter(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        await saveAppointmentLetter(payload);
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
      const data = await getMyAppointmentLetters();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letter');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getAppointmentLetterById(id);
      if (letter?.form_data) {
        setFormData(letter.form_data);
        setSelectedEmployeeId(letter.form_data.empid || '');
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
      await deleteAppointmentLetter(id);
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
    setFormData({
      refno: '001',
      year: moment().year().toString(),
      date: moment().format('DD/MM/YYYY'),
      name: '',
      father: '',
      present: '',
      perm: '',
      nid: '',
      gender: '',
      letterType: 'probationary',
      confirmationDate: '',
      designation: '',
      dept: '',
      empid: '',
      joining: '',
      reporting: '',
      location: '',
      employmentType: '',
      probation: '3',
      bond: '1',
      gross: '12000',
      signdate: moment().format('DD/MM/YYYY'),
    });
    applyNextNumbers('probationary');
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
          font-size: 11px;
          color: #c3d6ef;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 4px;
          display: block;
        }

        .admin-sidebar-form input[type="date"] {
          color-scheme: dark;
        }

        .prefill-banner {
          background: rgba(52, 152, 219, 0.12);
          border: 1px solid #2a4a7a;
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .prefill-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #3498db;
          color: #fff;
          font-weight: 700;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .admin-sidebar-form input, .admin-sidebar-form textarea {
          width: 100%;
          background: #162d50;
          border: 1px solid #2a4a7a;
          border-radius: 4px;
          color: #fff;
          padding: 6px 10px;
          font-size: 12px;
          margin-bottom: 8px;
        }

        .admin-sidebar-form input:focus, .admin-sidebar-form textarea:focus {
          border-color: #3498db;
          outline: none;
        }

        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          background: #b8b8b8;
        }

        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;700&family=Noto+Serif+Bengali:wght@400;700&display=swap');
        /* Kalpurush - local font, primary for Bengali text */

        .letter-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #fff;
          padding: 0.45in 0.45in 0.55in;
          font-family: 'Kalpurush', 'Noto Serif Bengali', 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', 'Vrinda', serif;
          font-size: 10.5pt;
          line-height: 1.5;
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
        .hdr-appt { font-size: 12.5pt; font-weight: 700; color: #fff; display: block; line-height: 1.3; }
        .hdr-appt-en { font-size: 8pt; color: #fff; display: block; line-height: 1.4; }
        .hdr-rule { height: 0; border: 0; border-top: 5px solid #c0392b; margin: 0 0 5px; }

        .info-bar td { font-size: 9pt; color: #555; padding: 2px 0; }
        .ref-bar { background: #d6e4f7; margin: 5px 0 4px; }
        .ref-bar td { padding: 4px 10px; font-size: 10pt; }
        .subject-line { background: #d6e4f7; padding: 5px 10px; margin: 4px 0; font-size: 11pt; font-weight: 700; }

        .sec-hdr { background: #1a3a6b; color: #fff; font-weight: 700; font-size: 10.5pt; padding: 5px 10px; margin: 9px 0 0; }
        .ig { margin: 0 0 6px; width: 100%; border-collapse: collapse; }
        .ig td { font-size: 10.5pt; line-height: 1.7; padding: 3px 8px; border: none; }
        .ig-l { background: #d6e4f7; font-weight: 700; color: #1a3a6b; width: 29%; }
        .ig-c { background: #d6e4f7; font-weight: 700; color: #1a3a6b; width: 2%; text-align: center; }
        .ig-v { background: #f5f5f5; font-weight: 700; color: #c0392b; width: 69%; }

        .sal-tbl { border-collapse: collapse; margin: 5px 0 7px; width: 100%; font-size: 10.5pt; }
        .sal-tbl th { background: #1a3a6b; color: #fff; font-weight: 700; padding: 5px 10px; text-align: left; }
        .sal-tbl td { padding: 4px 10px; border: 1px solid #ccc; }

        .sig-block { display: flex; justify-content: space-between; gap: 20px; margin-top: 22px; }
        .sig-box { flex: 1; }
        .sig-title { font-weight: 700; font-size: 10.5pt; color: #1a3a6b; margin-bottom: 36px; }
        .sig-line { border-top: 1.5px solid #000; width: 180px; }

        .hr-box { margin-top: 14px; border: 1.5px solid #1a3a6b; padding: 7px 14px 9px; break-inside: avoid; page-break-inside: avoid; }
        .hr-box-title { font-weight: 700; color: #1a3a6b; font-size: 10pt; border-bottom: 1px solid #d6e4f7; margin-bottom: 5px; padding-bottom: 3px; }
        .hr-box table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .hr-box td { font-size: 9.5pt; color: #555; padding: 2px 4px; vertical-align: middle; white-space: nowrap; }
        .hr-box td:nth-child(2) { text-align: center; }
        .hr-box td:nth-child(3) { text-align: right; }

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

          /* Hide all UI elements, sidebars, buttons, hamburger icons, headers, navbars */
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

          .ref-bar, .sig-block, .hr-box {
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
        {isPrefilled && (
          <div className="prefill-banner">
            <div className="prefill-avatar">
              {String(initialData.full_name || initialData.name || 'E').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-white fw-bold" style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {initialData.full_name || initialData.name}
              </div>
              <div style={{ fontSize: '11px', color: '#c3d6ef' }}>
                {initialData.employee_id || ''}
              </div>
            </div>
            <button className="btn btn-sm btn-outline-light" onClick={handleClearPrefill} title="Clear prefill">
              Clear
            </button>
            <button className="btn btn-sm btn-outline-light" onClick={handleBackFromAppointment} title="Back">
              <i className="fas fa-arrow-left"></i>
            </button>
          </div>
        )}
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #1a3a6b 0%, #0d1f3c 100%)', borderRadius: '8px', border: '1px solid #2a4a7a' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px', letterSpacing: '0.5px' }}>
            <i className="fas fa-file-signature text-danger me-2"></i>Appointment Letter Generator
          </h5>
        </div>

        <button className="btn btn-danger w-100 fw-bold mb-3 shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print
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
                <input type="text" name="refno" value={formData.refno} onChange={handleChange} placeholder="001" />
              </div>
              <div className="col-6">
                <label>Year</label>
                <input type="text" name="year" value={formData.year} onChange={handleChange} placeholder="2024" />
              </div>
            </div>
            <label>Issue Date</label>
            <input type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
          </div>
        </div>

        {/* Letter Type */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-file-alt me-1"></i> Letter Type</div>
          <div className="sec-body">
            <label>Letter Type</label>
            <select name="letterType" value={formData.letterType} onChange={(e) => { handleChange(e); if (!editingId) applyNextNumbers(e.target.value); }}>
              <option value="probationary">Probationary Appointment Letter</option>
              <option value="confirmation">Confirmation Letter</option>
            </select>
            {formData.letterType === 'confirmation' && (
              <>
                <label>Confirmation Date</label>
                <input type="date" name="confirmationDate" value={toISODate(formData.confirmationDate)} onChange={handleDateChange} />
              </>
            )}
          </div>
        </div>

        {/* Employee Details */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-user me-1"></i> Employee Information</div>
          <div className="sec-body">
            <label htmlFor="appointment-employee-select">Select Employee (auto-fill)</label>
            <select id="appointment-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label>Employee Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Enter name" />
            <label>Father / Husband Name</label>
            <input type="text" name="father" value={formData.father} onChange={handleChange} placeholder="Father / husband name" />
            <label>Present Address</label>
            <textarea name="present" value={formData.present} onChange={handleChange} rows="2" placeholder="Present address"></textarea>
            <label>Permanent Address</label>
            <textarea name="perm" value={formData.perm} onChange={handleChange} rows="2" placeholder="Permanent address"></textarea>
            <label>NID Number</label>
            <input type="text" name="nid" value={formData.nid} onChange={handleChange} placeholder="National ID number" inputMode="numeric" pattern="[0-9]*" title="Numbers only" />
            <label>Gender</label>
            <select name="gender" value={formData.gender} onChange={handleChange}>
              <option value="">Select</option>
              <option value="পুরুষ">Male (Mr.)</option>
              <option value="মহিলা">Female (Ms.)</option>
            </select>
          </div>
        </div>

        {/* Position */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-briefcase me-1"></i> Position Details</div>
          <div className="sec-body">
            <div className="row g-2">
              <div className="col-6">
                <label>Designation</label>
                <input type="text" name="designation" value={formData.designation} onChange={handleChange} placeholder="Designation" />
              </div>
              <div className="col-6">
                <label>Department</label>
                <input type="text" name="dept" value={formData.dept} onChange={handleChange} placeholder="Department" />
              </div>
            </div>
            <div className="row g-2">
              <div className="col-6">
                <label>Employee ID</label>
                <input type="text" name="empid" value={formData.empid} onChange={handleChange} placeholder="SN-2024-001" />
              </div>
              <div className="col-6">
                <label>Joining Date</label>
                <input type="date" name="joining" value={toISODate(formData.joining)} onChange={handleDateChange} />
              </div>
            </div>
            <label>Reporting Manager</label>
            <select name="reporting" value={formData.reporting} onChange={handleChange}>
              <option value="">{'Select manager'}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.full_name}>
                  {emp.full_name} ({emp.employee_id}) — {emp.designation}
                </option>
              ))}
            </select>
            <label>Work Location</label>
            <select name="location" value={formData.location} onChange={handleChange}>
              <option value="">{'Select work location'}</option>
              {BRANCH_OFFICES.map((branch) => (
                <option key={branch.value} value={branch.value}>
                  {branch.label}
                </option>
              ))}
            </select>
            <label>Employment Type</label>
            <select name="employmentType" value={formData.employmentType} onChange={handleChange}>
              <option value="">{'Select employment type'}</option>
              {EMPLOYMENT_TYPES.map((et) => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Terms & Salary */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-coins me-1"></i> Terms &amp; Salary</div>
          <div className="sec-body">
            <div className="row g-2">
              <div className="col-6">
                <label>Probation (Months)</label>
                <input type="number" name="probation" value={formData.probation} onChange={handleChange} />
              </div>
              <div className="col-6">
                <label>Bond (Years)</label>
                <input type="number" name="bond" value={formData.bond} onChange={handleChange} />
              </div>
            </div>
            <div className="mb-2">
              <label>Gross Monthly Salary (৳)</label>
              <input type="number" name="gross" value={formData.gross} onChange={handleChange} />
            </div>
            <label>Employee Sign Date</label>
            <input type="date" name="signdate" value={toISODate(formData.signdate)} onChange={handleDateChange} />
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
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Letters</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedLetters.length === 0 ? (
                <p className="text-muted text-center py-4">No saved letters.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Position</th><th>Type</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedLetters.map(letter => (
                      <tr key={letter.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadLetter(letter.id)}>
                        <td>{letter.employee_name || '-'}</td>
                        <td>{letter.employee_id || '-'}</td>
                        <td>{letter.letter_type === 'confirmation' ? 'Confirmation' : 'Probationary'}</td>
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
                  <span className="hdr-co-bn">স্পিড নেট - ইন্টারনেট সার্ভিস প্রোভাইডার</span>
                  <span className="hdr-co-addr">83/3, গগন বাবু রোড, খুলনা। প্রথম ও দ্বিতীয় তলা।</span>
                </td>
                <td className="hdr-right">
                  <span className="hdr-appt">নিয়োগপত্র</span>
                  <span className="hdr-appt-en">APPOINTMENT</span>
                  <span className="hdr-appt-en">LETTER</span>
                </td>
              </tr>
            </tbody>
          </table>
          <hr className="hdr-rule" />

          <table className="info-bar" style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td>ঠিকানা: খুলনা, বাংলাদেশ</td>
                <td style={{ textAlign: 'right' }}>ইমেইল: info@speednetkhulna.com | www.speednetkhulna.com</td>
              </tr>
            </tbody>
          </table>

          <table className="ref-bar" style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td><strong>রেফারেন্স নং: </strong><span className="dyn-val">SN/HR/APPT/{formData.year || '2024'}/{formData.refno || '001'}</span></td>
                <td style={{ textAlign: 'right' }}><strong>তারিখ: </strong><span className="dyn-val">{formData.date || 'DD/MM/YYYY'}</span></td>
              </tr>
            </tbody>
          </table>

          <div className="subject-line"><strong>বিষয়: </strong><span className="dyn-val">নিয়োগপত্র (Appointment Letter) — গোপনীয়</span></div>

          <p style={{ margin: '8px 0 3px', fontWeight: 700, color: '#1a3a6b' }}>
            {formData.gender === 'মহিলা' ? 'জনাবা' : 'জনাব'} <span className="dyn-val">{formData.name || '_____________'}</span>,
          </p>

          <p style={{ textAlign: 'justify', margin: '3px 0 7px' }}>
            {isConfirmation ? (
              <>আস-সালামু আলাইকুম। স্পিড নেট কর্তৃপক্ষের পক্ষ থেকে আপনাকে আন্তরিক শুভেচ্ছা ও অভিনন্দন জানানো হচ্ছে। আপনার শিক্ষানবিশকালে অর্জিত সন্তোষজনক কর্মদক্ষতা, আচরণ ও পেশাদারিত্বের প্রেক্ষিতে কোম্পানির ব্যবস্থাপনা কর্তৃপক্ষ আপনাকে স্পিড নেট-এ স্থায়ী পদে নিয়োগ/স্থায়ীকরণ প্রদানের সিদ্ধান্ত গ্রহণ করেছেন। এই নিয়োগপত্র বাংলাদেশ শ্রম আইন ২০০৬ (সংশোধিত ২০১৩, ২০১৮) এবং বাংলাদেশ শ্রম বিধিমালা ২০১৫ অনুযায়ী প্রস্তুত করা হয়েছে।</>
            ) : (
              <>আস-সালামু আলাইকুম। স্পিড নেট (Speed Net) কর্তৃপক্ষের পক্ষ থেকে আপনাকে আন্তরিক শুভেচ্ছা ও অভিনন্দন জানানো হচ্ছে। আপনার দাখিলকৃত আবেদনপত্র, লিখিত পরীক্ষা এবং মৌখিক সাক্ষাৎকারে সন্তোষজনক ফলাফলের প্রেক্ষিতে কোম্পানির ব্যবস্থাপনা কর্তৃপক্ষ আপনাকে নিম্নবর্ণিত শর্তাদি ও বিধিমালা সাপেক্ষে স্পিড নেট-এ নিয়োগ প্রদানের সিদ্ধান্ত গ্রহণ করেছেন। এই নিয়োগপত্র বাংলাদেশ শ্রম আইন ২০০৬ (সংশোধিত ২০১৩, ২০১৮) এবং বাংলাদেশ শ্রম বিধিমালা ২০১৫ অনুযায়ী প্রস্তুত করা হয়েছে।</>
            )}
          </p>

          {/* Section 1 */}
          <div className="sec-hdr">ধারা ১: কর্মী পরিচিতি ও পদের বিবরণ (Employee Info &amp; Position Details)</div>
          <table className="ig">
            <tbody>
              <tr><td className="ig-l">কর্মীর নাম</td><td className="ig-c">:</td><td className="ig-v">{formData.name || '___________'}</td></tr>
              <tr><td className="ig-l">পিতা/স্বামীর নাম</td><td className="ig-c">:</td><td className="ig-v">{formData.father || '___________'}</td></tr>
              <tr><td className="ig-l">বর্তমান ঠিকানা</td><td className="ig-c">:</td><td className="ig-v">{formData.present || '___________'}</td></tr>
              <tr><td className="ig-l">স্থায়ী ঠিকানা</td><td className="ig-c">:</td><td className="ig-v">{formData.perm || '___________'}</td></tr>
              <tr><td className="ig-l">জাতীয় পরিচয়পত্র নং</td><td className="ig-c">:</td><td className="ig-v">{formData.nid || '___________'}</td></tr>
              <tr><td className="ig-l">পদবী (Designation)</td><td className="ig-c">:</td><td className="ig-v">{formData.designation || '___________'}</td></tr>
              <tr><td className="ig-l">বিভাগ (Department)</td><td className="ig-c">:</td><td className="ig-v">{formData.dept || '___________'}</td></tr>
              <tr><td className="ig-l">কর্মী আইডি</td><td className="ig-c">:</td><td className="ig-v">{formData.empid || '___________'}</td></tr>
              <tr><td className="ig-l">{isConfirmation ? 'স্থায়ীকরণের তারিখ' : 'যোগদানের তারিখ'}</td><td className="ig-c">:</td><td className="ig-v">{isConfirmation ? (formData.confirmationDate || '___________') : (formData.joining || '___________')}</td></tr>
              <tr><td className="ig-l">রিপোর্টিং কর্মকর্তা</td><td className="ig-c">:</td><td className="ig-v">{formData.reporting || '___________'}</td></tr>
              <tr><td className="ig-l">কর্মস্থল</td><td className="ig-c">:</td><td className="ig-v">{formData.location || '___________'}</td></tr>
              <tr><td className="ig-l">নিয়োগের ধরন</td><td className="ig-c">:</td><td className="ig-v">{isConfirmation ? 'পূর্ণকালীন (Full-Time, Permanent)' : (formData.employmentType || '___________')}</td></tr>
            </tbody>
          </table>

          {/* Section 2 */}
          <div className="sec-hdr">ধারা ২: দায়িত্ব ও কর্তব্য (Job Responsibilities)</div>
          <p style={{ margin: '4px 0' }}>কর্মী তাঁর নিয়োগকৃত পদের সাথে সংশ্লিষ্ট নিম্নবর্ণিত দায়িত্বসমূহ যথাযথভাবে পালন করতে বাধ্য থাকবেন। কর্তৃপক্ষ প্রয়োজনে যেকোনো সময় দায়িত্বের পরিধি সংযোজন বা পরিবর্তন করতে পারবেন:</p>
          <p style={{ margin: '4px 0' }}>২.১ পদ সংশ্লিষ্ট সকল কার্যক্রম সততা, দক্ষতা ও পেশাদারিত্বের সাথে সম্পাদন করা।</p>
          <p style={{ margin: '4px 0' }}>২.২ নির্ধারণের লক্ষ্যমাত্রা অর্জনে সক্রিয় ভূমিকা পালন করা এবং ঊর্ধ্বতন কর্তৃপক্ষের নির্দেশনা মেনে চলা।</p>
          <p style={{ margin: '4px 0' }}>২.৩ গ্রাহক সেবা সংক্রান্ত সকল কার্যক্রমে সর্বোচ্চ গুরুত্ব প্রদান করা এবং অভিযোগ দ্রুত নিষ্পত্তি করা।</p>
          <p style={{ margin: '4px 0' }}>২.৪ কোম্পানির নেটওয়ার্ক অবকাঠামো ও প্রযুক্তিগত সম্পদের রক্ষণাবেক্ষণ নিশ্চিত করা।</p>
          <p style={{ margin: '4px 0' }}>২.৫ কোম্পানির যাবতীয় নথিপত্র, তথ্য ও সম্পদের সুরক্ষা প্রদান করা এবং অননুমোদিত ব্যক্তির কাছে প্রকাশ না করা।</p>
          <p style={{ margin: '4px 0' }}>২.৬ টিমওয়ার্ক ও সহযোগিতামূলক মনোভাব বজায় রাখা এবং সহকর্মীদের সাথে সৌহার্দ্যপূর্ণ সম্পর্ক রক্ষা করা।</p>
          <p style={{ margin: '4px 0' }}>২.৭ কোম্পানি নির্ধারণ প্রশিক্ষণ কার্যক্রমে অংশগ্রহণ করা এবং পেশাদার দক্ষতা ক্রমাগত উন্নত করা।</p>
          <p style={{ margin: '4px 0' }}>২.৮ কর্তৃপক্ষ কর্তৃক অর্পিত যেকোনো বিশেষ দায়িত্ব যথাযথভাবে পালন করা।</p>

          {/* Section 3 - Probation (only for probationary letter) */}
          {!isConfirmation && (
            <>
              <div className="sec-hdr">ধারা ৩: পরীক্ষামূলক নিয়োগকাল (Probation Period)</div>
              <p style={{ margin: '4px 0' }}>৩.১ আপনার নিয়োগ প্রাথমিকভাবে <strong><span className="dyn-val">{formData.probation || '3'}</span></strong> মাস পরীক্ষামূলক (Probationary) ভিত্তিতে গণ্য হবে। বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ৪ অনুযায়ী এই সময়কাল নির্ধারণ করা হয়েছে।</p>
              <p style={{ margin: '4px 0' }}>৩.২ পরীক্ষামূলক সময়কালে কর্মীর কর্মদক্ষতা, আচরণ, সময়ানুবর্তিতা ও পেশাদারিত্ব মূল্যায়ন করা হবে।</p>
              <p style={{ margin: '4px 0' }}>৩.৩ পরীক্ষামূলক সময়কালে যেকোনো পক্ষ ১৪ (চৌদ্দ) দিনের লিখিত নোটিশ প্রদান সাপেক্ষে এই নিয়োগ বাতিল করতে পারবেন। তবে গুরুতর অসদাচরণের ক্ষেত্রে তাৎক্ষণিক বরখাস্তের অধিকার কর্তৃপক্ষ সংরক্ষণ করেন।</p>
              <p style={{ margin: '4px 0' }}>৩.৪ সন্তোষজনক মূল্যায়নের ভিত্তিতে পরীক্ষামূলক সময়কাল শেষে কর্মীকে স্থায়ীভাবে নিয়োগ দেওয়া হবে এবং লিখিতভাবে অবহিত করা হবে।</p>
              <p style={{ margin: '4px 0' }}>৩.৫ প্রয়োজনে পরীক্ষামূলক সময়কাল অনধিক আরও <strong><span className="dyn-val">{formData.bond || '1'}</span></strong> মাস বাড়ানো যেতে পারে।</p>
            </>
          )}

          {/* Section 3 or 4: Training & Development */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৩' : '৪'}: প্রশিক্ষণ ও দক্ষতা উন্নয়ন (Training &amp; Development)</div>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৩' : '৪'}.১ কর্মী যোগদানের পর কোম্পানি নির্ধারিত ইন্ডাকশন ট্রেনিং (Induction Training) এ অবশ্যই অংশগ্রহণ করবেন।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৩' : '৪'}.২ নেটওয়ার্কিং, আইএসপি অপারেশন, গ্রাহক সেবা ও সাইবার নিরাপত্তা বিষয়ক প্রশিক্ষণ কর্তৃপক্ষ নির্ধারিত সময়সূচি অনুযায়ী গ্রহণ করতে হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৩' : '৪'}.৩ কোম্পানি বহির্ভূত কোনো প্রশিক্ষণ বা সনদ কার্যক্রমে অংশগ্রহণের পূর্বে কর্তৃপক্ষের লিখিত অনুমতি গ্রহণ করতে হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৩' : '৪'}.৪ কোম্পানির ব্যয়ে গৃহীত প্রশিক্ষণের পর কর্মী ন্যূনতম তিন থেকে পাঁচ বছর কোম্পানিতে কর্মরত থাকতে বাধ্য থাকবেন।</p>

          {/* Section 4 or 5 - Working Hours */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৪' : '৫'}: কর্মঘণ্টা ও উপস্থিতি (Working Hours &amp; Attendance)</div>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৪' : '৫'}.১ বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ১০০ ও ১০২ অনুযায়ী প্রতিদিন সাধারণ কর্মঘণ্টা ৮ (আট) ঘণ্টা এবং সাপ্তাহিক সর্বোচ্চ ৪৮ (আটচল্লিশ) ঘণ্টা নির্ধারিত থাকবে। তবে কর্তৃপক্ষের নির্দেশনাক্রমে জরুরি প্রয়োজনে প্রতিদিন সর্বোচ্চ ২ (দুই) ঘণ্টা অতিরিক্ত কাজ (ওভারটাইম) করা যাবে, যা ওভারটাইমসহ দৈনিক মোট ১০ (দশ) ঘণ্টার বেশি হবে না।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৪' : '৫'}.২ সাধারণ অফিস সময়: শনিবার থেকে বৃহস্পতিবার, সকাল ৯:৩০ থেকে বিকেল ৫:৩০ পর্যন্ত। (বিরতি: দুপুর ১:৩০ থেকে ২:৩০)<br/>তবে Customer Care Executive-এর ক্ষেত্রে শিফট ভিত্তিক কর্মঘণ্টা প্রযোজ্য হবে:<br/>• ডে শিফট: শনিবার থেকে বৃহস্পতিবার, সকাল ৯:৩০ থেকে বিকেল ৫:৩০ পর্যন্ত। (বিরতি: দুপুর ১:৩০ থেকে ২:৩০)<br/>• নাইট শিফট: শনিবার থেকে বৃহস্পতিবার, রাত ৯:৩০ থেকে সকাল ৯:৩০ পর্যন্ত। (বিশ্রাম/বিরতি: মোট ৩ ঘণ্টা)<br/>শিফটের সময়সূচি ও দায়িত্ব বণ্টন প্রতিষ্ঠানের কার্যক্রমের প্রয়োজন অনুযায়ী কর্তৃপক্ষ নির্ধারণ ও পরিবর্তন করার অধিকার রাখবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৪' : '৫'}.৩ শুক্রবার সাপ্তাহিক ছুটি। তবে আইএসপি অপারেশনের জরুরি প্রয়োজনে সাপ্তাহিক ছুটির দিনেও কর্তৃপক্ষের নির্দেশে কাজ করতে হতে পারে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৪' : '৫'}.৪ উপস্থিতি নিবন্ধনে বায়োমেট্রিক/ডিজিটাল পদ্ধতি ব্যবহার করা হবে। অনুমোদন ব্যতীত দেরিতে আসা বা আগে চলে যাওয়া শাস্তিযোগ্য অপরাধ বলে গণ্য হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৪' : '৫'}.৫ আইএসপি নেটওয়ার্ক মনিটরিং ও রক্ষণাবেক্ষণের জন্য অন-কল ডিউটি প্রযোজ্য হতে পারে।</p>

          {/* Section 5 or 6 - Salary */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৫' : '৬'}: বেতন কাঠামো (Salary &amp; Compensation Structure)</div>
          <p style={{ margin: '4px 0' }}>আপনার মাসিক বেতন কাঠামো নিম্নরূপ নির্ধারণ করা হয়েছে:</p>
          <table className="sal-tbl">
            <thead>
              <tr><th>বেতনের খাত</th><th>মাসিক পরিমাণ (৳)</th></tr>
            </thead>
            <tbody>
              <tr><td>মূল বেতন (Basic Salary)</td><td>৳ <span className="dyn-val">{formatNumber(basicSalary)}</span>/-</td></tr>
              <tr><td>ওভারটাইম ভাতা (প্রতিদিন সর্বোচ্চ ২ ঘণ্টা)</td><td>বাংলাদেশ শ্রম আইন অনুযায়ী মূল বেতনের দ্বিগুণ হারে প্রযোজ্য</td></tr>
              <tr><td>মোট মাসিক বেতন (Gross Monthly Salary)</td><td>৳ <span className="dyn-val">{formatNumber(grossAmount)}</span>/-</td></tr>
            </tbody>
          </table>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৫' : '৬'}.১</strong> বেতন প্রতি মাসের ৫ (পাঁচ) থেকে ১০ (দশ) তারিখের মধ্যে নির্ধারিত ব্যাংক হিসাবে অথবা নগদে প্রদান করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৫' : '৬'}.২</strong> সরকার নির্ধারিত আয়কর ও প্রযোজ্য অন্যান্য কর বেতন থেকে কর্তন করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৫' : '৬'}.৩</strong> বার্ষিক বেতন বৃদ্ধি কর্মক্ষমতা মূল্যায়নের ভিত্তিতে নির্ধারিত হবে এবং এটি কোম্পানির আর্থিক অবস্থার উপর নির্ভরশীল।</p>
          {!isConfirmation && (
            <p style={{ margin: '4px 0' }}><strong>৬.৪</strong> নিয়োগের প্রথম তিন মাস পরীক্ষামূলক বেতন হিসেবে উপরোক্ত কাঠামো কার্যকর হবে।</p>
          )}

          {/* Section 6 or 7 - Overtime */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৬' : '৭'}: অতিরিক্ত কর্মঘণ্টা নীতি (Overtime Policy)</div>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৬' : '৭'}.১ বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ১০৮ অনুযায়ী নিয়মিত কর্মঘণ্টার অতিরিক্ত কাজের জন্য সাধারণ মজুরির দ্বিগুণ হারে ওভারটাইম প্রদেয় হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৬' : '৭'}.২ ওভারটাইম কেবলমাত্র ঊর্ধ্বতন কর্তৃপক্ষের পূর্ব লিখিত অনুমোদনক্রমে গণনাযোগ্য হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৬' : '৭'}.৩ নেটওয়ার্ক জরুরি অবস্থা (Network Emergency) বা দুর্যোগকালীন সময়ে অতিরিক্ত কাজ করার জন্য কর্মী বাধ্য থাকবেন এবং সেক্ষেত্রে ক্ষতিপূরণ কর্তৃপক্ষ নির্ধারণ করবেন।</p>

          {/* Section 7 or 8 - PF */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৭' : '৮'}: ভবিষ্যৎ তহবিল নীতি (Provident Fund Policy)</div>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৭' : '৮'}.১ {isConfirmation ? 'বাংলাদেশ শ্রম আইন ২০০৬-এর বিধান অনুযায়ী ভবিষ্যৎ তহবিল (Provident Fund) কার্যকর হলো।' : 'স্থায়ী নিয়োগের পর বাংলাদেশ শ্রম আইন ২০০৬-এর বিধান অনুযায়ী ভবিষ্যৎ তহবিল (Provident Fund) কার্যকর হবে।'}</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৭' : '৮'}.২ কর্মী প্রতি মাসে মূল বেতনের ৫% (পাঁচ শতাংশ) ভবিষ্যৎ তহবিলে জমা দেবেন এবং কোম্পানিও ২% (দুই শতাংশ) অবদান রাখবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৭' : '৮'}.৩ ভবিষ্যৎ তহবিল থেকে উত্তোলন কর্তৃপক্ষ নির্ধারিত নিয়ম অনুযায়ী পরিচালিত হবে।</p>

          {/* Section 8 or 9 - Festival Bonus */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৮' : '৯'}: উৎসব ভাতা নীতি (Festival Bonus Policy)</div>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৮' : '৯'}.১ বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ১৩২ অনুযায়ী প্রতি বছর দুইটি প্রধান ধর্মীয় উৎসব, যথা ঈদুল ফিতর এবং ঈদুল আযহা উপলক্ষে কর্মচারীকে উৎসব বোনাস প্রদান করা হবে। প্রতিটি উৎসবে কর্মচারী তার এক (১) মাসের মূল বেতনের ৫০% (অর্ধেক) হারে উৎসব বোনাস প্রাপ্য হবেন। অর্থাৎ, বছরে মোট উৎসব বোনাসের পরিমাণ কর্মচারীর এক (১) মাসের মূল বেতনের সমপরিমাণ হবে।</p>
          <p style={{ margin: '4px 0' }}>{isConfirmation ? '৮' : '৯'}.২ উৎসব বোনাস পাওয়ার যোগ্যতার জন্য ন্যূনতম ৬ (ছয়) মাস চাকরির মেয়াদ পূর্ণ হতে হবে।</p>

          {/* Section 9 or 10 - Leave */}
          <div className="sec-hdr">ধারা {isConfirmation ? '৯' : '১০'}: ছুটি নীতি (Leave Policy)</div>
          <p style={{ margin: '4px 0' }}>যেহেতু Speed Net একটি সেবামূলক (Service-Oriented) প্রতিষ্ঠান এবং গ্রাহক সেবা নিরবচ্ছিন্নভাবে পরিচালনা করা প্রতিষ্ঠানের জন্য অত্যন্ত গুরুত্বপূর্ণ, তাই কর্মচারীদের ছুটি বাংলাদেশ শ্রম আইন ২০০৬ অনুযায়ী নিম্নোক্ত ছুটির সুবিধা প্রযোজ্য হবে:</p>
          <table className="sal-tbl">
            <thead>
              <tr><th>ধারা</th><th>ছুটির ধরন</th><th>দিন সংখ্যা</th><th>বেতনসহ</th></tr>
            </thead>
            <tbody>
              <tr><td>{isConfirmation ? '৯.১' : '১০.১'}</td><td>মাসিক নির্ধারিত ছুটি (প্রতি ৩০ কর্মদিনে ১ দিন) সাপ্তাহিক ছুটি ব্যতীত</td><td>১ দিন</td><td>হ্যাঁ</td></tr>
              <tr><td>{isConfirmation ? '৯.২' : '১০.২'}</td><td>অর্ধ-দিবস ছুটি</td><td>প্রতি মাসে ১ (এক) দিন</td><td>হ্যাঁ</td></tr>
              <tr><td>{isConfirmation ? '৯.৩' : '১০.৩'}</td><td>উৎসবকালীন ছুটি</td><td>বছরে ৮ (আট) দিন (প্রতি উৎসবে সর্বোচ্চ ৪ দিন)</td><td>হ্যাঁ</td></tr>
              <tr><td>{isConfirmation ? '৯.৪' : '১০.৪'}</td><td>সরকারি ছুটি</td><td>কোম্পানির নীতিমালা অনুযায়ী প্রযোজ্য</td><td>হ্যাঁ</td></tr>
              <tr><td>{isConfirmation ? '৯.৫' : '১০.৫'}</td><td>অসুস্থতা / জরুরি ছুটি — কর্তৃপক্ষের পূর্বানুমোদন সাপেক্ষে</td><td>—</td><td>হ্যাঁ</td></tr>
            </tbody>
          </table>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৯.৬' : '১০.৬'} অতিরিক্ত ছুটি</strong><br/>উপরোক্ত নির্ধারিত ছুটির অতিরিক্ত কোনো কর্মচারী ব্যক্তিগত কারণ অথবা অন্য কোনো প্রয়োজনে ছুটি গ্রহণ করলে উক্ত ছুটি বেতনবিহীন হিসেবে গণ্য হবে এবং সংশ্লিষ্ট সময়ের বেতন প্রচলিত নিয়ম অনুযায়ী সমন্বয় করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৯.৭' : '১০.৭'} ছুটি গ্রহণের প্রক্রিয়া</strong><br/>কর্মচারীকে যথাসম্ভব আমাদের নির্দিষ্ট ছুটির পোর্টালে ছুটির আবেদন করতে হবে। জরুরি পরিস্থিতি ব্যতীত কর্তৃপক্ষের পূর্বানুমোদন ছাড়া ছুটি গ্রহণ করা শৃঙ্খলাভঙ্গ হিসেবে বিবেচিত হতে পারে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '৯.৮' : '১০.৮'} কোম্পানির প্রয়োজন অনুযায়ী ছুটি সমন্বয়</strong><br/>গ্রাহক সেবা ও অপারেশনাল কার্যক্রম সচল রাখার স্বার্থে কোম্পানি প্রয়োজনে কর্মচারীর ছুটির সময়সূচি পরিবর্তন, স্থগিত বা পুনঃনির্ধারণ করার অধিকার সংরক্ষণ করে।</p>

          {/* Section 10 or 11 - Code of Conduct */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১০' : '১১'}: আচার-বিধি ও পেশাদার নৈতিকতা (Code of Conduct &amp; Professional Ethics)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.১</strong> কর্মী কর্মস্থলে সকলের সাথে সম্মানজনক আচরণ বজায় রাখবেন এবং যেকোনো ধরনের হয়রানি, বৈষম্য বা অপমানজনক আচরণ থেকে বিরত থাকবেন।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.২</strong> কর্মঘণ্টায় ব্যক্তিগত সামাজিক মাধ্যম ব্যবহার, মোবাইল ফোনে অতিরিক্ত কথা বলা বা অফিসের সম্পদের অননুমোদিত ব্যবহার নিষিদ্ধ।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.৩</strong> কর্মস্থলে মদ্যপান, মাদকদ্রব্য সেবন বা যেকোনো অবৈধ কার্যক্রমে জড়িত থাকা শাস্তিযোগ্য অপরাধ।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.৪</strong> কোম্পানির গ্রাহক, সরবরাহকারী বা অংশীদার প্রতিষ্ঠানের সাথে ব্যক্তিগত আর্থিক লেনদেন বা স্বার্থ-সংঘাতমূলক কার্যক্রমে জড়িত হওয়া নিষিদ্ধ।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.৫</strong> সামাজিক যোগাযোগ মাধ্যমে কোম্পানির ভাবমূর্তিহানিকর কোনো তথ্য প্রকাশ বা মন্তব্য করা সম্পূর্ণ নিষিদ্ধ।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১০' : '১১'}.৬</strong> কর্মী কর্তৃপক্ষের অনুমতি ব্যতীত মিডিয়া বা তৃতীয় পক্ষের কাছে কোম্পানির পক্ষে কোনো বিবৃতি প্রদান করবেন না।</p>

          {/* Section 11 or 12 - Confidentiality */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১১' : '১২'}: গোপনীয়তা ও অ-প্রতিযোগিতা চুক্তি (Confidentiality &amp; Non-Compete Clause)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১১' : '১২'}.১</strong> কর্মী চাকরিকালীন এবং চাকরি পরবর্তী ৩ (তিন) বছর পর্যন্ত কোম্পানির গ্রাহকতালিকা, নেটওয়ার্ক অবকাঠামো, বাণিজ্যিক চুক্তি, আর্থিক তথ্য, প্রযুক্তিগত কৌশল ও যেকোনো মালিকানাধীন তথ্য কোনো তৃতীয় পক্ষের কাছে প্রকাশ করবেন না।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১১' : '১২'}.২</strong> কর্মী চাকরিকালীন কোনো প্রতিযোগী প্রতিষ্ঠানে কর্মরত থাকতে বা পার্টটাইম পরামর্শ সেবা প্রদান করতে পারবেন না।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১১' : '১২'}.৩</strong> চাকরি সমাপ্তির পর ৬ (ছয়) মাস পর্যন্ত একই ভৌগোলিক এলাকায় সরাসরি প্রতিযোগী কোম্পানিতে যোগদান সীমাবদ্ধ থাকবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১১' : '১২'}.৪</strong> গোপনীয়তা লঙ্ঘনের ক্ষেত্রে কোম্পানি আইনগত ব্যবস্থা গ্রহণের অধিকার সংরক্ষণ করে।</p>

          {/* Section 12 or 13 - Company Property */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১২' : '১৩'}: কোম্পানির সম্পদ ব্যবহার নীতি (Company Property Clause)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১২' : '১৩'}.১</strong> কর্মীকে প্রদত্ত ল্যাপটপ, মোবাইল ফোন, নেটওয়ার্ক সরঞ্জাম ও অন্যান্য সম্পদ শুধুমাত্র অফিসিয়াল কাজে ব্যবহারযোগ্য।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১২' : '১৩'}.২</strong> কোম্পানির সম্পদ অবহেলার কারণে ক্ষতিগ্রস্ত হলে মূল্য পুনরুদ্ধার করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১২' : '১৩'}.৩</strong> চাকরির সমাপ্তিতে কর্মী সকল কোম্পানি সম্পদ, পরিচয়পত্র, অ্যাক্সেস কার্ড ও ডিজিটাল সুবিধা অবিলম্বে ফেরত দিতে বাধ্য থাকবেন।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১২' : '১৩'}.৪</strong> কোম্পানির নেটওয়ার্ক সিস্টেম, ক্লায়েন্ট ডেটা ও সফ্টওয়্যার অননুমোদিত ব্যক্তির সাথে শেয়ার করা বা ব্যক্তিগত উদ্দেশ্যে ব্যবহার করা কঠোরভাবে নিষিদ্ধ।</p>

          {/* Section 13 or 14 - Transfer */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৩' : '১৪'}: বদলি নীতি (Transfer Clause)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৩' : '১৪'}.১</strong> কোম্পানির কার্যক্রমের স্বার্থে কর্তৃপক্ষ যেকোনো সময় কর্মীকে একই বা সমতুল্য পদে যেকোনো শাখা, বিভাগ বা কর্মস্থলে বদলি করতে পারবেন।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৩' : '১৪'}.২</strong> বদলির ক্ষেত্রে {isConfirmation ? 'ন্যূনতম ১৫ (পনের) দিনের' : 'ন্যূনতম ৩ দিনের'} পূর্ব নোটিশ প্রদান করা হবে, জরুরি ক্ষেত্রে ব্যতিক্রম হতে পারে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৩' : '১৪'}.৩</strong> বদলি আদেশ প্রত্যাখ্যান করা শৃঙ্খলাভঙ্গ হিসেবে গণ্য হবে।</p>

          {/* Section 14 or 15 - Performance Evaluation */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৪' : '১৫'}: কর্মক্ষমতা মূল্যায়ন (Performance Evaluation)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৪' : '১৫'}.১</strong> প্রতি বছর বার্ষিক কর্মক্ষমতা মূল্যায়ন (Annual Performance Review) পরিচালিত হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৪' : '১৫'}.২</strong> মূল্যায়নে কর্মদক্ষতা, লক্ষ্যমাত্রা অর্জন, নেতৃত্বগুণ, সততা ও দলগত কাজের অবদান বিবেচনা করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৪' : '১৫'}.৩</strong> অসন্তুষ্টিকর কর্মক্ষমতার ক্ষেত্রে কারণ দর্শানো নোটিশ (Show Cause Notice) প্রদান ও উন্নয়ন পরিকল্পনা (PIP) প্রণয়ন করা হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৪' : '১৫'}.৪</strong> উৎকৃষ্ট কর্মক্ষমতার ক্ষেত্রে পদোন্নতি, বেতন বৃদ্ধি বা বিশেষ পুরস্কারের বিষয়টি কর্তৃপক্ষ বিবেচনা করবেন।</p>

          {/* Section 15 or 16 - Termination */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৫' : '১৬'}: চাকরির অবসান ও পদত্যাগ নীতি (Termination &amp; Resignation Policy)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৫' : '১৬'}.১</strong> বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ২৬ অনুযায়ী কর্তৃপক্ষ যেকোনো সময় নোটিশ বা নোটিশের পরিবর্তে বেতন প্রদান করে কর্মীকে অব্যাহতি দিতে পারবেন।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৫' : '১৬'}.২</strong> স্থায়ী কর্মীকে চাকরিচ্যুত করার পূর্বে ৩০ (ত্রিশ) দিনের নোটিশ অথবা সমপরিমাণ বেতন প্রদান করতে হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৫' : '১৬'}.৩</strong> গুরুতর অসদাচরণ, চুরি, জালিয়াতি, নেটওয়ার্ক নাশকতা বা কোম্পানির গোপন তথ্য ফাঁস করার ক্ষেত্রে নোটিশ বা ক্ষতিপূরণ ছাড়াই তাৎক্ষণিক বরখাস্ত করা যাবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৫' : '১৬'}.৪</strong> পদত্যাগের ক্ষেত্রে কর্মী কমপক্ষে ৩০ (ত্রিশ) দিনের লিখিত পূর্ব নোটিশ প্রদান করবেন। নোটিশ পিরিয়ড পূরণ না করলে সমপরিমাণ বেতন কর্তনযোগ্য।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৫' : '১৬'}.৫</strong> চাকরি সমাপ্তিতে প্রাপ্য সুবিধাদি বাংলাদেশ শ্রম আইন ২০০৬ অনুযায়ী নিষ্পত্তি করা হবে।</p>

          {/* Section 16 or 17 - Disciplinary */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৬' : '১৭'}: শৃঙ্খলামূলক ব্যবস্থা (Disciplinary Action)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৬' : '১৭'}.১</strong> শৃঙ্খলাভঙ্গের ক্ষেত্রে বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ২৩-২৪ অনুযায়ী নিম্নোক্ত পর্যায়ক্রমিক ব্যবস্থা গ্রহণ করা হবে: (ক) মৌখিক সতর্কতা, (খ) লিখিত সতর্কতা, (গ) বেতন কর্ষণ, (ঘ) সাময়িক বরখাস্ত, (ঙ) স্থায়ী বরখাস্ত।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৬' : '১৭'}.২</strong> যেকোনো শৃঙ্খলামূলক ব্যবস্থার পূর্বে কারণ দর্শানো নোটিশ প্রদান করা হবে এবং কর্মীকে ৭ (সাত) কার্যদিবসের মধ্যে লিখিতভাবে জবাব দেওয়ার সুযোগ দেওয়া হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৬' : '১৭'}.৩</strong> শৃঙ্খলা তদন্ত কমিটি গঠনের মাধ্যমে ন্যায্য ও নিরপেক্ষ তদন্ত পরিচালনা নিশ্চিত করা হবে।</p>

          {/* Section 17 or 18 - Grievance */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৭' : '১৮'}: অভিযোগ নিষ্পত্তি প্রক্রিয়া (Grievance Redressal)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৭' : '১৮'}.১</strong> কর্মী কোনো অভিযোগ বা সমস্যার ক্ষেত্রে প্রথমে সরাসরি রিপোর্টিং ম্যানেজারের সাথে আলোচনা করবেন।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৭' : '১৮'}.২</strong> সমাধান না হলে ৭ (সাত) কার্যদিবসের মধ্যে এইচআর বিভাগে লিখিত অভিযোগ দাখিল করা যাবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৭' : '১৮'}.৩</strong> বাংলাদেশ শ্রম আইন ২০০৬ অনুযায়ী সকল অভিযোগ ন্যায্যভাবে নিষ্পত্তি করার প্রতিশ্রুতি কোম্পানি প্রদান করছে।</p>

          {/* Section 18 or 19 - General */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৮' : '১৯'}: সাধারণ বিধানাবলী (General Provisions)</div>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৮' : '১৯'}.১</strong> এই নিয়োগপত্র বাংলাদেশের আইন দ্বারা পরিচালিত হবে এবং যেকোনো বিরোধ নিষ্পত্তির জন্য খুলনার উপযুক্ত আদালতের এখতিয়ার প্রযোজ্য হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৮' : '১৯'}.২</strong> কোম্পানির নীতিমালা, এইচআর হ্যান্ডবুক ও পরিচালনা বিধিমালা এই নিয়োগপত্রের অবিচ্ছেদ্য অংশ হিসেবে গণ্য হবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৮' : '১৯'}.৩</strong> এই চুক্তির যেকোনো ধারা বাংলাদেশ শ্রম আইনের সাথে সাংঘর্ষিক হলে আইনের বিধান প্রাধান্য পাবে।</p>
          <p style={{ margin: '4px 0' }}><strong>{isConfirmation ? '১৮' : '১৯'}.৪</strong> কর্তৃপক্ষ কোম্পানির নীতিমালা যেকোনো সময় পরিবর্তন করতে পারবেন এবং কর্মীকে লিখিতভাবে অবহিত করা হবে।</p>

          {/* Section 19 or 20 - Acceptance */}
          <div className="sec-hdr">ধারা {isConfirmation ? '১৯' : '২০'}: গ্রহণ ঘোষণা (Acceptance Declaration)</div>
          <p style={{ margin: '4px 0' }}>
            আমি, <strong><span className="dyn-val">{formData.name || '___________'}</span></strong>, এতদ্বারা ঘোষণা করছি যে আমি উপরোক্ত সমস্ত শর্তাবলী, বিধিমালা ও নির্দেশিকা সম্পূর্ণভাবে পাঠ করেছি, বুঝেছি এবং স্বেচ্চায় সম্মত হয়েছি। আমি স্বীকার করছি যে এই নিয়োগপত্রে উল্লিখিত সমস্ত শর্ত স্পিড নেট ও আমার মধ্যকার সম্পূর্ণ কর্মচুক্তির প্রতিনিধিত্ব করে।
          </p>
          <div className="sig-block">
            <div className="sig-box">
              <p className="sig-title">কর্তৃপক্ষের স্বাক্ষর ও সিল</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1">Authorized Signatory</small>
              <small className="text-muted d-block mt-1">
                <img src="/speednet_logo.webp?v=20260912" alt="Speed Net" style={{ height: '35px', objectFit: 'contain', filter: 'brightness(0) invert(1)', background: 'transparent' }} />
              </small>
            </div>
            <div className="sig-box">
              <p className="sig-title">কর্মীর স্বাক্ষর</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1">নাম: <span className="dyn-val">{formData.name || '___________'}</span></small>
              <small className="text-muted d-block">তারিখ: <span className="dyn-val">{formData.signdate || '___________'}</span></small>
            </div>
            <div className="sig-box">
              <p className="sig-title">সাক্ষীর স্বাক্ষর</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1">নাম: _______________</small>
            </div>
          </div>

          <div className="hr-box">
            <div className="hr-box-title">এইচআর বিভাগের ব্যবহারের জন্য (For HR Use Only)</div>
            <table>
              <tbody>
                <tr>
                  <td>গ্রহণের তারিখ: ___________</td>
                  <td>ফাইল নং: ___________</td>
                  <td>এইচআর অনুমোদন: ___________</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="footer">
              <span>
                <img src="/speednet_logo.webp?v=20260912" alt="Speed Net" style={{ height: '28px', objectFit: 'contain', verticalAlign: 'middle', filter: 'brightness(0) invert(1)', background: 'transparent' }} />
              </span>
              <span>info@speednetkhulna.com | www.speednetkhulna.com</span>
            <span>HR-APPT v2.0</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppointmentGenerator;
