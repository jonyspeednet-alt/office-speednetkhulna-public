import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { saveEmployeeSuggestion, getMyEmployeeSuggestions, getEmployeeSuggestionById, updateEmployeeSuggestion, deleteEmployeeSuggestion } from '../services/employeeSuggestionService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const EmployeeIssueSuggestionForm = () => {
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
    date: moment().format('DD/MM/YYYY'),
    department: '',
    employeeName: '',
    employeeId: '',
    designation: '',
    categories: {
      technical: false,
      interDept: false,
      officeEnv: false,
      clientService: false,
      policy: false,
      other: false,
    },
    issueDescription: '',
    suggestion: '',
  });

  const [formData, setFormData] = useState(defaultForm);

  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savedItems, setSavedItems] = useState([]);
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

  const handleChange = (e) => {
    const { name, value, checked } = e.target;
    if (name.startsWith('category_')) {
      const key = name.replace('category_', '');
      setFormData((prev) => ({ ...prev, categories: { ...prev.categories, [key]: checked } }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Native date inputs work with ISO values; formData keeps DD/MM/YYYY shape
  // so the preview and server payload stay unchanged.
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
    if (!formData.issueDescription?.trim() && !formData.suggestion?.trim()) {
      notify.error('Issue description or suggestion is required');
      return;
    }
    try {
      // This form has no ref/serial concept — save with nullable ref_no.
      const payload = {
        employee_name: formData.employeeName,
        employee_id: formData.employeeId,
        ref_no: null,
        form_data: formData,
      };
      if (editingId) {
        await updateEmployeeSuggestion(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveEmployeeSuggestion(payload);
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

  const loadMyItems = async () => {
    try {
      const data = await getMyEmployeeSuggestions();
      setSavedItems(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load suggestions');
    }
  };

  const handleLoadItem = async (id) => {
    try {
      const item = await getEmployeeSuggestionById(id);
      if (item?.form_data) {
        const def = defaultForm();
        const loaded = item.form_data;
        setFormData({ ...def, ...loaded, categories: { ...def.categories, ...(loaded.categories || {}) } });
        setSelectedEmployeeId(loaded.employeeId || '');
        setEditingId(item.id);
        setShowEditModal(false);
        setSaveMsg('Suggestion loaded — edit mode');
        notify.success('Suggestion loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load suggestion');
    }
  };

  const handleDeleteItem = async (id) => {
    if (!(await confirmAction({ title: 'Delete this suggestion?', danger: true }))) return;
    try {
      await deleteEmployeeSuggestion(id);
      setSavedItems(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewItem = () => {
    setEditingId(null);
    setSelectedEmployeeId('');
    setFormData(defaultForm());
  };

  const formatBanglaDate = (value) => {
    if (!value) return '____ / ____ / ______';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return value;
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  const categoryOptions = [
    { key: 'technical', label: 'কাজের সমস্যা / টেকনিক্যাল বাধা', icon: '⚙️' },
    { key: 'interDept', label: 'আন্তঃবিভাগীয় সমন্বয়', icon: '🔗' },
    { key: 'officeEnv', label: 'অফিস পরিবেশ / অ্যাডমিন', icon: '🏢' },
    { key: 'clientService', label: 'ক্লায়েন্ট / সার্ভিস ইস্যু', icon: '👤' },
    { key: 'policy', label: 'পলিসি / প্রাতিষ্ঠানিক পরামর্শ', icon: '📋' },
    { key: 'other', label: 'অন্যান্য (Others)', icon: '📌' },
  ];

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to use Issue & Suggestion Form. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #8b5cf6;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #a78bfa; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
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
        .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
        .cat-item {
          display: flex; align-items: center; gap: 10px; font-size: 14px;
          padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;
          background: #f8fafc;
        }
        .cat-item.checked { background: #ede9fe; border-color: #8b5cf6; }
        .answer-box {
          border: 1px solid #e2e8f0; min-height: 100px; padding: 10px 12px;
          font-size: 14px; line-height: 1.85; margin-top: 8px; white-space: pre-wrap;
          color: #475569; border-radius: 4px;
        }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #8b5cf6; }
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
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #2e1065 100%)', borderRadius: '8px', border: '1px solid #8b5cf6' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-comment-dots me-2" style={{ color: '#a78bfa' }}></i>Issue & Suggestion Form
          </h5>
        </div>
        <button className="btn w-100 fw-bold mb-2 shadow-sm" style={{ background: '#7c3aed', color: '#fff' }} onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <div className="mb-2" style={{ fontSize: '11px', color: '#8ab0d8' }}>
          Tip: প্রিন্ট ডায়ালগে Headers and footers অফ করুন।
        </div>
        <div className="d-flex gap-2 mb-2">
          <button className="btn btn-primary fw-bold shadow-sm flex-fill" onClick={handleSaveToServer}>
            <i className="fas fa-save me-1"></i>{editingId ? 'Update' : 'Save'}
          </button>
          <button className="btn btn-warning fw-bold shadow-sm flex-fill" onClick={loadMyItems}>
            <i className="fas fa-edit me-1"></i>Edit
          </button>
        </div>
        {editingId && (
          <button className="btn btn-outline-light w-100 mb-2 shadow-sm" onClick={handleNewItem} style={{ fontSize: '12px' }}>
            <i className="fas fa-plus me-1"></i>New Form
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>
        <div className="sec">
          <div className="sec-title">Form Info</div>
          <div className="sec-body">
            <label htmlFor="issue-emp-select">Select Employee (auto-fill)</label>
            <select id="issue-emp-select" value={selectedEmployeeId} onChange={(e) => handleEmployeeSelect(e.target.value)}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.employee_id}>
                  {emp.full_name} ({emp.employee_id}){emp.designation ? ` — ${emp.designation}` : ''}
                </option>
              ))}
            </select>
            <label htmlFor="issue-date">Date</label>
            <input id="issue-date" type="date" name="date" value={toISODate(formData.date)} onChange={handleDateChange} />
            <label>Department</label>
            <input name="department" value={formData.department} onChange={handleChange} />
            <label>Name (Optional)</label>
            <input name="employeeName" value={formData.employeeName} onChange={handleChange} />
            <label htmlFor="issue-emp-id">Employee ID</label>
            <input id="issue-emp-id" name="employeeId" value={formData.employeeId} onChange={handleChange} placeholder="SN-1004" />
            <label>Designation</label>
            <input name="designation" value={formData.designation} onChange={handleChange} />
            <label>Category</label>
            {categoryOptions.map((item) => (
              <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px', color: '#e0e8f5' }}>
                <input type="checkbox" name={`category_${item.key}`} checked={formData.categories[item.key]} onChange={handleChange} style={{ width: '14px', height: '14px', margin: 0 }} />
                <span>{item.icon} {item.label}</span>
              </div>
            ))}
            <label>Issue Description</label>
            <textarea name="issueDescription" value={formData.issueDescription} onChange={handleChange} rows={5} />
            <label>Proposed Solution</label>
            <textarea name="suggestion" value={formData.suggestion} onChange={handleChange} rows={5} />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Suggestions</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedItems.length === 0 ? (
                <p className="text-muted text-center py-4">No saved suggestions.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Name</th><th>Employee ID</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedItems.map(item => (
                      <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadItem(item.id)}>
                        <td>{item.employee_name || '-'}</td>
                        <td>{item.employee_id || '-'}</td>
                        <td>{item.updated_at ? new Date(item.updated_at).toLocaleDateString('bn-BD') : '-'}</td>
                        <td>{item.created_by_name || '-'}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-primary me-1 py-0" onClick={(e) => { e.stopPropagation(); handleLoadItem(item.id); }}><i className="fas fa-edit"></i></button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}><i className="fas fa-trash"></i></button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #7c3aed', paddingBottom: '14px', marginBottom: '16px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>তারিখ:</strong> {formatBanglaDate(formData.date)}</div>
                <div><strong>বিভাগ:</strong> {formData.department || '—'}</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>কর্মীদের সমস্যা ও পরামর্শ ফর্ম</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '16px' }}>
              Employee Issue & Suggestion Form
            </div>

            {/* Meta */}
            <div style={{ display: 'flex', gap: '24px', fontSize: '14px', lineHeight: 1.85, marginBottom: '16px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '8px', padding: '10px 14px' }}>
              <div><strong>নাম:</strong> {formData.employeeName || '(অপশনাল)'}</div>
              <div><strong>পদবী:</strong> {formData.designation || '—'}</div>
            </div>

            {/* Categories */}
            <div style={{ fontWeight: 800, fontSize: '14px', color: '#1e293b', borderLeft: '3px solid #7c3aed', paddingLeft: '10px', marginBottom: '8px' }}>
              ১. বিষয়ের ধরন নির্বাচন করুন (Select Category):
            </div>
            <div className="cat-grid">
              {categoryOptions.map((item) => (
                <div key={item.key} className={`cat-item${formData.categories[item.key] ? ' checked' : ''}`}>
                  <input type="checkbox" checked={Boolean(formData.categories[item.key])} readOnly style={{ width: '16px', height: '16px', margin: 0 }} />
                  <span>{item.icon} {item.label}</span>
                </div>
              ))}
            </div>

            {/* Sections */}
            <div style={{ marginTop: '18px', fontWeight: 800, fontSize: '14px', color: '#1e293b', borderLeft: '3px solid #7c3aed', paddingLeft: '10px', marginBottom: '8px' }}>
              ২. বর্তমান সমস্যা বা চ্যালেঞ্জের বিবরণ (Describe Issue):
            </div>
            <div className="answer-box">{formData.issueDescription || 'এখানে সমস্যার বিস্তারিত বিবরণ লিখুন...'}</div>

            <div style={{ marginTop: '18px', fontWeight: 800, fontSize: '14px', color: '#1e293b', borderLeft: '3px solid #7c3aed', paddingLeft: '10px', marginBottom: '8px' }}>
              ৩. সমস্যা সমাধানের প্রস্তাবিত পরামর্শ (Proposed Solution):
            </div>
            <div className="answer-box">{formData.suggestion || 'এখানে আপনার পরামর্শ লিখুন...'}</div>

            <div style={{ marginTop: '16px', padding: '10px 14px', background: '#faf5ff', borderRadius: '8px', fontSize: '13px', color: '#6d28d9', fontWeight: 600, fontStyle: 'italic' }}>
              💡 নোট: এটি একটি গোপনীয়/উন্মুক্ত মতামত ফর্ম। মিটিং শুরুর আগেই পূরণ করে নির্ধারিত বক্সে জমা দিন।
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

export default EmployeeIssueSuggestionForm;
