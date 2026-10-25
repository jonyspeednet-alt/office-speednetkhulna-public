import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import moment from 'moment';
import { useSearchParams, Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { getResellers } from '../services/resellerService';
import { createPartnerOnboarding, getPartnerOnboardings, getPartnerOnboarding, updatePartnerOnboarding, deletePartnerOnboarding, updateOnboardingStatus, convertOnboardingToReseller } from '../services/partnerOnboardingService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const banglaNum = (n) => {
  const d = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(n).split('').map((c) => d[parseInt(c)] || c).join('');
};

const emptyRow = () => ({ name: '', mobile: '', comment: '' });

const genRefSuffix = () => String(Math.floor(100 + Math.random() * 900));
const defaultFormData = (user = {}) => ({
  partnerPhoto: '',
  refNumber: `SN-PO-${moment().format('YYYYMMDD')}-${genRefSuffix()}`,
  partnerUserId: '',
  partnerName: '',
  address: '',
  contactNumber: '',
  onboardingDate: moment().format('DD/MM/YYYY'),
  latitude: '',
  longitude: '',
  owners: [emptyRow(), emptyRow(), emptyRow()],
  partnerType: 'mac',
  revenueSharing: '50:50',
  agentCommissionPct: '',
  // MAC-specific
  macSoftwarePortal: false,
  macLoginCredential: false,
  macPaymentGateway: false,
  macPaymentMethod: 'gateway',
  macAdvancePayment: '',
  macAdvancePaymentAmount: '',
  macSecurityCheque: '',
  macChequeNo: '',
  macBankName: '',
  macBranch: '',
  macAccountHolder: '',
  macChequeAmount: '',
  macChequeVerification: '',
  macChequeVerifiedBy: '',
  macChequeVerificationDate: '',
  // Distribution-specific
  distIig: '',
  distGgc: '',
  distFna: '',
  distBdix: '',
  distCdn: '',
  distTotalCapacity: '',
  distNttn: '',
  distReqRate: '',
  distNewRate: '',
  distTotalAmount: '',
  distNttnProvider: '',
  distNttnLinkId: '',
  distNttnFid: '',
  distNttnCapacity: '',
  distNttnCost: '',
  distNttnPop: '',
  distNttnType: 'metro',
  distInstallStatus: 'pending',
  distNttnCostSharing: '50:50',
  distNttnCostSharingOther: '',
  distInstallDate: '',
  distAdvancePaymentAmount: '',
  distSecurityCheque: '',
  distChequeNo: '',
  distBankName: '',
  distBranch: '',
  distAccountHolder: '',
  distChequeAmount: '',
  distChequeVerification: '',
  distChequeVerifiedBy: '',
  distChequeVerificationDate: '',
  // Staff
  totalStaff: '',
  totalIdCard: '',
  staffListCollected: false,
  idCardIssued: false,
  nidCopyCollected: false,
  passportPhotoCollected: false,
  staffComment: '',
  staffMembers: [{ name: '', nid: '', mobile: '', designation: '' }],
  // Office/POP
  popDeclared: false,
  popAddress: '',
  popType: 'office',
  // Agreement
  agreementSpeedNet: false,
  agreementPartner: false,
  agreementComment: '',
  agreementDuration: '',
  agreementStartDate: '',
  agreementExpiryDate: '',
  // Customer History
  currentCustomers: '',
  previousIsp: '',
  previousNoc: 'pending',
  hasDue: false,
  dueAmount: '',
  duePaymentDays: '',
  duePaymentTerms: '',
  // Extra notes
  extraNotes: '',
  // Signatures
  partnerSignName: '',
  speednetSignName: user?.full_name || '',
  speednetSignDesignation: user?.role || 'Management Authority',
  signDate: moment().format('DD/MM/YYYY'),
  // Approvals — fixed assigned persons per spec 6-9
  approvals: [
    { stage: 'Verified By / Onboarding Officer', name: 'মোঃ সাব্বির হোসেন', signDate: '', status: 'pending' },
    { stage: 'Finance Verification', name: 'পূর্ণিমা মিস্ত্রী', signDate: '', status: 'pending' },
    { stage: 'Technical / NOC Verification', name: 'এস কে রাফাত উদ্দিন', signDate: '', status: 'pending' },
    { stage: 'Management Approval', name: 'শেখ আজমল হোসেন', signDate: '', status: 'pending' },
  ],
});

