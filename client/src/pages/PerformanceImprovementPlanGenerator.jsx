import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { savePip, getMyPips, getPipById, updatePip, deletePip, getNextPipNumbers } from '../services/pipService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const PerformanceImprovementPlanGenerator = () => {
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
    refNo: 'SNKHL/HR/PIP/' + moment().year() + '/01',
    companyName: '',
    department: '',
    employeeName: '',
    supervisor: '',
    employeeId: '',
    pipStartDate: '',
    designation: '',
    pipEndDate: '',
    reasonLateArrival: false,
    reasonMissedDeadline: false,
    reasonQualityIssue: false,
    reasonPolicyViolation: false,
    reasonInstructionFailure: false,
    reasonOther: '',
    review1Date: '',
    review1Comment: '',
    review2Date: '',
    review2Comment: '',
    finalReviewDate: '',
    finalReviewComment: '',
    employeeComment: '',
    employeeSignatureName: '',
    employeeSignature: '',
    employeeSignatureDate: '',
    supervisorSignatureName: '',
    supervisorSignature: '',
    supervisorSignatureDate: '',
    hrSignatureName: '',
    hrSignature: '',
    hrSignatureDate: '',
    finalDecision: '',
    finalDecisionComment: '',
    approverName: '',
    approvalDate: '',
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedPips, setSavedPips] = useState([]);
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
      const n = await getNextPipNumbers();
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
    const { name, type, value, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  // Native date inputs work with ISO values; formData keeps DD/MM/YYYY shape
  // so the PIP preview and server payload stay unchanged.
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
        await updatePip(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await savePip(payload);
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

  const loadMyPips = async () => {
    try {
      const data = await getMyPips();
      setSavedPips(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load PIPs');
    }
  };

  const handleLoadPip = async (id) => {
    try {
      const pip = await getPipById(id);
      if (pip?.form_data) {
        const def = defaultForm();
        setFormData({ ...def, ...pip.form_data });
        setSelectedEmployeeId(pip.form_data.employeeId || '');
        setEditingId(pip.id);
        setShowEditModal(false);
        setSaveMsg('PIP loaded — edit mode');
        notify.success('PIP loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load PIP');
    }
  };

  const handleDeletePip = async (id) => {
    if (!(await confirmAction({ title: 'Delete this PIP?', danger: true }))) return;
    try {
      await deletePip(id);
      setSavedPips(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewPip = () => {
    setEditingId(null);
    setSelectedEmployeeId('');
    setFormData(defaultForm());
    applyNextNumbers();
  };

  const formatBanglaDate = (value) => {
    if (!value) return '________________';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return value;
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  const getCheckedReasons = () => {
    const reasons = [];
    if (formData.reasonLateArrival) reasons.push('নিয়মিত দেরিতে অফিসে উপস্থিত হওয়া');
    if (formData.reasonMissedDeadline) reasons.push('নির্ধারিত সময়ে কাজ সম্পন্ন না করা');
    if (formData.reasonQualityIssue) reasons.push('কাজের মান প্রতিষ্ঠানের প্রত্যাশা অনুযায়ী না হওয়া');
    if (formData.reasonPolicyViolation) reasons.push('অফিসের নীতিমালা ও নির্দেশনা যথাযথভাবে অনুসরণ না করা');
    if (formData.reasonInstructionFailure) reasons.push('ঊর্ধ্বতন কর্মকর্তার নির্দেশনা যথাযথভাবে পালন না করা');
    if (formData.reasonOther) reasons.push(formData.reasonOther);
    return reasons.length ? reasons : ['—'];
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Performance Improvement Plan. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .admin-sidebar-form {
          width: 400px;
          min-width: 340px;
          background: #0d1f3c;
          color: #e0e8f5;
          padding: 16px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          border-right: 3px solid #dc2626;
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
          color: #f87171;
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
        .admin-sidebar-form .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 0;
          color: #dfeafc;
          font-size: 12px;
        }
        .admin-sidebar-form input[type='checkbox'] {
          width: auto;
          margin: 0;
        }
        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow: auto;
          background: #e2e8f0;
        }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto;
          background: #fff; color: #1e293b;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif;
          position: relative; display: flex; flex-direction: column;
        }
        .pip-title {
          text-align: center;
          font-size: 22px;
          font-weight: 800;
          margin: 20px 0 12px;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 16px;
          margin: 10px 0 18px;
        }
        .info-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
          border: 1px solid #dfe7f0;
          background: #f8fafc;
          padding: 8px 10px;
          min-height: 60px;
        }
        .info-box strong {
          font-size: 11px;
          color: #334155;
          text-transform: uppercase;
        }
        .section-header {
          font-size: 18px;
          font-weight: 800;
          margin: 20px 0 8px;
          color: #0f172a;
        }
        .reasons-list {
          font-size: 12px;
          line-height: 1.9;
          margin: 10px 0 16px;
          padding-left: 18px;
        }
        .table-main {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          margin-bottom: 16px;
        }
        .table-main th, .table-main td {
          border: 1px solid #111827;
          padding: 8px 10px;
          font-size: 11px;
          vertical-align: top;
          text-align: left;
        }
        .table-main th {
          background: #f1f5f9;
          font-weight: 800;
        }
        .list-steps {
          padding-left: 18px;
          font-size: 12px;
          line-height: 1.9;
          margin: 0 0 12px;
        }
        .review-table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0 16px;
        }
        .review-table th, .review-table td {
          border: 1px solid #111827;
          padding: 8px 10px;
          font-size: 11px;
          vertical-align: top;
          text-align: left;
        }
        .signature-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
          margin-top: 18px;
        }
        .signature-box {
          text-align: center;
          font-size: 11px;
        }
        .sig-line {
          border-bottom: 1.5px solid #111;
          height: 40px;
          margin-bottom: 6px;
        }
        .small-note {
          font-size: 11px;
          line-height: 1.7;
          color: #334155;
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
          .letter-page { box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; min-height: auto !important; height: auto !important; display: flex !important; flex-direction: column !important; page-break-after: avoid !important; overflow: hidden !important; }
          .table-main, .table-main tr, .table-main thead, .table-main tbody, .review-table, .review-table tr, .review-table thead, .review-table tbody, .signature-grid, .signature-box { break-inside: avoid !important; page-break-inside: avoid !important; }
          .signature-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', borderRadius: '8px', border: '1px solid #dc2626' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-chart-bar me-2" style={{ color: '#f87171' }}></i>PIP Generator
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#dc2626', color: '#fff' }} onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyPips}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewPip} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New PIP
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>
        <div className="sec">
          <div className="sec-title">PIP Generator</div>
          <div className="sec-body">
            <label htmlFor="pip-employee-select">Select Employee (auto-fill)</label>
            <select id="pip-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="pip-refNo">Reference No</label>
            <input id="pip-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />

            <label htmlFor="pip-companyName">Company Name</label>
            <input id="pip-companyName" name="companyName" value={formData.companyName} onChange={handleChange} />

            <label htmlFor="pip-department">Department</label>
            <input id="pip-department" name="department" value={formData.department} onChange={handleChange} />

            <label htmlFor="pip-employeeName">Employee Name</label>
            <input id="pip-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />

            <label htmlFor="pip-supervisor">Supervisor</label>
            <input id="pip-supervisor" name="supervisor" value={formData.supervisor} onChange={handleChange} />

            <label htmlFor="pip-employeeId">Employee ID</label>
            <input id="pip-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} />

            <label htmlFor="pip-startDate">PIP Start Date</label>
            <input id="pip-startDate" type="date" name="pipStartDate" value={toISODate(formData.pipStartDate)} onChange={handleDateChange} />

            <label htmlFor="pip-designation">Designation</label>
            <input id="pip-designation" name="designation" value={formData.designation} onChange={handleChange} />

            <label htmlFor="pip-endDate">PIP End Date</label>
            <input id="pip-endDate" type="date" name="pipEndDate" value={toISODate(formData.pipEndDate)} onChange={handleDateChange} />

            <label>Reasons for PIP</label>
            <label className="checkbox-row" htmlFor="pip-reasonLateArrival"><input id="pip-reasonLateArrival" type="checkbox" name="reasonLateArrival" checked={formData.reasonLateArrival} onChange={handleChange} /> নিয়মিত দেরিতে অফিসে উপস্থিত হওয়া</label>
            <label className="checkbox-row" htmlFor="pip-reasonMissedDeadline"><input id="pip-reasonMissedDeadline" type="checkbox" name="reasonMissedDeadline" checked={formData.reasonMissedDeadline} onChange={handleChange} /> নির্ধারিত সময়ে কাজ সম্পন্ন না করা</label>
            <label className="checkbox-row" htmlFor="pip-reasonQualityIssue"><input id="pip-reasonQualityIssue" type="checkbox" name="reasonQualityIssue" checked={formData.reasonQualityIssue} onChange={handleChange} /> কাজের মান প্রতিষ্ঠানের প্রত্যাশা অনুযায়ী না হওয়া</label>
            <label className="checkbox-row" htmlFor="pip-reasonPolicyViolation"><input id="pip-reasonPolicyViolation" type="checkbox" name="reasonPolicyViolation" checked={formData.reasonPolicyViolation} onChange={handleChange} /> অফিসের নীতিমালা ও নির্দেশনা যথাযথভাবে অনুসরণ না করা</label>
            <label className="checkbox-row" htmlFor="pip-reasonInstructionFailure"><input id="pip-reasonInstructionFailure" type="checkbox" name="reasonInstructionFailure" checked={formData.reasonInstructionFailure} onChange={handleChange} /> ঊর্ধ্বতন কর্মকর্তার নির্দেশনা যথাযথভাবে পালন না করা</label>
            <input id="pip-reasonOther" name="reasonOther" value={formData.reasonOther} onChange={handleChange} placeholder="Other" />

            <label htmlFor="pip-review1Date">Review 1 Date</label>
            <input id="pip-review1Date" type="date" name="review1Date" value={toISODate(formData.review1Date)} onChange={handleDateChange} />
            <label htmlFor="pip-review1Comment">Review 1 Comment</label>
            <textarea id="pip-review1Comment" name="review1Comment" value={formData.review1Comment} onChange={handleChange} rows={2} />

            <label htmlFor="pip-review2Date">Review 2 Date</label>
            <input id="pip-review2Date" type="date" name="review2Date" value={toISODate(formData.review2Date)} onChange={handleDateChange} />
            <label htmlFor="pip-review2Comment">Review 2 Comment</label>
            <textarea id="pip-review2Comment" name="review2Comment" value={formData.review2Comment} onChange={handleChange} rows={2} />

            <label htmlFor="pip-finalReviewDate">Final Review Date</label>
            <input id="pip-finalReviewDate" type="date" name="finalReviewDate" value={toISODate(formData.finalReviewDate)} onChange={handleDateChange} />
            <label htmlFor="pip-finalReviewComment">Final Review Comment</label>
            <textarea id="pip-finalReviewComment" name="finalReviewComment" value={formData.finalReviewComment} onChange={handleChange} rows={2} />

            <label htmlFor="pip-employeeComment">Employee Comment</label>
            <textarea id="pip-employeeComment" name="employeeComment" value={formData.employeeComment} onChange={handleChange} rows={3} />

            <label htmlFor="pip-employeeSignatureName">Employee Signature Name</label>
            <input id="pip-employeeSignatureName" name="employeeSignatureName" value={formData.employeeSignatureName} onChange={handleChange} />

            <label htmlFor="pip-employeeSignatureDate">Employee Signature Date</label>
            <input id="pip-employeeSignatureDate" type="date" name="employeeSignatureDate" value={toISODate(formData.employeeSignatureDate)} onChange={handleDateChange} />

            <label htmlFor="pip-supervisorSignatureName">Supervisor Signature Name</label>
            <input id="pip-supervisorSignatureName" name="supervisorSignatureName" value={formData.supervisorSignatureName} onChange={handleChange} />

            <label htmlFor="pip-supervisorSignatureDate">Supervisor Signature Date</label>
            <input id="pip-supervisorSignatureDate" type="date" name="supervisorSignatureDate" value={toISODate(formData.supervisorSignatureDate)} onChange={handleDateChange} />

            <label htmlFor="pip-hrSignatureName">HR Signature Name</label>
            <input id="pip-hrSignatureName" name="hrSignatureName" value={formData.hrSignatureName} onChange={handleChange} />

            <label htmlFor="pip-hrSignatureDate">HR Signature Date</label>
            <input id="pip-hrSignatureDate" type="date" name="hrSignatureDate" value={toISODate(formData.hrSignatureDate)} onChange={handleDateChange} />

            <label htmlFor="pip-finalDecision">Final Decision</label>
            <input id="pip-finalDecision" name="finalDecision" value={formData.finalDecision} onChange={handleChange} />

            <label htmlFor="pip-finalDecisionComment">Decision Comment</label>
            <textarea id="pip-finalDecisionComment" name="finalDecisionComment" value={formData.finalDecisionComment} onChange={handleChange} rows={2} />

            <label htmlFor="pip-approverName">Approver Name</label>
            <input id="pip-approverName" name="approverName" value={formData.approverName} onChange={handleChange} />

            <label htmlFor="pip-approvalDate">Approval Date</label>
            <input id="pip-approvalDate" type="date" name="approvalDate" value={toISODate(formData.approvalDate)} onChange={handleDateChange} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved PIPs</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedPips.length === 0 ? (
                <p className="text-muted text-center py-4">No saved PIPs.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Ref No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedPips.map(pip => (
                      <tr key={pip.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadPip(pip.id)}>
                        <td>{pip.employee_name || '-'}</td>
                        <td>{pip.employee_id || '-'}</td>
                        <td>{pip.ref_no || '-'}</td>
                        <td>{pip.updated_at ? new Date(pip.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{pip.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadPip(pip.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeletePip(pip.id); }}><i className="fas fa-trash"></i></button>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #dc2626', paddingBottom: '14px', marginBottom: '16px' }}>
            <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
            <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
              <div><strong>সূত্র:</strong> {formData.refNo}</div>
              <div><strong>প্রতিষ্ঠান:</strong> {formData.companyName || 'স্পিড নেট খুলনা'}</div>
              <div><strong>বিভাগ:</strong> {formData.department || '—'}</div>
            </div>
          </div>
          <div className="pip-title" style={{ color: '#7f1d1d', fontFamily: "'Hind Siliguri',sans-serif", fontSize: '22px', fontWeight: 800, textAlign: 'center', marginBottom: '14px' }}>কর্মদক্ষতা উন্নয়ন পরিকল্পনা</div>
          <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#dc2626', letterSpacing: '1.5px', marginBottom: '16px', textTransform: 'uppercase' }}>Performance Improvement Plan (PIP)</div>

          <div className="info-grid">
            <div className="info-box"><strong>প্রতিষ্ঠানের নাম</strong><span>{formData.companyName || '__________________'}</span></div>
            <div className="info-box"><strong>বিভাগ</strong><span>{formData.department || '__________________'}</span></div>
            <div className="info-box"><strong>কর্মীর নাম</strong><span>{formData.employeeName || '__________________'}</span></div>
            <div className="info-box"><strong>সুপারভাইজার</strong><span>{formData.supervisor || '__________________'}</span></div>
            <div className="info-box"><strong>কর্মী আইডি</strong><span>{formData.employeeId || '__________________'}</span></div>
            <div className="info-box"><strong>PIP শুরুর তারিখ</strong><span>{formatBanglaDate(formData.pipStartDate)}</span></div>
            <div className="info-box"><strong>পদবি</strong><span>{formData.designation || '__________________'}</span></div>
            <div className="info-box"><strong>PIP সমাপ্তির তারিখ</strong><span>{formatBanglaDate(formData.pipEndDate)}</span></div>
          </div>

          <div className="section-header">১. PIP প্রদানের কারণ</div>
          <div className="reasons-list">
            {getCheckedReasons().map((reason, index) => (
              <div key={index}>• {reason}</div>
            ))}
          </div>

          <div className="section-header">২. উন্নয়নের ক্ষেত্র</div>
          <table className="table-main">
            <thead>
              <tr>
                <th style={{ width: '8%' }}>ক্রম</th>
                <th style={{ width: '22%' }}>বিষয়</th>
                <th style={{ width: '25%' }}>বর্তমান অবস্থা (সমস্যা)</th>
                <th style={{ width: '25%' }}>প্রত্যাশিত অবস্থা (লক্ষ্যমাত্রা)</th>
                <th style={{ width: '20%' }}>প্রয়োজনীয় সহায়তা/রিসোর্স</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>১</td>
                <td>সময়ানুবর্তিতা</td>
                <td>নিয়মিত দেরি করা</td>
                <td>৯:৩০ AM-এর মধ্যে উপস্থিতি নিশ্চিত করা</td>
                <td>—</td>
              </tr>
              <tr>
                <td>২</td>
                <td>কাজের মান</td>
                <td>ভুলের হার বেশি</td>
                <td>কাজের ভুলের হার ৫%-এর নিচে আনা</td>
                <td>সুপারভাইজার রিভিউ</td>
              </tr>
              <tr>
                <td>৩</td>
                <td>ডেলিভারি</td>
                <td>ডেডলাইন মিস করা</td>
                <td>শতভাগ কাজ নির্ধারিত সময়ে জমা দেওয়া</td>
                <td>কাজের অগ্রাধিকার তালিকা</td>
              </tr>
              <tr>
                <td>৪</td>
                <td>অন্যান্য</td>
                <td>{formData.reasonOther || '__________________'}</td>
                <td>__________________</td>
                <td>__________________</td>
              </tr>
            </tbody>
          </table>

          <div className="section-header">৩. উন্নয়নের জন্য করণীয়</div>
          <ol className="list-steps">
            <li>প্রতিদিন নির্ধারিত সময়ে অফিসে উপস্থিত থাকতে হবে।</li>
            <li>সকল দায়িত্ব নির্ধারিত সময়সীমার মধ্যে সম্পন্ন করতে হবে।</li>
            <li>ঊর্ধ্বতন কর্মকর্তার নির্দেশনা যথাযথভাবে অনুসরণ করতে হবে।</li>
            <li>প্রয়োজন হলে অতিরিক্ত প্রশিক্ষণ গ্রহণ করতে হবে।</li>
            <li>সহকর্মীদের সঙ্গে পেশাদার আচরণ ও কার্যকর যোগাযোগ বজায় রাখতে হবে।</li>
            <li>সুপারভাইজারের সাথে নির্ধারিত সময়ে অগ্রগতি পর্যালোচনা সভায় অংশগ্রহণ করতে হবে।</li>
          </ol>

          <div className="section-header">৪. মূল্যায়নের সময়সূচি</div>
          <table className="review-table">
            <thead>
              <tr>
                <th style={{ width: '25%' }}>মূল্যায়ন</th>
                <th style={{ width: '25%' }}>তারিখ</th>
                <th style={{ width: '50%' }}>মন্তব্য</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>১ম পর্যালোচনা</td>
                <td>{formatBanglaDate(formData.review1Date)}</td>
                <td>{formData.review1Comment || '________________________'}</td>
              </tr>
              <tr>
                <td>২য় পর্যালোচনা</td>
                <td>{formatBanglaDate(formData.review2Date)}</td>
                <td>{formData.review2Comment || '________________________'}</td>
              </tr>
              <tr>
                <td>চূড়ান্ত মূল্যায়ন</td>
                <td>{formatBanglaDate(formData.finalReviewDate)}</td>
                <td>{formData.finalReviewComment || '________________________'}</td>
              </tr>
            </tbody>
          </table>

          <div className="section-header">৫. সম্ভাব্য ফলাফল</div>
          <ol className="list-steps">
            <li>নির্ধারিত সময়ের মধ্যে সন্তোষজনক উন্নতি হলে কর্মী স্বাভাবিক দায়িত্ব পালন অব্যাহত রাখবেন।</li>
            <li>প্রয়োজনীয় উন্নতি না হলে প্রতিষ্ঠানের নীতিমালা এবং বাংলাদেশ শ্রম আইন অনুযায়ী পরবর্তী প্রশাসনিক ব্যবস্থা গ্রহণ করা হতে পারে।</li>
          </ol>

          <div className="section-header">৬. কর্মীর মন্তব্য</div>
          <div className="small-note" style={{ border: '1px solid #dfe7f0', padding: '10px', minHeight: '60px' }}>
            {formData.employeeComment || '________________________________________________________________________________'}
          </div>

          <div className="section-header">৭. ঘোষণা</div>
          <p style={{ fontSize: '12px', lineHeight: '1.9', marginBottom: '18px' }}>
            আমি এই Performance Improvement Plan (PIP)-এর বিষয়বস্তু পড়েছি, বুঝেছি এবং নির্ধারিত উন্নয়ন পরিকল্পনা বাস্তবায়নে সম্মত আছি।
          </p>

          <div className="signature-grid">
            <div className="signature-box">
              <div style={{ fontWeight: 800, marginBottom: '6px' }}>কর্মী</div>
              <div className="sig-line"></div>
              <div>{formData.employeeSignatureName || '__________________'}</div>
              <div>{formData.employeeSignature || '__________________'}</div>
              <div>{formatBanglaDate(formData.employeeSignatureDate)}</div>
            </div>

            <div className="signature-box">
              <div style={{ fontWeight: 800, marginBottom: '6px' }}>সুপারভাইজার</div>
              <div className="sig-line"></div>
              <div>{formData.supervisorSignatureName || '__________________'}</div>
              <div>{formData.supervisorSignature || '__________________'}</div>
              <div>{formatBanglaDate(formData.supervisorSignatureDate)}</div>
            </div>

            <div className="signature-box">
              <div style={{ fontWeight: 800, marginBottom: '6px' }}>HR প্রতিনিধি</div>
              <div className="sig-line"></div>
              <div>{formData.hrSignatureName || '__________________'}</div>
              <div>{formData.hrSignature || '__________________'}</div>
              <div>{formatBanglaDate(formData.hrSignatureDate)}</div>
            </div>
          </div>

          <div className="section-header" style={{ marginTop: '24px' }}>HR ব্যবহারের জন্য (ঐচ্ছিক)</div>
          <div className="small-note">
            <div style={{ fontWeight: 800, marginBottom: '6px' }}>চূড়ান্ত সিদ্ধান্ত:</div>
            <div>{formData.finalDecision || '☐ সন্তোষজনক উন্নতি হয়েছে / ☐ PIP-এর মেয়াদ বৃদ্ধি করা হলো / ☐ পরবর্তী প্রশাসনিক ব্যবস্থা গ্রহণ করা হবে'}</div>
            <div style={{ marginTop: '8px' }}>মন্তব্য: {formData.finalDecisionComment || '________________________'}</div>
            <div style={{ marginTop: '8px' }}><strong>অনুমোদনকারী:</strong> {formData.approverName || '_________________________________'}</div>
            <div style={{ marginTop: '6px' }}><strong>তারিখ:</strong> {formatBanglaDate(formData.approvalDate)}</div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceImprovementPlanGenerator;
