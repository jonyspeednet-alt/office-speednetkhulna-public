import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveEmployeeOfTheYear, getMyEmployeeOfTheYear, getNextEmployeeOfTheYearNumbers, getEmployeeOfTheYearById, updateEmployeeOfTheYear, deleteEmployeeOfTheYear } from '../services/employeeOfTheYearService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const EmployeeOfTheYearGenerator = () => {
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
    refNo: 'SNKHL/HR/EOY/' + moment().year() + '/01',
    date: moment().format('DD/MM/YYYY'),
    employeeName: '',
    employeeId: '',
    designation: '',
    department: '',
    year: moment().year().toString(),
    achievements: 'সারা বছর অসাধারণ পেশাদারিত্ব, নিষ্ঠা এবং কার্যকর দলনেতৃত্বের মাধ্যমে প্রতিষ্ঠানের লক্ষ্য অর্জনে অগ্রণী ভূমিকা পালন করেছেন।',
    signerName: user?.full_name || 'ম্যানেজিং ডিরেক্টর',
    signerDesignation: user?.role || 'ব্যবস্থাপনা কর্তৃপক্ষ',
    signerDate: moment().format('DD/MM/YYYY'),
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedRecords, setSavedRecords] = useState([]);
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

  const applyNextNumbers = async () => {
    try {
      const n = await getNextEmployeeOfTheYearNumbers();
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
      setFormData((prev) => ({
        ...prev,
        employeeName: found.full_name || '',
        employeeId: found.employee_id || '',
        designation: found.designation || '',
        department: found.department || '',
      }));
    }
  };

  const handleReset = () => {
    setFormData(defaultForm());
    setEditingId(null);
    setSelectedEmployeeId('');
    applyNextNumbers();
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
        await updateEmployeeOfTheYear(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveEmployeeOfTheYear(payload);
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

  const loadMyRecords = async () => {
    try {
      const data = await getMyEmployeeOfTheYear();
      setSavedRecords(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load records');
    }
  };

  const handleLoadRecord = async (id) => {
    try {
      const rec = await getEmployeeOfTheYearById(id);
      if (rec?.form_data) {
        setFormData({ ...defaultForm(), ...rec.form_data });
        setSelectedEmployeeId(rec.form_data.employeeId || '');
        setEditingId(rec.id);
        setShowEditModal(false);
        setSaveMsg('Record loaded — edit mode');
        notify.success('Record loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load record');
    }
  };

  const handleDeleteRecord = async (id) => {
    if (!(await confirmAction({ title: 'Delete this record?', danger: true }))) return;
    try {
      await deleteEmployeeOfTheYear(id);
      setSavedRecords(prev => prev.filter(r => r.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewRecord = () => {
    setEditingId(null);
    setSelectedEmployeeId('');
    setFormData(defaultForm());
    applyNextNumbers();
  };

  const formatBanglaDate = (value) => {
    if (!value) return '________________';
    const date = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!date.isValid()) return value;
    return date.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Employee of the Year certificate. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #eab308;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form textarea { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 16mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #eab308; }
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
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #713f12 0%, #451a03 100%)', borderRadius: '8px', border: '1px solid #92400e' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-crown text-warning me-2"></i>Employee of the Year Certificate
          </h5>
        </div>
        <button className="btn btn-warning w-100 fw-bold mb-2 text-dark shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyRecords}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewRecord} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Record
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
            <label>Date</label>
            <input type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
            <label>Year</label>
            <input name="year" value={formData.year} onChange={handleChange} />
            <label>Employee ID</label>
            <input name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label>Employee Name</label>
            <input name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label>Designation</label>
            <input name="designation" value={formData.designation} onChange={handleChange} />
            <label>Department</label>
            <input name="department" value={formData.department} onChange={handleChange} />
            <label>Achievements</label>
            <textarea name="achievements" value={formData.achievements} onChange={handleChange} rows={4} />
            <label>Signer Name</label>
            <input name="signerName" value={formData.signerName} onChange={handleChange} />
            <label>Signer Designation</label>
            <input name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />
            <label>Signer Date</label>
            <input type="date" name="signerDate" value={toISODate(formData.signerDate)} onChange={handleDateChange} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Records</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedRecords.length === 0 ? (
                <p className="text-muted text-center py-4">No saved records.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Ref No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedRecords.map(rec => (
                      <tr key={rec.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadRecord(rec.id)}>
                        <td>{rec.employee_name || '-'}</td>
                        <td>{rec.employee_id || '-'}</td>
                        <td>{rec.ref_no || '-'}</td>
                        <td>{rec.updated_at ? new Date(rec.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{rec.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadRecord(rec.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeleteRecord(rec.id); }}><i className="fas fa-trash"></i></button>
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
          {/* Watermark */}
          <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '420px', opacity: '0.04', zIndex: 0, pointerEvents: 'none' }} />

          {/* Decorative Border */}
          <div style={{ position: 'absolute', top: '8px', left: '8px', right: '8px', bottom: '8px', border: '2px solid #eab308', borderRadius: '4px', pointerEvents: 'none', zIndex: 0 }} />
          <div style={{ position: 'absolute', top: '14px', left: '14px', right: '14px', bottom: '14px', border: '1px solid #fef3c7', borderRadius: '2px', pointerEvents: 'none', zIndex: 0 }} />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: '12px', color: '#78350f' }}>
                <div><strong>স্মারক নং:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
              </div>
            </div>

            {/* Crown Icon */}
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'linear-gradient(135deg, #eab308, #ca8a04)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '38px', margin: '0 auto', boxShadow: '0 10px 24px rgba(234, 179, 8, 0.35)' }}>
                <i className="fa-solid fa-crown" />
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '30px', fontWeight: 800, color: '#78350f', letterSpacing: '1px' }}>বছরের সেরা কর্মী</div>
            <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '24px' }}>
              EMPLOYEE OF THE YEAR — {formData.year}
            </div>

            <div style={{ textAlign: 'center', fontSize: '15px', color: '#64748b', marginBottom: '6px' }}>
              এই বিশেষ সম্মাননা প্রদান করা হচ্ছে
            </div>

            {/* Recipient Box */}
            <div style={{ textAlign: 'center', margin: '12px 0 20px', padding: '20px 24px', background: 'linear-gradient(135deg, #fffbeb, #fef9c3)', borderRadius: '12px', border: '2px solid #fde68a' }}>
              <div style={{ fontSize: '30px', fontWeight: 800, color: '#1e293b', letterSpacing: '0.5px' }}>{formData.employeeName || '[কর্মচারীর নাম]'}</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#b45309', marginTop: '6px' }}>
                {formData.designation || '[পদবী]'} | {formData.department || '[বিভাগ]'}
              </div>
              <div style={{ fontSize: '12px', color: '#78350f', marginTop: '4px' }}>কর্মী আইডি: {formData.employeeId || 'SN-XXXX'}</div>
            </div>

            {/* Achievement body */}
            <div style={{ fontSize: '15px', lineHeight: 1.85, textAlign: 'justify', color: '#334155', padding: '0 16px' }}>
              <strong>স্পিড নেট খুলনা (Speed Net Khulna)</strong> পরিবারের পক্ষ থেকে {formData.year} সালের জন্য তাঁকে <strong>বছরের সেরা কর্মী</strong> নির্বাচন করা হলো।
              <br /><br />
              {formData.achievements}
              <br /><br />
              আমরা তাঁর এই অসামান্য অর্জনকে সাধুবাদ জানাই এবং ভবিষ্যতেও এই ধারাবাহিক সাফল্য অব্যাহত থাকার প্রত্যাশা রাখি।
            </div>

            {/* Signature */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', paddingTop: '30px' }}>
              <div style={{ fontSize: '11px', color: '#78350f', fontWeight: 600, textTransform: 'uppercase' }}>
                অফিসিয়াল সিল ও অনুমোদন
              </div>
              <div style={{ textAlign: 'center', width: '220px' }}>
                <div style={{ borderBottom: '1.5px solid #0f172a', marginBottom: '8px', height: '40px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{formData.signerName}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>{formData.signerDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>তারিখ: {formatBanglaDate(formData.signerDate)}</div>
              </div>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #fef9c3', paddingTop: '8px' }}>
              Speed Net Khulna | Annual Excellence Award Certificate — {formData.year}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeOfTheYearGenerator;