const PartnerOnboardingForm = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const [formData, setFormData] = useState(() => defaultFormData(user));
  const fileInputRef = useRef(null);

  const [partners, setPartners] = useState([]);
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');

  // DB onboarding persistence
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingStatus, setEditingStatus] = useState('draft');
  const [editingResellerId, setEditingResellerId] = useState(null);
  const [myOnboardings, setMyOnboardings] = useState([]);
  const [showMyModal, setShowMyModal] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  // One-time temp password — stays visible until dismissed / new form (never auto-hides)
  const [tempPasswordInfo, setTempPasswordInfo] = useState(null);
  const [searchParamsQ] = useSearchParams();
  // Deep-links apply once — never clobber the user's own edits afterwards
  const appliedPartnerTypeRef = useRef(false);
  const appliedResellerRef = useRef(false);
  const appliedOnboardingRef = useRef(false);

  // Honor ?partner_type=... from /add-reseller redirect or direct link (same value applies once)
  useEffect(() => {
    const raw = String(searchParamsQ.get('partner_type') || '').trim().toLowerCase();
    if (editingId || !raw || appliedPartnerTypeRef.current === raw) return;
    let mapped = null;
    if (['mac', 'mac_partner'].includes(raw)) mapped = 'mac';
    else if (['distribution', 'distribution_partner', 'dist'].includes(raw)) mapped = 'distribution';
    else if (['channel', 'channel_partner', 'chanel', 'chanel_partner'].includes(raw)) mapped = 'channel';
    if (mapped) {
      appliedPartnerTypeRef.current = raw;
      setFormData((prev) => (prev.partnerType === mapped ? prev : { ...prev, partnerType: mapped }));
    }
  }, [searchParamsQ, editingId]);

  useEffect(() => {
    let cancelled = false;
    const loadPartners = async () => {
      setPartnersLoading(true);
      try {
        const data = await getResellers('', { status: 'all' });
        if (!cancelled) setPartners(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPartners([]);
      } finally {
        if (!cancelled) setPartnersLoading(false);
      }
    };
    loadPartners();
    return () => { cancelled = true; };
  }, []);

  const mapPartnerType = (dbType) => {
    if (dbType === 'mac_partner') return 'mac';
    if (dbType === 'distribution_partner') return 'distribution';
    if (dbType === 'channel_partner') return 'channel';
    return 'mac';
  };

  const handlePartnerSelect = (e) => {
    const value = e.target.value;
    setSelectedPartnerId(value);
    if (value === 'new') {
      setFormData((prev) => ({ ...prev, partnerUserId: '', partnerName: '', contactNumber: '', address: '' }));
      return;
    }
    const partner = partners.find((p) => p.reseller_code === value || String(p.id) === String(value));
    if (!partner) return;
    const joinDate = partner.joining_date || partner.created_at;
    setFormData((prev) => ({
      ...prev,
      partnerUserId: partner.reseller_code || String(partner.id),
      partnerName: partner.name || '',
      contactNumber: partner.contact_number || '',
      address: partner.address || '',
      partnerType: mapPartnerType(partner.partner_type),
      onboardingDate: joinDate ? moment(joinDate).format('DD/MM/YYYY') : prev.onboardingDate,
    }));
  };

  const filteredPartners = useMemo(() => {
    const term = partnerSearch.trim().toLowerCase();
    if (!term) return partners;
    return partners.filter((p) =>
      String(p.id).includes(term) ||
      (p.reseller_code || '').toLowerCase().includes(term) ||
      (p.name || '').toLowerCase().includes(term) ||
      (p.contact_number || '').includes(term)
    );
  }, [partners, partnerSearch]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('owner_')) {
      const parts = name.split('_');
      const idx = parseInt(parts[1]);
      const field = parts[2];
      setFormData((prev) => {
        const owners = [...prev.owners];
        owners[idx] = { ...owners[idx], [field]: type === 'checkbox' ? checked : value };
        return { ...prev, owners };
      });
      return;
    }
    if (name.startsWith('approval_')) {
      const parts = name.split('_');
      const idx = parseInt(parts[1]);
      const field = parts[2];
      setFormData((prev) => {
        const approvals = [...prev.approvals];
        approvals[idx] = { ...approvals[idx], [field]: value };
        return { ...prev, approvals };
      });
      return;
    }
    if (name.startsWith('staffmember_')) {
      const parts = name.split('_');
      const idx = parseInt(parts[1]);
      const field = parts[2];
      setFormData((prev) => {
        const members = [...prev.staffMembers];
        members[idx] = { ...members[idx], [field]: value };
        return { ...prev, staffMembers: members };
      });
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify.error('Image must be under 2MB.');
      e.target.value = '';
      return;
    }
    if (file.type && !file.type.startsWith('image/')) {
      notify.error('Please upload an image file only');
      e.target.value = '';
      return;
    }
    setPendingPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFormData((prev) => ({ ...prev, partnerPhoto: ev.target.result }));
    };
    reader.onerror = () => notify.error('Failed to read image');
    reader.readAsDataURL(file);
  };

  const handleReset = () => {
    setFormData(defaultFormData(user));
    setSelectedPartnerId('');
    setPartnerSearch('');
    setPendingPhotoFile(null);
    setTempPasswordInfo(null);
    setEditingId(null);
    setEditingStatus('draft');
    setEditingResellerId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleResetConfirm = async () => {
    if (!(await confirmAction({ title: 'Reset form? All unsaved changes will be lost', danger: true }))) return;
    handleReset();
  };

  const saveMsgTimerRef = useRef(null);
  const submittingRef = useRef(false);
  const showTempMsg = useCallback((msg, isError = false) => {
    if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current);
    setSaveMsg(msg);
    if (isError) {
      notify.error(msg);
      // Errors show at the top — bring the sidebar back into view
      try { document.querySelector('.admin-sidebar-form')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch(_) {}
    }
    else if (msg) notify.success(msg);
    saveMsgTimerRef.current = setTimeout(() => setSaveMsg(''), 4000);
  }, []);
  useEffect(() => () => { if (saveMsgTimerRef.current) clearTimeout(saveMsgTimerRef.current); }, []);

  const handleSave = async (targetStatus = 'draft') => {
    if (!formData.partnerName || !String(formData.partnerName).trim()) {
      showTempMsg('Partner name is required', true);
      return;
    }
    // Agent commission — invalid is invalid even in drafts (never persist garbage %)
    const commRaw = String(formData.agentCommissionPct ?? '').trim();
    if (commRaw !== '' && !/^\d+(\.\d{1,2})?$/.test(commRaw.replace(/%/g, '').trim())) {
      showTempMsg('Agent Commission must be a number (e.g. 5 or 7.5)', true);
      return;
    }
    if (commRaw !== '') {
      const commNum = parseFloat(commRaw.replace(/%/g, '').trim());
      if (isNaN(commNum) || commNum < 0 || commNum > 100) { showTempMsg('Agent Commission must be between 0 and 100', true); return; }
    }
    if (targetStatus !== 'draft') {
      if (!String(formData.contactNumber || '').trim()) { showTempMsg('Contact number is required', true); return; }
      if (!String(formData.address || '').trim()) { showTempMsg('Address is required', true); return; }
      if (formData.partnerType === 'distribution' && !String(formData.distNttnProvider || formData.distNttnLinkId || '').trim()) {
        // soft warning, not block
        notify.info('NTTN Provider/Link ID is empty — you can add it later');
      }
      if (formData.latitude && isNaN(parseFloat(formData.latitude))) { showTempMsg('Please enter a valid Latitude', true); return; }
      if (formData.longitude && isNaN(parseFloat(formData.longitude))) { showTempMsg('Please enter a valid Longitude', true); return; }
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      // S1: editing approved should not downgrade to draft
      let effectiveStatus = targetStatus;
      if (editingId && editingStatus !== 'draft' && targetStatus === 'draft') {
        effectiveStatus = editingStatus; // keep approved etc.
      }
      const payload = { ...formData, status: effectiveStatus };
      // Avoid sending huge base64 when file will be uploaded separately — backend will use file path
      if (pendingPhotoFile && payload.partnerPhoto && String(payload.partnerPhoto).startsWith('data:')) {
        delete payload.partnerPhoto;
      }
      // Preserve refNumber for updates
      let result;
      if (editingId) {
        result = await updatePartnerOnboarding(editingId, payload, pendingPhotoFile);
        if (result.reseller_id) showTempMsg('Update successful — Reseller #' + result.reseller_id + ' sync');
        else showTempMsg(effectiveStatus === 'submitted' ? 'Submitted successfully — reseller pending' : 'Update successful');
      } else {
        result = await createPartnerOnboarding(payload, pendingPhotoFile);
        setEditingId(result.id);
        if (result.reseller_created || result.reseller_id) {
          if (result.tempPassword) {
            setTempPasswordInfo({ password: result.tempPassword, resellerId: result.reseller_id, resellerCode: result.reseller_code });
          }
          showTempMsg(`✓ Partner created — Reseller #${result.reseller_id} (${result.reseller_code}) — Pending, view in reseller list${result.tempPassword ? ' — TEMP PASSWORD shown below (copy now, shown once)' : ''}`);
        } else if (targetStatus === 'draft') {
          showTempMsg('Draft saved — reseller not yet created, click "Save & Create Partner"');
        } else {
          showTempMsg('Saved successfully — stored in database');
        }
      }
      setEditingStatus(result.status || effectiveStatus || targetStatus);
      setEditingResellerId(result.reseller_id || result.resellerId || null);
      setPendingPhotoFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Refresh list if modal data loaded
      if (myOnboardings.length) {
        try { const data = await getPartnerOnboardings({ limit: 100 }); setMyOnboardings(data.rows || data || []); } catch(_){}
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Save failed';
      showTempMsg(msg, true);
    } finally { submittingRef.current = false; setSaving(false); }
  };

  const handleLoadMy = async () => {
    try {
      const data = await getPartnerOnboardings({ limit: 50 });
      setMyOnboardings(data.rows || data || []);
      setShowMyModal(true);
    } catch (err) {
      showTempMsg(err?.response?.data?.message || 'Load failed', true);
    }
  };

  const handleLoadOne = useCallback(async (id) => {
    try {
      const row = await getPartnerOnboarding(id);
      const fd = row.form_data || {};
      const photoFallback = fd.partnerPhoto || fd.partner_photo || fd._uploadedPhotoPath || row.photo_path || '';
      // Preserve persisted ref — old/migrated rows may not have refNumber inside form_data
      const loadedRef = fd.refNumber || fd.ref_number || row.ref_number || defaultFormData(user).refNumber;
      setFormData({ ...defaultFormData(user), ...fd, refNumber: loadedRef, partnerPhoto: photoFallback });
      setEditingId(row.id);
      setEditingStatus(row.status || 'draft');
      setEditingResellerId(row.reseller_id || null);
      setSelectedPartnerId(row.reseller_id ? String(row.reseller_code || row.reseller_id) : '');
      setPendingPhotoFile(null);
      setTempPasswordInfo(null);
      setShowMyModal(false);
      showTempMsg('Loaded — edit mode');
    } catch (err) {
      showTempMsg('Load failed', true);
    }
  }, [showTempMsg, user]);

  const handleDeleteOne = async (id) => {
    if (!(await confirmAction({ title: 'Delete this onboarding?', danger: true }))) return;
    try {
      await deletePartnerOnboarding(id);
      setMyOnboardings((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) { handleReset(); }
      notify.success('Deleted successfully');
      showTempMsg('Deleted successfully');
    } catch (err) { const m = err?.response?.data?.message || 'Failed to delete'; notify.error(m); showTempMsg(m, true); }
  };

  const handleStatusChange = async (newStatus) => {
    if (!editingId) { showTempMsg('Please save first', true); return; }
    if (newStatus === 'approved' && !(await confirmAction({ title: 'Approve? Reseller will become Active', danger: false }))) return;
    if (newStatus === 'rejected' && !(await confirmAction({ title: 'Reject? Reseller will become Suspended', danger: true }))) return;
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateOnboardingStatus(editingId, newStatus);
      setEditingStatus(updated.status || newStatus);
      if (updated.reseller_status) notify.info(`Reseller is now ${updated.reseller_status}`);
      notify.success(`Status updated to ${newStatus}`);
      showTempMsg(`Status updated to ${newStatus}`);
    } catch (err) { const m = err?.response?.data?.message || 'Failed to update status'; notify.error(m); showTempMsg(m, true); }
    finally { setSaving(false); }
  };

  const handleConvert = async () => {
    if (!editingId) { showTempMsg('Please save first', true); return; }
    if (!(await confirmAction({ title: 'Create a new Partner from this onboarding?', text: 'A new row will be created in the resellers table', danger: true }))) return;
    setSaving(true);
    try {
      const res = await convertOnboardingToReseller(editingId);
      if (res.tempPassword) {
        setTempPasswordInfo({ password: res.tempPassword, resellerId: res.reseller_id, resellerCode: res.reseller_code });
      }
      notify.success(`Partner created — Reseller #${res.reseller_id}${res.tempPassword ? ' — temp password shown below (copy now)' : ''}`);
      showTempMsg(`Partner created successfully — ID ${res.reseller_id} (${res.reseller_code})${res.tempPassword ? ' — TEMP PASSWORD shown below (copy now, shown once)' : ''}`);
      setEditingStatus('converted');
      setEditingResellerId(res.reseller_id || null);
      try {
        const data = await getResellers('', { status: 'all' });
        if (Array.isArray(data)) setPartners(data);
      } catch(_){}
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Conversion failed';
      notify.error(msg);
      showTempMsg(msg, true);
    } finally { setSaving(false); }
  };

  // Deep-link: ?onboarding_id=XX auto-load, ?reseller_id=YY pre-select (same value applies once)
  useEffect(() => {
    const oid = searchParamsQ.get('onboarding_id');
    if (oid && !editingId && appliedOnboardingRef.current !== oid) {
      appliedOnboardingRef.current = oid;
      handleLoadOne(oid);
    }
    const rid = searchParamsQ.get('reseller_id');
    if (rid && !editingId && !oid && appliedResellerRef.current !== rid) {
      appliedResellerRef.current = rid;
      setSelectedPartnerId(String(rid));
      // If partners already loaded, try to autofill
      const p = partners.find((x) => String(x.id) === String(rid) || String(x.reseller_code) === String(rid));
      if (p) {
        const joinDate = p.joining_date || p.created_at;
        setFormData((prev) => ({
          ...prev,
          partnerUserId: p.reseller_code || String(p.id),
          partnerName: p.name || prev.partnerName,
          contactNumber: p.contact_number || p.phone || prev.contactNumber,
          address: p.address || p.pop_location || prev.address,
          partnerType: mapPartnerType(p.partner_type) || prev.partnerType,
          onboardingDate: joinDate ? moment(joinDate).format('DD/MM/YYYY') : prev.onboardingDate,
        }));
      }
    }
  }, [editingId, handleLoadOne, searchParamsQ, partners]);

  const isMac = formData.partnerType === 'mac';
  const isDist = formData.partnerType === 'distribution';
  const isChannel = formData.partnerType === 'channel';

  const FieldRow = ({ label, value }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '8px', fontSize: '13px', lineHeight: 1.7 }}>
      <span style={{ fontWeight: 700, minWidth: '220px', color: '#1e293b', flexShrink: 0 }}>{label}</span>
      <span style={{ borderBottom: '1px solid #94a3b8', flex: 1, paddingBottom: '2px', color: '#334155', minHeight: '18px' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="appointment-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#f4f6f9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        .admin-sidebar-form {
          flex: 0 0 540px; width: 540px; min-width: 540px; max-width: 540px; flex-shrink: 0;
          background: #0d1f3c; color: #e0e8f5;
          padding: 14px 16px; overflow-y: auto; overflow-x: hidden; max-height: calc(100vh - 70px);
          border-right: 3px solid #6366f1;
        }
        .admin-sidebar-form .sec { background: rgba(22,45,80,0.6); border: 1px solid #2a4a7a; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
        .admin-sidebar-form .sec-title { background: #162d50; padding: 7px 12px; font-size: 10px; font-weight: 700; color: #a5b4fc; text-transform: uppercase; border-bottom: 1px solid #2a4a7a; }
        .admin-sidebar-form .sec-body { padding: 10px; }
        .admin-sidebar-form label { font-size: 10px; color: #8ab0d8; text-transform: uppercase; font-weight: 600; margin-bottom: 3px; display: block; }
        .admin-sidebar-form input, .admin-sidebar-form select, .admin-sidebar-form textarea { width: 100%; background: #162d50; border: 1px solid #2a4a7a; border-radius: 4px; color: #fff; padding: 6px 10px; font-size: 12px; margin-bottom: 7px; box-sizing: border-box; }
        .admin-sidebar-form select option { background: #162d50; color: #fff; }
        .admin-sidebar-form textarea { resize: vertical; min-height: 50px; }
        .admin-sidebar-form .chk-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; color: #e0e8f5; }
        .admin-sidebar-form .chk-row input[type="checkbox"] { width: 14px; height: 14px; margin: 0; }
        .admin-sidebar-form .photo-upload-area {
          display: flex; flex-direction: row; align-items: center; gap: 12px;
          border: 2px dashed #2a4a7a; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
          cursor: pointer; transition: border-color 0.2s;
        }
        .admin-sidebar-form .photo-upload-area:hover { border-color: #6366f1; }
        .admin-sidebar-form .photo-upload-area img { width: 50px; height: 60px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
        .admin-sidebar-form .photo-upload-area .upload-hint { font-size: 10px; color: #8ab0d8; margin-top: 0; line-height: 1.5; }
        .po-sticky-bar { position: sticky; bottom: 0; background: #0d1f3c; padding: 10px 0 6px; border-top: 1px solid #2a4a7a; margin-top: 4px; z-index: 5; }
        .preview-pane { flex: 1 1 auto; min-width: 0; padding: 12px; overflow-y: auto; overflow-x: auto; background: #e2e8f0; display: flex; justify-content: center; align-items: flex-start; }
        .letter-page {
          width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto; background: #ffffff;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 12mm 16mm; box-sizing: border-box;
          font-family: 'Hind Siliguri', 'Inter', sans-serif; color: #1e293b;
          position: relative; display: flex; flex-direction: column;
          flex-shrink: 0;
        }
        .section-heading {
          font-weight: 800; color: #4f46e5;
          border-left: 3px solid #6366f1; padding-left: 10px;
          margin: 14px 0 8px; font-size: 13px; letter-spacing: 0.5px;
        }
        .data-table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 12px; }
        .data-table th, .data-table td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
        .data-table th { background: #f1f5f9; font-weight: 700; color: #334155; font-size: 11px; }
        .data-table td { color: #1e293b; }
        .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 20px; }
        .sig-box { text-align: center; font-size: 12px; }
        .sig-line { border-bottom: 1.5px solid #1e293b; height: 50px; width: 100%; margin-bottom: 6px; }
        .audit-note { background: #fefce8; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; margin-top: 14px; font-size: 11px; color: #854d0e; }
        .audit-note ul { padding-left: 16px; margin: 4px 0 0; }
        .audit-note li { margin-bottom: 2px; }
        .approval-table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 12px; }
        .approval-table th, .approval-table td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
        .approval-table th { background: #f1f5f9; font-weight: 700; color: #334155; font-size: 10px; }
        .passport-photo-box {
          width: 35mm; height: 45mm; border: 1.5px solid #64748b; border-radius: 2px;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          background: #f8fafc; flex-shrink: 0;
        }
        .passport-photo-box img { width: 100%; height: 100%; object-fit: cover; }
        .passport-photo-box .placeholder { font-size: 9px; color: #94a3b8; text-align: center; line-height: 1.4; }
        .po-hdr-left { background: #1a3a6b; width: 22%; padding: 8px 10px; vertical-align: middle; text-align: center; }
        .po-hdr-center { background: #1a3a6b; padding: 8px 6px; vertical-align: middle; text-align: center; }
        .po-hdr-right { background: #c0392b; width: 19%; padding: 8px 10px; vertical-align: middle; text-align: center; }
        .po-hdr-co-bn { font-size: 13.5pt; font-weight: 800; color: #fff; display: block; line-height: 1.4; }
        .po-hdr-co-addr { font-size: 9pt; color: #fff; display: block; line-height: 1.4; }
        .po-hdr-title { font-size: 12.5pt; font-weight: 700; color: #fff; display: block; line-height: 1.3; }
        .po-hdr-title-en { font-size: 8pt; color: #fff; display: block; line-height: 1.4; letter-spacing: 0.5px; }
        .po-hdr-rule { height: 0; border: 0; border-top: 5px solid #c0392b; margin: 0 0 5px; }
        .po-ref-bar { background: #d6e4f7; margin: 5px 0 10px; }
        .po-ref-bar td { padding: 4px 10px; font-size: 10.5pt; color: #1a3a6b; font-weight: 600; }
        @media screen and (max-width: 1400px) {
          .admin-sidebar-form { flex-basis: 480px; width: 480px; min-width: 480px; max-width: 480px; }
        }
        @media screen and (max-width: 1200px) {
          .admin-sidebar-form { flex-basis: 400px; width: 400px; min-width: 360px; max-width: 400px; }
          .preview-pane { padding: 8px; }
          .letter-page { zoom: 0.9; }
        }
        @media screen and (max-width: 992px) {
          .preview-pane { padding: 8px; }
          .letter-page { zoom: 0.75; }
        }
        @media screen and (max-width: 768px) {
          .appointment-generator-wrapper { flex-direction: column !important; }
          .admin-sidebar-form { flex: none; width: 100%; min-width: 0; max-width: none; max-height: none; border-right: 0; border-bottom: 3px solid #6366f1; }
          .preview-pane { padding: 6px; }
          .letter-page { zoom: 0.65; padding: 8mm 8mm; }
        }
        @media print {
          body { background: white !important; padding: 0 !important; }
          .admin-sidebar-form, .no-print { display: none !important; }
          .preview-pane { padding: 0 !important; background: transparent !important; }
          .letter-page { box-shadow: none !important; border: none !important; width: 100% !important; margin: 0 !important; padding: 8mm 12mm !important; }
          @page { size: A4 portrait; margin: 6mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* ═══════ SIDEBAR ═══════ */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)', borderRadius: '8px', border: '1px solid #6366f1' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px' }}>
            <i className="fas fa-handshake me-2" style={{ color: '#a5b4fc' }}></i>Partner Onboarding Form
          </h5>
          <div style={{ fontSize: '10px', color: '#a5b4fc' }}>MAC / Distribution / Channel Partner</div>
        </div>
        <button className="btn w-100 fw-bold mb-3 shadow-sm" style={{ background: '#6366f1', color: '#fff' }} onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save PDF
        </button>

        {/* DB save/load — new backend wired */}
        <div className="sec" style={{ borderLeft: '3px solid #f59e0b' }}>
          <div className="sec-title" style={{ color: '#fde68a' }}><i className="fas fa-cloud-arrow-up me-1"></i>DB / Backend {editingId ? `— #${editingId} [${editingStatus}]` : ''}</div>
          <div className="sec-body">
            {editingId && (
              <div style={{ fontSize: '11px', background: editingStatus === 'converted' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.12)', border: `1px solid ${editingStatus === 'converted' ? '#22c55e' : '#f59e0b'}`, borderRadius: '4px', padding: '6px 8px', marginBottom: '8px', color: editingStatus === 'converted' ? '#86efac' : '#fde68a' }}>
                <i className={`fas ${editingStatus === 'converted' ? 'fa-circle-check' : 'fa-pen-to-square'} me-1`}></i>
                {editingStatus === 'converted' ? 'Converted — reseller has been created' : `Edit mode — ID ${editingId} (${editingStatus})`}
                {editingId && <button onClick={handleResetConfirm} style={{ float: 'right', background: 'none', border: 'none', color: '#fff', fontSize: '10px', cursor: 'pointer' }}>New Form</button>}
              </div>
            )}
            {editingResellerId && (
              <div style={{ marginBottom: '8px' }}>
                <Link to={`/reseller-profile/${editingResellerId}`} className="btn btn-sm btn-outline-success w-100">
                  <i className="fas fa-external-link-alt me-1"></i>View Reseller Profile #{editingResellerId}
                </Link>
              </div>
            )}
            {saveMsg && (
              <div style={{ fontSize: '11px', background: '#1e3a5f', border: '1px solid #38bdf8', borderRadius: '4px', padding: '6px 8px', marginBottom: '8px', color: '#bae6fd' }}>{saveMsg}</div>
            )}
            {tempPasswordInfo && (
              <div style={{ fontSize: '12px', background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', borderRadius: '4px', padding: '8px', marginBottom: '8px', color: '#bbf7d0' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                  <i className="fas fa-key me-1"></i>TEMP PASSWORD — Reseller #{tempPasswordInfo.resellerId} ({tempPasswordInfo.resellerCode})
                </div>
                <div className="d-flex align-items-center gap-2">
                  <code style={{ flex: 1, background: '#052e16', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '13px', wordBreak: 'break-all' }}>{tempPasswordInfo.password}</code>
                  <button
                    className="btn btn-sm btn-outline-success"
                    onClick={() => { try { navigator.clipboard.writeText(tempPasswordInfo.password); notify.success('Password copied'); } catch(_) { notify.error('Copy failed — select manually'); } }}
                  >
                    <i className="fas fa-copy me-1"></i>Copy
                  </button>
                  <button className="btn btn-sm btn-outline-light" onClick={() => setTempPasswordInfo(null)} title="Dismiss — password will not be shown again">
                    <i className="fas fa-times"></i>
                  </button>
                </div>
                <div style={{ fontSize: '10px', color: '#86efac', marginTop: '4px' }}>Shown once — copy now. Dismissing hides it forever.</div>
              </div>
            )}
            {/* S1 simple: save vs create — editing approved shows single Update */}
            <div className="d-flex gap-2 mb-2">
              {editingId && editingStatus !== 'draft' ? (
                <button className="btn btn-sm flex-fill fw-bold" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', color: '#fff' }} onClick={() => handleSave(editingStatus)} disabled={saving} title="Update info — reseller will be synced">
                  {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-save me-1"></i>}Update
                </button>
              ) : (
                <>
                  <button className="btn btn-sm flex-fill fw-bold" style={{ background: '#475569', color: '#fff', border: '1px solid #64748b' }} onClick={() => handleSave('draft')} disabled={saving} title="Draft — no reseller will be created">
                    {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-save me-1"></i>}{editingId ? 'Update Draft' : 'Save Draft'}
                  </button>
                  <button className="btn btn-sm flex-fill fw-bold" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff' }} onClick={() => handleSave('submitted')} disabled={saving} title="Saving will create a reseller — will appear in reseller list">
                    {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-user-plus me-1"></i>}{editingId ? 'Submit & Create Partner' : 'Save & Create Partner'}
                  </button>
                </>
              )}
            </div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '8px', lineHeight: 1.4 }}>
              <i className="fas fa-info-circle me-1"></i>Draft = no reseller will be created. <b>Save & Create Partner</b> will immediately appear in <code>reseller-list</code> as <span style={{ color: '#fde68a' }}>Inactive (Pending)</span>, and will become <span style={{ color: '#86efac' }}>Active</span> after approval.
            </div>
            <div className="d-flex gap-2 mb-2">
              <button className="btn btn-sm btn-outline-light flex-fill" onClick={handleLoadMy} style={{ fontSize: '11px' }}>
                <i className="fas fa-folder-open me-1"></i>My Onboardings
              </button>
            </div>
            {/* Retry path: submitted but reseller was never created (e.g. old rows) */}
            {editingId && !editingResellerId && editingStatus !== 'draft' && (
              <div className="mb-2">
                <button className="btn btn-sm btn-outline-warning w-100" onClick={handleConvert} disabled={saving} style={{ fontSize: '11px' }} title="No reseller linked yet — create one now">
                  <i className="fas fa-user-plus me-1"></i>Create Partner Now (no reseller linked)
                </button>
              </div>
            )}
            {/* Approval — only show when reseller already exists (S1 flow) */}
            {editingId && editingResellerId && (
              <div style={{ borderTop: '1px solid #2a4a7a', paddingTop: '8px', marginTop: '4px' }}>
                <div style={{ fontSize: '10px', color: '#a5b4fc', marginBottom: '6px', fontWeight: 700 }}>Approval (Approval Chain)</div>
                <div style={{ fontSize: '11px', color: editingStatus === 'approved' ? '#86efac' : '#fde68a', marginBottom: '6px' }}>
                  <i className={`fas ${editingStatus === 'approved' ? 'fa-check-circle' : 'fa-clock'} me-1`}></i>Status: <b>{editingStatus}</b> {editingResellerId ? `· Reseller #${editingResellerId}` : ''}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm flex-fill fw-bold" style={{ background: editingStatus === 'approved' ? '#14532d' : '#22c55e', color: '#fff', opacity: editingStatus === 'approved' ? 0.7 : 1 }} onClick={() => handleStatusChange('approved')} disabled={saving || editingStatus === 'approved'}>
                    <i className="fas fa-check me-1"></i>{editingStatus === 'approved' ? 'Approved' : 'Approve'}
                  </button>
                  <button className="btn btn-sm btn-outline-warning flex-fill" onClick={() => handleStatusChange('rejected')} disabled={saving} style={{ fontSize: '11px' }}>
                    Reject
                  </button>
                </div>
                {editingStatus !== 'approved' && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px' }}>Approving will make the reseller <b>Active</b>, rejecting will make it <b>Suspended</b>.</div>}
              </div>
            )}
          </div>
        </div>

        {/* Existing partner select — still maps to resellers for linking */}
        <div className="sec" style={{ borderLeft: '3px solid #22c55e' }}>
          <div className="sec-title" style={{ color: '#86efac' }}>
            <i className="fas fa-database me-1"></i>Select Existing Partner
          </div>
          <div className="sec-body">
            <label>Search (Name / ID / Phone)</label>
            <input
              value={partnerSearch}
              onChange={(e) => setPartnerSearch(e.target.value)}
              placeholder="Search partner..."
            />
            <label>Partner List {partnersLoading ? '(Loading...)' : `(${filteredPartners.length})`}</label>
            <select value={selectedPartnerId} onChange={handlePartnerSelect}>
              <option value="">-- Select --</option>
              <option value="new">➕ New Partner (manual entry)</option>
              {filteredPartners.map((p) => (
                <option key={p.id} value={p.reseller_code || String(p.id)}>
                  {p.reseller_code || `#${p.id}`} — {p.name} ({p.partner_type === 'mac_partner' ? 'MAC' : p.partner_type === 'channel_partner' ? 'Channel' : 'Distribution'})
                </option>
              ))}
            </select>
            {selectedPartnerId && selectedPartnerId !== 'new' && (
              <div style={{ fontSize: '11px', color: '#86efac', background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', borderRadius: '4px', padding: '6px 8px' }}>
                <i className="fas fa-check-circle me-1"></i>
                Partner #{selectedPartnerId} info auto-filled
              </div>
            )}
          </div>
        </div>

        {(() => {
          let sNum = 0;
          const S = (label) => { sNum += 1; return `${banglaNum(sNum)}. ${label}`; };

          return <>
            {/* General info + photo */}
            <div className="sec">
              <div className="sec-title">{S('General Information')}</div>
              <div className="sec-body">
                <label>Partner Photo (Passport Size)</label>
                <div
                  className="photo-upload-area"
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                >
                  {formData.partnerPhoto ? (
                    <img src={formData.partnerPhoto} alt="Partner" />
                  ) : (
                    <div style={{ width: '50px', height: '60px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed #475569', borderRadius: '4px' }}>
                      <i className="fas fa-camera" style={{ fontSize: '16px', color: '#475569' }}></i>
                    </div>
                  )}
                  <div className="upload-hint">
                    {formData.partnerPhoto ? 'Photo added — click to change' : 'Click to upload photo'}
                    <br />(max 2MB)
                    {formData.partnerPhoto && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setFormData((prev) => ({ ...prev, partnerPhoto: '' })); setPendingPhotoFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setFormData((prev) => ({ ...prev, partnerPhoto: '' })); setPendingPhotoFile(null); } }}
                        style={{ display: 'inline-block', marginLeft: '8px', color: '#f87171', cursor: 'pointer', fontWeight: 700 }}
                      >
                        <i className="fas fa-trash-alt me-1"></i>Remove
                      </span>
                    )}
                  </div>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoUpload} />
                <label>Ref Number</label>
                <input name="refNumber" value={formData.refNumber} onChange={handleChange} />
                <label>Partner Code (User ID)</label>
                <input name="partnerUserId" value={formData.partnerUserId} onChange={handleChange} placeholder="e.g. SN-KHL-D2D-B17-Molla" />
                <label>Partner Name <span style={{ color: '#f87171' }}>*</span></label>
                <input name="partnerName" value={formData.partnerName} onChange={handleChange} />
                <label>Address <span style={{ color: '#f87171' }}>*</span></label>
                <input name="address" value={formData.address} onChange={handleChange} />
                <label>Contact Number <span style={{ color: '#f87171' }}>*</span></label>
                <input name="contactNumber" value={formData.contactNumber} onChange={handleChange} />
                <label>Onboarding Date</label>
                <input name="onboardingDate" value={formData.onboardingDate} onChange={handleChange} />
                <label>Latitude</label>
                <input name="latitude" value={formData.latitude} onChange={handleChange} placeholder="e.g. 22.8456" />
                <label>Longitude</label>
                <input name="longitude" value={formData.longitude} onChange={handleChange} placeholder="e.g. 89.5403" />
              </div>
            </div>

            {/* Owners */}
            <div className="sec">
              <div className="sec-title">{S('Ownership Information')}</div>
              <div className="sec-body">
                {formData.owners.map((o, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #2a4a7a' }}>
                    <div>
                      <label>Name</label>
                      <input name={`owner_${i}_name`} value={o.name} onChange={handleChange} />
                    </div>
                    <div>
                      <label>Mobile</label>
                      <input name={`owner_${i}_mobile`} value={o.mobile} onChange={handleChange} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label>Comment</label>
                      <input name={`owner_${i}_comment`} value={o.comment} onChange={handleChange} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Partner type */}
            <div className="sec">
              <div className="sec-title">{S('Partner Type')}</div>
              <div className="sec-body">
                <label>Select Partner Type</label>
                <select name="partnerType" value={formData.partnerType} onChange={handleChange}>
                  <option value="mac">MAC Partner</option>
                  <option value="distribution">Distribution Partner</option>
                  <option value="channel">Channel Partner</option>
                </select>
              </div>
            </div>

            {/* Revenue sharing + Agent Commission — Agent Commission for all 3 types */}
            <div className="sec">
              <div className="sec-title">{S('Revenue / Package Price Sharing')}</div>
              <div className="sec-body">
                {!isDist && (
                  <>
                    <label>Sharing Ratio (Speed Net : Partner)</label>
                    <select name="revenueSharing" value={formData.revenueSharing} onChange={handleChange}>
                      <option value="50:50">50 : 50</option>
                      <option value="45:55">45 : 55</option>
                      <option value="40:60">40 : 60</option>
                      <option value="35:65">35 : 65</option>
                    </select>
                  </>
                )}
                <label>Agent Commission %</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    name="agentCommissionPct"
                    value={formData.agentCommissionPct ?? ''}
                    onChange={handleChange}
                    placeholder="e.g. 5"
                    inputMode="decimal"
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '13px', color: '#e0e8f5', fontWeight: 700 }}>%</span>
                </div>
              </div>
            </div>

            {/* MAC-specific (conditional) */}
            {isMac && (
              <div className="sec" style={{ borderLeft: '3px solid #22d3ee' }}>
                <div className="sec-title" style={{ color: '#22d3ee' }}>{S('For MAC Partner')}</div>
                <div className="sec-body">
                  <div className="chk-row">
                    <input type="checkbox" name="macSoftwarePortal" checked={formData.macSoftwarePortal} onChange={handleChange} />
                    <span>Provide Software Portal</span>
                  </div>
                  <div className="chk-row">
                    <input type="checkbox" name="macLoginCredential" checked={formData.macLoginCredential} onChange={handleChange} />
                    <span>Transfer Login Credentials</span>
                  </div>
                  <div className="chk-row">
                    <input type="checkbox" name="macPaymentGateway" checked={formData.macPaymentGateway} onChange={handleChange} />
                    <span>Use Payment Gateway</span>
                  </div>
                  <label>Payment Method</label>
                  <select name="macPaymentMethod" value={formData.macPaymentMethod} onChange={handleChange}>
                    <option value="gateway">Payment Gateway</option>
                    <option value="monthly">Monthly Bill (by the 15th)</option>
                    <option value="extended">20th/25th (conditional)</option>
                  </select>
                  {formData.macPaymentMethod === 'extended' && (
                    <>
                      <label>Advance Payment / Security Cheque</label>
                      <select name="macAdvancePayment" value={formData.macAdvancePayment} onChange={handleChange}>
                        <option value="">-- Select --</option>
                        <option value="advance">Advance Payment</option>
                        <option value="cheque">Security Cheque</option>
                      </select>
                    </>
                  )}
                  <label>Advance Payment Amount (if applicable)</label>
                  <input name="macAdvancePaymentAmount" value={formData.macAdvancePaymentAmount} onChange={handleChange} placeholder="Advance Payment Amount" />
                  <label>Security Cheque Received</label>
                  <div className="chk-row">
                    <input type="radio" name="macSecurityCheque" value="yes" checked={formData.macSecurityCheque === 'yes'} onChange={handleChange} />
                    <span>Yes</span>
                    <input type="radio" name="macSecurityCheque" value="not_applicable" checked={formData.macSecurityCheque === 'not_applicable'} onChange={handleChange} />
                    <span>Not Applicable</span>
                  </div>
                  <label>Cheque No.</label>
                  <input name="macChequeNo" value={formData.macChequeNo} onChange={handleChange} placeholder="Cheque No." />
                  <label>Bank Name</label>
                  <input name="macBankName" value={formData.macBankName} onChange={handleChange} placeholder="Bank Name" />
                  <label>Branch</label>
                  <input name="macBranch" value={formData.macBranch} onChange={handleChange} placeholder="Branch" />
                  <label>Account Holder Name</label>
                  <input name="macAccountHolder" value={formData.macAccountHolder} onChange={handleChange} placeholder="Account Holder" />
                  <label>Cheque Amount (if applicable)</label>
                  <input name="macChequeAmount" value={formData.macChequeAmount} onChange={handleChange} placeholder="Cheque Amount" />
                  <div style={{ fontSize: '10px', color: '#8ab0d8', fontStyle: 'italic', margin: '4px 0 6px' }}>Note: If a security/blank cheque is received, its purpose and terms of use must be stated in a separate written authorization/agreement clause.</div>
                  <label>Cheque Verification Status</label>
                  <div className="chk-row">
                    <input type="radio" name="macChequeVerification" value="verified" checked={formData.macChequeVerification === 'verified'} onChange={handleChange} />
                    <span>Verified (Yes)</span>
                    <input type="radio" name="macChequeVerification" value="not_verified" checked={formData.macChequeVerification === 'not_verified'} onChange={handleChange} />
                    <span>Not Verified (No)</span>
                  </div>
                  <label>Verified By</label>
                  <input name="macChequeVerifiedBy" value={formData.macChequeVerifiedBy} onChange={handleChange} placeholder="Verified By" />
                  <label>Verification Date</label>
                  <input name="macChequeVerificationDate" value={formData.macChequeVerificationDate} onChange={handleChange} placeholder="YYYY-MM-DD" />
                </div>
              </div>
            )}

            {/* Channel Partner-specific: Mandatory Payment Security */}
            {isChannel && (
              <div className="sec" style={{ borderLeft: '3px solid #22d3ee' }}>
                <div className="sec-title" style={{ color: '#22d3ee' }}>{S('Mandatory Payment Security')}</div>
                <div className="sec-body">
                  <label>Security Cheque Received</label>
                  <div className="chk-row">
                    <input type="radio" name="macSecurityCheque" value="yes" checked={formData.macSecurityCheque === 'yes'} onChange={handleChange} />
                    <span>Yes</span>
                    <input type="radio" name="macSecurityCheque" value="pending" checked={formData.macSecurityCheque === 'pending'} onChange={handleChange} />
                    <span>Pending (onboarding/service activation will not complete until the security cheque is received)</span>
                  </div>
                  <label>Cheque No.</label>
                  <input name="macChequeNo" value={formData.macChequeNo} onChange={handleChange} />
                  <label>Bank Name</label>
                  <input name="macBankName" value={formData.macBankName} onChange={handleChange} />
                  <label>Branch</label>
                  <input name="macBranch" value={formData.macBranch} onChange={handleChange} />
                  <label>Account Holder Name</label>
                  <input name="macAccountHolder" value={formData.macAccountHolder} onChange={handleChange} />
                  <label>Cheque Amount (if applicable)</label>
                  <input name="macChequeAmount" value={formData.macChequeAmount} onChange={handleChange} />
                  <label>Cheque Verification Status</label>
                  <div className="chk-row">
                    <input type="radio" name="macChequeVerification" value="verified" checked={formData.macChequeVerification === 'verified'} onChange={handleChange} />
                    <span>Verified (Yes)</span>
                    <input type="radio" name="macChequeVerification" value="not_verified" checked={formData.macChequeVerification === 'not_verified'} onChange={handleChange} />
                    <span>Not Verified (No)</span>
                  </div>
                  <label>Verified By</label>
                  <input name="macChequeVerifiedBy" value={formData.macChequeVerifiedBy} onChange={handleChange} placeholder="Name" />
                  <label>Verification Date</label>
                  <input name="macChequeVerificationDate" value={formData.macChequeVerificationDate} onChange={handleChange} placeholder="YYYY-MM-DD" />
                </div>
              </div>
            )}

            {/* Distribution-specific (conditional) */}
            {isDist && (
              <div className="sec" style={{ borderLeft: '3px solid #22d3ee' }}>
                <div className="sec-title" style={{ color: '#22d3ee' }}>{S('For Distribution Partner')}</div>
                <div className="sec-body">
                  <label style={{ color: '#22d3ee' }}>Distribution Requirement (Mbps)</label>
                  <input name="distIig" value={formData.distIig} onChange={handleChange} placeholder="IIG Required (Mbps)" />
                  <input name="distGgc" value={formData.distGgc} onChange={handleChange} placeholder="GGC Required (Mbps)" />
                  <input name="distFna" value={formData.distFna} onChange={handleChange} placeholder="FNA Required (Mbps)" />
                  <input name="distBdix" value={formData.distBdix} onChange={handleChange} placeholder="BDIX Required (Mbps)" />
                  <input name="distCdn" value={formData.distCdn} onChange={handleChange} placeholder="CDN Required (Mbps)" />
                  <input name="distNttn" value={formData.distNttn} onChange={handleChange} placeholder="NTTN (Mbps)" />
                  <input name="distTotalCapacity" value={formData.distTotalCapacity} onChange={handleChange} placeholder="Total Required Capacity (Mbps)" />
                  <input name="distTotalAmount" value={formData.distTotalAmount} onChange={handleChange} placeholder="Total Amount (Taka)" />
                  <label style={{ color: '#22d3ee', marginTop: '6px' }}>Rate</label>
                  <input name="distReqRate" value={formData.distReqRate} onChange={handleChange} placeholder="Rate" />
                  <label style={{ color: '#22d3ee', marginTop: '2px' }}>New Rate</label>
                  <input name="distNewRate" value={formData.distNewRate} onChange={handleChange} placeholder="New Rate" />
                  <label style={{ color: '#22d3ee', marginTop: '6px' }}>NTTN Information</label>
                  <input name="distNttnProvider" value={formData.distNttnProvider} onChange={handleChange} placeholder="NTTN Provider Name" />
                  <input name="distNttnLinkId" value={formData.distNttnLinkId} onChange={handleChange} placeholder="Link ID / Circuit ID" />
                  <input name="distNttnFid" value={formData.distNttnFid} onChange={handleChange} placeholder="FID / Feasibility ID" />
                  <input name="distNttnCapacity" value={formData.distNttnCapacity} onChange={handleChange} placeholder="NTTN Capacity (Mbps)" />
                  <input name="distNttnCost" value={formData.distNttnCost} onChange={handleChange} placeholder="NTTN Cost (Monthly, VAT Inc.)" />
                  <input name="distNttnPop" value={formData.distNttnPop} onChange={handleChange} placeholder="NTTN POP / Endpoint" />
                  <label>NTTN Type</label>
                  <select name="distNttnType" value={formData.distNttnType} onChange={handleChange}>
                    <option value="metro">Metro</option>
                    <option value="d2d">D2D</option>
                    <option value="longhaul">Longhaul</option>
                  </select>
                  <label>Installation Status</label>
                  <select name="distInstallStatus" value={formData.distInstallStatus} onChange={handleChange}>
                    <option value="pending">Pending</option>
                    <option value="feasibility">Feasibility Received</option>
                    <option value="work-order">Work Order Issued</option>
                    <option value="installed">Installed</option>
                    <option value="activated">Activated</option>
                  </select>
                  <label>NTTN Cost Sharing (Speed Net : Partner)</label>
                  <select name="distNttnCostSharing" value={formData.distNttnCostSharing} onChange={handleChange}>
                    <option value="50:50">50 : 50</option>
                    <option value="partner">Partner Bear</option>
                    <option value="speednet">Speed Net Bear</option>
                    <option value="other">Other</option>
                  </select>
                  {formData.distNttnCostSharing === 'other' && (
                    <input name="distNttnCostSharingOther" value={formData.distNttnCostSharingOther} onChange={handleChange} placeholder="Other: __________" />
                  )}
                  <input name="distInstallDate" value={formData.distInstallDate} onChange={handleChange} placeholder="Installation / Activation Date" />
                  <label style={{ color: '#22d3ee', marginTop: '6px' }}>4.3 Mandatory Payment Security</label>
                  <label>Advance Payment Amount</label>
                  <input name="distAdvancePaymentAmount" value={formData.distAdvancePaymentAmount} onChange={handleChange} placeholder="Advance Payment Amount" />
                  <label>Security Cheque Received</label>
                  <div className="chk-row">
                    <input type="radio" name="distSecurityCheque" value="yes" checked={formData.distSecurityCheque === 'yes'} onChange={handleChange} />
                    <span>Yes</span>
                    <input type="radio" name="distSecurityCheque" value="pending" checked={formData.distSecurityCheque === 'pending'} onChange={handleChange} />
                    <span>Pending</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#8ab0d8', marginBottom: '6px' }}>Security cheque receipt is mandatory for distribution partners. (No activation while pending.)</div>
                  <label>Cheque No.</label>
                  <input name="distChequeNo" value={formData.distChequeNo} onChange={handleChange} placeholder="Cheque No." />
                  <label>Bank Name</label>
                  <input name="distBankName" value={formData.distBankName} onChange={handleChange} placeholder="Bank Name" />
                  <label>Branch</label>
                  <input name="distBranch" value={formData.distBranch} onChange={handleChange} placeholder="Branch" />
                  <label>Account Holder Name</label>
                  <input name="distAccountHolder" value={formData.distAccountHolder} onChange={handleChange} placeholder="Account Holder" />
                  <label>Cheque Amount (if applicable)</label>
                  <input name="distChequeAmount" value={formData.distChequeAmount} onChange={handleChange} placeholder="Cheque Amount" />
                  <label>Cheque Verification Status</label>
                  <div className="chk-row">
                    <input type="radio" name="distChequeVerification" value="verified" checked={formData.distChequeVerification === 'verified'} onChange={handleChange} />
                    <span>Verified (Yes)</span>
                    <input type="radio" name="distChequeVerification" value="not_verified" checked={formData.distChequeVerification === 'not_verified'} onChange={handleChange} />
                    <span>Not Verified (No)</span>
                  </div>
                  <label>Verified By</label>
                  <input name="distChequeVerifiedBy" value={formData.distChequeVerifiedBy} onChange={handleChange} placeholder="Verified By" />
                  <label>Verification Date</label>
                  <input name="distChequeVerificationDate" value={formData.distChequeVerificationDate} onChange={handleChange} placeholder="YYYY-MM-DD" />
                </div>
              </div>
            )}

            {/* Staff */}
            {/* Staff — hidden for Channel Partner (spec 6-9 replaces 6-9) */}
            {!isChannel && (
            <div className="sec">
              <div className="sec-title">{S('Staff Information')}</div>
              <div className="sec-body">
                <label>Total Staff Count</label>
                <input name="totalStaff" value={formData.totalStaff} onChange={handleChange} />
                <label>Total ID Cards Issued</label>
                <input name="totalIdCard" value={formData.totalIdCard} onChange={handleChange} />
                <div className="chk-row">
                  <input type="checkbox" name="staffListCollected" checked={formData.staffListCollected} onChange={handleChange} />
                  <span>Staff list collected</span>
                </div>
                <div className="chk-row">
                  <input type="checkbox" name="idCardIssued" checked={formData.idCardIssued} onChange={handleChange} />
                  <span>Required ID cards issued</span>
                </div>
                <div className="chk-row">
                  <input type="checkbox" name="nidCopyCollected" checked={formData.nidCopyCollected} onChange={handleChange} />
                  <span>Staff NID copies collected</span>
                </div>
                <div className="chk-row">
                  <input type="checkbox" name="passportPhotoCollected" checked={formData.passportPhotoCollected} onChange={handleChange} />
                  <span>Staff passport photos collected</span>
                </div>
                <label>Comment</label>
                <input name="staffComment" value={formData.staffComment} onChange={handleChange} />

                {/* Dynamic staff member list */}
                <div style={{ marginTop: '8px', borderTop: '1px solid #2a4a7a', paddingTop: '8px' }}>
                  <label style={{ color: '#a5b4fc' }}>Staff Details</label>
                  {formData.staffMembers.map((m, i) => (
                    <div key={i} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #2a4a7a' }}>
                      {formData.staffMembers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, staffMembers: prev.staffMembers.filter((_, idx) => idx !== i) }))}
                          style={{ position: 'absolute', top: 0, right: 0, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '11px', padding: '0 2px' }}
                          title="Remove"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                      <div>
                        <label>Name</label>
                        <input name={`staffmember_${i}_name`} value={m.name} onChange={handleChange} placeholder="Employee Name" />
                      </div>
                      <div>
                        <label>NID</label>
                        <input name={`staffmember_${i}_nid`} value={m.nid} onChange={handleChange} placeholder="NID Number" />
                      </div>
                      <div>
                        <label>Mobile</label>
                        <input name={`staffmember_${i}_mobile`} value={m.mobile} onChange={handleChange} placeholder="Mobile Number" />
                      </div>
                      <div>
                        <label>Designation</label>
                        <input name={`staffmember_${i}_designation`} value={m.designation} onChange={handleChange} placeholder="Designation / Position" />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, staffMembers: [...prev.staffMembers, { name: '', nid: '', mobile: '', designation: '' }] }))}
                    style={{ width: '100%', padding: '6px', border: '2px dashed #2a4a7a', borderRadius: '4px', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                  >
                    <i className="fas fa-plus me-1"></i> Add Another Staff Member
                  </button>
                </div>
              </div>
            </div>
            )}

            {/* Office/POP — hidden for Channel Partner (spec 6-9 replaces 6-9) */}
            {!isChannel && (
            <div className="sec">
              <div className="sec-title">{S('Office / POP Declaration')}</div>
              <div className="sec-body">
                <div className="chk-row">
                  <input type="checkbox" name="popDeclared" checked={formData.popDeclared} onChange={handleChange} />
                  <span>Declaration Completed</span>
                </div>
                <label>Office / POP Address</label>
                <input name="popAddress" value={formData.popAddress} onChange={handleChange} />
                <label>POP Type</label>
                <select name="popType" value={formData.popType} onChange={handleChange}>
                  <option value="office">Office POP</option>
                  <option value="distribution">Distribution POP</option>
                  <option value="both">Both</option>
                </select>
              </div>
            </div>
            )}

            {/* Agreement — 2 rows for Distribution, 1 for others */}
            <div className="sec">
              <div className="sec-title">{S('Agreement')}</div>
              <div className="sec-body">
                <div className="chk-row">
                  <input type="checkbox" name="agreementSpeedNet" checked={formData.agreementSpeedNet} onChange={handleChange} />
                  <span>Agreement with Speed Net (Done / Not Done)</span>
                </div>
                {!isChannel && (
                <div className="chk-row">
                  <input type="checkbox" name="agreementPartner" checked={formData.agreementPartner} onChange={handleChange} />
                  <span>Agreement with partner office/landlord (Done / Not Done)</span>
                </div>
                )}
                <label>Comment</label>
                <input name="agreementComment" value={formData.agreementComment} onChange={handleChange} placeholder="Comment" />
                <label>Agreement Duration (Years)</label>
                <input name="agreementDuration" value={formData.agreementDuration} onChange={handleChange} />
                <label>Agreement Start Date</label>
                <input name="agreementStartDate" value={formData.agreementStartDate} onChange={handleChange} placeholder="DD/MM/YYYY" />
                <label>Agreement Expiry Date</label>
                <input name="agreementExpiryDate" value={formData.agreementExpiryDate} onChange={handleChange} placeholder="DD/MM/YYYY" />
              </div>
            </div>

            {/* Customer history — hidden for Channel Partner */}
            {!isChannel && (
            <div className="sec">
              <div className="sec-title">{S('Customer & Previous History')}</div>
              <div className="sec-body">
                <label>Current Total Customers</label>
                <input name="currentCustomers" value={formData.currentCustomers} onChange={handleChange} />
                <label>Previously Associated ISP</label>
                <input name="previousIsp" value={formData.previousIsp} onChange={handleChange} />
                <label>Previous ISP NOC</label>
                <select name="previousNoc" value={formData.previousNoc} onChange={handleChange}>
                  <option value="pending">Not Received</option>
                  <option value="received">Received</option>
                  <option value="na">N/A</option>
                </select>
                <div className="chk-row">
                  <input type="checkbox" name="hasDue" checked={formData.hasDue} onChange={handleChange} />
                  <span>Has Due</span>
                </div>
                {formData.hasDue && (
                  <>
                    <input name="dueAmount" value={formData.dueAmount} onChange={handleChange} placeholder="Due Amount" />
                    <input name="duePaymentDays" value={formData.duePaymentDays} onChange={handleChange} placeholder="Payment Deadline (days)" />
                    <input name="duePaymentTerms" value={formData.duePaymentTerms} onChange={handleChange} placeholder="Payment Method / Terms" />
                  </>
                )}
              </div>
            </div>
            )}

            {/* Extra notes */}
            <div className="sec">
              <div className="sec-title">{S('Additional Information / Notes')}</div>
              <div className="sec-body">
                <textarea name="extraNotes" value={formData.extraNotes} onChange={handleChange} rows={3} />
              </div>
            </div>

            {/* Signatures */}
            <div className="sec">
              <div className="sec-title">{S('Signatures')}</div>
              <div className="sec-body">
                <label>Partner Name</label>
                <input name="partnerSignName" value={formData.partnerSignName} onChange={handleChange} />
                <label>Speed Net Representative Name</label>
                <input name="speednetSignName" value={formData.speednetSignName} onChange={handleChange} />
                <label>Speed Net Representative Designation</label>
                <input name="speednetSignDesignation" value={formData.speednetSignDesignation} onChange={handleChange} />
                <label>Date</label>
                <input name="signDate" value={formData.signDate} onChange={handleChange} />
              </div>
            </div>

            {/* Approvals */}
            <div className="sec">
              <div className="sec-title">{S('Internal Verification & Approval')}</div>
              <div className="sec-body">
                {formData.approvals.map((a, i) => (
                  <div key={i} style={{ marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #2a4a7a' }}>
                    <div style={{ fontSize: '10px', color: '#a5b4fc', fontWeight: 700, marginBottom: '4px' }}>{a.stage}</div>
                    <input name={`approval_${i}_name`} value={a.name} onChange={handleChange} placeholder="Name / Designation" style={{ marginBottom: '3px' }} />
                    <input name={`approval_${i}_signDate`} value={a.signDate} onChange={handleChange} placeholder="Signature & Date" style={{ marginBottom: '3px' }} />
                    <select name={`approval_${i}_status`} value={a.status} onChange={handleChange}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Sticky save bar — always visible while scrolling */}
            <div className="po-sticky-bar">
              <div className="d-flex gap-2">
                {editingId && editingStatus !== 'draft' ? (
                  <button className="btn btn-sm flex-fill fw-bold" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', color: '#fff' }} onClick={() => handleSave(editingStatus)} disabled={saving}>
                    {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-save me-1"></i>}Update
                  </button>
                ) : (
                  <>
                    <button className="btn btn-sm flex-fill fw-bold" style={{ background: '#475569', color: '#fff', border: '1px solid #64748b' }} onClick={() => handleSave('draft')} disabled={saving}>
                      {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-save me-1"></i>}{editingId ? 'Update Draft' : 'Save Draft'}
                    </button>
                    <button className="btn btn-sm flex-fill fw-bold" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff' }} onClick={() => handleSave('submitted')} disabled={saving}>
                      {saving ? <i className="fas fa-spinner fa-spin me-1"></i> : <i className="fas fa-user-plus me-1"></i>}{editingId ? 'Submit & Create' : 'Save & Create'}
                    </button>
                  </>
                )}
              </div>
              <button onClick={handleResetConfirm} style={{ width: '100%', background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer', padding: '6px 0 2px' }}>
                <i className="fas fa-undo me-1"></i>Reset form
              </button>
            </div>
          </>;
        })()}
      </div>

      {/* My Onboardings Modal */}
      {showMyModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowMyModal(false)}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '92%', maxWidth: '720px', maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="d-flex justify-content-between align-items-center p-3" style={{ background: '#0d1f3c', color: '#fff' }}>
              <h6 className="m-0 fw-bold"><i className="fas fa-folder-open me-2"></i>My Onboarding Forms</h6>
              <button className="btn btn-sm btn-outline-light" onClick={() => setShowMyModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              {(!myOnboardings || myOnboardings.length === 0) ? (
                <p className="text-muted text-center py-4">No saved onboardings found.</p>
              ) : (
                <table className="table table-hover table-sm mb-0" style={{ fontSize: '12px' }}>
                  <thead><tr><th>Ref</th><th>Name</th><th>Type</th><th>Status</th><th>Date</th><th></th></tr></thead>
                  <tbody>
                    {myOnboardings.map((row) => (
                      <tr key={row.id}>
                        <td>{row.ref_number}</td>
                        <td>{row.partner_name}</td>
                        <td>{row.partner_type}</td>
                        <td><span className={`badge ${row.status === 'converted' ? 'bg-success' : row.status === 'approved' ? 'bg-primary' : row.status === 'rejected' ? 'bg-danger' : 'bg-secondary'}`}>{row.status}</span></td>
                        <td title={row.onboarding_date ? `Onboarding: ${new Date(row.onboarding_date).toLocaleDateString('en-GB')} | Saved: ${row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : '-'}` : ''}>{row.onboarding_date ? new Date(row.onboarding_date).toLocaleDateString('en-GB') : (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : '-')}</td>
                        <td className="d-flex gap-1">
                          <button className="btn btn-sm btn-outline-primary py-0" onClick={() => handleLoadOne(row.id)}><i className="fas fa-edit"></i> Load</button>
                          {row.reseller_id && (
                            <Link to={`/reseller-profile/${row.reseller_id}`} className="btn btn-sm btn-outline-success py-0" onClick={() => setShowMyModal(false)}>
                              <i className="fas fa-external-link-alt"></i>
                            </Link>
                          )}
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={() => handleDeleteOne(row.id)}><i className="fas fa-trash"></i></button>
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

      {/* ═══════ PREVIEW ═══════ */}
      <div className="preview-pane">
        <div className="letter-page">
          <BrandLogo alt="watermark" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '400px', opacity: '0.04', zIndex: 0, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header — Official Letterhead */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td className="po-hdr-left">
                    <img
                      src="/speednet_logo.webp?v=20260912"
                      alt="Speed Net"
                      onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                      style={{ height: '62px', maxWidth: '100%', objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
                    />
                    <div style={{ display: 'none', color: '#fff', fontWeight: 800, fontSize: '15px', lineHeight: 1.2 }}>
                      Speed Net<br />
                      <span style={{ fontSize: '10px', fontWeight: 600, opacity: 0.85 }}>Khulna</span>
                    </div>
                  </td>
                  <td className="po-hdr-center">
                    <span className="po-hdr-co-bn">স্পিড নেট - ইন্টারনেট সার্ভিস প্রোভাইডার</span>
                    <span className="po-hdr-co-addr">৮৩/৩, গগন বাবু রোড, খুলনা। প্রথম ও দ্বিতীয় তলা।</span>
                    <span className="po-hdr-co-addr">info@speednetkhulna.com | www.speednetkhulna.com</span>
                  </td>
                  <td className="po-hdr-right">
                    <span className="po-hdr-title">পার্টনার অনবোর্ডিং</span>
                    <span className="po-hdr-title-en">PARTNER</span>
                    <span className="po-hdr-title-en">ONBOARDING FORM</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <hr className="po-hdr-rule" />

            {/* Ref bar */}
            <table className="po-ref-bar" style={{ width: '100%' }}>
              <tbody>
                <tr>
                  <td>Partner ID: {formData.partnerUserId || '______________'}</td>
                  <td style={{ textAlign: 'right' }}>তারিখ: {formData.onboardingDate}</td>
                </tr>
              </tbody>
            </table>

            {/* Title */}
            <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 800, color: '#1e293b' }}>পার্টনার অনবোর্ডিং ফর্ম</div>
            <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: '#c0392b', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
              (MAC Partner, Distribution Partner & Channel Partner)
            </div>

            {(() => {
              let pNum = 0;
              const P = (label) => { pNum += 1; return `${banglaNum(pNum)}. ${label}`; };

              return <>
                {/* General */}
                <div className="section-heading">{P('পার্টনার সম্পর্কিত সাধারণ তথ্য')}</div>
                <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FieldRow label="পার্টনার আইডি (User ID):" value={formData.partnerUserId || '____________________________________________'} />
                    <FieldRow label="পার্টনার নাম:" value={formData.partnerName || '____________________________________________'} />
                    <FieldRow label="ঠিকানা:" value={formData.address || '____________________________________________'} />
                    <FieldRow label="কন্টাক্ট নম্বর:" value={formData.contactNumber || '____________________________________________'} />
                    <FieldRow label="অনবোর্ডিং তারিখ:" value={formData.onboardingDate} />
                    <FieldRow label="Latitude / Longitude:" value={(formData.latitude || formData.longitude) ? `${formData.latitude} / ${formData.longitude}` : '____________________________________________'} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div className="passport-photo-box">
                      {formData.partnerPhoto ? (
                        <img src={formData.partnerPhoto} alt="Partner" />
                      ) : (
                        <div className="placeholder">
                          <i className="fas fa-user" style={{ fontSize: '20px', display: 'block', marginBottom: '3px' }}></i>
                          পাসপোর্ট<br />সাইজ ছবি<br />(৩৫×৪৫ মিমি)
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '9px', color: '#64748b', textAlign: 'center' }}>অনবোর্ডকৃত পার্টনারের ছবি</div>
                  </div>
                </div>

                {/* Owners */}
                <div className="section-heading">{P('পার্টনার / মালিকানা তথ্য')}</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>পার্টনারের নাম</th>
                      <th>মোবাইল নম্বর</th>
                      <th>মন্তব্য</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.owners.map((o, i) => (
                      <tr key={i}>
                        <td>{o.name || '________________________'}</td>
                        <td>{o.mobile || '________________________'}</td>
                        <td>{o.comment || '________________________'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Partner type */}
                <div className="section-heading">{P('পার্টনারের ধরন')}</div>
                <div style={{ fontSize: '13px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 700 }}>নির্বাচিত:</span>{' '}
                  {formData.partnerType === 'mac' && '☑ MAC Partner      ☐ Distribution Partner      ☐ Channel Partner'}
                  {formData.partnerType === 'distribution' && '☐ MAC Partner      ☑ Distribution Partner      ☐ Channel Partner'}
                  {formData.partnerType === 'channel' && '☐ MAC Partner      ☐ Distribution Partner      ☑ Channel Partner'}
                </div>

                {/* Revenue sharing + Agent Commission — Agent Commission for all 3 types */}
                <div className="section-heading">{P('Revenue / Package Price Sharing')}</div>
                {!isDist && (
                  <div style={{ fontSize: '13px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700 }}>Revenue / Package Price Sharing (Speed Net : Partner):</span>{' '}
                    {formData.revenueSharing === '50:50' && '☑ 50:50     ☐ 45:55     ☐ 40:60     ☐ 35:65'}
                    {formData.revenueSharing === '45:55' && '☐ 50:50     ☑ 45:55     ☐ 40:60     ☐ 35:65'}
                    {formData.revenueSharing === '40:60' && '☐ 50:50     ☐ 45:55     ☑ 40:60     ☐ 35:65'}
                    {formData.revenueSharing === '35:65' && '☐ 50:50     ☐ 45:55     ☐ 40:60     ☑ 35:65'}
                  </div>
                )}
                <div style={{ fontSize: '13px', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 700 }}>Agent Commission:</span>{' '}
                  {formData.agentCommissionPct ? `${formData.agentCommissionPct} %` : '_____ %'}
                </div>

                {/* MAC-specific — ৫. MAC Partner-এর জন্য প্রযোজ্য */}
                {isMac && (
                  <>
                    <div className="section-heading">{P('MAC Partner-এর জন্য প্রযোজ্য')}</div>
                    <table className="data-table">
                      <thead>
                        <tr><th>বিষয়</th><th>Yes</th><th>No</th><th>মন্তব্য</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Speed Net Software Portal প্রদান করা হয়েছে</td>
                          <td style={{ textAlign: 'center' }}>{formData.macSoftwarePortal ? '☑' : '☐'}</td>
                          <td style={{ textAlign: 'center' }}>{!formData.macSoftwarePortal ? '☑' : '☐'}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>Portal Login Credential হস্তান্তর করা হয়েছে</td>
                          <td style={{ textAlign: 'center' }}>{formData.macLoginCredential ? '☑' : '☐'}</td>
                          <td style={{ textAlign: 'center' }}>{!formData.macLoginCredential ? '☑' : '☐'}</td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>Speed Net Payment Gateway ব্যবহার করবে</td>
                          <td style={{ textAlign: 'center' }}>{formData.macPaymentGateway ? '☑' : '☐'}</td>
                          <td style={{ textAlign: 'center' }}>{!formData.macPaymentGateway ? '☑' : '☐'}</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>

                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#4f46e5', marginTop: '8px', marginBottom: '4px' }}>MAC Partner Payment Policy</div>
                    <ul style={{ fontSize: '12px', paddingLeft: '18px', margin: '0 0 6px', lineHeight: 1.8, color: '#334155' }}>
                      <li>Speed Net Payment Gateway ব্যবহার করলে নির্ধারিত Settlement Policy প্রযোজ্য হবে।</li>
                      <li>Payment Gateway ব্যবহার না করলে মাসিক বিল প্রতি মাসের ১৫ তারিখের মধ্যে পরিশোধ করতে হবে।</li>
                      <li>২০/২৫ তারিখে Payment সুবিধা চাইলে নিচের যেকোনো একটি শর্ত পূরণ করতে হবে:</li>
                    </ul>
                    <div style={{ fontSize: '12px', paddingLeft: '12px', color: '#334155', marginBottom: '6px' }}>
                      {formData.macAdvancePayment === 'advance' ? '☑' : '☐'} এক মাসের মোট Customer Bill-এর সমপরিমাণ Advance Payment
                      <span style={{ margin: '0 8px' }}>অথবা</span>
                      {formData.macAdvancePayment === 'cheque' ? '☑' : '☐'} Security Cheque
                    </div>
                    <FieldRow label="Advance Payment Amount (যদি প্রযোজ্য):" value={formData.macAdvancePaymentAmount ? `Tk. ${formData.macAdvancePaymentAmount}` : '______________________________________'} />
                    <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                      Security Cheque Received: <strong>{formData.macSecurityCheque === 'yes' || formData.macSecurityCheque === true ? '☑ Yes     ☐ Not Applicable' : formData.macSecurityCheque === 'not_applicable' ? '☐ Yes     ☑ Not Applicable' : formData.macSecurityCheque ? '☑ Yes     ☐ Not Applicable' : '☐ Yes     ☑ Not Applicable'}</strong>
                    </div>
                    <FieldRow label="Cheque No.:" value={formData.macChequeNo || '______________________'} />
                    <FieldRow label="Bank Name:" value={formData.macBankName || '______________________'} />
                    <FieldRow label="Branch:" value={formData.macBranch || '______________________'} />
                    <FieldRow label="Account Holder Name:" value={formData.macAccountHolder || '______________________'} />
                    <FieldRow label="Cheque Amount (if applicable):" value={formData.macChequeAmount || '______________________'} />
                    <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginTop: '4px' }}>
                      Note: Security/Blank Cheque গ্রহণ করা হলে এর উদ্দেশ্য ও ব্যবহারের শর্ত পৃথক লিখিত Authorization/Agreement Clause-এ উল্লেখ থাকতে হবে।
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '8px', marginBottom: '4px' }}>
                      Cheque Verification Status: <strong>{formData.macChequeVerification === 'verified' ? '☑ Verified (Yes)     ☐ Not Verified (No)' : formData.macChequeVerification === 'not_verified' ? '☐ Verified (Yes)     ☑ Not Verified (No)' : '☐ Verified (Yes)     ☐ Not Verified (No)'}</strong>
                    </div>
                    <FieldRow label="Verified By:" value={formData.macChequeVerifiedBy || '______________________'} />
                    <FieldRow label="Verification Date:" value={formData.macChequeVerificationDate || '______________________'} />
                  </>
                )}

                {/* Channel Partner: Mandatory Payment Security */}
                {isChannel && (
                  <>
                    <div className="section-heading">{P('Mandatory Payment Security')}</div>
                    <div style={{ fontSize: '12px', marginBottom: '6px' }}>
                      Security Cheque Received: <strong>{formData.macSecurityCheque === 'yes' ? '☑ Yes     ☐ Pending' : formData.macSecurityCheque === 'pending' ? '☐ Yes     ☑ Pending' : '☐ Yes     ☐ Pending'}</strong>
                      <span style={{ color: '#64748b', fontSize: '11px' }}> (Security Cheque গ্রহণ না হওয়া পর্যন্ত Onboarding/Service Activation সম্পন্ন হবে না)</span>
                    </div>
                    <FieldRow label="Cheque No.:" value={formData.macChequeNo || '______________________'} />
                    <FieldRow label="Bank Name:" value={formData.macBankName || '______________________'} />
                    <FieldRow label="Branch:" value={formData.macBranch || '______________________'} />
                    <FieldRow label="Account Holder Name:" value={formData.macAccountHolder || '______________________'} />
                    <FieldRow label="Cheque Amount (if applicable):" value={formData.macChequeAmount || '______________________'} />
                    <div style={{ fontSize: '12px', marginTop: '8px', marginBottom: '4px' }}>
                      Cheque Verification Status: <strong>{formData.macChequeVerification === 'verified' ? '☑ Verified (Yes)     ☐ Not Verified (No)' : formData.macChequeVerification === 'not_verified' ? '☐ Verified (Yes)     ☑ Not Verified (No)' : '☐ Verified (Yes)     ☐ Not Verified (No)'}</strong>
                    </div>
                    <FieldRow label="Verified By:" value={formData.macChequeVerifiedBy || '______________________'} />
                    <FieldRow label="Verification Date:" value={formData.macChequeVerificationDate || '______________________'} />
                  </>
                )}

                {/* Distribution-specific */}
                {isDist && (
                  <>
                    <div className="section-heading">{P('Distribution Partner-এর Bandwidth Price')}</div>

                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#4f46e5', marginBottom: '4px' }}>৪.১ Distribution Requirement Details</div>
                    <table className="data-table">
                      <thead>
                        <tr><th>Distribution Type</th><th>Required (Mbps)</th><th>Rate</th><th>New Rate</th></tr>
                      </thead>
                      <tbody>
                        <tr><td>IIG</td><td>{formData.distIig || '________'}</td><td>{formData.distReqRate || '________'}</td><td>{formData.distNewRate || '________'}</td></tr>
                        <tr><td>GGC</td><td>{formData.distGgc || '________'}</td><td>{formData.distReqRate ? '' : '________'}</td><td>{formData.distNewRate ? '' : '________'}</td></tr>
                        <tr><td>FNA</td><td>{formData.distFna || '________'}</td><td></td><td></td></tr>
                        <tr><td>BDIX</td><td>{formData.distBdix || '________'}</td><td></td><td></td></tr>
                        <tr><td>CDN</td><td>{formData.distCdn || '________'}</td><td></td><td></td></tr>
                        <tr><td>NTTN</td><td>{formData.distNttn || '________'}</td><td></td><td></td></tr>
                        <tr style={{ fontWeight: 700 }}><td>Total Required Capacity &amp; Amount</td><td>{formData.distTotalCapacity ? `${formData.distTotalCapacity} Mbps` : '________ Mbps'}</td><td>{formData.distReqRate ? `${formData.distReqRate} Taka` : 'Taka'}</td><td>{formData.distNewRate ? `${formData.distNewRate} Taka` : (formData.distTotalAmount ? `${formData.distTotalAmount} Taka` : 'Taka')}</td></tr>
                      </tbody>
                    </table>

                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#4f46e5', marginTop: '8px', marginBottom: '4px' }}>৪.২ NTTN Information</div>
                    <FieldRow label="NTTN Provider Name:" value={formData.distNttnProvider || '____________________________________'} />
                    <FieldRow label="NTTN Link ID / Circuit ID:" value={formData.distNttnLinkId || '____________________________________'} />
                    <FieldRow label="FID / Feasibility ID:" value={formData.distNttnFid || '____________________________________'} />
                    <FieldRow label="NTTN Capacity (Mbps):" value={formData.distNttnCapacity || '____________________________________'} />
                    <FieldRow label="NTTN Cost (Monthly, VAT Included):" value={formData.distNttnCost ? `Tk. ${formData.distNttnCost}` : 'Tk. ____________________________________'} />
                    <FieldRow label="NTTN POP / Endpoint Location:" value={formData.distNttnPop || '____________________________________'} />
                    <FieldRow label="NTTN Type:" value={
                      `${formData.distNttnType === 'metro' ? '☑' : '☐'} Metro  ${formData.distNttnType === 'd2d' ? '☑' : '☐'} D2D  ${formData.distNttnType === 'longhaul' ? '☑' : '☐'} Longhaul`
                    } />
                    <FieldRow label="Installation Status:" value={
                      `${formData.distInstallStatus === 'feasibility' ? '☑' : '☐'} Feasibility Received     ${formData.distInstallStatus === 'work-order' ? '☑' : '☐'} Work Order Issued     ${formData.distInstallStatus === 'installed' ? '☑' : '☐'} Installed     ${formData.distInstallStatus === 'activated' ? '☑' : '☐'} Activated     ${formData.distInstallStatus === 'pending' ? '☑' : '☐'} Pending`
                    } />
                    <FieldRow label="NTTN Cost Sharing (Speed Net : Partner):" value={
                      `${formData.distNttnCostSharing === '50:50' ? '☑' : '☐'} 50:50     ${formData.distNttnCostSharing === 'partner' ? '☑' : '☐'} Partner Bear     ${formData.distNttnCostSharing === 'speednet' ? '☑' : '☐'} Speed Net Bear     ${formData.distNttnCostSharing === 'other' ? '☑' : '☐'} Other: ${formData.distNttnCostSharing === 'other' ? (formData.distNttnCostSharingOther || '__________') : '__________'}`
                    } />
                    <FieldRow label="Installation / Activation Date:" value={formData.distInstallDate || '____________________________________'} />

                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#4f46e5', marginTop: '8px', marginBottom: '4px' }}>৪.৩ Mandatory Payment Security</div>
                    <FieldRow label="Advance Payment Amount:" value={formData.distAdvancePaymentAmount ? `Tk. ${formData.distAdvancePaymentAmount}` : '____________________________________'} />
                    <div style={{ fontSize: '12px', color: '#334155', marginBottom: '4px' }}>
                      Distribution partner-এর ক্ষেত্রে Security Cheque গ্রহণ বাধ্যতামূলক।
                    </div>
                    <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                      Security Cheque Received: <strong>{formData.distSecurityCheque === 'yes' || formData.distSecurityCheque === true ? '☑ Yes     ☐ Pending' : formData.distSecurityCheque === 'pending' ? '☐ Yes     ☑ Pending' : '☐ Yes     ☐ Pending'}</strong>
                      <span style={{ color: '#64748b', fontSize: '11px' }}> (Security Cheque গ্রহণ না হওয়া পর্যন্ত Onboarding/Service Activation সম্পন্ন হবে না)</span>
                    </div>
                    <FieldRow label="Cheque No.:" value={formData.distChequeNo || '____________________________________'} />
                    <FieldRow label="Bank Name:" value={formData.distBankName || '____________________________________'} />
                    <FieldRow label="Branch:" value={formData.distBranch || '____________________________________'} />
                    <FieldRow label="Account Holder Name:" value={formData.distAccountHolder || '____________________________________'} />
                    <FieldRow label="Cheque Amount (if applicable):" value={formData.distChequeAmount || '____________________________________'} />
                    <div style={{ fontSize: '12px', marginTop: '8px', marginBottom: '4px' }}>
                      Cheque Verification Status: <strong>{formData.distChequeVerification === 'verified' ? '☑ Verified (Yes)     ☐ Not Verified (No)' : formData.distChequeVerification === 'not_verified' ? '☐ Verified (Yes)     ☑ Not Verified (No)' : '☐ Verified (Yes)     ☐ Not Verified (No)'}</strong>
                    </div>
                    <FieldRow label="Verified By:" value={formData.distChequeVerifiedBy || '____________________________________'} />
                    <FieldRow label="Verification Date:" value={formData.distChequeVerificationDate || '____________________________________'} />
                  </>
                )}

                {/* Staff — hidden for Channel Partner */}
                {!isChannel && (
                  <>
                <div className="section-heading">{P('পার্টনার কর্মী / জনবল তথ্য')}</div>
                <FieldRow label="মোট কর্মী সংখ্যা:" value={formData.totalStaff || '___________________________________________'} />
                <FieldRow label="মোট ID Card ইস্যু:" value={formData.totalIdCard || '___________________________________________'} />
                <table className="data-table">
                  <thead>
                    <tr><th>বিষয়</th><th>Yes</th><th>No</th><th>মন্তব্য</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>কর্মীদের তালিকা সংগ্রহ করা হয়েছে</td>
                      <td style={{ textAlign: 'center' }}>{formData.staffListCollected ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.staffListCollected ? '☑' : '☐'}</td>
                      <td rowSpan={4}>{formData.staffComment || ''}</td>
                    </tr>
                    <tr>
                      <td>প্রয়োজনীয় ID Card তৈরি/ইস্যু করা হয়েছে</td>
                      <td style={{ textAlign: 'center' }}>{formData.idCardIssued ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.idCardIssued ? '☑' : '☐'}</td>
                    </tr>
                    <tr>
                      <td>কর্মীদের NID-এর কপি সংগ্রহ করা হয়েছে</td>
                      <td style={{ textAlign: 'center' }}>{formData.nidCopyCollected ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.nidCopyCollected ? '☑' : '☐'}</td>
                    </tr>
                    <tr>
                      <td>কর্মীদের Passport Size ছবি সংগ্রহ করা হয়েছে</td>
                      <td style={{ textAlign: 'center' }}>{formData.passportPhotoCollected ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.passportPhotoCollected ? '☑' : '☐'}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Staff member detail table */}
                {(isDist || formData.staffMembers.some((m) => m.name || m.nid || m.mobile || m.designation)) && (
                  <>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#4f46e5', marginTop: '8px', marginBottom: '4px' }}>কর্মীদের বিস্তারিত তথ্য</div>
                    <table className="data-table">
                      <thead>
                        <tr><th style={{ width: '6%' }}>#</th><th>নাম</th><th>NID নম্বর</th><th>মোবাইল</th><th>পদবী</th></tr>
                      </thead>
                      <tbody>
                        {(isDist
                          ? (formData.staffMembers.some((m) => m.name || m.nid || m.mobile || m.designation)
                              ? formData.staffMembers
                              : [{ name: '', nid: '', mobile: '', designation: '' }, { name: '', nid: '', mobile: '', designation: '' }, { name: '', nid: '', mobile: '', designation: '' }])
                          : formData.staffMembers.filter((m) => m.name || m.nid || m.mobile || m.designation)
                        ).map((m, i) => (
                          <tr key={i}>
                            <td style={{ textAlign: 'center' }}>{banglaNum(i + 1)}</td>
                            <td>{m.name || '________________________'}</td>
                            <td>{m.nid || '________________________'}</td>
                            <td>{m.mobile || '________________________'}</td>
                            <td>{m.designation || '________________________'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {/* Office/POP */}
                <div className="section-heading">{P('পার্টনার অফিস / POP ডিক্লারেশন')}</div>
                <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                  পার্টনার অফিস / POP ডিক্লারেশন সম্পন্ন হয়েছে কি? <strong>{formData.popDeclared ? '☑ Yes     ☐ No' : '☐ Yes     ☑ No'}</strong>
                </div>
                <FieldRow label="অফিস / POP ঠিকানা:" value={formData.popAddress || '______________________________________________'} />
                <FieldRow label="POP Type:" value={
                  formData.popType === 'office' ? '☑ Office POP     ☐ Distribution POP     ☐ Both' :
                  formData.popType === 'distribution' ? '☐ Office POP     ☑ Distribution POP     ☐ Both' :
                  '☐ Office POP     ☐ Distribution POP     ☑ Both'
                } />
                  </>
                )}

                {/* Agreement — 2 rows for Distribution, 1 row for MAC/Channel */}
                <div className="section-heading">{P('চুক্তিপত্র (Agreement Checklist & Validity)')}</div>
                <table className="data-table">
                  <thead>
                    <tr><th>চুক্তির ধরন</th><th>Done</th><th>Not Done</th><th>মন্তব্য</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Speed Net-এর সাথে চুক্তিপত্র</td>
                      <td style={{ textAlign: 'center' }}>{formData.agreementSpeedNet ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.agreementSpeedNet ? '☑' : '☐'}</td>
                      <td>{formData.agreementComment || ''}</td>
                    </tr>
                    {!isChannel && (
                    <tr>
                      <td>পার্টনার অফিস/বাড়িওয়ালার সাথে চুক্তিপত্র</td>
                      <td style={{ textAlign: 'center' }}>{formData.agreementPartner ? '☑' : '☐'}</td>
                      <td style={{ textAlign: 'center' }}>{!formData.agreementPartner ? '☑' : '☐'}</td>
                      <td></td>
                    </tr>
                    )}
                  </tbody>
                </table>
                <FieldRow label="Agreement Duration:" value={formData.agreementDuration ? `${formData.agreementDuration} Years` : '____________________ Years'} />
                <FieldRow label="চুক্তি শুরুর তারিখ:" value={formData.agreementStartDate || '________________________________________'} />
                <FieldRow label="চুক্তি Expiry তারিখ:" value={formData.agreementExpiryDate || '________________________________________'} />

                {/* Customer history — hidden for Channel Partner */}
                {!isChannel && (
                  <>
                <div className="section-heading">{P('কাস্টমার ও পূর্ববর্তী হিস্ট্রি')}</div>
                <FieldRow label="বর্তমান মোট কাস্টমার সংখ্যা:" value={formData.currentCustomers || '______________________________________'} />
                <FieldRow label="পূর্বে যে কোম্পানি/ISP-এর সাথে যুক্ত ছিল:" value={formData.previousIsp || '______________________________________'} />
                <FieldRow label="Previous ISP/Provider Clearance/NOC:" value={
                  formData.previousNoc === 'received' ? '☑ Received     ☐ Not Received     ☐ N/A' :
                  formData.previousNoc === 'na' ? '☐ Received     ☐ Not Received     ☑ N/A' :
                  '☐ Received     ☑ Not Received     ☐ N/A'
                } />
                <FieldRow label="কোনো বকেয়া (Due) আছে কি?" value={formData.hasDue ? '☑ Yes     ☐ No' : '☐ Yes     ☑ No'} />
                {formData.hasDue && (
                  <>
                    <FieldRow label="বকেয়ার পরিমাণ (যদি প্রযোজ্য):" value={formData.dueAmount || '_________________________________'} />
                    <FieldRow label="পরিশোধের সময়সীমা (দিন):" value={formData.duePaymentDays || '____________________________________'} />
                    <FieldRow label="পরিশোধ পদ্ধতি / শর্ত:" value={formData.duePaymentTerms || '________________________________________'} />
                  </>
                )}
                  </>
                )}

                {/* Extra notes */}
                <div className="section-heading">{P('অতিরিক্ত তথ্য / বিশেষ নোট')}</div>
                <div style={{ minHeight: '40px', borderBottom: '1px solid #94a3b8', padding: '4px 0', fontSize: '13px', color: '#334155', whiteSpace: 'pre-wrap' }}>
                  {formData.extraNotes || '\n\n'}
                </div>

                {/* 8. Declaration & signatures */}
                <div className="section-heading">{P('ঘোষণা ও স্বাক্ষর (Declaration)')}</div>
                <div style={{ fontSize: '12px', lineHeight: 2, color: '#334155', textAlign: 'justify', marginBottom: '10px' }}>
                  আমি/আমরা নিশ্চিত করছি যে উপরে প্রদত্ত সকল তথ্য ও জমাকৃত ডকুমেন্ট সঠিক ও সত্য। Speed Net প্রয়োজন অনুযায়ী প্রদত্ত তথ্য ও ডকুমেন্ট যাচাই করতে পারবে। আমি/আমরা Speed Net-এর প্রযোজ্য Agreement, SOP, Payment Policy, Revenue/Package Price Sharing এবং NTTN Cost Sharing Policy মেনে চলতে সম্মত। কোনো তথ্য অসত্য, অসম্পূর্ণ বা অসঙ্গত প্রমাণিত হলে Speed Net Onboarding/Service Activation স্থগিত বা বাতিল করতে পারবে।
                </div>

                <div className="signature-row">
                  <div className="sig-box">
                    <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '8px', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px' }}>পার্টনার</div>
                    <div style={{ fontSize: '11px', color: '#334155', textAlign: 'left', lineHeight: 2 }}>
                      <div>স্বাক্ষর: <span style={{ borderBottom: '1px solid #94a3b8', display: 'inline-block', width: '160px', height: '14px' }}></span></div>
                      <div>নাম: <strong>{formData.partnerSignName || '__________________'}</strong></div>
                      <div>তারিখ: {formData.signDate || '__________________'}</div>
                    </div>
                  </div>
                  <div className="sig-box">
                    <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '8px', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: '4px' }}>Speed Net প্রতিনিধি</div>
                    <div style={{ fontSize: '11px', color: '#334155', textAlign: 'left', lineHeight: 2 }}>
                      <div>স্বাক্ষর: <span style={{ borderBottom: '1px solid #94a3b8', display: 'inline-block', width: '160px', height: '14px' }}></span></div>
                      <div>নাম: <strong>{formData.speednetSignName || '__________________'}</strong></div>
                      <div>তারিখ: {formData.signDate || '__________________'}</div>
                    </div>
                  </div>
                </div>

                {/* 9. Internal Verification & Approval — fixed names per spec */}
                <div className="section-heading">{P('Internal Verification & Approval')}</div>
                <table className="approval-table">
                  <thead>
                    <tr>
                      <th>Approval Stage</th>
                      <th>নাম / পদবি</th>
                      <th>স্বাক্ষর ও তারিখ</th>
                      <th>Status / মন্তব্য</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.approvals.map((a, i) => {
                      const fallbackNames = ['মোঃ সাব্বির হোসেন', 'পূর্ণিমা মিস্ত্রী', 'এস কে রাফাত উদ্দিন', 'শেখ আজমল হোসেন'];
                      return (
                      <tr key={i}>
                        <td style={{ fontSize: '11px', fontWeight: 600 }}>{a.stage}</td>
                        <td>{a.name || fallbackNames[i] || '________________'}</td>
                        <td>{a.signDate || '________________'}</td>
                        <td style={{ fontSize: '11px' }}>
                          {a.status === 'approved' && '☑ Approved  ☐ Pending  ☐ Rejected'}
                          {a.status === 'pending' && '☐ Approved  ☑ Pending  ☐ Rejected'}
                          {a.status === 'rejected' && '☐ Approved  ☐ Pending  ☑ Rejected'}
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>

                {/* Audit note */}
                <div className="audit-note">
                  <div style={{ fontWeight: 700, marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Official Record / Audit Note
                  </div>
                  <ul>
                    <li>এই ফর্ম Speed Net-এর অফিসিয়াল Partner Onboarding Record হিসেবে গণ্য হবে।</li>
                    <li>অসম্পূর্ণ, ভুল বা যাচাইবিহীন তথ্য থাকলে Onboarding/Service Activation স্থগিত বা বাতিলযোগ্য।</li>
                    <li>Finance, Technical/NOC, Audit, Compliance ও Management প্রয়োজনে এই ডকুমেন্ট রেফারেন্স হিসেবে ব্যবহার করবে।</li>
                  </ul>
                </div>
              </>;
            })()}

            {/* Footer */}
            <div style={{ marginTop: 'auto', paddingTop: '12px', textAlign: 'center', fontSize: '10px', color: '#94a3b8', borderTop: '1px solid #e2e8f0' }}>
              Speed Net Khulna | info@speednetkhulna.com | www.speednetkhulna.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PartnerOnboardingForm;
