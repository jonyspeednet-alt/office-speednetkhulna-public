import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveDeviceHandover, getMyDeviceHandovers, getDeviceHandoverById, updateDeviceHandover, deleteDeviceHandover, getNextDeviceHandoverNumbers } from '../services/deviceHandoverService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const DeviceHandoverForm = () => {
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
    refNo: 'SNKHL/HR/DH/' + moment().year() + '/01',
    companyName: 'স্পিড নেট খুলনা (Speed Net Khulna)',
    employeeName: '',
    employeeId: '',
    designation: '',
    date: moment().format('DD/MM/YYYY'),
    deviceType: 'mobile',
    model: '',
    serialNumber: '',
    condition: 'ভালো (Good)',
    accessories: { charger: false, cable: false, cover: false, others: '' },
    returnDate: '',
    receiverSignDate: moment().format('DD/MM/YYYY'),
    signerName: user?.full_name || '',
    signerDesignation: user?.role || 'ব্যবস্থাপনা কর্তৃপক্ষ',
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedForms, setSavedForms] = useState([]);
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
      const n = await getNextDeviceHandoverNumbers();
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
    const { name, value, type, checked } = e.target;
    if (name.startsWith('accessory_')) {
      const key = name.replace('accessory_', '');
      setFormData((prev) => ({ ...prev, accessories: { ...prev.accessories, [key]: type === 'checkbox' ? checked : value } }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Native date inputs work with ISO values; formData keeps DD/MM/YYYY shape
  // so the form preview and server payload stay unchanged.
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
        await updateDeviceHandover(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveDeviceHandover(payload);
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

  const loadMyForms = async () => {
    try {
      const data = await getMyDeviceHandovers();
      setSavedForms(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load forms');
    }
  };

  const handleLoadForm = async (id) => {
    try {
      const form = await getDeviceHandoverById(id);
      if (form?.form_data) {
        const def = defaultForm();
        const loaded = form.form_data;
        setFormData({
          ...def,
          ...loaded,
          accessories: { ...def.accessories, ...(loaded.accessories || {}) },
        });
        setSelectedEmployeeId(loaded.employeeId || '');
        setEditingId(form.id);
        setShowEditModal(false);
        setSaveMsg('Form loaded — edit mode');
        notify.success('Form loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load form');
    }
  };

  const handleDeleteForm = async (id) => {
    if (!(await confirmAction({ title: 'Delete this form?', danger: true }))) return;
    try {
      await deleteDeviceHandover(id);
      setSavedForms(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewForm = () => {
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
        <div className="alert alert-danger mb-0">No permission to generate Device Handover Form. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  const accessoryList = [
    { key: 'charger', label: 'চার্জার / Charger' },
    { key: 'cable', label: 'ক্যাবল / Cable' },
    { key: 'cover', label: 'কভার / Cover' },
  ];

  const deviceLabel = formData.deviceType === 'mobile' ? 'মোবাইল ফোন' : 'ল্যাপটপ / কম্পিউটার';

  const FieldRow = ({ label, value }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '10px', fontSize: '14px', lineHeight: 1.7 }}>
      <span style={{ fontWeight: 700, minWidth: '200px', color: '#1e293b' }}>{label}</span>
      <span style={{ borderBottom: '1px solid #94a3b8', flex: 1, paddingBottom: '2px', color: '#334155', minHeight: '20px' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .admin-sidebar-form {
          width: 380px; min-width: 320px; background: #0d1f3c; color: #e0e8f5;
          padding: 16px; overflow-y: auto; max-height: calc(100vh - 70px);
          border-right: 3px solid #0891b2;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #22d3ee; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form select { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; }
        .admin-sidebar-form input[type="date"] { color-scheme: dark; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .section-heading {
          font-weight: 800; font-size: '15px'; color: #0e7490;
          border-left: 3px solid #0891b2; padding-left: 10px;
          margin: 18px 0 12px; text-transform: uppercase; font-size: 13px; letter-spacing: 0.5px;
        }
        .rules-list { padding-left: 22px; margin: 0; font-size: 14px; line-height: 2; color: #334155; }
        .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 28px; }
        .sig-box { text-align: center; font-size: 13px; }
        .sig-line { border-bottom: 1.5px solid #1e293b; height: 50px; width: 100%; margin-bottom: 8px; }
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
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #164e63 0%, #083344 100%)', borderRadius: '8px', border: '1px solid #0891b2' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-tablet-alt me-2" style={{ color: '#22d3ee' }}></i>Device Handover Form
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#0891b2', color: '#fff' }} onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyForms}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewForm} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Form
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>
        <div className="sec">
          <div className="sec-title">Employee Info</div>
          <div className="sec-body">
            <label htmlFor="dh-employee-select">Select Employee (auto-fill)</label>
            <select id="dh-employee-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="dh-refNo">Reference No</label>
            <input id="dh-refNo" name="refNo" value={formData.refNo} onChange={handleChange} />
            <label htmlFor="dh-employeeName">Employee Name</label>
            <input id="dh-employeeName" name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label htmlFor="dh-employeeId">Employee ID</label>
            <input id="dh-employeeId" name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label htmlFor="dh-designation">Designation</label>
            <input id="dh-designation" name="designation" value={formData.designation} onChange={handleChange} />
            <label htmlFor="dh-date">Handover Date</label>
            <input id="dh-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
            <label htmlFor="dh-returnDate">Expected Return Date</label>
            <input id="dh-returnDate" type="date" name="returnDate" value={toISODate(formData.returnDate)} onChange={handleDateChange} />
          </div>
        </div>
        <div className="sec">
          <div className="sec-title">Device Info</div>
          <div className="sec-body">
            <label htmlFor="dh-deviceType">Device Type</label>
            <select id="dh-deviceType" name="deviceType" value={formData.deviceType} onChange={handleChange}>
              <option value="mobile">Mobile Phone</option>
              <option value="laptop">Laptop / Computer</option>
              <option value="router">Router / Network Device</option>
              <option value="tablet">Tablet</option>
            </select>
            <label htmlFor="dh-model">Model</label>
            <input id="dh-model" name="model" value={formData.model} onChange={handleChange} placeholder="e.g. Samsung Galaxy A54" />
            <label htmlFor="dh-serialNumber">Serial / IMEI Number</label>
            <input id="dh-serialNumber" name="serialNumber" value={formData.serialNumber} onChange={handleChange} />
            <label htmlFor="dh-condition">Device Condition</label>
            <select id="dh-condition" name="condition" value={formData.condition} onChange={handleChange}>
              <option value="ভালো (Good)">ভালো (Good)</option>
              <option value="গড় (Average)">গড় (Average)</option>
              <option value="মেরামত প্রয়োজন">মেরামত প্রয়োজন</option>
            </select>
            <label>Accessories</label>
            {accessoryList.map((item) => (
              <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px', color: '#e0e8f5' }}>
                <input type="checkbox" name={`accessory_${item.key}`} checked={Boolean(formData.accessories[item.key])} onChange={handleChange} style={{ width: '14px', height: '14px', margin: 0 }} />
                <span>{item.label}</span>
              </div>
            ))}
            <input name="accessory_others" value={formData.accessories.others} onChange={handleChange} placeholder="Other accessories" />
          </div>
        </div>
        <div className="sec">
          <div className="sec-title">Authorizer</div>
          <div className="sec-body">
            <label htmlFor="dh-signerName">Authorizer Name</label>
            <input id="dh-signerName" name="signerName" value={formData.signerName} onChange={handleChange} />
            <label htmlFor="dh-signerDesignation">Designation</label>
            <input id="dh-signerDesignation" name="signerDesignation" value={formData.signerDesignation} onChange={handleChange} />
            <label htmlFor="dh-receiverSignDate">Receiver Sign Date</label>
            <input id="dh-receiverSignDate" type="date" name="receiverSignDate" value={toISODate(formData.receiverSignDate)} onChange={handleDateChange} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Forms</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedForms.length === 0 ? (
                <p className="text-muted text-center py-4">No saved forms.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Ref No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedForms.map(form => (
                      <tr key={form.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadForm(form.id)}>
                        <td>{form.employee_name || '-'}</td>
                        <td>{form.employee_id || '-'}</td>
                        <td>{form.ref_no || '-'}</td>
                        <td>{form.updated_at ? new Date(form.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{form.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadForm(form.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeleteForm(form.id); }}><i className="fas fa-trash"></i></button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0891b2', paddingBottom: '14px', marginBottom: '16px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>সূত্র:</strong> {formData.refNo}</div>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Device Handover Record</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>প্রাতিষ্ঠানিক ডিভাইস হস্তান্তর ফর্ম</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '16px' }}>
              Corporate Device Handover & Acceptance Form
            </div>

            {/* Section 1 */}
            <div className="section-heading">১. সাধারণ তথ্য / General Information</div>
            <FieldRow label="প্রতিষ্ঠানের নাম:" value={formData.companyName} />
            <FieldRow label="কর্মীর নাম:" value={formData.employeeName || '____________________________________________'} />
            <FieldRow label="কর্মী আইডি:" value={formData.employeeId || '______________'} />
            <FieldRow label="পদবী:" value={formData.designation || '____________________________________________'} />
            <FieldRow label="হস্তান্তরের তারিখ:" value={formatBanglaDate(formData.date)} />
            <FieldRow label="প্রত্যাশিত ফেরতের তারিখ:" value={formData.returnDate ? formatBanglaDate(formData.returnDate) : '________________________'} />

            {/* Section 2 */}
            <div className="section-heading">২. ডিভাইসের বিবরণ / Device Details</div>
            <FieldRow label="ডিভাইসের ধরন:" value={deviceLabel} />
            <FieldRow label="মডেল:" value={formData.model || '____________________________________________'} />
            <FieldRow label="সিরিয়াল / IMEI নম্বর:" value={formData.serialNumber || '____________________________________________'} />
            <FieldRow label="ডিভাইসের অবস্থা:" value={formData.condition} />
            <FieldRow label="সাথে প্রাপ্ত এক্সেসরিজ:" value={[
              formData.accessories.charger ? 'চার্জার' : '',
              formData.accessories.cable ? 'ক্যাবল' : '',
              formData.accessories.cover ? 'কভার' : '',
              formData.accessories.others || '',
            ].filter(Boolean).join(' | ') || '________________________'} />

            {/* Section 3 */}
            <div className="section-heading">৩. নিয়মাবলি ও শর্তাবলী / Terms & Conditions</div>
            <ul className="rules-list">
              <li>ডিভাইসটি শুধুমাত্র অফিসিয়াল কাজের জন্য ব্যবহৃত হবে।</li>
              <li>রক্ষণাবেক্ষণের সম্পূর্ণ দায়িত্ব গ্রহণকারী কর্মীর।</li>
              <li>অবহেলায় ডিভাইস নষ্ট বা হারিয়ে গেলে নির্ধারিত ক্ষতিপূরণ দিতে হবে।</li>
              <li>চাকরি ছাড়ার সময় বা কর্তৃপক্ষের চাহিদামতে ডিভাইস ফেরত দিতে হবে।</li>
            </ul>

            {/* Section 4 — Signatures */}
            <div className="section-heading" style={{ marginTop: '20px' }}>৪. স্বাক্ষর / Signatures</div>
            <div className="signature-row">
              <div className="sig-box">
                <div className="sig-line"></div>
                <div style={{ fontWeight: 700 }}>{formData.employeeName || 'কর্মীর নাম'}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>ডিভাইস গ্রহণকারী কর্মীর স্বাক্ষর</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>তারিখ: {formatBanglaDate(formData.receiverSignDate)}</div>
              </div>
              <div className="sig-box">
                <div className="sig-line"></div>
                <div style={{ fontWeight: 700 }}>{formData.signerName || '__________________'}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>{formData.signerDesignation}</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>স্পিড নেট খুলনা</div>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '16px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceHandoverForm;
