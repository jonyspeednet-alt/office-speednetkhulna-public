import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import { getEmployees } from '../services/employeeService';
import { saveTerminationLetter, getMyTerminationLetters, getTerminationLetterById, updateTerminationLetter, deleteTerminationLetter } from '../services/terminationLetterService';
import apiClient from '../config/axiosConfig';
import { BRANCH_OFFICES, EMPLOYMENT_TYPES } from '../constants/workLocations';
import html2canvas from 'html2canvas';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const TerminationGenerator = () => {
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
  const canAccess = hasPermission('termination_letters.generate') || hasPermission('p_termination_letter');

  const [formData, setFormData] = useState({
    refNo: '001',
    year: moment().year().toString(),
    issueDate: moment().format('DD/MM/YYYY'),
    name: '',
    empid: '',
    designation: '',
    dept: '',
    joining: '',
    lastWorkingDate: '',
    terminationReason: 'প্রশাসনিক / পরিচালনাগত কারণ',
    noticePeriodDays: '30',
    noticeType: 'নোটিশ পিরিয়ড',
    hrContact: '',
    gender: '',
    reporting: '',
    location: '',
    employmentType: '',
  });

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
      const { data: n } = await apiClient.get('/api/termination-letters/next-numbers');
      if (n?.refNo || n?.year) {
        setFormData((prev) => ({
          ...prev,
          refNo: n.refNo || prev.refNo,
          year: n.year || prev.year,
        }));
      }
    } catch {
      // keep manual defaults (route wires up centrally)
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
        <div className="alert alert-danger mb-0">No permission to generate Termination Letter. (Permission: termination_letters.generate)</div>
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
        dept: found.department || '',
        joining: strictJoining || prev.joining,
        reporting: found.reporting_manager || prev.reporting,
        location: found.work_location || prev.location,
        employmentType: found.employment_type || prev.employmentType,
      }));
    }
  };

  const handleReset = () => {
    setFormData({
      refNo: '001',
      year: moment().year().toString(),
      issueDate: moment().format('DD/MM/YYYY'),
      name: '',
      empid: '',
      designation: '',
      dept: '',
      joining: '',
      lastWorkingDate: '',
      terminationReason: 'প্রশাসনিক / পরিচালনাগত কারণ',
      noticePeriodDays: '30',
      noticeType: 'নোটিশ পিরিয়ড',
      hrContact: '',
      gender: '',
      reporting: '',
      location: '',
      employmentType: '',
    });
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
      link.download = `termination-letter-${formData.name || 'letter'}.png`;
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
    if (!formData.lastWorkingDate?.trim()) {
      notify.error('Last working date is required');
      return;
    }
    try {
      const payload = {
        employee_name: formData.name,
        employee_id: formData.empid,
        form_data: formData,
      };
      if (editingId) {
        await updateTerminationLetter(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        await saveTerminationLetter(payload);
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
      const data = await getMyTerminationLetters();
      setSavedLetters(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleLoadLetter = async (id) => {
    try {
      const letter = await getTerminationLetterById(id);
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
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load letters');
    }
  };

  const handleDeleteLetter = async (id) => {
    if (!(await confirmAction({ title: 'Delete this letter?', danger: true }))) return;
    try {
      await deleteTerminationLetter(id);
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
      refNo: '001',
      year: moment().year().toString(),
      issueDate: moment().format('DD/MM/YYYY'),
      name: '',
      empid: '',
      designation: '',
      dept: '',
      joining: '',
      lastWorkingDate: '',
      terminationReason: 'প্রশাসনিক / পরিচালনাগত কারণ',
      noticePeriodDays: '30',
      noticeType: 'নোটিশ পিরিয়ড',
      hrContact: '',
      gender: '',
      reporting: '',
      location: '',
      employmentType: '',
    });
    applyNextNumbers();
  };

  const salutation = formData.gender === 'পুরুষ' ? 'জনাব' : formData.gender === 'মহিলা' ? 'জনাবা' : 'জনাব/জনাবা';

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
        .admin-sidebar-form .sec-body { padding: 10px; }
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
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form select option { background: #162d50; color: #fff; }
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
          padding: 0.42in 0.45in 0.55in;
          font-family: 'Kalpurush', 'Noto Serif Bengali', 'Hind Siliguri', 'Noto Sans Bengali', 'SolaimanLipi', 'Vrinda', serif;
          font-size: 10.5pt;
          line-height: 1.5;
          color: #000;
          box-shadow: 0 0 15px rgba(0,0,0,0.2);
        }
        .dyn-val { color: #c0392b; font-weight: 700; }
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
        .sig-block { display: flex; justify-content: space-between; gap: 20px; margin-top: 22px; }
        .sig-box { flex: 1; min-width: 180px; }
        .sig-title { font-weight: 700; font-size: 10.5pt; color: #1a3a6b; margin-bottom: 36px; }
        .sig-line { border-top: 1.5px solid #000; width: 180px; }
        .hr-box { margin-top: 14px; border: 1.5px solid #1a3a6b; padding: 7px 14px 9px; }
        .hr-box-title { font-weight: 700; color: #1a3a6b; font-size: 10pt; border-bottom: 1px solid #d6e4f7; margin-bottom: 5px; }
        .footer { margin-top: 14px; border-top: 2px solid #c0392b; padding-top: 5px; font-size: 9pt; color: #555; display: flex; justify-content: space-between; }
        .ack-box { border: 1.5px solid #1a3a6b; padding: 10px 14px; margin-top: 16px; }
        .ack-title { font-weight: 700; color: #1a3a6b; font-size: 10.5pt; margin-bottom: 6px; border-bottom: 1px solid #d6e4f7; padding-bottom: 4px; }
        .warning-box { margin-top: 12px; border: 1.5px solid #c0392b; background: #fff8f8; padding: 8px 14px; font-size: 9.5pt; color: #c0392b; line-height: 1.6; }
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
          .ref-bar, .sig-block, .hr-box, .ack-box, .footer {
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
            <i className="fas fa-file-signature text-danger me-2"></i>Termination Letter Generator
          </h5>
          <small className="text-white-50" style={{ fontSize: '9px' }}>Termination Letter Generator</small>
        </div>

        <button className="btn btn-danger w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <button className="btn btn-success w-100 fw-bold mb-2 shadow-sm" onClick={handleSave}>
          <i className="fas fa-download me-2"></i>Save as Image
        </button>

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

        {/* Reference */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-calendar-alt me-1"></i> Reference &amp; Date</div>
          <div className="sec-body">
            <div className="row g-2">
              <div className="col-6">
                <label>Ref No</label>
                <input type="text" name="refNo" value={formData.refNo} onChange={handleChange} placeholder="001" />
              </div>
              <div className="col-6">
                <label>Year</label>
                <input type="text" name="year" value={formData.year} onChange={handleChange} placeholder="2026" />
              </div>
            </div>
            <label htmlFor="termination-issue-date">Issue Date</label>
            <input id="termination-issue-date" type="date" name="issueDate" value={toISODate(formData.issueDate)} onChange={handleDateChange} />
          </div>
        </div>

        {/* Employee Info */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-user me-1"></i> Employee Information</div>
          <div className="sec-body">
            <label htmlFor="termination-employee-select">Select Employee (auto-fill)</label>
            <select id="termination-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label>Employee Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Enter name" />
            <label>Employee ID</label>
            <input type="text" name="empid" value={formData.empid} onChange={handleChange} placeholder="SN-2024-001" />
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
            <label htmlFor="termination-joining">Joining Date</label>
            <input id="termination-joining" type="date" name="joining" value={toISODate(formData.joining)} onChange={handleDateChange} />
            <label htmlFor="termination-last-working">Last Working Date</label>
            <input id="termination-last-working" type="date" name="lastWorkingDate" value={toISODate(formData.lastWorkingDate)} onChange={handleDateChange} />
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

        {/* Termination Details */}
        <div className="sec">
          <div className="sec-title"><i className="fas fa-exclamation-triangle me-1"></i> Termination Details</div>
          <div className="sec-body">
            <label>Termination Reason</label>
            <select name="terminationReason" value={formData.terminationReason} onChange={handleChange}>
              <option value="প্রশাসনিক / পরিচালনাগত কারণ">প্রশাসনিক / পরিচালনাগত কারণ</option>
              <option value="কর্মক্ষমতার অভাব">কর্মক্ষমতার অভাব</option>
              <option value="শৃঙ্খলাভঙ্গ / অসদাচরণ">শৃঙ্খলাভঙ্গ / অসদাচরণ</option>
              <option value="অন্যান্য">অন্যান্য</option>
            </select>
            <label>Notice Period (days)</label>
            <input type="number" name="noticePeriodDays" value={formData.noticePeriodDays} onChange={handleChange} min="0" />
            <label>Notice Type</label>
            <select name="noticeType" value={formData.noticeType} onChange={handleChange}>
              <option value="নোটিশ পিরিয়ড">নোটিশ পিরিয়ড (With Notice)</option>
              <option value="নোটিশের পরিবর্তে বেতন">নোটিশের পরিবর্তে বেতন (In Lieu of Notice)</option>
            </select>
            <label>HR Contact</label>
            <input type="text" name="hrContact" value={formData.hrContact} onChange={handleChange} placeholder="HR phone number" />
          </div>
        </div>

        <button className="btn btn-outline-secondary w-100 btn-sm text-light mb-2" onClick={handleReset}>
          <i className="fas fa-undo me-1"></i> Form Reset
        </button>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Termination Letters</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedLetters.length === 0 ? (
                <p className="text-muted text-center py-4">No saved letters.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>ID</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedLetters.map(letter => (
                      <tr key={letter.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadLetter(letter.id)}>
                        <td>{letter.employee_name || '-'}</td>
                        <td>{letter.employee_id || '-'}</td>
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
                  <span className="hdr-co-bn">স্পিড নেট — ইন্টারনেট সার্ভিস প্রোভাইডার</span>
                  <span className="hdr-co-addr">83/3, গগন বাবু রোড, খুলনা। প্রথম ও দ্বিতীয় তলা।</span>
                  <span className="hdr-co-addr">info@speednetkhulna.com | www.speednetkhulna.com</span>
                </td>
                <td className="hdr-right">
                  <span className="hdr-appt">চাকরি</span>
                  <span className="hdr-appt">অবসান</span>
                  <span className="hdr-appt-en">TERMINATION</span>
                  <span className="hdr-appt-en">LETTER</span>
                </td>
              </tr>
            </tbody>
          </table>
          <hr className="hdr-rule" />

          <table className="ref-bar" style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td><strong>রেফ নং: </strong><span className="dyn-val">SN/HR/TERM/{formData.year || moment().year()}/{formData.refNo || '001'}</span></td>
                <td style={{ textAlign: 'right' }}><strong>ইস্যু তারিখ: </strong><span className="dyn-val">{formData.issueDate || 'DD/MM/YYYY'}</span></td>
              </tr>
            </tbody>
          </table>

          {/* Subject */}
          <div className="subject-line"><strong>বিষয়: </strong><span className="dyn-val">চাকরির অবসান পত্র (Employment Termination Letter) — গোপনীয়</span></div>

          {/* Salutation */}
          <p style={{ margin: '8px 0 3px', fontWeight: 700, color: '#1a3a6b' }}>
            {salutation} <span className="dyn-val">{formData.name || '_____________'}</span>,
          </p>

          {/* Opening */}
          <p style={{ textAlign: 'justify', margin: '3px 0 7px', lineHeight: 1.8 }}>
            আস-সালামু আলাইকুম। স্পিড নেট (Speed Net)-এর পক্ষ থেকে আপনাকে জানানো হচ্ছে যে, প্রতিষ্ঠানের প্রশাসনিক, সাংগঠনিক ও ব্যবসায়িক প্রয়োজনীয়তার আলোকে ব্যবস্থাপনা কর্তৃপক্ষ আপনার চাকরি অবসানের সিদ্ধান্ত গ্রহণ করেছেন। এই সিদ্ধান্তটি বাংলাদেশ শ্রম আইন ২০০৬ (সংশোধনী ২০১৩, ২০১৮) এবং আপনার নিয়োগপত্রের শর্তাবলী অনুযায়ী কার্যকর করা হচ্ছে।
          </p>

          {/* Termination Reason */}
          <p style={{ textAlign: 'justify', margin: '3px 0 7px', lineHeight: 1.8 }}>
            <strong>অবসানের কারণ / পটভূমি:</strong><br />
            <strong>প্রশাসনিক / পরিচালনাগত কারণ:</strong> <span className="dyn-val">{formData.terminationReason || 'প্রশাসনিক / পরিচালনাগত কারণ'}</span> — কোম্পানির প্রাতিষ্ঠানিক ও সাংগঠনিক পুনর্গঠনের ফলে আপনার পদের কার্যক্রম সীমিত/স্থগিত করা হয়েছে।
          </p>

          {/* Section 1: Employee Info */}
          <div className="sec-hdr">১.০  কর্মী পরিচিতি (Employee Information)</div>
          <table className="ig">
            <tbody>
              <tr><td className="ig-l">কর্মীর নাম</td><td className="ig-c">:</td><td className="ig-v">{formData.name || '___________'}</td></tr>
              <tr><td className="ig-l">কর্মী আইডি</td><td className="ig-c">:</td><td className="ig-v">{formData.empid || '___________'}</td></tr>
              <tr><td className="ig-l">পদবী</td><td className="ig-c">:</td><td className="ig-v">{formData.designation || '___________'}</td></tr>
              <tr><td className="ig-l">বিভাগ</td><td className="ig-c">:</td><td className="ig-v">{formData.dept || '___________'}</td></tr>
              <tr><td className="ig-l">যোগদানের তারিখ</td><td className="ig-c">:</td><td className="ig-v">{formData.joining || '___________'}</td></tr>
              <tr><td className="ig-l">রিপোর্টিং কর্মকর্তা</td><td className="ig-c">:</td><td className="ig-v">{formData.reporting || '___________'}</td></tr>
              <tr><td className="ig-l">কর্মস্থল</td><td className="ig-c">:</td><td className="ig-v">{formData.location || '___________'}</td></tr>
              <tr><td className="ig-l">নিয়োগের ধরন</td><td className="ig-c">:</td><td className="ig-v">{formData.employmentType || '___________'}</td></tr>
              <tr><td className="ig-l">সর্বশেষ কর্মদিন</td><td className="ig-c">:</td><td className="ig-v">{formData.lastWorkingDate || '___________'}</td></tr>
            </tbody>
          </table>

          {/* Section 2: Formal Notice */}
          <div className="sec-hdr">২.০  আনুষ্ঠানিক অবসান নোটিশ (Formal Notice of Termination)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ২.১ এতদ্বারা আনুষ্ঠানিকভাবে অবহিত করা হচ্ছে যে, প্রতিষ্ঠানের প্রশাসনিক ও সাংগঠনিক প্রয়োজনের ভিত্তিতে ব্যবস্থাপনা কর্তৃপক্ষের সিদ্ধান্ত অনুযায়ী আপনার চাকরি <span className="dyn-val">{formData.lastWorkingDate || '___________'}</span> তারিখ থেকে কার্যকরভাবে সমাপ্ত বলে গণ্য হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ২.২ এই সিদ্ধান্তটি বাংলাদেশ শ্রম আইন ২০০৬-এর ধারা ২৬ এবং আপনার নিয়োগপত্রের নোটিশ পিরিয়ড বিধান অনুযায়ী প্রযোজ্য নোটিশ বা নোটিশের পরিবর্তে প্রযোজ্য বেতন প্রদানসহ কার্যকর করা হচ্ছে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ২.৩ এই অবসান সিদ্ধান্তটি কোম্পানির নীতিমালা ও ব্যবস্থাপনার কর্তৃপক্ষ-প্রাপ্ত বিবেচনার আলোকে গৃহীত হয়েছে এবং এটি চূড়ান্ত ও অপরিবর্তনীয়।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ২.৪ নিয়োগপত্রের ১৬.২ ধারা অনুযায়ী আপনাকে <span className="dyn-val">{formData.noticePeriodDays || '30'}</span> (ত্রিশ) দিনের অগ্রিম নোটিশ প্রদান করা হচ্ছে {formData.noticeType === 'নোটিশের পরিবর্তে বেতন' ? '[অথবা নোটিশের পরিবর্তে সমপরিমাণ মূল বেতন প্রদান করা হবে]' : ''}। তবে, কর্মচারী কোনো গুরুতর অসদাচরণ, শৃঙ্খলাভঙ্গ বা প্রতিষ্ঠানের স্বার্থবিরোধী কার্যকলাপে জড়িত হলে, প্রতিষ্ঠান প্রযোজ্য আইন ও নিয়োগপত্র অনুযায়ী পূর্ব নোটিশ ছাড়াই তাৎক্ষণিকভাবে চাকরি থেকে অব্যাহতি বা বরখাস্ত করার অধিকার সংরক্ষণ করবে।
          </p>

          {/* Section 3: Last Working Day */}
          <div className="sec-hdr">৩.০  সর্বশেষ কর্মদিন (Last Working Day)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৩.১ আপনার সর্বশেষ কর্মদিন হবে <span className="dyn-val">{formData.lastWorkingDate || '___________'}</span>। উক্ত তারিখ পর্যন্ত আপনাকে স্বাভাবিক কর্মদায়িত্ব যথাযথভাবে পালন করতে হবে এবং চলমান কার্যক্রম সংশ্লিষ্ট কর্মকর্তার নিকট সুশৃঙ্খলভাবে হস্তান্তর করতে হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৩.২ সর্বশেষ কর্মদিনের পর আপনার অ্যাক্সেস কার্ড, আইডি কার্ড, ইমেইল অ্যাকাউন্ট, সিস্টেম অ্যাক্সেস ও অন্যান্য কোম্পানি সুবিধা তাৎক্ষণিকভাবে নিষ্ক্রিয় করা হবে।
          </p>

          {/* Section 4: Asset Handover */}
          <div className="sec-hdr">৪.০  কোম্পানি সম্পদ হস্তান্তর (Asset Handover)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৪.১ সর্বশেষ কর্মদিনে বা তার পূর্বে নিচে উল্লিখিত সকল কোম্পানি সম্পদ যথাযথ অবস্থায় সংশ্লিষ্ট বিভাগে জমা দিতে হবে:
          </p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(ক) ল্যাপটপ, মোবাইল ফোন, ট্যাবলেট ও অন্যান্য ইলেকট্রনিক ডিভাইস।</p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(খ) নেটওয়ার্ক সরঞ্জাম, সরঞ্জামাদি ও প্রযুক্তিগত যন্ত্রপাতি।</p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(গ) কর্মী পরিচয়পত্র, অ্যাক্সেস কার্ড, চাবি ও সিকিউরিটি ব্যাজ।</p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(ঘ) কোম্পানির যাবতীয় নথিপত্র, ফাইল, রেকর্ড ও ডিজিটাল ডেটা।</p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(ঙ) ল্যাপটপ/পিসি, জিমেইল, হোয়াটসঅ্যাপ ও অন্যান্য অফিশিয়াল অ্যাকাউন্ট/ডিভাইসের পাসওয়ার্ড জমা প্রদান করতে হবে এবং ব্যক্তিগত তথ্য ব্যতিরেকে কোম্পানির অন্য কোনো ফাইল বা ডেটা মুছে ফেলা যাবে না।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৪.২ সম্পদ হস্তান্তর না করলে বা ক্ষতিগ্রস্ত অবস্থায় ফেরত দিলে সমপরিমাণ মূল্য পূর্ণ ও চূড়ান্ত নিষ্পত্তি থেকে কর্তন করা হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৪.৩ এইচআর বিভাগ হতে নির্ধারিত &apos;Clearance and No Dues Form&apos;-এ সংশ্লিষ্ট সকল বিভাগের ছাড়পত্র গ্রহণ করতে হবে।
          </p>

          {/* Section 5: Full & Final Settlement */}
          <div className="sec-hdr">৫.০  পূর্ণ ও চূড়ান্ত নিষ্পত্তি (Full &amp; Final Settlement)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৫.১ বাংলাদেশ শ্রম আইন ২০০৬ ও আপনার নিয়োগপত্রের শর্তাবলী অনুযায়ী নিম্নোক্ত প্রাপ্যতাসমূহ যথাসময়ে নিষ্পত্তি করা হবে:
          </p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(ক) <span className="dyn-val">{formData.lastWorkingDate || '___________'}</span> পর্যন্ত অনাদায়ী বেতন ও প্রযোজ্য ভাতা।</p>
          <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8 }}>(খ) আইনগতভাবে প্রাপ্য অন্যান্য সুবিধাদি।</p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৫.২ পূর্ণ ও চূড়ান্ত নিষ্পত্তির পরিমাণ HR বিভাগ কর্তৃক নির্ধারিত হবে এবং সকল কোম্পানি সম্পদ ফেরত ও প্রয়োজনীয় কাগজপত্র সম্পন্নের পর ৩০ (ত্রিশ) কার্যদিবসের মধ্যে প্রদান করা হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৫.৩ কোম্পানির কাছে কর্মীর কোনো অগ্রিম বেতন, লোন বা অননুমোদিত আর্থিক বকেয়া থাকলে তা পূর্ণ ও চূড়ান্ত নিষ্পত্তি (Final Settlement) থেকে কর্তন করার অধিকার ব্যবস্থাপনা কর্তৃপক্ষ সংরক্ষণ করে।
          </p>

          {/* Section 6: Provident Fund */}
          <div className="sec-hdr">৬.০  ভবিষ্যৎ তহবিল নিষ্পত্তি (Provident Fund Settlement)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৬.১ প্রযোজ্য ক্ষেত্রে, ভবিষ্যৎ তহবিলে (Provident Fund) সঞ্চিত আপনার নিজস্ব অবদান ও কোম্পানির অবদান বাংলাদেশ শ্রম আইন ২০০৬ এবং কোম্পানির ভবিষ্যৎ তহবিল বিধিমালা অনুযায়ী নিষ্পত্তি করা হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৬.২ ভবিষ্যৎ তহবিল নিষ্পত্তির জন্য কোম্পানি কর্তৃক ইস্যুকৃত NOC সংগ্রহ করে সংশ্লিষ্ট ব্যাংকে জমা দিয়ে ভবিষ্যৎ তহবিল উত্তোলন/সংগ্রহ করতে হবে।
          </p>

          {/* Section 7: Experience Certificate & NOC */}
          <div className="sec-hdr">৭.০  অভিজ্ঞতা সনদ ও এনওসি (Experience Certificate &amp; NOC)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৭.১ সকল কোম্পানি সম্পদ যথাযথভাবে ফেরত, পূর্ণ ও চূড়ান্ত নিষ্পত্তি সম্পন্ন এবং কোনো বকেয়া না থাকলে আপনি এইচআর বিভাগের নিকট লিখিত আবেদনের মাধ্যমে অভিজ্ঞতা সনদ (Experience Certificate) প্রাপ্তির যোগ্য হবেন।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৭.২ নো অবজেকশন সার্টিফিকেট (NOC) প্রদানের বিষয়টি ব্যবস্থাপনা কর্তৃপক্ষের বিবেচনা ও কোম্পানির নীতিমালার আলোকে নির্ধারিত হবে।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            ৭.৩ গোপনীয়তা ও অ-প্রতিযোগিতা চুক্তির বাধ্যবাধকতা চাকরি সমাপ্তির পরেও কার্যকর থাকবে যেমনটি আপনার নিয়োগপত্রে উল্লিখিত হয়েছে।
          </p>

          {/* Section 8: Closing */}
          <div className="sec-hdr">৮.০  সমাপনী বিবৃতি (Closing Statement)</div>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            স্পিড নেট কর্তৃপক্ষ আপনার সেবা ও অবদানের প্রতি কৃতজ্ঞতা প্রকাশ করছে এবং আপনার ভবিষ্যৎ জীবন ও কর্মজীবনে সাফল্য কামনা করছে। চাকরি অবসান প্রক্রিয়া সংক্রান্ত যেকোনো প্রশ্ন বা স্পষ্টীকরণের জন্য এইচআর বিভাগের সাথে যোগাযোগ করুন।
          </p>
          <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8 }}>
            <strong>যোগাযোগ:</strong> HR বিভাগ, স্পিড নেট | ইমেইল: hr@speednetkhulna.com | ফোন: <span className="dyn-val">{formData.hrContact || '[HR Contact Number]'}</span>
          </p>

          {/* Signatures */}
          <div className="sig-block">
            <div className="sig-box">
              <p className="sig-title">অনুমোদিত কর্তৃপক্ষের স্বাক্ষর ও সিল</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1" style={{ fontSize: '9.5pt' }}>Authorized Signatory &amp; Company Seal</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>
                <img src="/speednet_logo.webp?v=20260912" alt="Speed Net" style={{ height: '35px', objectFit: 'contain', filter: 'brightness(0) invert(1)', background: 'transparent' }} />
              </small>
            </div>
            <div className="sig-box">
              <p className="sig-title">এইচআর বিভাগের স্বাক্ষর</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1" style={{ fontSize: '9.5pt' }}>Head of HR / HR Manager</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>নাম: _______________________</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>পদবী: _____________________</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>তারিখ: ___________________</small>
            </div>
            <div className="sig-box">
              <p className="sig-title">নাম: _______________________</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1" style={{ fontSize: '9.5pt' }}>পদবী: _____________________</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>তারিখ: ___________________</small>
            </div>
          </div>

          {/* Employee Acknowledgement */}
          <div className="ack-box">
            <div className="ack-title">কর্মীর স্বীকৃতি (Employee Acknowledgement)</div>
            <p style={{ textAlign: 'justify', margin: '4px 0', lineHeight: 1.8, fontSize: '10pt' }}>
              আমি, <strong><span className="dyn-val">{formData.name || '_____________'}</span></strong>, কর্মী আইডি: <span className="dyn-val">{formData.empid || '_____________'}</span>, পদবী: <span className="dyn-val">{formData.designation || '_____________'}</span>, এতদ্বারা স্বীকার করছি যে:
            </p>
            <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8, fontSize: '10pt' }}>(ক) আমি এই চাকরির অবসান পত্রটি গ্রহণ করেছি এবং এর বিষয়বস্তু সম্পূর্ণভাবে পাঠ করেছি ও বুঝেছি।</p>
            <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8, fontSize: '10pt' }}>(খ) <span className="dyn-val">{formData.lastWorkingDate || '___________'}</span> তারিখটি আমার সর্বশেষ কর্মদিন হিসেবে আমি অবগত আছি।</p>
            <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8, fontSize: '10pt' }}>(গ) কোম্পানির সকল সম্পদ যথাযথভাবে ফেরত দেওয়ার এবং চলমান দায়িত্ব হস্তান্তর করার বাধ্যবাধকতা আমি স্বীকার করছি।</p>
            <p style={{ margin: '2px 0 2px 18px', lineHeight: 1.8, fontSize: '10pt' }}>(ঘ) গোপনীয়তা চুক্তি ও অ-প্রতিযোগিতা বিধান চাকরি সমাপ্তির পরেও কার্যকর থাকবে বলে আমি অবহিত আছি।</p>
          </div>

          {/* Acknowledgement Signatures */}
          <div className="sig-block" style={{ marginTop: '16px' }}>
            <div className="sig-box">
              <p className="sig-title">কর্মীর স্বাক্ষর (Employee Signature)</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1" style={{ fontSize: '9.5pt' }}>নাম: <span className="dyn-val">{formData.name || '_____________'}</span></small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>তারিখ: ___________________</small>
            </div>
            <div className="sig-box">
              <p className="sig-title">সাক্ষীর স্বাক্ষর (Witness Signature)</p>
              <div className="sig-line"></div>
              <small className="text-muted d-block mt-1" style={{ fontSize: '9.5pt' }}>নাম: _______________________</small>
              <small className="text-muted d-block" style={{ fontSize: '9.5pt' }}>তারিখ: ___________________</small>
            </div>
          </div>

          {/* Warning */}
          <div className="warning-box">
            ⚠ এই পত্রটি বাংলাদেশ শ্রম আইন ২০০৬ (সংশোধনী ২০১৩, ২০১৮) ও শ্রম বিধিমালা ২০১৫ অনুযায়ী প্রস্তুত একটি আইনি দলিল। উভয় পক্ষের স্বাক্ষর ব্যতীত কর্মীর স্বীকৃতি অংশ পূর্ণ হবে না। এই পত্র প্রাপ্তির পর যেকোনো আপত্তি ৭ (সাত) কার্যদিবসের মধ্যে লিখিতভাবে এইচআর বিভাগে জানাতে হবে।
          </div>

          {/* Footer */}
          <div className="footer">
            <span>
              <img src="/speednet_logo.webp?v=20260912" alt="Speed Net" style={{ height: '28px', objectFit: 'contain', verticalAlign: 'middle', filter: 'brightness(0) invert(1)', background: 'transparent' }} />
            </span>
            <span>Speed Net | 83/3 গগন বাবু রোড, খুলনা | info@speednetkhulna.com</span>
            <span>SN-HR-TERM-v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminationGenerator;
