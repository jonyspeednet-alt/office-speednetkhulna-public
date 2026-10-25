import React, { useState, useMemo, useEffect } from 'react';
import moment from 'moment';
import 'moment/locale/bn';
import BrandLogo from '../components/BrandLogo';
import { saveMeetingMinutes, getMyMeetingMinutes, getMeetingMinutesById, updateMeetingMinutes, deleteMeetingMinutes, getNextMeetingMinutesNumbers } from '../services/meetingMinutesService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';
import { formatClockTime } from '../utils/formatters';

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const MonthlyAllEmployeeMeetingForm = () => {
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
    refNo: 'SNKHL/HR/MOM/' + moment().year() + '/01',
    meetingDate: moment().format('DD/MM/YYYY'),
    meetingTime: '10:30',
    venue: 'স্পিড নেট অফিস, সম্মেলন কক্ষ',
    chairperson: 'ব্যবস্থাপনা পরিচালক / HR প্রধান',
    attendees: '',
    absentees: '',
    agenda: '',
    perfSummary: '',
    challenges: '',
    nextPlan: '',
    recognition: '',
    qna: '',
    nextMeeting: '',
  });

  const [formData, setFormData] = useState(defaultForm);

  const [savedItems, setSavedItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Auto serial: running ref number for the current year (server count).
  const applyNextNumbers = async () => {
    try {
      const n = await getNextMeetingMinutesNumbers();
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

  // Native time input needs HH:MM; legacy values like "10:30 AM" are converted.
  const toTimeInput = (v) => {
    if (!v) return '';
    if (/^\d{2}:\d{2}$/.test(v)) return v;
    const m = moment(v, ['h:mm A', 'hh:mm A', 'H:mm'], true);
    return m.isValid() ? m.format('HH:mm') : '';
  };

  const handleReset = () => {
    setFormData(defaultForm());
    setEditingId(null);
    applyNextNumbers();
  };

  const handleSaveToServer = async () => {
    if (!formData.meetingDate?.trim()) {
      notify.error('Meeting date is required');
      return;
    }
    try {
      // No single employee for minutes — employee fields stay null.
      const payload = {
        employee_name: null,
        employee_id: null,
        ref_no: formData.refNo,
        form_data: formData,
      };
      if (editingId) {
        await updateMeetingMinutes(editingId, payload);
        setSaveMsg('Update successful!');
        notify.success('Update successful');
      } else {
        const saved = await saveMeetingMinutes(payload);
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
      const data = await getMyMeetingMinutes();
      setSavedItems(data);
      setShowEditModal(true);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load meeting minutes');
    }
  };

  const handleLoadItem = async (id) => {
    try {
      const item = await getMeetingMinutesById(id);
      if (item?.form_data) {
        const def = defaultForm();
        setFormData({ ...def, ...item.form_data });
        setEditingId(item.id);
        setShowEditModal(false);
        setSaveMsg('Minutes loaded — edit mode');
        notify.success('Minutes loaded');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load meeting minutes');
    }
  };

  const handleDeleteItem = async (id) => {
    if (!(await confirmAction({ title: 'Delete these meeting minutes?', danger: true }))) return;
    try {
      await deleteMeetingMinutes(id);
      setSavedItems(prev => prev.filter(c => c.id !== id));
      if (editingId === id) setEditingId(null);
      notify.success('Deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Delete failed');
    }
  };

  const handleNewItem = () => {
    setEditingId(null);
    setFormData(defaultForm());
    applyNextNumbers();
  };

  const formatBanglaDate = (value) => {
    if (!value) return '____ / ____ / ______';
    const parsed = moment(value, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
    if (!parsed.isValid()) return value;
    return parsed.locale('bn').format('D MMMM, YYYY [ইং]');
  };

  // Empty sections render with a muted draft placeholder on screen but are
  // hidden entirely in print (see .mom-empty rule) so placeholder text never
  // prints as real minutes.
  const Section = ({ num, title, content, placeholder }) => {
    const empty = !String(content || '').trim();
    return (
      <div className={`mom-section${empty ? ' mom-empty' : ''}`} style={{ marginTop: '18px' }}>
        <div style={{ fontWeight: 800, fontSize: '14px', color: '#1e293b', marginBottom: '8px', borderLeft: '3px solid #3b82f6', paddingLeft: '10px' }}>
          {num}. {title}
        </div>
        <div className={empty ? 'mom-placeholder' : ''} style={{ border: '1px solid #e2e8f0', minHeight: '80px', padding: '10px 12px', fontSize: '14px', lineHeight: 1.85, whiteSpace: 'pre-wrap', color: '#334155', borderRadius: '4px' }}>
          {content || placeholder}
        </div>
      </div>
    );
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to use Monthly Meeting Form. (Permission: appointment_letters.generate)</div>
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
          border-right: 3px solid #3b82f6;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 8px 12px; font-size: 11px; font-weight: 700; color: #60a5fa; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 4px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form textarea { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; resize: vertical; }
        .admin-sidebar-form input[type="date"], .admin-sidebar-form input[type="time"] { color-scheme: dark; }
        .preview-pane { flex: 1; padding: 24px; overflow-y: auto; background: #e2e8f0; }
        .letter-page {
          width: 210mm; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 16mm 20mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
        }
        .mom-placeholder { color: #94a3b8 !important; font-style: italic; }
        @media (max-width: 991.98px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { width: 100% !important; min-width: 0 !important; max-height: none !important; border-right: none !important; border-bottom: 3px solid #3b82f6; }
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
          .letter-page { box-shadow: none !important; border: none !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; min-height: auto !important; height: auto !important; display: block !important; overflow: visible !important; }
          .mom-empty { display: none !important; }
          .mom-meta, .mom-next { break-inside: avoid !important; page-break-inside: avoid !important; }
          @page { size: A4 portrait; margin: 12mm 12mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #172554 100%)', borderRadius: '8px', border: '1px solid #3b82f6' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-users text-primary me-2"></i>Monthly Meeting Form
          </h5>
        </div>
        <button className="btn btn-primary w-100 fw-bold mb-2 shadow-sm" onClick={() => window.print()}>
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
            <i className="fas fa-plus me-1"></i>New Minutes
          </button>
        )}
        {saveMsg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: '12px' }}>{saveMsg}</div>}
        <button className="btn btn-outline-light w-100 fw-bold mb-3 shadow-sm" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset
        </button>
        <div className="sec">
          <div className="sec-title">Meeting Info</div>
          <div className="sec-body">
            <label htmlFor="mom-ref">Reference No</label>
            <input id="mom-ref" name="refNo" value={formData.refNo} onChange={handleChange} />
            <label htmlFor="mom-date">Meeting Date</label>
            <input id="mom-date" type="date" name="meetingDate" value={toISODate(formData.meetingDate)} onChange={handleDateChange} />
            <label htmlFor="mom-time">Time</label>
            <input id="mom-time" type="time" name="meetingTime" value={toTimeInput(formData.meetingTime)} onChange={handleChange} />
            <label>Venue</label>
            <input name="venue" value={formData.venue} onChange={handleChange} />
            <label>Chairperson</label>
            <input name="chairperson" value={formData.chairperson} onChange={handleChange} />
            <label htmlFor="mom-attendees">Attendees (উপস্থিতি)</label>
            <textarea id="mom-attendees" name="attendees" value={formData.attendees} onChange={handleChange} rows={3} placeholder="Present members, one per line..." />
            <label htmlFor="mom-absentees">Absentees (অনুপস্থিতি)</label>
            <textarea id="mom-absentees" name="absentees" value={formData.absentees} onChange={handleChange} rows={3} placeholder="Absent members with reason..." />
            <label>1. Opening & Agenda</label>
            <textarea name="agenda" value={formData.agenda} onChange={handleChange} rows={4} placeholder="Opening remarks, introducing new staff..." />
            <label>2. Department Performance Update</label>
            <textarea name="perfSummary" value={formData.perfSummary} onChange={handleChange} rows={4} placeholder="Sales, NOC, accounts updates..." />
            <label>3. Issues & Challenges</label>
            <textarea name="challenges" value={formData.challenges} onChange={handleChange} rows={4} />
            <label>4. Next Month Plan</label>
            <textarea name="nextPlan" value={formData.nextPlan} onChange={handleChange} rows={4} />
            <label>5. Recognition & Awards</label>
            <textarea name="recognition" value={formData.recognition} onChange={handleChange} rows={3} />
            <label>6. Q&A and Suggestions</label>
            <textarea name="qna" value={formData.qna} onChange={handleChange} rows={3} />
            <label>Next Meeting</label>
            <input name="nextMeeting" value={formData.nextMeeting} onChange={handleChange} placeholder="Date and time" />
          </div>
        </div>
      </div>

      {showEditModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-edit me-2"></i>My Saved Meeting Minutes</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {savedItems.length === 0 ? (
                <p className="text-muted text-center py-4">No saved meeting minutes.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr><th>Ref No</th><th>Date</th><th>By</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {savedItems.map(item => (
                      <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => handleLoadItem(item.id)}>
                        <td>{item.ref_no || '-'}</td>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #3b82f6', paddingBottom: '14px', marginBottom: '14px' }}>
              <BrandLogo alt="Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
              <div style={{ textAlign: 'right', fontSize: '13px', color: '#475569', lineHeight: 1.8 }}>
                <div><strong>স্পিড নেট খুলনা</strong></div>
                <div>ইন্টারনেট সার্ভিস প্রোভাইডার</div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 800, color: '#1e293b' }}>মাসিক সর্বকর্মী সভা</div>
            <div style={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '14px' }}>
              Monthly All-Employee Meeting — Team Coordination & Performance Review
            </div>

            {/* Meta */}
            <div className="mom-meta" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', marginBottom: '8px' }}>
              <div><strong>সূত্র:</strong> {formData.refNo}</div>
              <div><strong>তারিখ:</strong> {formatBanglaDate(formData.meetingDate)}</div>
              <div><strong>সময়:</strong> {formatClockTime(formData.meetingTime) || formData.meetingTime}</div>
              <div><strong>স্থান:</strong> {formData.venue}</div>
              <div><strong>সভাপতি:</strong> {formData.chairperson}</div>
              {formData.attendees?.trim() ? <div style={{ gridColumn: '1 / -1', whiteSpace: 'pre-wrap' }}><strong>উপস্থিতি:</strong> {formData.attendees}</div> : null}
              {formData.absentees?.trim() ? <div style={{ gridColumn: '1 / -1', whiteSpace: 'pre-wrap' }}><strong>অনুপস্থিতি:</strong> {formData.absentees}</div> : null}
            </div>

            {/* Sections */}
            <Section num="১" title="উদ্বোধন ও আলোচ্যসূচি (৫–১০ মিনিট)" content={formData.agenda}
              placeholder={'• উদ্বোধনী বার্তা ও শুভেচ্ছা\n• নতুন কর্মীদের পরিচয়\n• মিটিংয়ের মূল বার্তা ও আলোচ্যসূচি সংক্ষেপ'} />
            <Section num="২" title="বিভাগীয় পারফরম্যান্স আপডেট (২০–২৫ মিনিট)" content={formData.perfSummary}
              placeholder={'• Sales/BDM: নতুন ক্লায়েন্ট, লক্ষ্য বনাম অর্জন\n• NOC: নেটওয়ার্ক স্ট্যাটাস, ডাউনটাইম\n• Accounts: বিলিং, কালেকশন\n• HR/Admin: নীতিমালা আপডেট'} />
            <Section num="৩" title="সমস্যা ও চ্যালেঞ্জ (১৫–২০ মিনিট)" content={formData.challenges}
              placeholder={'• কর্মীদের সমস্যা পর্যালোচনা\n• সমাধানের দায়িত্ব নির্ধারণ'} />
            <Section num="৪" title="পরবর্তী মাসের পরিকল্পনা (১০ মিনিট)" content={formData.nextPlan}
              placeholder={'• আগামী মাসের KPI ও লক্ষ্য\n• নতুন প্রকল্প বা নির্দেশনা'} />
            <Section num="৫" title="স্বীকৃতি ও পুরস্কার (১০ মিনিট)" content={formData.recognition}
              placeholder={'• মাসের সেরা কর্মী\n• বিশেষ অর্জন স্বীকৃতি'} />
            <Section num="৬" title="প্রশ্নোত্তর ও সমাপনী (১০ মিনিট)" content={formData.qna}
              placeholder={'• কর্মীদের প্রশ্ন ও পরামর্শ\n• সমাপনী বক্তব্য'} />

            {formData.nextMeeting?.trim() ? (
              <div className="mom-next" style={{ marginTop: '16px', fontSize: '14px', fontWeight: 700 }}>
                <strong>পরবর্তী মিটিং:</strong> {formData.nextMeeting}
              </div>
            ) : null}

            <div style={{ marginTop: 'auto', paddingTop: '16px', textAlign: 'center', fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #e2e8f0' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthlyAllEmployeeMeetingForm;
