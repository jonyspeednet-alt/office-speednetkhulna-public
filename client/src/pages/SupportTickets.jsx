import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  createSupportTicket, getSupportDashboard, getSupportTickets, searchSupportCustomers, 
  syncMikrotikCustomers, updateSupportTicket, deleteSupportTicket, getTicketComments, addTicketComment, getCustomerComments, saveVerificationCall, getSmsTemplates, 
  createSmsTemplate, updateSmsTemplate, deleteSmsTemplate, sendSmsPortal, getTicketLiveStatus, revertSolvedTicket
} from '../services/supportService';
import * as supportService from '../services/supportService';
import { notify } from '../utils/notify';
import { confirmAction } from '../utils/confirm';
import { toast } from 'react-hot-toast';
import QRCode from 'react-qr-code';
import { BRANCHES } from '../constants/branches';
import { normalizeSupportOffice } from '../utils/supportOffice';
import { formatDateTime } from '../utils/formatters';
import SupportOfficeShortcuts from '../components/SupportOfficeShortcuts';
import '../styles/SupportTickets.css';

// Support Office/Branch options — Head Office + 4 branches (from BRANCHES constant)
// Corporate Office = Head Office, displayed as "Head Office (Corporate Office)"
const SUPPORT_OFFICES = BRANCHES.map((b) => ({
  ...b,
  displayName: b.code === 'CO' ? 'Head Office (Corporate Office)' : b.name
}));

const DEFAULT_CATEGORIES = [
  { id: 901, name: 'camera_problem', name_bn: 'Camera Problem', default_priority: 'medium' },
  { id: 902, name: 'dhcp_connection', name_bn: 'DHCP Connection', default_priority: 'medium' },
  { id: 903, name: 'line_open', name_bn: 'Line open', default_priority: 'high' },
  { id: 904, name: 'new_connection', name_bn: 'New Connection', default_priority: 'medium' },
  { id: 905, name: 'no_connection', name_bn: 'No Connection', default_priority: 'high' },
  { id: 906, name: 'onu_loss', name_bn: 'ONU LOSS', default_priority: 'high' },
  { id: 907, name: 'pon_blink_db_high', name_bn: 'PON Blink / DB High Issue', default_priority: 'high' },
  { id: 908, name: 'frequently_disconnect', name_bn: 'Frequently Disconnect', default_priority: 'medium' },
  { id: 909, name: 'others', name_bn: 'Others', default_priority: 'low' },
  { id: 910, name: 'pc_connect', name_bn: 'PC Connect', default_priority: 'medium' },
  { id: 911, name: 're_connect', name_bn: 'Re-Connect', default_priority: 'medium' },
  { id: 912, name: 'qc_support', name_bn: 'QC Support', default_priority: 'medium' },
  { id: 913, name: 'password_change', name_bn: 'Password Change', default_priority: 'low' },
  { id: 914, name: 'router_configure', name_bn: 'Router Configure', default_priority: 'medium' },
  { id: 915, name: 'shifting_connection', name_bn: 'Shifting Connection', default_priority: 'low' },
  { id: 916, name: 'tv_issue', name_bn: 'TV issue', default_priority: 'medium' },
  { id: 917, name: 'slow_connection', name_bn: 'Slow Connection', default_priority: 'medium' },
];

const REMOVED_SUPPORT_CATEGORY_LABELS = {
  912: 'QC Support',
  918: 'On-Call Support',
};
const SPECIAL_SUPPORT_CATEGORY_IDS = new Set([912, 918]);
const hasQcSupport = (ticket) => Boolean(ticket?.is_qc_support || Number(ticket?.category_id) === 912);
const hasOnCallSupport = (ticket) => Boolean(ticket?.is_on_call || ticket?.resolution_type === 'on_call' || Number(ticket?.category_id) === 918);
const getProblemCategoryLabel = (ticket) => (
  SPECIAL_SUPPORT_CATEGORY_IDS.has(Number(ticket?.category_id))
    ? ticket?.subject || '—'
    : ticket?.category_name || ticket?.subject || '—'
);
const get3cxCallUri = (phone) => {
  const number = String(phone || '').replace(/[^\d+]/g, '');
  return /^\+?\d+$/.test(number) ? `dial:${number}` : undefined;
};

const STATUS = { 
  new: 'Pending', 
  assigned: 'Processing', 
  in_progress: 'Processing', 
  waiting_customer: 'Pending', 
  waiting_vendor: 'Vendor', 
  resolved: 'Solved', 
  verification_pending: 'Verification', 
  closed: 'Closed', 
  reopened: 'Reopened', 
  cancelled: 'Cancelled' 
};

const TERMINAL_STATUSES = ['closed','resolved','cancelled'];
const ALL_QUEUE_STATUSES = ['new', 'assigned', 'in_progress', 'waiting_customer', 'waiting_vendor', 'resolved', 'verification_pending', 'closed', 'reopened'];
const isTerminalStatus = (s) => TERMINAL_STATUSES.includes(s);
const LEGACY_VERIFICATION_QUESTIONS = [
  { key: 'q1_technical', text: '১. আপনি কি যথাযথ কারিগরি সহায়তা পেয়েছেন?' },
  { key: 'q2_media', text: '২. FTP সার্ভার, YouTube, Facebook ও Live TV স্ট্রিমিং কি ঠিকভাবে ব্যবহার করতে পেরেছেন?' },
  { key: 'q3_customercare', text: '৩. কাস্টমার কেয়ার নম্বর ও পেমেন্ট পদ্ধতি কি বুঝতে পেরেছেন?' },
  { key: 'q4_payment', text: '৪. সেবার বিল কি পরিশোধ করেছেন?' },
  { key: 'q5_service_satisfaction', text: '৫. আমাদের সেবায় কি আপনি সন্তুষ্ট?' },
  { key: 'q6_time_satisfaction', text: '৬. সেবা পেতে যে সময় লেগেছে, তাতে কি আপনি সন্তুষ্ট?' },
  { key: 'q7_technician_behavior', text: '৭. সার্ভিস ম্যান/টেকনিশিয়ানের আচরণে কি আপনি সন্তুষ্ট?' },
];
const VERIFICATION_QUESTION_SETS = {
  shifting: [
    { key: 'work_received', text: 'Shifting-এর কাজটি সঠিকভাবে বুঝে পেয়েছেন কি?' },
    { key: 'payment_made', text: 'Shifting বাবদ কোনো payment করেছেন কি?' },
  ],
  new_connection: [
    { key: 'connection_usable', text: 'আপনার নতুন connection স্বাভাবিকভাবে ব্যবহার করতে পারছেন কি?' },
  ],
  qc: [
    { key: 'connection_problem', text: 'Connection ব্যবহার করতে কোনো problem পাচ্ছেন কি?' },
    { key: 'speednet_rating', text: 'আমাদের total service অনুযায়ী ১০-এর মধ্যে Speednet-কে কত rating দেবেন?', type: 'rating' },
  ],
  support: [
    { key: 'support_understood', text: 'আপনি যে support নিয়েছিলেন, সেটি বুঝে পেয়েছেন কি?' },
    { key: 'payment_made', text: 'Support বাবদ কোনো payment করেছেন কি?' },
    { key: 'team_satisfied', text: 'আমাদের support team-এর ব্যবহারে সন্তুষ্ট কি?' },
  ],
};
const VERIFICATION_TYPE_LABELS = {
  shifting: 'Shifting',
  new_connection: 'New Connection',
  qc: 'QC Support',
  support: 'Support',
};
const VERIFICATION_CALL_OUTCOMES = [
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'incomplete', label: 'Incomplete call' },
];
const getVerificationType = (ticket) => {
  const categoryId = Number(ticket?.category_id);
  const category = String(ticket?.category || ticket?.category_name || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (categoryId === 915 || category.includes('shifting')) return 'shifting';
  if (categoryId === 904 || category.includes('new_connection')) return 'new_connection';
  if (categoryId === 912 || ticket?.is_qc_support || category.includes('qc')) return 'qc';
  return 'support';
};
const getVerificationQuestions = (ticket) => VERIFICATION_QUESTION_SETS[getVerificationType(ticket)] || VERIFICATION_QUESTION_SETS.support;
const createEmptyVerificationForm = () => ({
  q1_technical: null,
  q2_media: null,
  q3_customercare: null,
  q4_payment: null,
  q5_service_satisfaction: null,
  q6_time_satisfaction: null,
  q7_technician_behavior: null,
  answers: {},
  feedback_remarks: '',
});

const TechnicianAvatar = ({ technician }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const name = technician.full_name || technician.name || 'U';
  const rawImage = technician.profile_photo || technician.avatar_url || technician.profile_pic;
  const imageSrc = rawImage && (rawImage.startsWith('/') || /^https?:\/\//i.test(rawImage) ? rawImage : `/uploads/${rawImage}`);
  const initials = String(name).split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('');

  return (
    <span className="tech-avatar">
      {imageSrc && !imageFailed ? <img src={imageSrc} alt="" onError={() => setImageFailed(true)} /> : initials}
    </span>
  );
};

const getStatusBadge = (status) => {
  if (status === 'cancelled') return { label: 'Cancelled', cls: 'badge-status-cancelled' };
  if (status === 'reopened') return { label: 'Reopened', cls: 'badge-status-reopened' };
  if (['closed','resolved'].includes(status)) return { label: 'Solved', cls: 'badge-status-solved' };
  if (['new','waiting_customer'].includes(status)) return { label: 'Pending', cls: 'badge-status-pending' };
  if (['assigned','in_progress','verification_pending','waiting_vendor'].includes(status)) return { label: 'Processing', cls: 'badge-status-processing' };
  return { label: STATUS[status] || status, cls: 'badge-status-processing' };
};


const fmt = (v) => formatDateTime(v) || '-';
// Timeline hygiene: old rows stored "(was ID:20)" — strip raw-ID suffix, drop same-name noise.
const cleanWasSuffix = (s) => {
  let out = String(s || '').replace(/\s*\(was\s+ID:\d+\)\s*/i, '');
  const m = out.match(/^(Re-assigned to:\s*(.+?))\s*\(was\s+(.+?)\)\s*$/i);
  if (m && m[2].trim().toLowerCase() === m[3].trim().toLowerCase()) out = m[1];
  return out;
};
const fmtDur = (start, end) => {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e)) return '-';
  const diff = Math.max(0, e - s);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
};
const timeAgoUx = (v) => {
  if (!v) return '-';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return fmt(v);
  const diffMs = Date.now() - t;
  if (diffMs < 0) return fmt(v);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return fmt(v);
};
const getCustomerShortName = (pppoe) => {
  const raw = String(pppoe || '').trim();
  if (!raw) return 'Unknown';
  const beforeAt = raw.split('@')[0];
  const nameOnly = beforeAt.replace(/[0-9]+$/g, '').replace(/[^A-Za-z]+$/g, '');
  return nameOnly || beforeAt || 'Unknown';
};
// Additional/team technicians: stored as JSONB array of user IDs (may arrive as
// array, JSON string, or null). Resolve to display names via the technicians list.
const parseAdditionalTechIds = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    } catch { /* not JSON — fall through */ }
    return [];
  }
  return [];
};
const resolveTeamNames = (raw, technicians) => {
  const ids = parseAdditionalTechIds(raw);
  if (!ids.length) return [];
  const list = Array.isArray(technicians) ? technicians : [];
  return ids.map((id) => {
    const t = list.find((x) => Number(x.id) === id);
    const name = t ? (t.full_name || t.name) : '';
    return { id, name: String(name || '').trim() || `ID:${id}` };
  });
};
// Ticket work-photo attachments: served via authenticated API
// GET /api/support/tickets/:id/attachments/:file (same-origin, cookie auth).
// Legacy rows may still carry /uploads/ticket_attachments/<file> — map them.
const resolveAttachmentUrl = (a) => {
  if (!a) return '';
  const p = typeof a === 'string' ? a : (a.file_path || '');
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  const m = String(p).match(/ticket-\d+-\d+\.(jpg|png|webp|gif)/i);
  const ticketId = typeof a === 'object' ? a.ticket_id : null;
  if (m && ticketId) return `/api/support/tickets/${ticketId}/attachments/${m[0].toLowerCase()}`;
  if (p.startsWith('/api/')) return p;
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  return `${base}${p}`;
};

const SupportTickets = ({
  modalOnly = false,
  initialTicketId = null,
  initialVerificationTicket = null,
  onModalClose,
}) => {
  const qc = useQueryClient();

  const syncAllMut = useMutation({
    mutationFn: syncMikrotikCustomers,
    onSuccess: (res) => {
      const synced = Array.isArray(res?.synced) ? res.synced : [];
      const failed = Array.isArray(res?.failed) ? res.failed : [];
      const totalRecords = synced.reduce((sum, r) => sum + (Number(r?.synced ?? r?.count ?? 0) || 0), 0);
      notify.success(`MikroTik sync: ${synced.length} router synced (${totalRecords} records)${failed.length ? `, ${failed.length} failed` : ''}`);
      if (failed.length && res?.warning) (notify.warning || notify.info)(res.warning);
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'MikroTik sync failed.')
  });

  const FILTER_KEY = 'supportFilters_v1';
  // Page-level capability flags (display only; server enforces every action).
  // Field technicians (update without assign) get a working subset: view own
  // tickets, update status/notes/photos, submit work reports. Admin controls
  // (create, re-assign, delete, verify, SMS, sync) are hidden, not 403-toast.
  const pageUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
  const assignedSupportOffice = normalizeSupportOffice(pageUser.work_location);
  const isHeadOfficeUser = assignedSupportOffice === 'Corporate Office';
  const isBranchOfficeUser = Boolean(assignedSupportOffice && !isHeadOfficeUser);
  const pagePerms = pageUser.permissions || {};
  const pageIsPower = Boolean(pageUser.is_super_admin || pageUser.all_access || pagePerms.all_access || pagePerms['system.all_access']);
  // Admin-only controls (e.g. revert an accidental solve). Server re-checks.
  const pageIsAdmin = Boolean(pageIsPower || ['admin', 'super admin', 'superadmin'].includes(String(pageUser.role_name || pageUser.role || '').trim().toLowerCase()));
  const hasTx = (...keys) => pageIsPower || keys.some((k) => pagePerms[k] || pageUser[k]);
  const canAssignTx = hasTx('support.ticket.assign', 'p_support_assign');
  const canCreateTx = hasTx('support.ticket.create', 'p_support_create');
  const canSyncTx = hasTx('support.mikrotik.sync', 'p_support_mikrotik_sync');
  // Field techs (update without assign): view + status-forward + notes +
  // reports only. Server rejects field edits/close/reassign for them —
  // hide those controls instead of 403-toasting.
  const loadFilters = () => {
    try { const s = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'); return s || {}; } catch { return {}; }
  };
  const initFilters = loadFilters();
  // Selected Tab Filter: 'all', 'pending', 'processing', 'solved', 'my', 'history', 'sms'
  // Each tab has its own URL: /support?tab=pending etc. (bookmarkable + back button works)
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnPathRef = useRef(null);
  const VALID_TABS = ['all', 'pending', 'processing', 'solved', 'my', 'history', 'sms'];
  const _urlTab = searchParams.get('tab');
  const _initTab = VALID_TABS.includes(_urlTab) ? _urlTab : (initFilters.activeTab || 'all');
  const [activeTab, setActiveTab] = useState(_initTab);

  const handleCloseViewingTicket = useCallback(() => {
    setViewingTicket(null);
    if (modalOnly) {
      onModalClose?.();
      return;
    }
    const ret = returnPathRef.current;
    if (ret) {
      returnPathRef.current = null;
      navigate(ret.path, {
        replace: true,
        state: {
          restoreSupportHistoryState: ret.historyState,
          verificationCallReturn: ret.path === '/support/verification',
        },
      });
    }
  }, [modalOnly, navigate, onModalClose]);

  const handleCloseVerification = useCallback(() => {
    setVerifyingTicket(null);
    if (modalOnly) {
      onModalClose?.();
      return;
    }
    const ret = returnPathRef.current;
    if (ret) {
      returnPathRef.current = null;
      navigate(ret.path, {
        replace: true,
        state: {
          restoreSupportHistoryState: ret.historyState,
          verificationCallReturn: ret.path === '/support/verification',
        },
      });
    }
  }, [modalOnly, navigate, onModalClose]);

  // Deep links (dashboard widget / sidebar): /support?tab=my&ticket=<id>.
  // ?ticket= is consumed once (modal opens), ?tab= stays in URL as the page address.
  useEffect(() => {
    if (modalOnly) return;
    const sp = new URLSearchParams(window.location.search);
    const ticket = sp.get('ticket');
    const returnPath = sp.get('return');
    if (returnPath?.startsWith('/support/history/') || returnPath === '/support/verification') {
      returnPathRef.current = {
        path: returnPath,
        historyState: location.state?.supportHistoryReturnState,
      };
    }
    if (ticket && /^\d+$/.test(ticket)) {
      const ticketId = Number(ticket);
      setViewingTicket({ id: ticketId });
      const next = new URLSearchParams(searchParams.toString());
      next.delete('ticket');
      next.delete('return');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOnly]);

  useEffect(() => {
    const ticketId = Number(initialTicketId);
    if (modalOnly && Number.isSafeInteger(ticketId) && ticketId > 0) {
      setViewingTicket({ id: ticketId });
    }
  }, [initialTicketId, modalOnly]);

  useEffect(() => {
    const ticketId = Number(initialVerificationTicket?.id);
    if (modalOnly && Number.isSafeInteger(ticketId) && ticketId > 0) {
      setVerifyingTicket({ ...initialVerificationTicket, id: ticketId });
    }
  }, [initialVerificationTicket, modalOnly]);

  // Browser back/forward: URL -> state (missing ?tab= means 'all')
  useEffect(() => {
    if (modalOnly) return;
    const t = searchParams.get('tab') || 'all';
    if (VALID_TABS.includes(t) && t !== activeTab) setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOnly, searchParams]);

  // State -> URL: restored tab (e.g. from last session) becomes the page address
  useEffect(() => {
    if (modalOnly) return;
    // Let the deep-link effect remove ticket/return before syncing the tab.
    if (searchParams.has('ticket') || searchParams.has('return')) return;
    const cur = searchParams.get('tab') || 'all';
    if (cur !== activeTab) {
      const next = new URLSearchParams(searchParams.toString());
      next.set('tab', activeTab);
      setSearchParams(next, { replace: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, modalOnly]);

  // Filter Bar State (matching screenshot inputs) — persisted
  const [selectedCategory, setSelectedCategory] = useState(
    REMOVED_SUPPORT_CATEGORY_LABELS[Number(initFilters.selectedCategory)] ? '' : (initFilters.selectedCategory || '')
  );
  const [selectedZone, setSelectedZone] = useState(isBranchOfficeUser ? assignedSupportOffice : (initFilters.selectedZone || ''));
  const [selectedAssignee, setSelectedAssignee] = useState(initFilters.selectedAssignee || '');
  const [selectedCreator, setSelectedCreator] = useState(initFilters.selectedCreator || '');
  const [selectedStatus, setSelectedStatus] = useState(
    _initTab === 'all' && initFilters.selectedStatus === 'cancelled'
      ? ''
      : (initFilters.selectedStatus || '')
  );
  const [selectedPriority, setSelectedPriority] = useState(initFilters.selectedPriority || '');
  const [searchByOption, setSearchByOption] = useState(initFilters.searchByOption || 'username');
  const [fromDate, setFromDate] = useState(initFilters.fromDate || '');
  const [toDate, setToDate] = useState(initFilters.toDate || '');
  const [complaintNo, setComplaintNo] = useState(initFilters.complaintNo || '');
  const [searchQuery, setSearchQuery] = useState(initFilters.searchQuery || '');
  const [closeDate, setCloseDate] = useState(initFilters.closeDate || '');
  // Compact filter panel: collapsed by default to keep tickets visible —
  // auto-expands only when persisted filters are active.
  const hasInitFilterValues = ['selectedCategory', 'selectedZone', 'selectedAssignee', 'selectedCreator', 'selectedStatus', 'selectedPriority', 'searchQuery', 'complaintNo', 'fromDate', 'toDate', 'closeDate'].some((k) => String(initFilters[k] || '').trim() !== '');
  const [filtersOpen, setFiltersOpen] = useState(hasInitFilterValues);
  const activeFilterCount = [selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, searchQuery, complaintNo, fromDate, toDate, closeDate].filter((v) => String(v || '').trim() !== '').length;
  useEffect(() => {
    if (modalOnly) return;
    const data = { selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, searchByOption, fromDate, toDate, complaintNo, searchQuery, closeDate, activeTab };
    localStorage.setItem(FILTER_KEY, JSON.stringify(data));
  }, [selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedStatus, selectedPriority, searchByOption, fromDate, toDate, complaintNo, searchQuery, closeDate, activeTab, modalOnly]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [editingTicket, setEditingTicket] = useState(null);
  const [verifyingTicket, setVerifyingTicket] = useState(null);
  const [cancellingTicket, setCancellingTicket] = useState(null);
  const [cancellationReason, setCancellationReason] = useState('');

  // New Ticket State
  const [lookup, setLookup] = useState('');
  const [matches, setMatches] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [technicianSearch, setTechnicianSearch] = useState('');
  const searchAbortRef = React.useRef(null);
  const lookupBlurTimer = React.useRef(null);
  const lookupInputRef = React.useRef(null);
  const resultRefs = React.useRef([]);
  const [connMenuOpen, setConnMenuOpen] = useState(false);
  const [connSubOpen, setConnSubOpen] = useState(false);
  const [form, setForm] = useState({
    category_id: '', is_qc_support: false, is_on_call: false, description: '', priority: 'medium',
    source: 'phone', connection_type: 'Fiber', connection_subtype: '', office_name: isBranchOfficeUser ? assignedSupportOffice : '', send_sms: true, send_whatsapp: true,
    complaint_no: '', technician_ids: []
  });

  // Edit / Re-Assign State
  const [viewingTicket, setViewingTicket] = useState(null);
  const [viewEditing, setViewEditing] = useState(false);
  const [viewForm, setViewForm] = useState({});
  const viewingTicketSaveVersionRef = useRef({});
  // LIVE LINE status (MODAL 3 left column only; manual refresh, no auto-fetch on open)
  const [liveStatus, setLiveStatus] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  useEffect(() => {
    setLiveStatus(null);
    setLiveError('');
    setLiveLoading(false);
  }, [viewingTicket?.id]);
  const fetchLiveStatus = async () => {
    if (!viewingTicket?.id || liveLoading) return;
    setLiveLoading(true);
    setLiveError('');
    try {
      const data = await getTicketLiveStatus(viewingTicket.id);
      setLiveStatus(data || null);
      if (data?.error && !data?.live) setLiveError(data.error);
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Failed to fetch live status.';
      setLiveError(msg);
    } finally {
      setLiveLoading(false);
    }
  };
  const [commentTab] = useState('ticket');
  const [newComment, setNewComment] = useState('');

  // Work reports (Phase 1): technician submit + reviewer approve/reject.
  const [reportForm, setReportForm] = useState({ work: '', materials: '', minutes: '', photo: null });
  const [reportBusy, setReportBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNote, setReviewNote] = useState('');

  const refreshReports = async (ticketId) => {
    try {
      const full = await supportService.getTicket(ticketId);
      const t = full?.ticket || full?.data || full;
      if (t && typeof t === 'object' && t.reports) {
        setViewingTicket((prev) => (prev && prev.id === ticketId ? { ...prev, reports: t.reports } : prev));
      }
      qc.invalidateQueries({ queryKey: ['ticketComments', ticketId] });
    } catch { /* timeline refresh is best-effort */ }
  };

  const submitReport = async () => {
    if (!viewingTicket?.id || reportBusy) return;
    if (!reportForm.work.trim()) { notify.error('Please describe the work done.'); return; }
    setReportBusy(true);
    try {
      const fd = new FormData();
      fd.append('work_done', reportForm.work.trim());
      if (reportForm.materials.trim()) fd.append('materials_used', reportForm.materials.trim());
      if (reportForm.minutes !== '') fd.append('time_spent_minutes', reportForm.minutes);
      if (reportForm.photo) fd.append('photo', reportForm.photo);
      await supportService.submitWorkReport(viewingTicket.id, fd);
      notify.success('Work report submitted.');
      setReportForm({ work: '', materials: '', minutes: '', photo: null });
      await refreshReports(viewingTicket.id);
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Failed to submit work report.');
    } finally {
      setReportBusy(false);
    }
  };

  const reviewReport = async (reportId, decision) => {
    if (!viewingTicket?.id || reviewingId) return;
    if (decision === 'rejected' && !reviewNote.trim()) { notify.error('A review note is required when rejecting.'); return; }
    setReviewingId(reportId);
    try {
      await supportService.reviewWorkReport(viewingTicket.id, reportId, { status: decision, review_note: reviewNote.trim() });
      notify.success(`Work report ${decision}.`);
      setReviewNote('');
      await refreshReports(viewingTicket.id);
    } catch (e) {
      notify.error(e?.response?.data?.message || 'Failed to review work report.');
    } finally {
      setReviewingId(null);
    }
  };
  const [isInternal, setIsInternal] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [closingTicket, setClosingTicket] = useState(null);
  const [closingNote, setClosingNote] = useState('');
  const [closingIsOnCall, setClosingIsOnCall] = useState(false);
  const [closingSendSms, setClosingSendSms] = useState(true);
  const [closingSendWhatsapp, setClosingSendWhatsapp] = useState(true);

  const openClosingModal = (t) => {
    setClosingTicket(t);
    setClosingNote(t?.resolution_note || '');
    setClosingSendSms(true);
    setClosingSendWhatsapp(true);
    const noTech = !t?.assigned_to && (!t?.additional_technician_ids || !t?.additional_technician_ids?.length);
    const isOnCallCategory = t?.category_id === 918 || String(t?.category_name || '').toLowerCase().includes('on call') || String(t?.category_name || '').toLowerCase().includes('phone');
    setClosingIsOnCall(Boolean(t?.is_on_call || noTech || isOnCallCategory));
  };
  const timelineRef = React.useRef(null);
  const detailsRef = React.useRef(null);
  const activityRef = React.useRef(null);
  const prevRef = React.useRef(null);
  const statusRef = React.useRef(null);
  const viewCloseRef = React.useRef(null);
  useEffect(() => {
    if (timelineRef.current && commentTab === 'ticket' && viewingTicket) {
      const el = timelineRef.current;
      // scroll to bottom to show recent changes
      setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
    }
  }, [viewingTicket, commentTab, timelineFilter]);
  useEffect(() => {
    if (!viewingTicket) return;
    const onKey = (e) => { if (e.key === 'Escape') handleCloseViewingTicket(); };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => { viewCloseRef.current?.focus(); }, 50);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [viewingTicket, handleCloseViewingTicket]);
  const [editForm, setEditForm] = useState({
    status: '', assigned_to: '', priority: '', category_id: '', is_qc_support: false, is_on_call: false, description: '', note: '', send_sms: true, send_whatsapp: true
  });
  const [reassignError, setReassignError] = useState('');
  const [reassignPickerOpen, setReassignPickerOpen] = useState(false);

  // Verification Form State
  const [verifyForm, setVerifyForm] = useState(createEmptyVerificationForm);
  const [callOutcome, setCallOutcome] = useState('');
  const [verificationData, setVerificationData] = useState(null);
  const [verificationHistory, setVerificationHistory] = useState([]);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationLoadError, setVerificationLoadError] = useState(false);
  const [verificationLoadedTicketId, setVerificationLoadedTicketId] = useState(null);
  const [verificationEditMode, setVerificationEditMode] = useState(false);

  useEffect(() => {
    const ticketId = verifyingTicket?.id;
    if (!ticketId) return undefined;
    const attemptId = Number(verifyingTicket?.verification_attempt_id) || null;
    let cancelled = false;
    setVerificationLoading(true);
    setVerificationLoadError(false);
    setVerificationLoadedTicketId(null);
    setVerificationEditMode(false);
    setCallOutcome('');
    (async () => {
      try {
        const full = await supportService.getTicket(ticketId);
        if (cancelled) return;
        const ticketObj = full?.ticket || full?.data || full;
        if (ticketObj && typeof ticketObj === 'object') {
          setVerifyingTicket((prev) => ({
            ...prev,
            ...ticketObj,
            reports: Array.isArray(full?.reports) ? full.reports : (ticketObj.reports || []),
            id: Number(ticketId),
            category_id: ticketObj.category_id ?? prev?.category_id,
            category: ticketObj.category || prev?.category,
            category_name: ticketObj.category_name || prev?.category_name,
            is_qc_support: ticketObj.is_qc_support ?? prev?.is_qc_support,
          }));
        }
        const saved = full?.verification || null;
        setVerificationLoadedTicketId(Number(ticketId));
        setVerificationData(saved);
        setVerificationHistory(Array.isArray(full?.verification_history) ? full.verification_history : []);
        setVerifyForm(saved ? {
          ...createEmptyVerificationForm(),
          ...Object.fromEntries(LEGACY_VERIFICATION_QUESTIONS.map(({ key }) => [key, saved[key] ?? null])),
          answers: saved.answers || {},
          feedback_remarks: saved.feedback_remarks || '',
        } : createEmptyVerificationForm());
        const hasLegacyAnswers = saved && LEGACY_VERIFICATION_QUESTIONS.some(({ key }) => saved[key] !== null && saved[key] !== undefined);
        setVerificationEditMode(!saved || Boolean(attemptId && !saved.answers && !hasLegacyAnswers));
      } catch (error) {
        if (!cancelled) {
          setVerificationLoadError(true);
          notify.error(error?.response?.data?.message || 'যাচাইকরণের তথ্য লোড করা যায়নি।');
        }
      } finally {
        if (!cancelled) setVerificationLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [verifyingTicket?.id, verifyingTicket?.verification_attempt_id]);

  // SMS Portal & Template Creator State
  // Auto SMS formats sent by the system on ticket events — editable below.
  // Keys must stay exact; {placeholders} are filled automatically.
  const SYSTEM_SMS_FORMATS = [
    { key: 'ticket_created_customer', label: 'Ticket Created → Customer', when: 'Sent to customer when a new ticket is opened', vars: '{ticket_no}', fallback: 'Your support ticket {ticket_no} created. SpeedNet will contact you soon.' },
    { key: 'ticket_assigned_technician', label: 'Ticket Assigned → Technician', when: 'Sent to technician on assign / re-assign', vars: '{ticket_no} {priority} {pppoe} {phone} {olt} {address} {subject} {description} {zone}', fallback: 'SpeedNet New Ticket {ticket_no} [{priority}]\nPPPoE:{pppoe} Mob:{phone}\nOLT:{olt}\nAddr:{address}\nIssue:{subject}\nNote:{description}\nPlz call customer & update portal.' },
    { key: 'ticket_status_customer', label: 'Status Changed → Customer', when: 'Sent to customer on solve / close / status change', vars: '{ticket_no} {status}', fallback: 'Your support ticket {ticket_no} is now {status}. SpeedNet - Thank you.' },
  ];
  const startEditSystemFormat = (meta) => {
    const row = (smsTemplates.data || []).find((t) => t.template_name === meta.key);
    if (row) {
      setEditingTemplate(row);
      setNewTemplate({ template_name: row.template_name, template_type: row.template_type, message_body: row.message_body });
    } else {
      setNewTemplate({ template_name: meta.key, template_type: 'System', message_body: meta.fallback });
      setShowCreateTemplateModal(true);
    }
  };
  const [smsRecipient, setSmsRecipient] = useState('');
  const [smsSelectedTemplate, setSmsSelectedTemplate] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [newTemplate, setNewTemplate] = useState({ template_name: '', template_type: 'Custom', message_body: '' });
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [viewingTemplate, setViewingTemplate] = useState(null);
  // Body scroll-lock while any modal is open (mount/unmount pattern, restores prior value).
  useEffect(() => {
    const anyOpen = !!(showNewTicketModal || viewingTicket || editingTicket || closingTicket || verifyingTicket || cancellingTicket || showCreateTemplateModal || viewingTemplate || editingTemplate);
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showNewTicketModal, viewingTicket, editingTicket, closingTicket, verifyingTicket, cancellingTicket, showCreateTemplateModal, viewingTemplate, editingTemplate]);

  // Queries
  const dashboard = useQuery({
    queryKey: ['supportDashboard', selectedZone],
    queryFn: () => getSupportDashboard({ office: selectedZone })
  });

  const filterParams = useMemo(() => {
    // Tab overwrites status dropdown (dropdown disabled while tab is active — see Status select below).
    let statusFilter = selectedStatus || '';
    const allQueue = activeTab === 'all';
    if (allQueue) {
      // All is the active queue, not the archive. Never let a persisted or
      // stale Cancelled filter pull archived tickets back into this list.
      if (statusFilter === 'cancelled') statusFilter = '';
      if (!statusFilter) statusFilter = ALL_QUEUE_STATUSES.join(',');
    }
    // Back-compat: legacy single 'closed' value maps to Solved group.
    if (statusFilter === 'closed') statusFilter = 'closed,resolved';
    if (activeTab === 'pending') statusFilter = 'new,waiting_customer,reopened';
    else if (activeTab === 'processing') statusFilter = 'assigned,in_progress,waiting_vendor,verification_pending';
    else if (activeTab === 'solved') statusFilter = 'closed,resolved';
    // History tab: backend includes closed/resolved/cancelled via isHistory flag; don't force a status group.
    const isHistory = activeTab === 'history';

    let assigneeFilter = selectedAssignee;
    let myUserId = '';
    if (activeTab === 'my') {
      try {
        const u = JSON.parse(localStorage.getItem('user') || 'null');
        const uid = String(u?.id || u?.userId || u?.user_id || '').trim();
        if (uid && /^\d+$/.test(uid)) myUserId = uid;
        else assigneeFilter = String(u?.full_name || u?.name || assigneeFilter || '').trim();
      } catch {}
      // for My Tickets: use myUserId (assigned OR created), ignore separate assignee/creator filters
      if (myUserId) assigneeFilter = '';
    }

    // Client guard: ignore inverted date range (UI shows inline hint).
    const rangeValid = !(fromDate && toDate && fromDate > toDate);

    return {
      status: isHistory ? (statusFilter || undefined) : statusFilter,
      isHistory: isHistory ? true : undefined,
      // All tab: solved-before-today leaves the list at midnight (Dhaka)
      hideOldSolved: allQueue ? true : undefined,
      allQueue: allQueue ? true : undefined,
      category_id: selectedCategory,
      office: selectedZone,
      assignee: assigneeFilter,
      creator: activeTab === 'my' ? '' : selectedCreator,
      myUserId: myUserId,
      priority: selectedPriority,
      searchBy: searchByOption,
      q: searchQuery,
      complaintNo: complaintNo,
      complaint_no: complaintNo,
      fromDate: rangeValid ? fromDate : undefined,
      toDate: rangeValid ? toDate : undefined,
      closeDate: closeDate || undefined,
    };
  }, [activeTab, selectedStatus, selectedCategory, selectedZone, selectedAssignee, selectedCreator, selectedPriority, searchByOption, searchQuery, complaintNo, fromDate, toDate, closeDate]);

  const queryParams = useMemo(() => ({ ...filterParams, page: currentPage, limit: pageSize }), [filterParams, currentPage, pageSize]);
  const filterKey = JSON.stringify(filterParams);

  // reset to page 1 only when filters (not pagination) change
  useEffect(() => { setCurrentPage(1); }, [filterKey]);

  const tickets = useQuery({
    queryKey: ['supportTickets', queryParams],
    queryFn: () => getSupportTickets(queryParams),
    placeholderData: (previousData, previousQuery) => {
      const previousParams = previousQuery?.queryKey?.[1];
      if (!previousParams) return undefined;
      const previousFilters = { ...previousParams };
      delete previousFilters.page;
      delete previousFilters.limit;
      return JSON.stringify(previousFilters) === filterKey ? previousData : undefined;
    }
  });

  // My Tickets card: real server count with the SAME definition as the My tab
  // (assigned_to = me OR created_by = me) — not a current-page hint.
  const myUid = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      const id = String(u?.id || u?.userId || u?.user_id || '').trim();
      return /^\d+$/.test(id) ? id : '';
    } catch { return ''; }
  })();
  const myCountQ = useQuery({
    queryKey: ['myTicketsCount', myUid],
    queryFn: () => getSupportTickets({ myUserId: myUid, page: 1, limit: 10 }),
    enabled: !!myUid,
    staleTime: 30000
  });

  const smsTemplates = useQuery({
    queryKey: ['smsTemplates'],
    queryFn: getSmsTemplates,
    enabled: activeTab === 'sms'
  });

  // WhatsApp sender numbers (login maintenance): leave + support sessions.
  // Polled while the SMS tab is open; worker pushes live state to the DB.
  // Poll fast while any sender is unconnected so a fresh QR appears within
  // seconds; slow down once everything is connected.
  const waSessionsQ = useQuery({
    queryKey: ['waSessions'],
    queryFn: () => supportService.getWhatsAppSessions(),
    enabled: activeTab === 'sms',
    refetchInterval: (query) => {
      const sessions = query.state.data?.sessions || {};
      const allLive = Object.keys(sessions).length > 0 && Object.values(sessions).every((s) => s?.connected);
      return allLive ? 30000 : 5000;
    },
  });
  // Last Connect press per session — drives the inline "preparing" hint
  // (worker boots a browser first, QR needs ~30-60s; no "queued" popup).
  const waConnectAt = useRef({});
  const waReconnectMut = useMutation({
    mutationFn: (session) => supportService.reconnectWhatsAppSession(session),
    onMutate: (session) => { waConnectAt.current[session] = Date.now(); },
    onError: (e) => notify.error(e?.response?.data?.message || 'Connect failed.'),
  });
  const waDisconnectMut = useMutation({
    mutationFn: (session) => supportService.disconnectWhatsAppSession(session),
    onSuccess: (res) => {
      notify.success(res?.message || 'Disconnect queued — number will unlink shortly.');
      setTimeout(() => waSessionsQ.refetch(), 4000);
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Disconnect failed.'),
  });
  const confirmDisconnectSession = (meta) => {
    if (!window.confirm(`Unlink ${meta.title} (${waSessionsQ.data?.sessions?.[meta.key]?.account?.number || 'this number'})? Auto-notifications will stop until you connect again.`)) return;
    waDisconnectMut.mutate(meta.key);
  };
  const WA_SESSION_META = [
    { key: 'support', title: 'Support Number', desc: 'Ticket auto-notifications sender' },
  ];
  // SMS history (recipient, body snippet, status, time; paginated if backend provides).
  const smsLogsQ = useQuery({
    queryKey: ['smsLogs'],
    queryFn: () => supportService.getSmsLogs(),
    enabled: activeTab === 'sms',
  });

  // Gateway prepaid balance (SID SPEEDNET). Refreshed every minute while the
  // SMS tab is open; warn early so a zero balance never surprises anyone.
  const smsBalanceQ = useQuery({
    queryKey: ['smsBalance'],
    queryFn: () => supportService.getSmsBalance(),
    enabled: activeTab === 'sms',
    refetchInterval: 60000,
    staleTime: 60000,
  });
  const smsBal = smsBalanceQ.data;
  const smsBalNum = smsBal?.available ? Number(smsBal.balance) : null;
  const smsBalEmpty = smsBal?.available && smsBalNum <= 0;
  const smsBalLow = smsBal?.available && !smsBalEmpty && smsBalNum < 100;

  // Open-ticket warning for the create-modal selected customer.
  const selectedCustomerQ = useQuery({
    queryKey: ['customerComments', 'lookup', selectedCustomer?.id],
    queryFn: () => getCustomerComments(selectedCustomer.id),
    enabled: !!selectedCustomer?.id,
  });
  const selectedCustomerOpenTickets = selectedCustomerQ.data?.open_tickets
    || (selectedCustomerQ.data?.tickets || []).filter((ticket) => !['closed', 'resolved', 'cancelled'].includes(ticket.status));
  const hasSelectedCustomerOpenTickets = selectedCustomerOpenTickets.length > 0;

  // Mutations
  const createMut = useMutation({
    mutationFn: createSupportTicket,
    onSuccess: (res) => {
      const ticketNo = res?.ticket_no || res?.ticket?.ticket_no || '';
      if (ticketNo) {
        toast.success((t) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>Ticket {ticketNo} created</span>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              onClick={(e) => {
                e.stopPropagation();
                try { navigator.clipboard?.writeText(ticketNo); } catch {}
                toast.dismiss(t.id);
                notify.success(`Copied ${ticketNo}`);
              }}
            >
              Copy
            </button>
          </span>
        ), { duration: 6000 });
      } else {
        notify.success('Support ticket created successfully.');
      }
      if (res?.sms_skipped) notify.warning('Ticket created, but SMS was skipped (no number / SMS disabled).');
      setShowNewTicketModal(false);
      setSelectedCustomer(null); setLookup(''); setMatches([]);
      setActiveIndex(-1); setSearching(false);
      setConnMenuOpen(false); setConnSubOpen(false);
      setForm({ category_id: '', is_qc_support: false, is_on_call: false, description: '', priority: 'medium', source: 'phone', connection_type: 'Fiber', connection_subtype: '', office_name: isBranchOfficeUser ? assignedSupportOffice : '', send_sms: true, send_whatsapp: true, complaint_no: '' });
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportDashboard'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to create ticket.')
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateSupportTicket(id, data),
    onSuccess: () => {
      notify.success('Ticket updated / Re-assigned successfully.');
      setEditingTicket(null);
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportDashboard'] });
      qc.invalidateQueries({ queryKey: ['ticketComments'] });
      qc.invalidateQueries({ queryKey: ['customerComments'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to update.')
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, reason }) => deleteSupportTicket(id, { reason }),
    onSuccess: () => {
      notify.success('Ticket moved to Cancelled (history preserved).');
      setCancellingTicket(null);
      setCancellationReason('');
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportDashboard'] });
      qc.invalidateQueries({ queryKey: ['ticketComments'] });
      qc.invalidateQueries({ queryKey: ['customerComments'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to delete ticket.')
  });
  const reopenMut = useMutation({
    mutationFn: (id) => updateSupportTicket(id, { status: 'reopened' }),
    onSuccess: () => {
      notify.success('Cancelled ticket reopened.');
      setViewingTicket(null);
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportDashboard'] });
      qc.invalidateQueries({ queryKey: ['ticketComments'] });
      qc.invalidateQueries({ queryKey: ['customerComments'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to reopen ticket.')
  });

  // Admin-only undo for a ticket that was solved/closed by mistake.
  const revertMut = useMutation({
    mutationFn: ({ id }) => revertSolvedTicket(id, {}),
    onSuccess: (ticket) => {
      notify.success(`${ticket?.ticket_no || 'Ticket'} reverted to ${ticket?.status || 'active'}.`);
      setViewingTicket(null);
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportDashboard'] });
      qc.invalidateQueries({ queryKey: ['supportHistory'] });
      qc.invalidateQueries({ queryKey: ['ticketComments'] });
      qc.invalidateQueries({ queryKey: ['customerComments'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to revert ticket.')
  });
  const handleRevertTicket = async (t) => {
    const ok = await confirmAction({
      title: 'Revert solved ticket?',
      text: `${t.ticket_no || 'This ticket'} will return to its previous active status. Resolution note and solved/closed timestamps will be cleared.`,
      confirmText: 'Revert ticket',
      danger: true,
    });
    if (ok) revertMut.mutate({ id: t.id });
  };

  const verifyMut = useMutation({
    mutationFn: saveVerificationCall,
    onSuccess: (data, variables) => {
      if (data?.verification_completed === true) {
        notify.success(variables?.is_correction
          ? 'যাচাইকরণের সংশোধন সংরক্ষিত হয়েছে এবং যাচাইকরণ সম্পন্ন।'
          : 'যাচাইকরণ সম্পন্ন হয়েছে।');
      } else {
        notify.success('কলের ফলাফল সংরক্ষিত হয়েছে। যাচাইকরণ এখনো Pending—Completed করতে সব category প্রশ্নের উত্তর দিন।');
      }
      handleCloseVerification();
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportHistory'] });
      qc.invalidateQueries({ queryKey: ['supportVerification', 'queue'] });
      qc.invalidateQueries({ queryKey: ['supportVerification', 'report'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to save verification.')
  });

  const finishVerificationCallMut = useMutation({
    mutationFn: ({ ticketId, attemptId, outcome = 'abandoned', note }) => supportService.finishVerificationCallAttempt(
      ticketId,
      attemptId,
      {
        outcome,
        note,
      }
    ),
    onSuccess: (_data, variables) => {
      notify.success(variables.outcome === 'abandoned'
        ? 'কল attempt বাতিল করা হয়েছে। Verification Pending রয়েছে।'
        : 'কলের ফলাফল সংরক্ষণ হয়েছে। Verification Pending রয়েছে।');
      handleCloseVerification();
      qc.invalidateQueries({ queryKey: ['supportTickets'] });
      qc.invalidateQueries({ queryKey: ['supportVerification', 'queue'] });
      qc.invalidateQueries({ queryKey: ['supportVerification', 'report'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'কল attempt বাতিল করা যায়নি।')
  });

  const handleCancelVerificationCall = async () => {
    const ticketId = Number(verifyingTicket?.id);
    const attemptId = Number(verifyingTicket?.verification_attempt_id);
    if (!ticketId || !attemptId) {
      notify.error('সক্রিয় কল attempt পাওয়া যায়নি।');
      return;
    }

    const confirmed = await confirmAction({
      title: 'এই verification call বাতিল করবেন?',
      text: 'চলমান call attempt বন্ধ হবে; ticket Verification Pending থাকবে।',
      confirmText: 'কল বাতিল',
      danger: true,
    });
    if (confirmed) {
      finishVerificationCallMut.mutate({
        ticketId,
        attemptId,
        outcome: 'abandoned',
        note: 'Call attempt cancelled from the verification form.',
      });
    }
  };

  const requestCloseVerification = useCallback(async () => {
    const ticketId = Number(verifyingTicket?.id);
    const attemptId = Number(verifyingTicket?.verification_attempt_id);
    if (!ticketId || !attemptId) {
      handleCloseVerification();
      return;
    }
    if (finishVerificationCallMut.isPending) return;

    const confirmed = await confirmAction({
      title: 'চলমান verification call বন্ধ করবেন?',
      text: 'বন্ধ করলে চলমান call attempt বাতিল হবে; ticket Verification Pending থাকবে।',
      confirmText: 'কল বাতিল করে বন্ধ করুন',
      danger: true,
    });
    if (confirmed) {
      finishVerificationCallMut.mutate({
        ticketId,
        attemptId,
        outcome: 'abandoned',
        note: 'Call attempt cancelled by closing the verification form.',
      });
    }
  }, [
    finishVerificationCallMut,
    handleCloseVerification,
    verifyingTicket?.id,
    verifyingTicket?.verification_attempt_id,
  ]);

  // Escape-to-close for other modals (same pattern as viewingTicket above).
  // NOTE: keep below all modal state declarations (TDZ guard — see 9a58a1f).
  useEffect(() => {
    if (!showNewTicketModal && !closingTicket && !verifyingTicket && !editingTicket && !cancellingTicket && !showCreateTemplateModal && !viewingTemplate && !editingTemplate) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (editingTemplate) { setEditingTemplate(null); setNewTemplate({ template_name: '', template_type: 'Custom', message_body: '' }); }
      else if (viewingTemplate) setViewingTemplate(null);
      else if (showCreateTemplateModal) setShowCreateTemplateModal(false);
      else if (verifyingTicket) requestCloseVerification();
      else if (closingTicket) setClosingTicket(null);
      else if (cancellingTicket) { setCancellingTicket(null); setCancellationReason(''); }
      else if (editingTicket) setEditingTicket(null);
      else if (showNewTicketModal) setShowNewTicketModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewTicketModal, closingTicket, verifyingTicket, editingTicket, cancellingTicket, showCreateTemplateModal, viewingTemplate, editingTemplate, requestCloseVerification]);

  const handleSaveVerification = () => {
    const questions = getVerificationQuestions(verifyingTicket);
    const hasCompleteAnswers = questions.every((question) => (
      question.type === 'rating'
        ? Number.isInteger(verifyForm.answers?.[question.key]) &&
          verifyForm.answers[question.key] >= 0 &&
          verifyForm.answers[question.key] <= 10
        : typeof verifyForm.answers?.[question.key] === 'boolean'
    ));
    if (hasCompleteAnswers) {
      verifyMut.mutate({
        ticket_id: verifyingTicket.id,
        ...(verifyingTicket.verification_attempt_id
          ? { verification_attempt_id: verifyingTicket.verification_attempt_id }
          : {}),
        ...(verificationData ? { is_correction: true } : {}),
        answers: verifyForm.answers,
        feedback_remarks: verifyForm.feedback_remarks,
      });
      return;
    }

    const ticketId = Number(verifyingTicket?.id);
    const attemptId = Number(verifyingTicket?.verification_attempt_id);
    if (!ticketId || !attemptId || !callOutcome) {
      notify.error('কলের ফলাফল নির্বাচন করুন।');
      return;
    }
    finishVerificationCallMut.mutate({
      ticketId,
      attemptId,
      outcome: callOutcome,
      note: verifyForm.feedback_remarks,
    });
  };

  const ticketCommentsQ = useQuery({
    queryKey: ['ticketComments', viewingTicket?.id || verifyingTicket?.id],
    queryFn: () => getTicketComments(viewingTicket?.id || verifyingTicket.id),
    enabled: !!(viewingTicket?.id || verifyingTicket?.id),
    refetchInterval: 15000,
  });
  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline && ticketCommentsQ.data?.timeline) {
      setTimeout(() => { timeline.scrollTop = timeline.scrollHeight; }, 80);
    }
  }, [ticketCommentsQ.data?.timeline]);
  const customerCommentsQ = useQuery({
    queryKey: ['customerComments', viewingTicket?.customer_id],
    queryFn: () => getCustomerComments(viewingTicket.customer_id),
    enabled: !!viewingTicket?.customer_id,
  });
  const addCommentMut = useMutation({
    mutationFn: ({ id, data }) => addTicketComment(id, data),
    onSuccess: () => {
      notify.success('Comment added.');
      setNewComment('');
      qc.invalidateQueries({ queryKey: ['ticketComments', viewingTicket?.id] });
      qc.invalidateQueries({ queryKey: ['customerComments', viewingTicket?.customer_id] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to add comment.')
  });

  const sendSmsMut = useMutation({
    mutationFn: sendSmsPortal,
    onSuccess: () => {
      notify.success('SMS sent successfully!');
      setSmsBody(''); setSmsRecipient('');
      qc.invalidateQueries({ queryKey: ['smsLogs'] });
      qc.invalidateQueries({ queryKey: ['smsBalance'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to send SMS.')
  });

  const createTemplateMut = useMutation({
    mutationFn: createSmsTemplate,
    onSuccess: () => {
      notify.success('SMS Template created successfully!');
      setShowCreateTemplateModal(false);
      setNewTemplate({ template_name: '', template_type: 'Custom', message_body: '' });
      qc.invalidateQueries({ queryKey: ['smsTemplates'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to create template.')
  });

  const deleteTemplateMut = useMutation({
    mutationFn: deleteSmsTemplate,
    onSuccess: () => {
      notify.success('Template deleted.');
      qc.invalidateQueries({ queryKey: ['smsTemplates'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to delete.')
  });

  const updateTemplateMut = useMutation({
    mutationFn: ({ id, data }) => updateSmsTemplate(id, data),
    onSuccess: () => {
      notify.success('Template updated.');
      setEditingTemplate(null);
      qc.invalidateQueries({ queryKey: ['smsTemplates'] });
    },
    onError: (e) => notify.error(e?.response?.data?.message || 'Failed to update template.')
  });

  // Customer search debounce (stale-response guard via AbortController)
  useEffect(() => {
    if (lookup.trim().length < 2) { setMatches([]); setSearching(false); setActiveIndex(-1); return; }
    setSearching(true);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    const timer = setTimeout(async () => {
      try {
        const res = await searchSupportCustomers(lookup);
        if (ctrl.signal.aborted) return;
        const rows = Array.isArray(res) ? res : (res?.rows || res?.data || []);
        setMatches(rows);
        setActiveIndex(rows.length > 0 ? 0 : -1);
      } catch { if (!ctrl.signal.aborted) { setMatches([]); setActiveIndex(-1); } }
      finally { if (!ctrl.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [lookup]);

  // Keyboard nav: keep active result visible
  useEffect(() => {
    if (activeIndex >= 0) resultRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const availableCategories = (dashboard.data?.categories && dashboard.data.categories.length > 0)
    ? dashboard.data.categories 
    : DEFAULT_CATEGORIES;
  const categories = availableCategories.filter((category) =>
    !REMOVED_SUPPORT_CATEGORY_LABELS[Number(category.id)] &&
    !['qc_support', 'on_call_support'].includes(String(category.name || '').trim().toLowerCase().replace(/\s+/g, '_'))
  );
  const technicians = dashboard.data?.technicians || [];

  // server pagination: support both legacy array and new {rows,total} shape
  const ticketsPayload = tickets.data;
  const isPaginated = ticketsPayload && typeof ticketsPayload === 'object' && Array.isArray(ticketsPayload.rows);
  const rawTicketsList = isPaginated ? ticketsPayload.rows : (Array.isArray(ticketsPayload) ? ticketsPayload : []);
  const serverTotal = isPaginated ? Number(ticketsPayload.total || 0) : rawTicketsList.length;
  const counts = dashboard.data?.counts || {};
  // Old solved (solved before today) no longer belongs to Total/All.
  const oldSolved = Number(dashboard.data?.oldSolved || 0);
  const cancelledTickets = Number(counts.cancelled || 0);
  const totalTickets = Math.max(0, (Number(dashboard.data?.totalTickets) || serverTotal || 0) - oldSolved - cancelledTickets);
  const pendingTickets = (Number(counts.new || 0) + Number(counts.waiting_customer || 0) + Number(counts.reopened || 0)) || rawTicketsList.filter(t => ['new','waiting_customer','reopened'].includes(t.status)).length;
  const processingTickets = (Number(counts.in_progress || 0) + Number(counts.assigned || 0) + Number(counts.verification_pending || 0) + Number(counts.waiting_vendor || 0)) || rawTicketsList.filter(t => ['in_progress','assigned','verification_pending','waiting_vendor'].includes(t.status)).length;
  const solvedTickets = (Number(counts.closed || 0) + Number(counts.resolved || 0)) || rawTicketsList.filter(t => ['closed','resolved'].includes(t.status)).length;

  // My Tickets card uses the server count (same assigned-OR-created definition
  // as the My tab), so the number matches before and after clicking the card.
  const myTicketsCount = (() => {
    const d = myCountQ.data;
    const t = d && typeof d === 'object' && !Array.isArray(d) ? d.total : (Array.isArray(d) ? d.length : undefined);
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    return activeTab === 'my' ? serverTotal : 0;
  })();

  const formatResponseTime = (seconds) => {
    const total = Number(seconds || 0);
    if (!total) return '-';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const handleResetFilters = () => {
    localStorage.removeItem(FILTER_KEY);
    setActiveTab('all');
    setSelectedCategory('');
    setSelectedZone(isBranchOfficeUser ? assignedSupportOffice : '');
    setSelectedAssignee('');
    setSelectedCreator('');
    setSelectedStatus('');
    setSelectedPriority('');
    setSearchByOption('username');
    setFromDate('');
    setToDate('');
    setComplaintNo('');
    setSearchQuery('');
    setCloseDate('');
    setCurrentPage(1);
  };

  const pickCustomer = (c) => {
    if (!c) return;
    setSelectedCustomer(c); setLookup(c.pppoe_username); setMatches([]); setActiveIndex(-1);
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    if (!selectedCustomer) return notify.error('Please select a customer first.');
    if (!form.office_name) return notify.error('Please select Office / Branch.');
    if (!form.category_id) return notify.error('Please select a problem category.');
    if (!String(form.description || '').trim()) return notify.error('Please describe the problem in detail.');
    if (form.connection_type === 'Conseal' && !form.connection_subtype) return notify.error('Please select Conseal subtype (Fiber Conseal / CAT Conseal).');
    // CONTRACT: subject is backend auto-generated — never send from frontend.
    // CONTRACT: connection_subtype is required iff connection_type === 'Conseal', omitted otherwise.
    const rest = { ...form };
    rest.is_qc_support = Boolean(form.is_qc_support);
    rest.is_on_call = Boolean(form.is_on_call);
    rest.resolution_type = rest.is_on_call ? 'on_call' : 'field_visit';
    delete rest.subject;
    delete rest.connection_subtype;
    const payload = form.connection_type === 'Conseal'
      ? { ...rest, connection_subtype: form.connection_subtype }
      : rest;
    createMut.mutate({ ...payload, customer_id: selectedCustomer.id });
  };

    const openEditModal = (t) => {    if (isTerminalStatus(t.status)) {
      notify.error(`Ticket ${t.ticket_no} is ${t.status} (Solved/Closed). Please Reopen first to edit/re-assign.`);
      return;
    }
    // PRIMARY TECHNICIAN: store numeric ID in assigned_to (backend resolves safely); name kept display-only.
    const _rawAssign = t.assigned_to ?? '';
    const _techMatch = technicians.find((x) => String(x.id) === String(_rawAssign).trim() || String(x.full_name || x.name || '').trim().toLowerCase() === String(_rawAssign || '').trim().toLowerCase());
    const _techName = _techMatch ? (_techMatch.full_name || _techMatch.name) : '';
    const _displayAssign = t.assigned_to_name || _techName || (String(_rawAssign).trim() !== '' ? (/^\d+$/.test(String(_rawAssign).trim()) ? `ID:${String(_rawAssign).trim()}` : String(_rawAssign)) : '');
    const _backendAssign = _techMatch ? String(_techMatch.id) : (t.assigned_to_name || t.assigned_to || '');

    const _activeTechIds = new Set((technicians || []).map((x) => Number(x.id)));
    const _rawAdd = Array.isArray(t.additional_technician_ids) ? t.additional_technician_ids.map(Number) : [];
    const _validAdd = _rawAdd.filter((id) => _activeTechIds.has(id));

    setEditingTicket(t);
    setReassignError('');
    setReassignPickerOpen(false);
    setTechnicianSearch('');
    setEditForm({
      status: t.status,
      assigned_to: _backendAssign,
      assigned_to_name: _displayAssign,
      priority: t.priority || 'medium',
      category_id: SPECIAL_SUPPORT_CATEGORY_IDS.has(Number(t.category_id)) ? '' : (t.category_id || ''),
      is_qc_support: hasQcSupport(t),
      is_on_call: hasOnCallSupport(t),
      complaint_no: t.complaint_no || '',
      description: t.description || '',
      manual_phone: t.phone || '',
      manual_address: t.address || '',
      additional_technician_ids: _validAdd,
      note: '',
      send_sms: true, send_whatsapp: true
    });
  };

  const startViewEdit = (t) => {
    if (!t || isTerminalStatus(t.status)) return;
    const _r = t.assigned_to ?? '';
    const _m = technicians.find((x) => String(x.id) === String(_r).trim() || String(x.full_name || x.name || '').trim().toLowerCase() === String(_r || '').trim().toLowerCase());
    setViewForm({
      office_name: t.office_name || '',
      category_id: SPECIAL_SUPPORT_CATEGORY_IDS.has(Number(t.category_id)) ? '' : (t.category_id || ''),
      is_qc_support: hasQcSupport(t),
      is_on_call: hasOnCallSupport(t),
      priority: t.priority || 'medium',
      connection_type: t.connection_type || 'Fiber',
      connection_subtype: t.connection_subtype || '',
      complaint_no: t.complaint_no || '',
      description: t.description || '',
      manual_phone: t.phone || '',
      manual_address: t.address || t.customer_snapshot?.address || '',
      assigned_to: _m ? String(_m.id) : (t.assigned_to_name || t.assigned_to || ''),
    });
    setViewEditing(true);
  };

  const saveViewEdit = () => {
    if (!viewingTicket || !viewEditing) return;
    const data = {};
    const vf = viewForm;
    if (vf.office_name && vf.office_name !== viewingTicket.office_name) data.office_name = vf.office_name;
    if (!vf.category_id && !SPECIAL_SUPPORT_CATEGORY_IDS.has(Number(viewingTicket.category_id))) {
      notify.error('Please select a problem category.');
      return;
    }
    if (vf.category_id && String(vf.category_id) !== String(viewingTicket.category_id || '')) data.category_id = vf.category_id;
    if (Boolean(vf.is_qc_support) !== hasQcSupport(viewingTicket)) data.is_qc_support = Boolean(vf.is_qc_support);
    if (Boolean(vf.is_on_call) !== hasOnCallSupport(viewingTicket)) {
      data.is_on_call = Boolean(vf.is_on_call);
      data.resolution_type = data.is_on_call ? 'on_call' : 'field_visit';
    }
    if (vf.priority && vf.priority !== viewingTicket.priority) data.priority = vf.priority;
    if (vf.connection_type && vf.connection_type !== viewingTicket.connection_type) data.connection_type = vf.connection_type;
    if (vf.connection_type === 'Conseal') {
      if (!vf.connection_subtype) { notify.error('Please select Conseal subtype.'); return; }
      if (vf.connection_subtype !== viewingTicket.connection_subtype) data.connection_subtype = vf.connection_subtype;
    }
    if ((vf.complaint_no || '') !== (viewingTicket.complaint_no || '')) data.complaint_no = vf.complaint_no;
    if ((vf.description || '') !== (viewingTicket.description || '')) data.description = vf.description;
    if ((vf.manual_phone || '') !== (viewingTicket.phone || '')) data.manual_phone = vf.manual_phone;
    if ((vf.manual_address || '') !== (viewingTicket.address || viewingTicket.customer_snapshot?.address || '')) data.manual_address = vf.manual_address;
    if (vf.assigned_to !== undefined) {
      const cur = String(viewingTicket.assigned_to || '');
      const curName = String(viewingTicket.assigned_to_name || '');
      const nv = String(vf.assigned_to || '');
      if (nv !== cur && nv !== curName && !(nv === '' && cur === '')) data.assigned_to = vf.assigned_to;
    }
    if (!Object.keys(data).length) { setViewEditing(false); return; }
    updateMut.mutate({ id: viewingTicket.id, data }, {
      onSuccess: (res) => {
        const ticketId = String(viewingTicket.id);
        viewingTicketSaveVersionRef.current[ticketId] = (viewingTicketSaveVersionRef.current[ticketId] || 0) + 1;
        const updated = res?.ticket || res?.data || null;
        setViewingTicket((prev) => (updated && typeof updated === 'object' ? { ...prev, ...updated } : { ...prev, ...data, phone: data.manual_phone ?? prev.phone, address: data.manual_address ?? prev.address }));
        setViewEditing(false);
      }
    });
  };

  React.useEffect(() => { if (!viewingTicket) setViewEditing(false); }, [viewingTicket]);

  const handleEditSubmit = () => {
    if (!editingTicket) return;
    // Unassign allowed: empty lead sends assigned_to:'' (backend logs as Unassigned). Team-without-lead allowed.
    setReassignError('');
    // assigned_to_name is display-only; backend reads assigned_to (numeric ID or '')
    const _payload = { ...editForm };
    delete _payload.assigned_to_name;
    if (!editForm.category_id && !SPECIAL_SUPPORT_CATEGORY_IDS.has(Number(editingTicket.category_id))) {
      notify.error('Please select a problem category.');
      return;
    }
    if (!_payload.assigned_to) _payload.assigned_to = '';
    // Don't send category_id when '' (prevents accidental NULL-clear).
    if (_payload.category_id === '') delete _payload.category_id;
    _payload.is_qc_support = Boolean(editForm.is_qc_support);
    _payload.is_on_call = Boolean(editForm.is_on_call);
    _payload.resolution_type = _payload.is_on_call ? 'on_call' : 'field_visit';
    updateMut.mutate({ id: editingTicket.id, data: _payload });
  };

  // server-side pagination: current page is already server-filtered
  const paginatedList = rawTicketsList;
  const totalItems = serverTotal;
  const totalPages = isPaginated ? (ticketsPayload.totalPages || Math.ceil(totalItems / pageSize) || 1) : Math.ceil(totalItems / pageSize) || 1;
  // Clamp: if filters shrink totalPages below currentPage, jump back into range.
  useEffect(() => {
    if (!tickets.isPlaceholderData && currentPage > totalPages) setCurrentPage(totalPages);
  }, [tickets.isPlaceholderData, currentPage, totalPages]);

  // On view open, fetch full ticket (fields + attachments) and merge into viewingTicket.
  useEffect(() => {
    const id = viewingTicket?.id;
    if (!id) return;
    let cancelled = false;
    const ticketId = String(id);
    const saveVersionAtRequest = viewingTicketSaveVersionRef.current[ticketId] || 0;
    (async () => {
      try {
        const full = await supportService.getTicket(id);
        const t = full?.ticket || full?.data || full;
        if (!cancelled && saveVersionAtRequest === (viewingTicketSaveVersionRef.current[ticketId] || 0) && t && typeof t === 'object') {
          setViewingTicket((prev) => {
            if (!prev || prev.id !== id) return prev;
            // Strip undefined/null so enriched API data never clobbers existing list-row values
            const clean = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== null));
            return { ...prev, ...clean, attachments: t.attachments ?? prev.attachments };
          });
        }
      } catch { /* keep row data; timeline queries still run */ }
    })();
    return () => { cancelled = true; };
  }, [viewingTicket?.id]);

  const verificationContactNumber = String(verifyingTicket?.complaint_no || '').trim()
    || String(verifyingTicket?.phone || '').trim();

  return (
    <div className={`support-page px-3 py-2${modalOnly ? ' support-page--modal-only' : ''}`}>
      {/* 1. Header Section + Actions (same row to save vertical space) */}
      <div className="support-header-section">
        <div>
          <h2 className="support-main-title">
            <i className="fas fa-headset text-primary" /> Support & Ticket Management
          </h2>
          <p className="support-sub-title">Manage, assign and resolve customer support tickets</p>
        </div>
        <div className="support-header-actions-wrap d-flex flex-column align-items-end gap-2">
          <div className="support-header-btns d-flex flex-wrap gap-2 justify-content-end">
            {canCreateTx && (
            <button className={`pill-btn ${activeTab === 'sms' ? 'active' : ''}`} onClick={() => setActiveTab(activeTab === 'sms' ? 'all' : 'sms')}>
              <i className="fas fa-comment-sms text-info" /> SMS Portal
            </button>
            )}
            {canCreateTx && (
            <button className="btn-open-new-ticket" onClick={() => setShowNewTicketModal(true)}>
              <i className="fas fa-plus" /> Open New Ticket
            </button>
            )}
            {canSyncTx && (
            <button className="pill-btn" onClick={() => syncAllMut.mutate()} disabled={syncAllMut.isPending} title="Sync All MikroTik">
              <i className="fas fa-sync text-success" /> {syncAllMut.isPending ? 'Syncing...' : 'Sync All'}
            </button>
            )}
          </div>
          <div className="support-breadcrumbs">
            <span>Dashboard</span> / <span className="text-dark fw-bold">Support & Ticketing</span>
          </div>
        </div>
      </div>

      {/* 2. Stats Cards (click filters same page — Solved opens history in a NEW tab) */}
      {isHeadOfficeUser && (
        <SupportOfficeShortcuts selectedOffice={selectedZone} onSelect={(office) => { setSelectedZone(office); setCurrentPage(1); }} />
      )}
      <div className="row g-2 mb-2">
        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <button type="button" onClick={() => { setSelectedStatus(''); setActiveTab('all'); }}
            className={`support-stat-card clickable w-100 text-start ${activeTab === 'all' ? 'active' : ''}`}>
            <div className="stat-icon-wrapper blue">
              <i className="fas fa-file-lines" />
            </div>
            <div className="stat-info">
              <span className="stat-label">Total Tickets</span>
              <span className="stat-val">{totalTickets}</span>
              <span className="stat-subtext">All tickets</span>
            </div>
          </button>
        </div>

        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <button type="button" onClick={() => setActiveTab('pending')}
            className={`support-stat-card clickable w-100 text-start ${activeTab === 'pending' ? 'active' : ''}`}>
            <div className="stat-icon-wrapper orange">
              <i className="fas fa-hourglass-start" />
            </div>
            <div className="stat-info">
              <span className="stat-label">Pending Tickets</span>
              <span className="stat-val">{pendingTickets}</span>
              <span className="stat-subtext">Awaiting Response</span>
            </div>
          </button>
        </div>

        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <button type="button" onClick={() => setActiveTab('processing')}
            className={`support-stat-card clickable w-100 text-start ${activeTab === 'processing' ? 'active' : ''}`}>
            <div className="stat-icon-wrapper amber">
              <i className="fas fa-gear" />
            </div>
            <div className="stat-info">
              <span className="stat-label">Processing Tickets</span>
              <span className="stat-val">{processingTickets}</span>
              <span className="stat-subtext">In Progress</span>
            </div>
          </button>
        </div>

        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <a href="/support/history/solved" target="_blank" rel="noopener" title="Open Solved Tickets history in a new tab"
            className={`support-stat-card clickable w-100 text-start ${activeTab === 'solved' ? 'active' : ''}`}>
            <div className="stat-icon-wrapper green">
              <i className="fas fa-circle-check" />
            </div>
            <div className="stat-info">
              <span className="stat-label">Solved Tickets <i className="fas fa-arrow-up-right-from-square newtab-hint" /></span>
              <span className="stat-val">{solvedTickets}</span>
              <span className="stat-subtext">Closed + resolved</span>
            </div>
          </a>
        </div>

        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <button type="button" onClick={() => setActiveTab('my')}
            className={`support-stat-card clickable w-100 text-start ${activeTab === 'my' ? 'active' : ''}`}>
            <div className="stat-icon-wrapper indigo">
              <i className="fas fa-user-check" />
            </div>
            <div className="stat-info">
              <span className="stat-label">My Tickets</span>
              <span className="stat-val">{myTicketsCount}</span>
              <span className="stat-subtext">Assigned to me</span>
            </div>
          </button>
        </div>

        <div className="col-6 col-sm-6 col-md-4 col-xl">
          <div className="support-stat-card">
            <div className="stat-icon-wrapper purple">
              <i className="fas fa-clock-rotate-left" />
            </div>
            <div className="stat-info">
              <span className="stat-label">Avg. Response Time</span>
              <span className="stat-val">{formatResponseTime(dashboard.data?.avgResponseSeconds)}</span>
              <span className="stat-subtext">Avg first response</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Compact Search Bar + Collapsible Filters */}
      <div className="support-filters-panel">
        {/* Top Header: Unified Search Bar + Filters Toggle + Reset */}
        <div className={`filter-header-bar d-flex flex-wrap align-items-center justify-content-between gap-3 ${filtersOpen ? 'mb-3 pb-3 border-bottom' : ''}`}>
          <div className="filter-search-combo flex-grow-1" style={{ maxWidth: '720px' }}>
            <div className="st-searchbar" role="search">
              <span className="st-searchbar-icon" aria-hidden="true">
                <i className="fas fa-search" />
              </span>
              <select
                id="flt-searchby"
                className="st-searchbar-select"
                value={searchByOption}
                onChange={(e) => setSearchByOption(e.target.value)}
                aria-label="Search field category"
              >
                <option value="all">All fields</option>
                <option value="username">User Name / ID</option>
                <option value="phone">Mobile Number</option>
                <option value="customer_name">Customer Name</option>
              </select>
              <input
                type="text"
                className="st-searchbar-input"
                placeholder="Search ticket by username, customer, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    qc.invalidateQueries({ queryKey: ['supportTickets'] });
                  }
                }}
                aria-label="Search tickets"
              />
              <button
                className="st-searchbar-btn"
                type="button"
                onClick={() => qc.invalidateQueries({ queryKey: ['supportTickets'] })}
              >
                Search
              </button>
            </div>
          </div>

          <div className="filter-toggle-btns-wrap d-flex align-items-center gap-2">
            <button
              className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2 px-3 py-2 fw-semibold rounded-3"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              title={filtersOpen ? 'Hide filter options' : 'Show filter options'}
            >
              <i className={`fas ${filtersOpen ? 'fa-chevron-up' : 'fa-sliders'}`} />
              <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </button>
            <button
              className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-2 px-3 py-2 fw-semibold rounded-3"
              onClick={handleResetFilters}
              title="Reset all filters to default"
            >
              <i className="fas fa-rotate-left" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>

        {/* Structured Filter Controls Grid (collapsible — 4 equal columns on desktop) */}
        {filtersOpen && (
        <div className="row g-2">
          {/* Col 1: Problem Category */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-category">
              <i className="fas fa-layer-group text-primary me-1" /> Problem Category
            </label>
            <select id="flt-category" className="form-select filter-select" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name_bn || c.name}</option>)}
            </select>
          </div>

          {/* Col 2: Office / Branch */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-office">
              <i className="fas fa-building text-primary me-1" /> Office / Branch
            </label>
            <select id="flt-office" className="form-select filter-select" value={selectedZone} onChange={(e) => setSelectedZone(e.target.value)} disabled={isBranchOfficeUser} title={isBranchOfficeUser ? 'Your view is limited to your assigned office.' : undefined}>
              <option value="">All Offices</option>
              {SUPPORT_OFFICES.map((b) => (
                <option key={b.code} value={b.name}>{b.displayName}</option>
              ))}
            </select>
          </div>

          {/* Col 3: Solved By (Assignee) */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-assignee">
              <i className="fas fa-user-check text-primary me-1" /> Solved By (Assign To)
            </label>
            <select id="flt-assignee" className="form-select filter-select" value={selectedAssignee} onChange={(e) => setSelectedAssignee(e.target.value)}>
              <option value="">All Assignees</option>
              {technicians.map(t => (
                <option key={t.id} value={t.id}>{t.full_name || t.name}</option>
              ))}
            </select>
          </div>

          {/* Col 4: Status */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-status">
              <i className="fas fa-traffic-light text-primary me-1" /> Status
            </label>
            <select id="flt-status" className="form-select filter-select" value={selectedStatus} onChange={(e) => {
              const nextStatus = e.target.value;
              setSelectedStatus(nextStatus);
              if (nextStatus === 'cancelled') setActiveTab('history');
            }} disabled={['pending','processing','solved'].includes(activeTab)} title={['pending','processing','solved'].includes(activeTab) ? `Status is controlled by the "${activeTab}" tab.` : 'Filter by status'}>
              <option value="">All Statuses</option>
              <option value="new,waiting_customer,reopened">Pending (new / waiting_customer / reopened)</option>
              <option value="assigned,in_progress,waiting_vendor,verification_pending">Processing (assigned / in_progress / waiting_vendor)</option>
              <option value="closed,resolved">Solved (closed / resolved)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Col 5: Priority */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-priority">
              <i className="fas fa-flag text-primary me-1" /> Priority
            </label>
            <select id="flt-priority" className="form-select filter-select" value={selectedPriority} onChange={(e) => setSelectedPriority(e.target.value)}>
              <option value="">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Col 6: Complaint Number */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-complaint">
              <i className="fas fa-hashtag text-primary me-1" /> Complaint Number
            </label>
            <input 
              id="flt-complaint"
              type="text" 
              className="form-control filter-input" 
              placeholder="e.g. 01700000000"
              value={complaintNo}
              onChange={(e) => setComplaintNo(e.target.value)}
            />
          </div>

          {/* Col 7: Created By */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-creator">
              <i className="fas fa-user-edit text-primary me-1" /> Created By
            </label>
            <input id="flt-creator" className="form-control filter-input" placeholder="Creator name/ID" value={selectedCreator} onChange={(e) => setSelectedCreator(e.target.value)} disabled={activeTab === 'my'} title={activeTab === 'my' ? 'My Tickets tab already filters by you — creator filter is ignored.' : 'Filter by creator name or ID'} />
          </div>

          {/* Col 8: Date Range & Closed Date combined dropdown/compact */}
          <div className="col-12 col-sm-6 col-lg-3">
            <label className="filter-group-label" htmlFor="flt-from">
              <i className="fas fa-calendar-alt text-primary me-1" /> Complaint Date Range
            </label>
            <div className="filter-date-range-wrap d-flex align-items-center gap-1">
              <input id="flt-from" type="date" className="form-control filter-input px-2" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="From Date" aria-label="From Date" />
              <span className="text-muted small">to</span>
              <input id="flt-to" type="date" className="form-control filter-input px-2" value={toDate} onChange={(e) => setToDate(e.target.value)} title="To Date" aria-label="To Date" />
            </div>
            {fromDate && toDate && fromDate > toDate && (
              <small className="text-danger d-block mt-1">From date must be on or before To date.</small>
            )}
          </div>
        </div>
        )}
      </div>

      {/* 5. Main Tickets Table */}
      {activeTab !== 'sms' ? (
        <div className="support-table-card">
          <div className="table-responsive">
            <table className="ticket-management-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Complaint No.</th>
                  <th>Customer Info</th>
                  <th>Address</th>
                  <th>Problem Category / Office</th>
                  <th>Priority</th>
                  <th>Timeline</th>
                  <th>Created By</th>
                  <th>Status</th>
                  <th>Assign To</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.isLoading || tickets.isPlaceholderData ? (
                  <tr><td colSpan={11} className="text-center py-5">Loading tickets...</td></tr>
                ) : tickets.isError ? (
                  <tr><td colSpan={11} className="text-center py-5">
                    <div className="text-danger fw-bold mb-1">Failed to load tickets</div>
                    <div className="text-muted small mb-2">{tickets.error?.response?.data?.message || tickets.error?.message || 'Unknown error.'}</div>
                    <button className="btn btn-sm btn-outline-secondary" onClick={handleResetFilters}>Clear filters</button>{' '}
                    <button className="btn btn-sm btn-outline-primary" onClick={() => tickets.refetch()}>Retry</button>
                  </td></tr>
                ) : paginatedList.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-5 text-muted">No support tickets found matching current filters.</td></tr>
                ) : (
                  paginatedList.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setViewingTicket(t)}
                      style={{ cursor: 'pointer' }}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if (e.target.closest?.('button, a, input, select, textarea, [role="button"], [role="link"], [contenteditable="true"]')) return;
                        e.preventDefault();
                        setViewingTicket(t);
                      }}
                      aria-label={`View ticket ${t.ticket_no || t.id}`}
                    >
                      {/* 1. Ticket No */}
                      <td>
                        <span className="fw-bold text-primary">{t.ticket_no || '—'}</span>
                      </td>
                      {/* 2. Complaint Number */}
                      <td>
                        <span className="fw-semibold text-secondary" style={{ fontSize: '12.5px' }}>
                          {t.complaint_no || '—'}
                        </span>
                      </td>
                      {/* 3. Customer Info: Name, Username & Phone */}
                      <td>
                        <div className="d-flex flex-column gap-1">
                          <div className="d-flex align-items-center gap-1">
                            <span className="fw-bold text-dark" style={{ textTransform: 'capitalize' }}>
                              {getCustomerShortName(t.pppoe_username || t.customer_snapshot?.pppoe_username)}
                            </span>
                            <i className="fas fa-user-circle text-primary" style={{ fontSize: '11px' }} />
                          </div>
                          <div className="d-flex align-items-center gap-2" style={{ fontSize: '12px' }}>
                            <span className="text-secondary fw-semibold">{t.pppoe_username || '—'}</span>
                            {t.phone && (
                              <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                                • <i className="fas fa-phone-alt me-1 text-secondary" style={{ fontSize: '10px' }} />{t.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* 4. Address */}
                      <td>
                        {(() => {
                          const addr = t.address || t.customer_snapshot?.address || '';
                          if (!addr) return <span className="text-muted">—</span>;
                          return (
                            <div className="text-truncate" style={{ maxWidth: '160px', fontSize: '12px', color: '#334155' }} title={addr}>
                              <i className="fas fa-map-marker-alt text-danger me-1" style={{ fontSize: '10px' }} />
                              {addr}
                            </div>
                          );
                        })()}
                      </td>
                      {/* 3. Problem & Office */}
                      <td>
                        <div className="d-flex flex-column">
                          <span className="text-dark fw-semibold">
                            {getProblemCategoryLabel(t)}
                          </span>
                          {hasQcSupport(t) && (
                            <div className="support-flag-badges mt-1">
                              <span className="support-flag-badge qc"><i className="fas fa-clipboard-check me-1" aria-hidden="true" />QC Support</span>
                            </div>
                          )}
                          <div className="d-flex align-items-center gap-1 flex-wrap">
                            <span className="text-muted small" style={{ fontSize: '11px' }}>
                              <i className="fas fa-building me-1" style={{ fontSize: '10px' }} />
                              {t.office_name || t.zone || 'Corporate Office'}
                            </span>
                          </div>
                        </div>
                      </td>
                      {/* 4. Priority */}
                      <td>
                        <span className={`badge-priority-${t.priority || 'low'}`}>
                          {t.priority || 'Low'}
                        </span>
                      </td>
                      {/* 5. Timeline (Created + Solved/Duration) */}
                      <td>
                        {(() => {
                          const fmtDuration = (start, end) => {
                            const s = new Date(start), e = end ? new Date(end) : new Date();
                            const diff = Math.max(0, e - s);
                            const d = Math.floor(diff / 86400000);
                            const h = Math.floor((diff % 86400000) / 3600000);
                            const m = Math.floor((diff % 3600000) / 60000);
                            const sec = Math.floor((diff % 60000) / 1000);
                            return `${d}d ${h}h:${String(m).padStart(2,'0')}m:${String(sec).padStart(2,'0')}s`;
                          };
                          const end = t.closed_at || t.resolved_at;
                          const label = end ? 'Solved' : 'Duration';
                          const durValue = t.created_at ? fmtDuration(t.created_at, end) : '-';
                          return (
                            <div className="d-flex flex-column">
                            <span className="ticket-timeline-date"><time dateTime={t.created_at || undefined}>{fmt(t.created_at)}</time></span>
                            <span className="ticket-timeline-detail">
                                <span className="fw-semibold">{label}:</span> {durValue}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      {/* 6. Created By */}
                      <td>
                        <span
                          className="ticket-created-by"
                          title={t.created_by_name || t.created_by_username || '—'}
                        >
                          <i className="fas fa-user-edit me-1 text-secondary" style={{ fontSize: '10px' }} />
                          <span className="ticket-created-by-name">
                            {t.created_by_name || t.created_by_username || '—'}
                          </span>
                        </span>
                      </td>
                      {/* 7. Status */}
                      <td>
                        {(() => { const b = getStatusBadge(t.status); return <span className={b.cls}>{b.label}</span>; })()}
                      </td>
                      {/* 7. Assign To */}
                      <td onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const isAssigned = !!(t.assigned_to_name || t.assigned_to);
                          const locked = isTerminalStatus(t.status);
                          const isOnCall = hasOnCallSupport(t);
                          const team = resolveTeamNames(t.additional_technician_ids, technicians)
                            .filter((m) => Number(m.id) !== Number(t.assigned_to));
                          const assigneeName = t.assigned_to_name || (t.assigned_to ? `ID:${t.assigned_to}` : 'Unassigned');
                          const teamTitle = team.length ? `Team: ${team.map((m) => m.name).join(', ')}` : '';
                          return (
                            <div className="ticket-assignment-stack">
                              {isOnCall && !isAssigned ? (
                                canAssignTx && !locked ? (
                                  <button
                                    type="button"
                                    className="ticket-on-call-control"
                                    title="Assign technician"
                                    aria-label={`Assign technician to ticket ${t.ticket_no || t.id}`}
                                    onClick={() => openEditModal(t)}
                                  >
                                    <i className="fas fa-headset me-1" aria-hidden="true" />On-Call
                                  </button>
                                ) : (
                                  <span className="ticket-on-call-control is-static" title="On-Call Support (Phone call / NOC)">
                                    <i className="fas fa-headset me-1" aria-hidden="true" />On-Call
                                  </span>
                                )
                              ) : null}
                              {(!isOnCall || isAssigned) && (
                                canAssignTx && !locked ? (
                                  <button
                                    type="button"
                                    className="ticket-assignee-control"
                                    title={`${isOnCall ? 'On-Call Support. ' : ''}${isAssigned ? `Re-Assign technician${teamTitle ? ` (${teamTitle})` : ''}` : 'Assign technician'}`}
                                    aria-label={`${isOnCall ? 'On-Call Support. ' : ''}${isAssigned ? 'Re-assign' : 'Assign'} technician${isAssigned ? ` ${assigneeName}` : ''} for ticket ${t.ticket_no || t.id}${teamTitle ? `. ${teamTitle}` : ''}`}
                                    onClick={(e) => { e.stopPropagation(); openEditModal(t); }}
                                  >
                                    {isOnCall && <i className="fas fa-headset ticket-on-call-icon" aria-hidden="true" />}
                                    <i className={`fas ${isAssigned ? 'fa-user-check' : 'fa-user-plus'}`} aria-hidden="true" />
                                    <span className="ticket-assignee-name">{assigneeName}</span>
                                    {team.length > 0 && (
                                      <span className="ticket-team-count" title={teamTitle}>+{team.length}</span>
                                    )}
                                  </button>
                                ) : (
                                  <span
                                    className="ticket-assignee-control is-static"
                                    title={`${isOnCall ? 'On-Call Support. ' : ''}${isAssigned ? `Assigned: ${assigneeName}` : 'Unassigned'}${teamTitle ? ` (${teamTitle})` : ''}`}
                                  >
                                    {isOnCall && <i className="fas fa-headset ticket-on-call-icon" aria-hidden="true" />}
                                    <i className={`fas ${isAssigned ? 'fa-user-check' : 'fa-user'}`} aria-hidden="true" />
                                    <span className="ticket-assignee-name">{assigneeName}</span>
                                    {team.length > 0 && (
                                      <span className="ticket-team-count" title={teamTitle}>+{team.length}</span>
                                    )}
                                  </span>
                                )
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="table-actions-group">
                          {isTerminalStatus(t.status) ? (
                            <>
                              {t.status === 'resolved' && canAssignTx && (
                                <button className="btn-table-action text-success" title="Close with report" aria-label={`Close ticket ${t.ticket_no || t.id} with report`} onClick={(e) => {
                                  e.stopPropagation();
                                  openClosingModal(t);
                                }}>
                                  <i className="fas fa-check-circle" aria-hidden="true" />
                                </button>
                              )}
                            </>
                          ) : null}
                          {!isTerminalStatus(t.status) && (
                            <button className="btn-table-action text-success" title="Solved / Close" aria-label={`Solve or close ticket ${t.ticket_no || t.id}`} onClick={(e) => {
                              e.stopPropagation();
                              openClosingModal(t);
                            }}>
                              <i className="fas fa-check-circle" aria-hidden="true" />
                            </button>
                          )}
                          {canAssignTx && (
                          <button className={`btn-table-action ${isTerminalStatus(t.status) ? 'text-muted' : 'text-danger'}`} title={isTerminalStatus(t.status) ? 'Only active tickets can be cancelled' : 'Cancel ticket'} aria-label={`Cancel ticket ${t.ticket_no || t.id}`} disabled={isTerminalStatus(t.status)} style={{ cursor: isTerminalStatus(t.status) ? 'not-allowed' : 'pointer' }} onClick={(e) => {
                            e.stopPropagation();
                            if (isTerminalStatus(t.status)) { notify.error('Only active tickets can be cancelled.'); return; }
                            setCancellationReason('');
                            setCancellingTicket(t);
                          }}>
                            <i className="fas fa-trash" aria-hidden="true" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Server-side Pagination */}
          <div className="table-pagination-row">
            <div>Showing {totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalItems)} of {totalItems} entries {isPaginated ? '' : '(local)'}</div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <label className="small text-muted m-0" htmlFor="pageSizeSel">Per page</label>
              <select id="pageSizeSel" className="form-select form-select-sm" style={{ width: '80px' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <div className="ticket-pager" role="group" aria-label="Ticket pagination">
                <button className="btn btn-light border btn-sm" aria-label="First page" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>First</button>
                <button className="btn btn-light border btn-sm" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Previous</button>
                <span className="ticket-pager-indicator" aria-current="page">{currentPage} / {totalPages}</span>
                <button className="btn btn-light border btn-sm" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</button>
                <button className="btn btn-light border btn-sm" aria-label="Last page" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>Last</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* SMS Portal Section */
        <div className="row g-4">
          <div className="col-12">
            <div className="support-table-card p-3">
              <h5 className="fw-bold mb-1"><i className="fab fa-whatsapp text-success me-2" /> WhatsApp Number</h5>
              <p className="small text-muted mb-3">Support sender login status, QR scan and reconnect. Auto-refreshes every few seconds while connecting.</p>
              {waSessionsQ.isLoading ? (
                <div className="small text-muted">Loading WhatsApp status...</div>
              ) : waSessionsQ.isError ? (
                <div className="small text-danger">Status unavailable: {waSessionsQ.error?.response?.data?.message || waSessionsQ.error?.message || 'Unknown error.'}</div>
              ) : (
                <div className="row g-2">
                  {WA_SESSION_META.map((meta) => {
                    const s = waSessionsQ.data?.sessions?.[meta.key] || {};
                    const live = !!s.connected;
                    const connecting = waReconnectMut.isPending
                      || (Date.now() - (waConnectAt.current[meta.key] || 0) < 90000 && !live && !s.hasQr);
                    const dot = live ? '#16a34a' : (s.hasQr ? '#f59e0b' : '#dc2626');
                    const stateLabel = live ? 'Connected' : (connecting ? 'Connecting…' : (s.state === 'qr' || s.hasQr ? 'Scan QR to connect' : (s.state || 'Disconnected')));
                    return (
                      <div key={meta.key} className="col-12 col-lg-6">
                        <div className="border rounded p-3 h-100 bg-light">
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: dot, display: 'inline-block' }} />
                            <strong style={{ fontSize: '13px' }}>{meta.title}</strong>
                            <span className="small text-muted">• {meta.desc}</span>
                            <span className="ms-auto small fw-bold" style={{ color: dot }}>{stateLabel}</span>
                          </div>
                          <div className="small mb-2">
                            {s.account?.number
                              ? <span>Number: <strong>{s.account.number}</strong>{s.account?.name ? ` (${s.account.name})` : ''}</span>
                              : <span className="text-muted">Number will appear after login</span>}
                            {s.lastSeenAt && <span className="text-muted"> • seen {formatDateTime(s.lastSeenAt)}</span>}
                          </div>
                          {s.error && <div className="small text-danger mb-2">{s.error}</div>}
                          {connecting && <div className="small text-muted mb-2">Starting secure session — the browser is opening WhatsApp Web, QR appears in about a minute…</div>}
                          <div className="d-flex align-items-center gap-3 flex-wrap">
                            {!live && s.hasQr && s.qr && (
                              <QRCode value={s.qr} size={140} level="M" aria-label={`${meta.title} WhatsApp QR`} />
                            )}
                            <button
                              className="btn btn-sm btn-outline-success"
                              disabled={waReconnectMut.isPending || connecting}
                              onClick={() => waReconnectMut.mutate(meta.key)}
                              title={live ? 'Restart this WhatsApp session' : 'Start session and get a fresh QR'}
                            >
                              <i className={`fas ${connecting ? 'fa-spinner fa-spin' : 'fa-sync'} me-1`} /> {connecting ? 'Connecting…' : (live ? 'Reconnect' : 'Connect')}
                            </button>
                            {live && (
                              <button
                                className="btn btn-sm btn-outline-danger"
                                disabled={waDisconnectMut.isPending}
                                onClick={() => confirmDisconnectSession(meta)}
                                title="Unlink this WhatsApp number"
                              >
                                <i className="fas fa-unlink me-1" /> Disconnect
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="col-12">
            <div className="support-table-card p-3">
              <h5 className="fw-bold mb-1"><i className="fas fa-robot text-success me-2" /> Auto SMS Formats</h5>
              <p className="small text-muted mb-3">Ticket events (create / assign / status change) send these texts automatically by <strong>SMS + WhatsApp</strong>. Edit the wording here — <code>{'{ticket_no} {subject} {status}'}</code> fill in by themselves.</p>
              <div className="row g-2">
                {SYSTEM_SMS_FORMATS.map((meta) => {
                  const row = (smsTemplates.data || []).find((t) => t.template_name === meta.key);
                  return (
                    <div key={meta.key} className="col-12 col-lg-4">
                      <div className="border rounded p-3 h-100 bg-light">
                        <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                          <strong style={{ fontSize: '13px' }}>{meta.label}</strong>
                          <span className={`badge ${row ? 'bg-success' : 'bg-secondary'}`}>{row ? 'Custom' : 'Default'}</span>
                        </div>
                        <div className="small text-muted mb-2">{meta.when}</div>
                        <div className="small bg-white border rounded p-2 mb-2" style={{ whiteSpace: 'pre-wrap', minHeight: '52px' }}>{row ? row.message_body : meta.fallback}</div>
                        <div className="small text-muted mb-2">Variables: <code>{meta.vars}</code></div>
                        <button className="btn btn-sm btn-outline-primary" onClick={() => startEditSystemFormat(meta)}>
                          <i className="fas fa-edit me-1" /> {row ? 'Edit Format' : 'Customize'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="col-lg-5">
            <div className="support-table-card p-4">
              <h5 className="fw-bold mb-3"><i className="fas fa-paper-plane text-primary me-2" /> Individual SMS Portal</h5>
              {smsBal?.available ? (
                <div className={`alert ${smsBalEmpty ? 'alert-danger' : smsBalLow ? 'alert-warning' : 'alert-success'} py-2 small mb-3`} role="status">
                  SMS Balance ({smsBal.sid || 'SPEEDNET'}): <strong>{smsBalNum}</strong>
                  {smsBalEmpty ? ' — Balance is zero. Recharge before sending.' : smsBalLow ? ' — Running low, recharge soon.' : ''}
                  {smsBal.stale ? ' (last known)' : ''}
                  <button type="button" className="btn btn-sm btn-link p-0 ms-2" disabled={smsBalanceQ.isFetching} onClick={() => smsBalanceQ.refetch()} title="Refresh balance">Refresh</button>
                </div>
              ) : smsBalanceQ.isError ? (
                <div className="alert alert-secondary py-2 small mb-3" role="status">SMS balance unavailable — sends will report gateway errors directly.</div>
              ) : null}
              <label className="form-label fw-bold small" htmlFor="sms-to">SEND TO</label>
              <input id="sms-to" className="form-control mb-3" placeholder="01970XXXXXX" value={smsRecipient} onChange={(e) => setSmsRecipient(e.target.value)} />
              
              <label className="form-label fw-bold small" htmlFor="sms-template">SELECT TEMPLATE</label>
              <select 
                id="sms-template"
                className="form-select mb-3" 
                value={smsSelectedTemplate}
                onChange={(e) => {
                  setSmsSelectedTemplate(e.target.value);
                  const found = (smsTemplates.data || []).find(tmpl => String(tmpl.id) === e.target.value);
                  if (found) setSmsBody(found.message_body);
                }}
              >
                <option value="">-- Choose Template --</option>
                {(smsTemplates.data || []).map(tmpl => (
                  <option key={tmpl.id} value={tmpl.id}>{tmpl.template_name}</option>
                ))}
              </select>

              <label className="form-label fw-bold small" htmlFor="sms-desc">SMS DESCRIPTION</label>
              <textarea id="sms-desc" className="form-control mb-3" rows="6" value={smsBody} onChange={(e) => setSmsBody(e.target.value)} placeholder="Type SMS text..." />

              <button className="btn btn-primary w-100" disabled={sendSmsMut.isPending || smsBalEmpty} title={smsBalEmpty ? 'SMS balance is zero — recharge first' : 'Send SMS'} onClick={() => sendSmsMut.mutate({ send_to: smsRecipient, message_body: smsBody })}>
                {sendSmsMut.isPending ? 'Sending...' : smsBalEmpty ? 'No Balance — Recharge First' : 'Send SMS'}
              </button>
            </div>
          </div>

          <div className="col-lg-7">
            <div className="support-table-card p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="fw-bold m-0"><i className="fas fa-list-alt text-success me-2" /> SMS Templates</h5>
                <button className="btn btn-sm btn-success text-white" onClick={() => setShowCreateTemplateModal(true)}>
                  <i className="fas fa-plus me-1" /> Add Template
                </button>
              </div>

              <div className="table-responsive">
                <table className="ticket-management-table sms-table">
                  <thead>
                    <tr>
                      <th>Template Name</th>
                      <th>Type</th>
                      <th>Message Body</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(smsTemplates.data || []).filter((tmpl) => tmpl.template_type !== 'System').map(tmpl => (
                      <tr key={tmpl.id} style={{ cursor: 'pointer' }} onClick={() => setViewingTemplate(tmpl)} title="Click to view" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewingTemplate(tmpl); } }} aria-label={`View template ${tmpl.template_name}`}>
                        <td><strong>{tmpl.template_name}</strong></td>
                        <td><span className="badge bg-info">{tmpl.template_type}</span></td>
                        <td><small className="text-truncate d-inline-block" style={{ maxWidth: 'min(300px,40vw)', textOverflow: 'ellipsis', overflow: 'hidden' }}>{tmpl.message_body}</small></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-primary" title="Edit template" aria-label={`Edit template ${tmpl.template_name}`} onClick={() => { setEditingTemplate(tmpl); setNewTemplate({ template_name: tmpl.template_name, template_type: tmpl.template_type, message_body: tmpl.message_body }); }}>
                              <i className="fas fa-edit" aria-hidden="true" />
                            </button>
                            <button className="btn btn-sm btn-outline-danger" title="Delete template" aria-label={`Delete template ${tmpl.template_name}`} onClick={() => { if (window.confirm(`Delete template "${tmpl.template_name}"?`)) deleteTemplateMut.mutate(tmpl.id); }}>
                              <i className="fas fa-trash" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="support-table-card p-4 mt-4">
              <h5 className="fw-bold mb-3"><i className="fas fa-clock-rotate-left text-primary me-2" /> SMS History</h5>
              {smsLogsQ.isLoading ? (
                <div className="small text-muted">Loading SMS history...</div>
              ) : smsLogsQ.isError ? (
                <div className="small text-danger">{smsLogsQ.error?.response?.data?.message || smsLogsQ.error?.message || 'Failed to load SMS history.'}</div>
              ) : (() => {
                const payload = smsLogsQ.data;
                const rows = Array.isArray(payload) ? payload : (payload?.rows || payload?.logs || payload?.data || []);
                const total = Array.isArray(payload) ? rows.length : (payload?.total ?? payload?.count ?? rows.length);
                if (!rows.length) return <div className="small text-muted">No SMS history yet.</div>;
                return (
                  <>
                    <div className="table-responsive">
                      <table className="ticket-management-table sms-table">
                        <thead>
                          <tr>
                            <th>Recipient</th>
                            <th>Message</th>
                            <th>Status</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((s, i) => (
                            <tr key={s.id || i}>
                              <td>{s.recipient || s.send_to || s.phone || s.to || '—'}</td>
                              <td><small title={s.message_body || s.body || ''}>{String(s.message_body || s.body || '—').slice(0, 80)}{String(s.message_body || s.body || '').length > 80 ? '…' : ''}</small></td>
                              <td><span className="badge bg-light text-dark border">{s.status || '—'}</span></td>
                              <td><small><time dateTime={s.created_at || s.sent_at || s.time || undefined}>{fmt(s.created_at || s.sent_at || s.time)}</time></small></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {total > rows.length && <small className="text-muted">Showing {rows.length} of {total}</small>}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 1: OPEN NEW SUPPORT TICKET (Page 3 of PDF) --- */}
      {showNewTicketModal && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewTicketModal(false); }}>
          <div className="support-modal p-4" style={{ width: 'min(780px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="new-ticket-modal-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => setShowNewTicketModal(false)}>×</button>
            <h5 id="new-ticket-modal-title" className="fw-bold text-primary mb-3"><i className="fas fa-ticket me-2" /> New Support Ticket Entry</h5>

            <form onSubmit={handleCreateSubmit}>
              <div className="mb-3">
                <label className="form-label fw-bold small">USER NAME (ID)</label>
                <div className="position-relative">
                  <input
                    ref={lookupInputRef}
                    className="form-control pe-5"
                    value={lookup}
                    onChange={(e) => { setLookup(e.target.value); setSelectedCustomer(null); setActiveIndex(-1); }}
                    onFocus={() => { if (lookupBlurTimer.current) clearTimeout(lookupBlurTimer.current); }}
                    onBlur={() => { lookupBlurTimer.current = setTimeout(() => { setMatches([]); setActiveIndex(-1); }, 150); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setMatches([]); setActiveIndex(-1); }
                      else if (e.key === 'ArrowDown' && matches.length > 0) { e.preventDefault(); setActiveIndex((i) => (i + 1) % matches.length); }
                      else if (e.key === 'ArrowUp' && matches.length > 0) { e.preventDefault(); setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1)); }
                      else if (e.key === 'Enter' && activeIndex >= 0 && matches[activeIndex]) { e.preventDefault(); pickCustomer(matches[activeIndex]); }
                    }}
                    placeholder="Type username / mobile to search..."
                    autoComplete="off"
                  />
                  {lookup && (
                    <button
                      type="button"
                      className="btn btn-sm btn-link position-absolute top-50 translate-middle-y p-0 px-2 text-muted"
                      style={{ right: 4 }}
                      title="Clear search"
                      aria-label="Clear customer search"
                      onClick={() => { setLookup(''); setMatches([]); setSelectedCustomer(null); setActiveIndex(-1); lookupInputRef.current?.focus(); }}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  )}
                  {searching && (
                    <span className="position-absolute top-50 translate-middle-y me-2" style={{ right: lookup ? 28 : 8 }}>
                      <span className="spinner-border spinner-border-sm text-primary" role="status" aria-label="Searching" />
                    </span>
                  )}
                </div>
                {matches.length > 0 && (
                  <div className="customer-results mt-1" role="listbox">
                    {matches.map((c, idx) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={idx === activeIndex}
                        ref={(el) => { resultRefs.current[idx] = el; }}
                        className={`customer-result d-flex flex-column align-items-stretch${idx === activeIndex ? ' active' : ''}`}
                        key={c.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => pickCustomer(c)}
                        title={`${c.pppoe_username} · ${c.phone || 'Phone n/a'} · ${c.address || c.comment_raw || 'No Address'}`}
                      >
                        <span className="d-flex align-items-center gap-1 min-w-0 w-100">
                          <strong className="text-truncate">{c.pppoe_username}</strong>
                          {c.vlan_id && <span className="badge bg-info flex-shrink-0">VLAN {c.vlan_id}</span>}
                        </span>
                        <span className="customer-result-sub text-truncate d-block w-100 text-start">{c.phone || 'Phone n/a'} · {c.address || c.comment_raw || 'No Address'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!searching && lookup.trim().length >= 2 && matches.length === 0 && !selectedCustomer && (
                  <div className="text-muted small mt-1">No match found</div>
                )}
              </div>

              {selectedCustomer && (
                <div className="p-3 bg-light border rounded mb-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <strong className="small text-truncate">{selectedCustomer.pppoe_username}</strong>
                    <span className="d-flex gap-2 flex-shrink-0 align-items-center">
                      {(() => {
                        const onlineRaw = selectedCustomer.is_online ?? selectedCustomer.online ?? selectedCustomer.status;
                        const disabledRaw = selectedCustomer.is_disabled ?? selectedCustomer.disabled ?? selectedCustomer.isDisabled;
                        const isDisabled = disabledRaw === true || String(disabledRaw || '').toLowerCase() === 'disabled';
                        const isOnline = !isDisabled && (onlineRaw === true || String(onlineRaw || '').toLowerCase() === 'online' || String(onlineRaw || '').toLowerCase() === 'up' || String(onlineRaw || '').toLowerCase() === 'active');
                        if (isDisabled) return <span className="badge bg-secondary">Disabled</span>;
                        return isOnline ? <span className="badge bg-success">Online</span> : <span className="badge bg-danger">Offline</span>;
                      })()}
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setSelectedCustomer(null); lookupInputRef.current?.focus(); }}>Change</button>
                      <button type="button" className="btn btn-sm btn-link text-muted p-0 px-1" title="Clear customer" aria-label="Clear selected customer" onClick={() => { setSelectedCustomer(null); setLookup(''); setMatches([]); setActiveIndex(-1); }}><span aria-hidden="true">✕</span></button>
                    </span>
                  </div>
                  <div className="row g-2 small">
                    <div className="col-md-4"><strong>Client Code:</strong> {selectedCustomer.id}</div>
                    <div className="col-md-4"><strong>Mobile:</strong> {selectedCustomer.phone || 'N/A'}</div>
                    <div className="col-md-4"><strong>Package:</strong> {selectedCustomer.package_profile || selectedCustomer.service || selectedCustomer.profile || 'N/A'}</div>
                    <div className="col-md-4"><strong>VLAN:</strong> {selectedCustomer.vlan_id || '-'} {selectedCustomer.vlan_name && <small className="text-muted">({selectedCustomer.vlan_name})</small>}</div>
                    {(selectedCustomer.session || selectedCustomer.ip || selectedCustomer.last_ip) && (
                      <div className="col-md-8"><strong>Session:</strong> {selectedCustomer.session || selectedCustomer.ip || selectedCustomer.last_ip || '-'}{selectedCustomer.service ? ` · ${selectedCustomer.service}` : ''}</div>
                    )}
                    {(selectedCustomer.last_synced_at || selectedCustomer.synced_at || selectedCustomer.updated_at) && (() => {
                      const raw = selectedCustomer.last_synced_at || selectedCustomer.synced_at || selectedCustomer.updated_at;
                      const t = new Date(raw).getTime();
                      const ageH = Number.isNaN(t) ? null : (Date.now() - t) / 3600000;
                      return (
                        <div className="col-md-8">
                          <strong>Last synced:</strong> {fmt(raw)}{ageH != null && ageH > 2 && <span className="badge bg-warning text-dark ms-1">STALE</span>}
                        </div>
                      );
                    })()}
                    <div className="col-12"><strong>Address:</strong> {selectedCustomer.address || selectedCustomer.comment_raw || 'N/A'}</div>
                    {(() => {
                      if (!selectedCustomer?.id || selectedCustomerQ.isLoading || !hasSelectedCustomerOpenTickets) return null;
                      const latest = selectedCustomerOpenTickets[0];
                      return (
                        <div className="col-12">
                          <div className="alert alert-warning py-2 mb-0">
                            <strong>Unresolved ticket exists:</strong> {latest.ticket_no} ({latest.status})
                            {Number(latest.total_count) > 1 ? ` + ${Number(latest.total_count) - 1} more` : ''}.
                            Resolve or close it before opening another ticket.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="row g-3 mb-3">
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small">OFFICE / BRANCH *</label>
                  <select className="form-select" value={form.office_name} onChange={(e) => setForm({ ...form, office_name: e.target.value })} required disabled={isBranchOfficeUser} title={isBranchOfficeUser ? 'Ticket office is fixed to your assigned office.' : undefined}>
                    <option value="">Select Office</option>
                    {SUPPORT_OFFICES.map((b) => <option key={b.code} value={b.name}>{b.displayName}</option>)}
                  </select>
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small" htmlFor="new-ticket-problem-category">PROBLEM CATEGORY *</label>
                  <select id="new-ticket-problem-category" className="form-select" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                    <option value="">Select Category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name_bn || c.name}</option>)}
                  </select>
                </div>
                <div className="col-12">
                  <fieldset className="support-flags-fieldset">
                    <legend className="form-label fw-bold small mb-2">ADDITIONAL SUPPORT (OPTIONAL)</legend>
                    <div className="support-flag-options">
                      <label className={`support-flag-option qc${form.is_qc_support ? ' active' : ''}`}>
                        <input type="checkbox" checked={Boolean(form.is_qc_support)} onChange={(e) => setForm((prev) => ({ ...prev, is_qc_support: e.target.checked }))} />
                        <span><i className="fas fa-clipboard-check me-2" aria-hidden="true" />QC Support</span>
                      </label>
                      <label className={`support-flag-option on-call${form.is_on_call ? ' active' : ''}`}>
                        <input type="checkbox" checked={Boolean(form.is_on_call)} onChange={(e) => setForm((prev) => ({ ...prev, is_on_call: e.target.checked }))} />
                        <span><i className="fas fa-headset me-2" aria-hidden="true" />On-Call Support</span>
                      </label>
                    </div>
                  </fieldset>
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small">PROBLEM PRIORITY *</label>
                  <select className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small">SOURCE</label>
                  <select className="form-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="walk_in">Walk-in</option>
                    <option value="facebook">Facebook</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small">COMPLAINT NUMBER</label>
                  <input className="form-control" value={form.complaint_no} maxLength={50} onChange={(e) => setForm({ ...form, complaint_no: e.target.value })} placeholder="017..." />
                </div>
                <div className="col-12 col-sm-6">
                  <label className="form-label fw-bold small">Connection Type *</label>
                  <div className="conn-dropdown">
                    <button
                      type="button"
                      className="form-control text-start d-flex justify-content-between align-items-center"
                      onClick={() => setConnMenuOpen((o) => !o)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConnMenuOpen(false); setConnSubOpen(false); } }}
                      aria-haspopup="true"
                      aria-expanded={connMenuOpen}
                      aria-label="Select connection type"
                    >
                      <span>{form.connection_type === 'Conseal' && form.connection_subtype ? `${form.connection_subtype}` : form.connection_type}</span>
                      <i className={`fas fa-chevron-${connMenuOpen ? 'up' : 'down'} ms-2 text-muted small`} />
                    </button>
                    {connMenuOpen && (
                      <>
                        <div className="conn-backdrop" onClick={() => setConnMenuOpen(false)} />
                        <ul className="conn-menu">
                          {['Fiber', 'CAT', 'Wireless', 'Cat6', 'Other'].map((t) => (
                            <li key={t}>
                              <button type="button" className={`conn-item${form.connection_type === t ? ' active' : ''}`} onClick={() => { setForm((prev) => ({ ...prev, connection_type: t, connection_subtype: '' })); setConnMenuOpen(false); }}>
                                {t}{form.connection_type === t && <i className="fas fa-check ms-auto" />}
                              </button>
                            </li>
                          ))}
                          <li className="conn-has-sub">
                            <button type="button" className={`conn-item${form.connection_type === 'Conseal' ? ' active' : ''}`} onMouseEnter={() => setConnSubOpen(true)} onClick={() => setConnSubOpen((o) => !o)}>
                              Conseal<i className="fas fa-chevron-right ms-auto small text-muted" />
                            </button>
                            <ul className={`conn-submenu${connSubOpen || undefined ? ' show' : ''}`}>
                              {['Fiber Conseal', 'CAT Conseal'].map((s) => (
                                <li key={s}>
                                  <button type="button" className={`conn-item${form.connection_subtype === s ? ' active' : ''}`} onClick={() => { setForm((prev) => ({ ...prev, connection_type: 'Conseal', connection_subtype: s })); setConnMenuOpen(false); setConnSubOpen(false); }}>
                                    {s}{form.connection_subtype === s && <i className="fas fa-check ms-auto" />}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </li>
                        </ul>
                      </>
                    )}
                  </div>
                </div>
                <div className="col-12 col-sm-6 d-flex align-items-end">
                  <div className="form-check support-sms-check mb-1">
                    <input className="form-check-input" type="checkbox" id="sendSmsModal" checked={form.send_sms} onChange={(e) => setForm({ ...form, send_sms: e.target.checked })} />
                    <label className="form-check-label fw-bold small" htmlFor="sendSmsModal">SMS to Client?</label>
                  </div>
                  <div className="form-check support-sms-check mb-1 ms-3">
                    <input className="form-check-input" type="checkbox" id="sendWaModal" checked={form.send_whatsapp} onChange={(e) => setForm({ ...form, send_whatsapp: e.target.checked })} />
                    <label className="form-check-label fw-bold small" htmlFor="sendWaModal">WhatsApp to Client?</label>
                  </div>
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label fw-bold small" htmlFor="new-ticket-description">REMARKS / NOTE / COMMENTS *</label>
                <textarea id="new-ticket-description" className="form-control support-remarks" rows="4" value={form.description} maxLength={2000} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="সমস্যাটি বিস্তারিত লিখুন—কী সমস্যা হচ্ছে, কখন থেকে হচ্ছে এবং কী error বা লক্ষণ দেখছেন?" required />
                <small className="text-muted d-block">সমস্যার বিস্তারিত, কখন থেকে হচ্ছে এবং প্রাসঙ্গিক error বা লক্ষণ লিখুন—এতে support team দ্রুত সঠিকভাবে বুঝে সমাধান দিতে পারবে।</small>
                <small className="text-muted">{String(form.description || '').length}/2000</small>
              </div>

              <div className="support-modal-footer d-flex justify-content-end gap-2 flex-wrap">
                <button type="button" className="btn btn-light border" onClick={() => setShowNewTicketModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary px-4" disabled={createMut.isPending || selectedCustomerQ.isLoading || hasSelectedCustomerOpenTickets}>
                  {createMut.isPending ? 'Submitting...' : hasSelectedCustomerOpenTickets ? 'Resolve Existing Ticket First' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: EDIT & RE-ASSIGN SUPPORT TICKET (Page 4 of PDF) --- */}
      {editingTicket && (
        <div className="support-modal-backdrop">
          <div className="support-modal reassign-modal" role="dialog" aria-modal="true" aria-labelledby="reassign-modal-title">
            <header className="reassign-head">
              <div className="reassign-head-icon"><i className="fas fa-headset" /></div>
              <div className="reassign-head-copy">
                <span className="reassign-eyebrow">SUPPORT TICKET</span>
                <h5 id="reassign-modal-title">Edit &amp; Re-Assign</h5>
                <div className="reassign-ticket-meta"><strong>{editingTicket.ticket_no}</strong><span>{editingTicket.pppoe_username || 'Customer ticket'}</span></div>
              </div>
              <button type="button" className="reassign-close" onClick={() => setEditingTicket(null)} aria-label="Close dialog">×</button>
            </header>

            <div className="reassign-content">
              <section className="reassign-section reassign-team-section">
                <div className="reassign-section-heading">
                  <div><span className="reassign-step">01</span><div><h6>Assigned team</h6><p>Choose a lead technician and add teammates if needed. Lead may be left empty to unassign.</p></div></div>
                  <span className="reassign-team-total">{((editForm.assigned_to || editForm.assigned_to_name) ? 1 : 0) + ((editForm.additional_technician_ids || []).length)}/9 selected</span>
                </div>
                <div className="tech-picker reassign-picker">
                  <label className="reassign-field-label" htmlFor="reassign-tech-search">Search technicians</label>
                  <div className="reassign-search-wrap"><i className="fas fa-search" aria-hidden="true" />
                    <input id="reassign-tech-search" className="form-control" value={technicianSearch} onChange={(e) => { setTechnicianSearch(e.target.value); setReassignPickerOpen(true); }} onClick={() => setReassignPickerOpen(true)} onFocus={() => setReassignPickerOpen(true)} onBlur={() => setReassignPickerOpen(false)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setReassignPickerOpen(false); setTechnicianSearch(''); } }} placeholder="Type a name to search..." role="combobox" aria-expanded={reassignPickerOpen} aria-controls="reassign-tech-listbox" aria-autocomplete="list" autoComplete="off" />
                  </div>
                  {reassignError && <p className="reassign-error" role="alert">{reassignError}</p>}
                  {reassignPickerOpen && <div id="reassign-tech-listbox" className="tech-picker-results" role="listbox" aria-label="Technicians">{(() => { const q = (technicianSearch || '').trim().toLowerCase(); const memberIds = (editForm.additional_technician_ids || []).map(String); const filtered = [...technicians].filter((t) => !q || String(t.full_name || t.name || '').toLowerCase().includes(q)).sort((a, b) => String(a.full_name || a.name).localeCompare(String(b.full_name || b.name))); if (!filtered.length) return <div className="tech-picker-empty">No technician found</div>; return filtered.map((t) => { const sid = String(t.id); const leadId = String(editForm.assigned_to || '').trim(); const leadName = String(editForm.assigned_to_name || '').trim().toLowerCase(); const isPrimary = leadId === sid || (!/^\d+$/.test(leadId) && leadId !== '' && leadId.toLowerCase() === String(t.full_name || t.name || '').toLowerCase()) || (leadName !== '' && leadName === String(t.full_name || t.name || '').toLowerCase()); const isMember = memberIds.includes(sid); const isSelected = isPrimary || isMember; return <button type="button" key={t.id} id={`reassign-opt-${t.id}`} role="option" aria-selected={isSelected} disabled={isSelected} onMouseDown={(e) => e.preventDefault()} onClick={() => { const total = ((editForm.assigned_to || editForm.assigned_to_name) ? 1 : 0) + ((editForm.additional_technician_ids || []).length); if (total >= 9) { setReassignError('Team limit is 9 members.'); return; } if (!(editForm.assigned_to || editForm.assigned_to_name)) { setEditForm({ ...editForm, assigned_to: String(t.id), assigned_to_name: t.full_name || t.name }); setReassignError(''); } else if (!(editForm.additional_technician_ids || []).map(String).includes(sid)) setEditForm({ ...editForm, additional_technician_ids: [...(editForm.additional_technician_ids || []), sid] }); setTechnicianSearch(''); setReassignPickerOpen(false); }}><TechnicianAvatar technician={t} /><span>{t.full_name || t.name} <small className="text-muted">ID:{t.id}{t.phone ? ` · ${t.phone}` : ''}</small></span>{isSelected && <span className="tech-picker-check">✓</span>}</button>; }); })()}</div>}
                </div>
                <div className="reassign-assigned-list">
                  {(editForm.assigned_to || editForm.assigned_to_name) && <div className="assigned-team-row primary"><span className="reassign-role-icon"><i className="fas fa-star" /></span><span className="reassign-person"><small>LEAD TECHNICIAN</small>{editForm.assigned_to_name || (/^\d+$/.test(String(editForm.assigned_to).trim()) ? `ID:${String(editForm.assigned_to).trim()}` : editForm.assigned_to)}</span><button type="button" className="reassign-remove" aria-label="Remove primary technician" onClick={() => { setEditForm({ ...editForm, assigned_to: '', assigned_to_name: '' }); }}>×</button></div>}
                  {(editForm.additional_technician_ids || []).map((id) => { const t = technicians.find(x => String(x.id) === String(id)); const tName = t ? (t.full_name || t.name) : ''; return t ? <div key={id} className="assigned-team-row"><span className="reassign-role-icon"><i className="fas fa-user" /></span><span className="reassign-person"><small>TEAM MEMBER</small>{tName}</span><button type="button" className="reassign-remove" aria-label={`Remove ${tName}`} onClick={() => setEditForm({ ...editForm, additional_technician_ids: editForm.additional_technician_ids.filter(x => String(x) !== String(id)) })}>×</button></div> : null; })}
                  {!editForm.assigned_to && !(editForm.additional_technician_ids || []).length && <div className="reassign-empty-team"><i className="fas fa-user-plus" /><span>No technicians selected yet</span></div>}
                </div>
              </section>

              <div className="reassign-details-grid">
                <section className="reassign-section">
                  <div className="reassign-section-heading"><div><span className="reassign-step">02</span><div><h6>Ticket details</h6><p>Update category and urgency.</p></div></div></div>
                  <div className="reassign-grid-2col">
                    <div>
                      <label className="reassign-field-label" htmlFor="reassign-category">Problem category</label>
                      <select id="reassign-category" className="form-select reassign-control" value={editForm.category_id} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}>
                        <option value="">Select category</option>
                        {editForm.category_id && !categories.some((category) => String(category.id) === String(editForm.category_id)) && (
                          <option value={editForm.category_id} disabled>
                            Legacy category ({editingTicket.category_name || REMOVED_SUPPORT_CATEGORY_LABELS[Number(editForm.category_id)] || `ID:${editForm.category_id}`})
                          </option>
                        )}
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name_bn || c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="reassign-field-label" htmlFor="reassign-priority">Priority</label>
                      <select id="reassign-priority" className="form-select reassign-control" value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className="reassign-field-label" htmlFor="reassign-complaint">Complaint number</label>
                    <input id="reassign-complaint" className="form-control reassign-control" value={editForm.complaint_no || ''} maxLength={50} onChange={(e) => setEditForm({ ...editForm, complaint_no: e.target.value })} placeholder="Complaint number (optional)" />
                  </div>
                  <fieldset className="support-flags-fieldset mt-3">
                    <legend className="reassign-field-label">Additional support (optional)</legend>
                    <div className="support-flag-options">
                      <label className={`support-flag-option qc${editForm.is_qc_support ? ' active' : ''}`}>
                        <input type="checkbox" checked={Boolean(editForm.is_qc_support)} onChange={(e) => setEditForm((prev) => ({ ...prev, is_qc_support: e.target.checked }))} />
                        <span><i className="fas fa-clipboard-check me-2" aria-hidden="true" />QC Support</span>
                      </label>
                      <label className={`support-flag-option on-call${editForm.is_on_call ? ' active' : ''}`}>
                        <input type="checkbox" checked={Boolean(editForm.is_on_call)} onChange={(e) => setEditForm((prev) => ({ ...prev, is_on_call: e.target.checked }))} />
                        <span><i className="fas fa-headset me-2" aria-hidden="true" />On-Call Support</span>
                      </label>
                    </div>
                  </fieldset>
                </section>
                <section className="reassign-section">
                  <div className="reassign-section-heading"><div><span className="reassign-step">03</span><div><h6>Customer contact</h6><p>Correct contact details for this ticket.</p></div></div></div>
                  <div className="reassign-grid-2col">
                    <div>
                      <label className="reassign-field-label" htmlFor="reassign-phone">Mobile</label>
                      <input id="reassign-phone" className="form-control reassign-control" value={editForm.manual_phone || ''} maxLength={11} onChange={(e) => setEditForm({ ...editForm, manual_phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="tel" />
                      {editForm.manual_phone && !/^01\d{9}$/.test(String(editForm.manual_phone).trim()) && (
                        <small className="text-danger">BD mobile must be 11 digits starting with 01.</small>
                      )}
                    </div>
                    <div>
                      <label className="reassign-field-label" htmlFor="reassign-address">Address</label>
                      <input id="reassign-address" className="form-control reassign-control" value={editForm.manual_address || ''} maxLength={500} onChange={(e) => setEditForm({ ...editForm, manual_address: e.target.value })} placeholder="Customer address" />
                    </div>
                  </div>
                </section>
              </div>

              <section className="reassign-section reassign-note-section">
                <label className="reassign-field-label" htmlFor="reassign-description">Remark / work note</label>
                <textarea id="reassign-description" className="form-control reassign-control" rows="2" value={editForm.description} maxLength={2000} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="Add a note about the issue or assignment..." />
                <small className="text-muted">{String(editForm.description || '').length}/2000</small>
              </section>

              <div className="reassign-notify-grid">
                <label className="reassign-sms-option" htmlFor="reassignSms">
                  <span className="reassign-sms-icon"><i className="fas fa-comment-dots" /></span>
                  <span><strong>SMS notification</strong><small>Notify technician on assign/reassign</small></span>
                  <input type="checkbox" id="reassignSms" checked={editForm.send_sms} onChange={(e) => setEditForm({ ...editForm, send_sms: e.target.checked })} />
                </label>
                <label className="reassign-sms-option" htmlFor="reassignWa">
                  <span className="reassign-sms-icon"><i className="fab fa-whatsapp" /></span>
                  <span><strong>WhatsApp notification</strong><small>Notify technician on assign/reassign</small></span>
                  <input type="checkbox" id="reassignWa" checked={editForm.send_whatsapp} onChange={(e) => setEditForm({ ...editForm, send_whatsapp: e.target.checked })} />
                </label>
              </div>
            </div>

            <footer className="reassign-footer">
              <button type="button" className="btn btn-light border" onClick={() => setEditingTicket(null)}>Cancel</button>
              <button type="button" className="btn btn-primary reassign-save" onClick={handleEditSubmit} disabled={updateMut.isPending}>
                {updateMut.isPending ? <><i className="fas fa-spinner fa-spin me-2" />Saving...</> : <><i className="fas fa-check me-2" />{editingTicket.assigned_to || editingTicket.assigned_to_name ? 'Save changes' : 'Assign ticket'}</>}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* --- MODAL 3: TICKET VIEW (Premium 2-col format) --- */}
      {viewingTicket && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) handleCloseViewingTicket(); }}>
          <div className="support-modal ticket-detail-modal ticket-premium p-0" role="dialog" aria-modal="true" aria-label={viewingTicket.ticket_no || 'Support ticket details'}>
            {/* Ticket Header */}
            <div className="ticket-detail-header ticket-premium-header">
              <button ref={viewCloseRef} className="modal-close-btn ticket-premium-close" onClick={handleCloseViewingTicket} aria-label="Close ticket details">×</button>
              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div className="min-w-0">
                  <h5 className="fw-bold mb-1 ticket-premium-no"><i className="fas fa-ticket-alt me-2" />{viewingTicket.ticket_no}</h5>
                  <small className="ticket-premium-date">{viewingTicket.complaint_no && viewingTicket.complaint_no !== viewingTicket.ticket_no ? `Complaint: ${viewingTicket.complaint_no} · ` : ''}<time dateTime={viewingTicket.created_at || undefined}>{fmt(viewingTicket.created_at)}</time></small>
                </div>
                <div className="text-end ticket-premium-statusWrap">
                  <div className="mb-1 d-flex align-items-center justify-content-end gap-2">
                    <button type="button" className="ticket-premium-msg" title="Timeline / comments" onClick={() => { try { timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }}><i className="fas fa-comment-dots" />{(ticketCommentsQ.data?.timeline?.length || 0) + ((customerCommentsQ.data?.comments || []).filter((c) => Number(c.ticket_id) !== Number(viewingTicket?.id)).length)}</button>
                    {(() => { const b = getStatusBadge(viewingTicket.status); return <span className={`${b.cls} ticket-premium-pill`}>{b.label}</span>; })()}
                    <button type="button" className="ticket-premium-bell" title={isTerminalStatus(viewingTicket.status) ? `Ticket ${viewingTicket.status} — Reopen to re-assign` : (viewingTicket.assigned_to_name || viewingTicket.assigned_to ? `Assigned: ${viewingTicket.assigned_to_name || viewingTicket.assigned_to}` : 'Unassigned — needs assignment')} disabled={isTerminalStatus(viewingTicket.status)} style={isTerminalStatus(viewingTicket.status) ? { opacity: 0.5, cursor: 'not-allowed' } : {}} onClick={() => { if (isTerminalStatus(viewingTicket.status)) { notify.error(`Ticket ${viewingTicket.status}. Reopen first.`); return; } setViewingTicket(null); openEditModal(viewingTicket); }}>
                      <i className="fas fa-bell" />{!(viewingTicket.assigned_to_name || viewingTicket.assigned_to) && <span className="ticket-premium-dot" />}
                    </button>
                  </div>
                  <small className="ticket-premium-priority text-capitalize">{viewingTicket.priority || 'medium'} Priority</small>
                </div>
              </div>
            </div>
            {/* Ticket Body */}
            <div className="ticket-detail-body ticket-premium-body">
              <div className="ticket-premium-grid">
                <div className="ticket-premium-left">
                {/* LEFT: Customer card */}
                <div className="ticket-premium-card ticket-premium-customer">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <small className="ticket-premium-label">CUSTOMER</small>
                    {viewingTicket.package_profile && <span className="ticket-premium-package">{viewingTicket.package_profile}</span>}
                  </div>
                  {(() => {
                    const shortName = getCustomerShortName(viewingTicket.pppoe_username || viewingTicket.customer_snapshot?.pppoe_username);
                    const _words = String(shortName || 'U').trim().split(/\s+/).filter(Boolean);
                    const initials = _words.length >= 2 ? (_words[0][0] + _words[1][0]).toUpperCase() : String(_words[0] || 'U').slice(0, 2).toUpperCase();
                    const addr = viewingTicket.address || viewingTicket.customer_snapshot?.address || '';
                    return (<>
                      <div className="ticket-premium-avatar">{initials}</div>
                      <div className="ticket-premium-cname">{shortName} <i className="fas fa-check-circle text-primary ms-1" style={{ fontSize: '12px' }} /></div>
                      <div className="ticket-premium-pppoe">{viewingTicket.pppoe_username || '-'}</div>
                      <div className="ticket-premium-contactRow">
                        <button type="button" className="ticket-premium-iconBtn" title="Copy customer ID" aria-label="Copy customer ID" onClick={(e) => { e.preventDefault(); try { navigator.clipboard?.writeText(viewingTicket.pppoe_username || ''); notify.success('Copied ID'); } catch {} }} style={{ cursor: 'pointer' }}><i className="fas fa-copy" aria-hidden="true" /></button>
                        {viewingTicket.phone ? (
                          <>
                            <a
                              className="ticket-premium-iconBtn"
                              title={`Call ${viewingTicket.phone} with 3CX`}
                              href={get3cxCallUri(viewingTicket.phone)}
                              onClick={() => {
                                const ticketId = viewingTicket.id;
                                supportService.log3cxCallHandoff(ticketId, 'ticket')
                                  .then(() => qc.invalidateQueries({ queryKey: ['ticketComments', ticketId] }))
                                  .catch((error) => {
                                    notify.error(error?.response?.data?.message || '3CX opened, but the call attempt could not be saved.');
                                  });
                              }}
                            ><i className="fas fa-phone" /></a>
                            <a
                              className="ticket-premium-iconBtn text-success"
                              title={`WhatsApp Chat ${viewingTicket.phone}`}
                              href={`https://wa.me/880${String(viewingTicket.phone).replace(/^0+/, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <i className="fab fa-whatsapp" />
                            </a>
                          </>
                        ) : <span className="ticket-premium-iconBtn disabled"><i className="fas fa-phone" /></span>}
                      </div>
                      <div className="ticket-premium-phoneRow d-flex align-items-center justify-content-center gap-1">
                        <i className="fas fa-phone me-1 text-muted" />
                        {viewEditing ? (
                          <input className="form-control form-control-sm mt-1" value={viewForm.manual_phone || ''} maxLength={11} onChange={(e) => setViewForm({ ...viewForm, manual_phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="tel" />
                        ) : (
                          <>
                            <span>{viewingTicket.phone || '-'}</span>
                            {viewingTicket.phone && (
                              <button
                                type="button"
                                className="btn btn-link p-0 text-secondary ms-1"
                                title="Copy Phone Number"
                                aria-label="Copy Phone Number"
                                onClick={(e) => {
                                  e.preventDefault();
                                  try { navigator.clipboard?.writeText(String(viewingTicket.phone)); notify.success('Copied phone number'); } catch {}
                                }}
                              >
                                <i className="fas fa-copy" style={{ fontSize: '12px' }} />
                              </button>
                            )}
                          </>
                        )}
                        {viewingTicket.vlan_id && <span className="badge bg-info ms-2">VLAN {viewingTicket.vlan_id}</span>}
                      </div>
                      <div className="addrx-card">
                        <small className="addrx-label">ADDRESS</small>
                        {viewEditing ? (
                          <input className="form-control form-control-sm mt-1" value={viewForm.manual_address || ''} maxLength={500} onChange={(e) => setViewForm({ ...viewForm, manual_address: e.target.value })} placeholder="Client address" />
                        ) : (
                          <>
                            <div className="addrx-text" title={addr || ''}>{addr || 'No address on file'}</div>
                            <a
                              className="addrx-btn"
                              href={addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr + ' Khulna Bangladesh')}` : undefined}
                              target="_blank"
                              rel="noreferrer"
                              title={addr ? 'Open in Google Maps' : 'No address'}
                              onClick={(e) => { if (!addr) e.preventDefault(); }}
                              aria-disabled={!addr}
                            >
                              <i className="fas fa-map-marker-alt me-1" />Open in Maps
                            </a>
                          </>
                        )}
                      </div>
                    </>);
                  })()}
                </div>
                <div className="ticket-premium-card ticket-premium-live">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <small className="ticket-premium-label">LIVE LINE</small>
                    {(() => {
                      const live = liveStatus?.live || null;
                      const db = liveStatus?.db_fallback || null;
                      const disabledFlag = live?.disabled === true || String(live?.disabled ?? '').toLowerCase() === 'true'
                        || String(live?.status ?? '').toLowerCase() === 'disabled'
                        || db?.disabled === true || String(db?.status ?? '').toLowerCase() === 'disabled';
                      if (disabledFlag) return <span className="live-pill live-disabled">Disabled</span>;
                      if (live) {
                        const s = String(live.status ?? '').toLowerCase();
                        const unkSuffix = (s === 'unknown' && liveStatus?.db_fallback) ? ' · Last sync' : '';
                        if (['online','up','active','connected'].includes(s)) return <span className="live-pill on">● Online</span>;
                        if (['offline','down','inactive','disconnected'].includes(s)) return <span className="live-pill off">● Offline</span>;
                        return <span className="live-pill unk">○ Unknown{unkSuffix}</span>;
                      }
                      if (liveStatus && db) {
                        if (db.is_online === true) return <span className="live-pill on">● Online · Last sync</span>;
                        if (db.is_online === false) return <span className="live-pill off">● Offline · Last sync</span>;
                        return <span className="live-pill unk">○ Unknown · Last sync</span>;
                      }
                      return <span className="live-pill unk">○ Unknown</span>;
                    })()}
                  </div>
                  {liveLoading ? (
                    <div role="status" aria-label="Checking live line" className="live-skeleton"><span /><span /><span /></div>
                  ) : !liveStatus && !liveError ? (
                    <div className="small text-muted">Tap Refresh to check live line.</div>
                  ) : (
                    <>
                      {(() => {
                        // Precise errors: never mask one failure as another.
                        if (!liveStatus && liveError) return <div className="live-error">{String(liveError)}</div>;
                        const code = String(liveStatus?.error || '');
                        if (!code) return null;
                        if (code === 'NOT_FOUND_ON_ROUTER') return <div className="live-error">No secret on router{liveStatus?.router_label ? ` (${liveStatus.router_label})` : ''} — showing last sync.</div>;
                        if (code === 'TIMEOUT' || code === 'UNREACHABLE') return <div className="live-error">Router unreachable ({code}) — showing last sync.</div>;
                        if (code === 'AUTH') return <div className="live-error">Router login failed (AUTH) — contact admin.</div>;
                        return <div className="live-error">{code}</div>;
                      })()}
                      {liveStatus ? (() => {
                        const live = liveStatus.live || null;
                        const db = liveStatus?.db_fallback || null;
                        const unknownLive = !!live && String(live.status || '').toLowerCase() === 'unknown';
                        const isFallback = !live || unknownLive;
                        const ip = live?.ip ?? live?.address ?? '-';
                        const uptime = live?.uptime ?? '-';
                        const profile = live?.profile ?? '-';
                        const service = live?.service ?? live?.service_name ?? db?.service ?? null;
                        const discReason = live?.last_disconnect_reason ?? live?.disconnect_reason ?? live?.last_down_reason ?? db?.last_disconnect_reason ?? null;
                        const router = liveStatus.router_label || (liveStatus.router_id != null ? String(liveStatus.router_id) : '-');
                        const suffix = isFallback ? ' · Last sync' : '';
                        return (
                          <>
                            <div className="live-row"><span className="k">IP{suffix}</span><span className="v mono">{ip || '-'}</span></div>
                            <div className="live-row"><span className="k">Uptime{suffix}</span><span className="v">{uptime || '-'}</span></div>
                            <div className="live-row"><span className="k">Profile{suffix}</span><span className="v">{profile || '-'}</span></div>
                            {service && <div className="live-row"><span className="k">Service{suffix}</span><span className="v">{service}</span></div>}
                            {discReason && <div className="live-row"><span className="k">Last disconnect</span><span className="v">{discReason}</span></div>}
                            <div className="live-row"><span className="k">Router{suffix}</span><span className="v mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }} title={router}>{router}</span></div>
                          </>
                        );
                      })() : null}
                      {liveStatus?.fetched_at && (
                        <div className="live-stamp">as of {fmt(liveStatus.fetched_at)} · {liveStatus.source === 'live' ? 'Live' : liveStatus.source === 'cache' ? 'Cached' : liveStatus.source === 'db-fallback' ? 'Last sync' : (liveStatus.cached ? 'Cached' : 'Live')}</div>
                      )}
                    </>
                  )}
                  <button type="button" className="live-refresh btn btn-sm btn-outline-primary" disabled={liveLoading} onClick={fetchLiveStatus}>{liveLoading ? 'Checking...' : (liveError ? 'Retry' : 'Refresh')}</button>
                </div>
                </div>
                <div className="ticket-premium-right">
                  <div className="d-flex flex-wrap gap-1 mb-2 section-nav" role="navigation" aria-label="Ticket sections">
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { try { detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }}>Details</button>
                    {isTerminalStatus(viewingTicket.status) && (viewingTicket.resolution_note || viewingTicket.resolved_at || viewingTicket.closed_at) && (
                      <button type="button" className="btn btn-sm btn-outline-success" onClick={() => { try { document.getElementById('ticket-resolution-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }}><i className="fas fa-check-double me-1" />Resolution</button>
                    )}
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { try { activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }}>Activity</button>
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { try { prevRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }}>Previous tickets{((customerCommentsQ.data?.tickets || []).filter((t) => Number(t.id) !== Number(viewingTicket?.id)).length) > 0 && <span className="badge bg-primary ms-1">{(customerCommentsQ.data?.tickets || []).filter((t) => Number(t.id) !== Number(viewingTicket?.id)).length}</span>}</button>
                  </div>

                  {/* PROMINENT RESOLUTION SUMMARY CARD (For Solved / Closed tickets) */}
                  {isTerminalStatus(viewingTicket.status) && (
                    <div id="ticket-resolution-card" className="ticket-solved-banner mb-2">
                      <div className="ticket-solved-banner-head">
                        <span className="ticket-solved-title">
                          <i className="fas fa-circle-check text-success" />
                          <span>Ticket Resolved &amp; Closed</span>
                        </span>
                        <span className="ticket-solved-badge">
                          <i className="fas fa-shield-alt me-1" />Solved Record
                        </span>
                      </div>
                      <div className="ticket-solved-meta">
                        <div className="ticket-solved-meta-item">
                          <i className="fas fa-calendar-check" />
                          <span><strong>Solved at:</strong> {fmt(viewingTicket.closed_at || viewingTicket.resolved_at)}</span>
                        </div>
                        <div className="ticket-solved-meta-item">
                          <i className="fas fa-stopwatch" />
                          <span><strong>Resolution Time:</strong> {fmtDur(viewingTicket.created_at, viewingTicket.closed_at || viewingTicket.resolved_at)}</span>
                        </div>
                        <div className="ticket-solved-meta-item">
                          <i className="fas fa-user-check" />
                          <span><strong>Handled by:</strong> {viewingTicket.assigned_to_name || 'Assigned Staff'}</span>
                        </div>
                      </div>
                      <div className="ticket-solved-note">
                        <small><i className="fas fa-comment-medical me-1" />Resolution Summary / Report</small>
                        <p className="mb-0">{viewingTicket.resolution_note || viewingTicket.description || 'Issue investigated and resolved.'}</p>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const tl = ticketCommentsQ.data?.timeline || [];
                    const cComments = customerCommentsQ.data?.comments || [];
                    const cEvents = customerCommentsQ.data?.events || [];
                    const cTickets = customerCommentsQ.data?.tickets || [];
                    if (!tl.length && !cComments.length && !cEvents.length) return null;
                    const noById = {};
                    cTickets.forEach((t) => { noById[String(t.id)] = t.ticket_no; });
                    const all = [
                      ...tl.map((e) => ({ ...e, _tid: e.ticket_id ?? viewingTicket?.id, _tno: e.ticket_no || viewingTicket?.ticket_no })),
                      ...cComments.map((e) => ({ ...e, _tid: e.ticket_id, _tno: e.ticket_no || noById[String(e.ticket_id)] || '' })),
                      ...cEvents.map((e) => ({ ...e, _tid: e.ticket_id, _tno: e.ticket_no || noById[String(e.ticket_id)] || '' })),
                    ].filter((e) => e && e.created_at);
                    if (!all.length) return null;
                    const sorted = [...all].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    const latest = sorted[0];
                    if (!latest) return null;
                    const actor = latest.created_by_name || 'System';
                    const rawText = latest.kind === 'comment' ? (latest.comment || '') : (latest.message || latest.comment || 'Activity recorded');
                    const strText = String(rawText || 'Activity recorded');
                    const shortText = strText.length > 140 ? `${strText.slice(0, 140)}…` : strText;
                    const ago = timeAgoUx(latest.created_at);
                    const isOther = latest._tid != null && Number(latest._tid) !== Number(viewingTicket?.id);
                    const otherNo = isOther && latest._tno ? String(latest._tno) : '';
                    return (
                      <div className="ticket-premium-card d-flex justify-content-between align-items-start gap-2 mb-2 p-2">
                        <div className="min-w-0">
                          <small className="ticket-premium-label" title={latest.created_at ? fmt(latest.created_at) : ''}>LATEST UPDATE · {ago}</small>
                          <div className="small" title={strText}><strong>{actor}: </strong>{shortText} {otherNo ? <span className="badge bg-light text-dark border ms-1">{otherNo}</span> : null}</div>
                          <small className="text-muted">{fmt(latest.created_at)}</small>
                        </div>
                        <button type="button" className="btn btn-sm btn-primary flex-shrink-0" onClick={() => { try { activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }}>View full history</button>
                      </div>
                    );
                  })()}
              <div ref={detailsRef} id="ticket-details" className="ticket-premium-card ticket-premium-details">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <small className="ticket-premium-label">TICKET DETAILS</small>
                  {viewingTicket.package_profile && <span className="ticket-premium-package">{viewingTicket.package_profile}</span>}
                </div>
                <div className="ticket-premium-detailsGrid">
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Office / Branch</small>
                    {viewEditing ? (
                      <select className="form-select form-select-sm" value={viewForm.office_name} onChange={(e) => setViewForm({ ...viewForm, office_name: e.target.value })} disabled={isBranchOfficeUser} title={isBranchOfficeUser ? 'Ticket office is fixed to your assigned office.' : undefined}>
                        <option value="">Select Office</option>
                        {SUPPORT_OFFICES.map((b) => <option key={b.code} value={b.name}>{b.displayName}</option>)}
                      </select>
                    ) : (
                      <span className="fw-medium">{viewingTicket.office_name || viewingTicket.zone || 'Corporate Office'}</span>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Connection Type</small>
                    {viewEditing ? (
                      <>
                        <select className="form-select form-select-sm" value={viewForm.connection_type} onChange={(e) => setViewForm((prev) => ({ ...prev, connection_type: e.target.value, connection_subtype: e.target.value === 'Conseal' ? prev.connection_subtype : '' }))}>
                          <option value="Fiber">Fiber</option>
                          <option value="CAT">CAT</option>
                          <option value="Conseal">Conseal</option>
                          <option value="Wireless">Wireless</option>
                          <option value="Cat6">Cat6</option>
                          <option value="Other">Other</option>
                        </select>
                        {viewForm.connection_type === 'Conseal' && (
                          <select className="form-select form-select-sm mt-1" value={viewForm.connection_subtype} onChange={(e) => setViewForm({ ...viewForm, connection_subtype: e.target.value })}>
                            <option value="">Select Conseal Type</option>
                            <option value="Fiber Conseal">Fiber Conseal</option>
                            <option value="CAT Conseal">CAT Conseal</option>
                          </select>
                        )}
                      </>
                    ) : (
                      <span className="ticket-premium-conn">{viewingTicket.connection_type || 'Fiber'}</span>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Connection detail</small>
                    {viewingTicket.connection_subtype ? <span className="ticket-premium-fiberPill">{viewingTicket.connection_subtype}</span> : <span className="ticket-premium-fiberPill">{viewingTicket.connection_type || 'Fiber'}</span>}
                    {(viewingTicket.vlan_name || viewingTicket.vlan_id) && (
                      <div className="small text-muted mt-1">VLAN {viewingTicket.vlan_id || ''}{viewingTicket.vlan_name ? ` (${viewingTicket.vlan_name})` : ''}</div>
                    )}
                    {(() => {
                      const svc = viewingTicket.service || viewingTicket.package_profile || viewingTicket.profile || '';
                      const onlineRaw = viewingTicket.is_online ?? viewingTicket.online;
                      const disabledRaw = viewingTicket.is_disabled ?? viewingTicket.disabled;
                      const isDisabled = disabledRaw === true || String(disabledRaw || '').toLowerCase() === 'disabled';
                      const line = isDisabled ? 'Disabled' : (onlineRaw === true || String(onlineRaw || '').toLowerCase() === 'online' ? 'Online' : (onlineRaw === false || String(onlineRaw || '').toLowerCase() === 'offline' ? 'Offline' : ''));
                      if (!svc && !line) return null;
                      return <div className="small mt-1">{svc ? <span>{svc}</span> : null}{svc && line ? ' · ' : ''}{line ? <span className={isDisabled ? 'text-muted' : ''}>{line}</span> : null}</div>;
                    })()}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Problem Category</small>
                    {viewEditing ? (
                      <>
                        <select className="form-select form-select-sm" aria-label="Problem category" value={viewForm.category_id} onChange={(e) => setViewForm({ ...viewForm, category_id: e.target.value })}>
                          <option value="">Select Category</option>
                          {viewForm.category_id && !categories.some((category) => String(category.id) === String(viewForm.category_id)) && (
                            <option value={viewForm.category_id} disabled>
                              Legacy category ({viewingTicket.category_name || REMOVED_SUPPORT_CATEGORY_LABELS[Number(viewForm.category_id)] || `ID:${viewForm.category_id}`})
                            </option>
                          )}
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name_bn || c.name}</option>)}
                        </select>
                        <fieldset className="support-flags-fieldset mt-2">
                          <legend className="ticket-premium-fLabel">Additional support</legend>
                          <div className="support-flag-options compact">
                            <label className={`support-flag-option qc${viewForm.is_qc_support ? ' active' : ''}`}>
                              <input type="checkbox" checked={Boolean(viewForm.is_qc_support)} onChange={(e) => setViewForm((prev) => ({ ...prev, is_qc_support: e.target.checked }))} />
                              <span>QC Support</span>
                            </label>
                            <label className={`support-flag-option on-call${viewForm.is_on_call ? ' active' : ''}`}>
                              <input type="checkbox" checked={Boolean(viewForm.is_on_call)} onChange={(e) => setViewForm((prev) => ({ ...prev, is_on_call: e.target.checked }))} />
                              <span>On-Call Support</span>
                            </label>
                          </div>
                        </fieldset>
                      </>
                    ) : (
                      <>
                        <span className="ticket-premium-fValue">{getProblemCategoryLabel(viewingTicket)}</span>
                        <div className="support-flag-badges mt-1">
                          {hasQcSupport(viewingTicket) && <span className="support-flag-badge qc"><i className="fas fa-clipboard-check me-1" aria-hidden="true" />QC Support</span>}
                          {hasOnCallSupport(viewingTicket) && <span className="support-flag-badge on-call"><i className="fas fa-headset me-1" aria-hidden="true" />On-Call Support</span>}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Assigned Technician</small>
                    {viewEditing ? (
                      <select className="form-select form-select-sm" value={viewForm.assigned_to} onChange={(e) => setViewForm({ ...viewForm, assigned_to: e.target.value })}>
                        <option value="">Unassigned</option>
                        {technicians.map(t => (
                          <option key={t.id} value={t.id}>{t.full_name || t.name} (ID:{t.id}{t.phone ? ` · ${t.phone}` : ''})</option>
                        ))}
                      </select>
                    ) : (
                      viewingTicket.assigned_to_name ? <span className="ticket-premium-tech">{viewingTicket.assigned_to_name}</span> : viewingTicket.assigned_to ? <span className="badge bg-secondary">ID:{viewingTicket.assigned_to}</span> : <button type="button" className="ticket-premium-assignBtn" onClick={() => { setViewingTicket(null); openEditModal(viewingTicket); }}>Assign</button>
                    )}
                  </div>
                  {(() => {
                    const team = resolveTeamNames(viewingTicket.additional_technician_ids, technicians)
                      .filter((m) => Number(m.id) !== Number(viewingTicket.assigned_to));
                    if (!team.length) return null;
                    return (
                      <div className="ticket-premium-field" title={team.map((m) => m.name).join(', ')}>
                        <small className="ticket-premium-fLabel"><i className="fas fa-users me-1" aria-hidden="true" />Team Members ({team.length})</small>
                        <span className="ticket-premium-fValue">{team.map((m) => m.name).join(', ')}</span>
                      </div>
                    );
                  })()}
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Priority</small>
                    {viewEditing ? (
                      <select className="form-select form-select-sm" value={viewForm.priority} onChange={(e) => setViewForm({ ...viewForm, priority: e.target.value })}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    ) : (
                      <span className={`ticket-premium-prio prio-${viewingTicket.priority || 'medium'}`}><i className="fas fa-flag me-1" aria-hidden="true" />{viewingTicket.priority || 'medium'}</span>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Complaint No</small>
                    {viewEditing ? (
                      <input className="form-control form-control-sm" value={viewForm.complaint_no || ''} maxLength={50} onChange={(e) => setViewForm({ ...viewForm, complaint_no: e.target.value })} placeholder="Complaint No" />
                    ) : (
                      <span className="ticket-premium-fValue">{viewingTicket.complaint_no || '-'}</span>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Status</small>
                    <span className="ticket-premium-fValue text-capitalize">{String(viewingTicket.status || '-').replace(/_/g, ' ')}</span>
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Due / SLA</small>
                    {viewingTicket.due_at ? (
                      <span className="ticket-premium-fValue">
                        {fmt(viewingTicket.due_at)}{' '}
                        {new Date(viewingTicket.due_at).getTime() < Date.now() && !isTerminalStatus(viewingTicket.status) && (
                          <span className="badge bg-danger ms-1">OVERDUE</span>
                        )}
                      </span>
                    ) : (
                      <span className="ticket-premium-fValue text-muted">—</span>
                    )}
                  </div>
                  <div className="ticket-premium-field">
                    <small className="ticket-premium-fLabel">Created By</small>
                    <span className="ticket-premium-fValue">{viewingTicket.created_by_name || viewingTicket.created_by_username || 'NOC'}</span>
                  </div>
                </div>
              </div>
              {(() => {
                const atts = viewingTicket.attachments || [];
                if (!atts.length) return null;
                return (
                  <div className="ticket-premium-card ticket-premium-attach">
                    <small className="ticket-premium-label">ATTACHMENTS ({atts.length})</small>
                    <div className="d-flex flex-wrap gap-2 mt-2">
                      {atts.map((a) => (
                        <a key={a.id} href={resolveAttachmentUrl(a)} target="_blank" rel="noreferrer" title={a.file_name || 'Attachment'}>
                          <img src={resolveAttachmentUrl(a)} alt={a.file_name || 'Ticket attachment'} loading="lazy" className="ticket-premium-thumb" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Work Reports — technician submit + reviewer approve/reject */}
              <div className="ticket-premium-card ticket-premium-reports">
                <small className="ticket-premium-label">
                  WORK REPORTS ({(viewingTicket.reports || []).length})
                  {(viewingTicket.reports || []).some((r) => r.status === 'submitted') && (
                    <span className="badge bg-warning text-dark ms-2">pending review</span>
                  )}
                </small>
                <div className="d-flex flex-column gap-2 mt-2">
                  {(viewingTicket.reports || []).map((r) => (
                    <div key={r.id} className="border rounded p-2">
                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-1">
                        <strong className="small">{r.author_name || `ID:${r.author_id}`}</strong>
                        <span className={`badge ${r.status === 'approved' ? 'bg-success' : r.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{r.work_done}</div>
                      {r.materials_used && <div className="small text-muted mt-1"><strong>Materials:</strong> {r.materials_used}</div>}
                      {r.time_spent_minutes != null && <div className="small text-muted"><strong>Time:</strong> {r.time_spent_minutes}m</div>}
                      {Array.isArray(r.photos) && r.photos.length > 0 && (
                        <div className="d-flex flex-wrap gap-2 mt-2">
                          {r.photos.map((a) => (
                            <a key={a.id} href={resolveAttachmentUrl(a)} target="_blank" rel="noreferrer" title={a.file_name || 'Report photo'}>
                              <img src={resolveAttachmentUrl(a)} alt={a.file_name || 'Report photo'} loading="lazy" className="ticket-premium-thumb" />
                            </a>
                          ))}
                        </div>
                      )}
                      {r.review_note && <div className="small mt-1"><strong>Review:</strong> {r.review_note} <span className="text-muted">— {r.reviewer_name || ''}</span></div>}
                      {canAssignTx && r.status === 'submitted' && (
                        <div className="mt-2">
                          {reviewingId === r.id ? (
                            <div className="d-flex flex-column gap-2">
                              <input
                                className="form-control form-control-sm"
                                placeholder="Review note (required to reject)..."
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                              />
                              <div className="d-flex gap-2">
                                <button className="btn btn-success btn-sm" disabled={reviewingId !== null} onClick={() => reviewReport(r.id, 'approved')}>
                                  <i className="fas fa-check me-1" /> Approve
                                </button>
                                <button className="btn btn-danger btn-sm" disabled={!reviewNote.trim()} onClick={() => reviewReport(r.id, 'rejected')}>
                                  <i className="fas fa-times me-1" /> Reject
                                </button>
                                <button className="btn btn-light border btn-sm" onClick={() => { setReviewingId(null); setReviewNote(''); }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button className="btn btn-outline-primary btn-sm" onClick={() => { setReviewingId(r.id); setReviewNote(''); }}>
                              <i className="fas fa-clipboard-check me-1" /> Review
                            </button>
                          )}
                        </div>
                      )}
                      <div className="text-muted mt-1" style={{ fontSize: '11px' }}>{r.created_at ? fmt(r.created_at) : ''}</div>
                    </div>
                  ))}
                </div>
                {!isTerminalStatus(viewingTicket.status) ? (
                  <div className="border rounded p-2 mt-2" style={{ background: 'var(--surface-muted)' }}>
                    <strong className="small">Submit work report</strong>
                    <textarea
                      className="form-control form-control-sm mt-2"
                      rows="2"
                      placeholder="What work was done? (required)"
                      value={reportForm.work}
                      maxLength={2000}
                      onChange={(e) => setReportForm((p) => ({ ...p, work: e.target.value }))}
                    />
                    <div className="row g-2 mt-1">
                      <div className="col-md-7">
                        <input
                          className="form-control form-control-sm"
                          placeholder="Materials used (optional)"
                          value={reportForm.materials}
                          maxLength={1000}
                          onChange={(e) => setReportForm((p) => ({ ...p, materials: e.target.value }))}
                        />
                      </div>
                      <div className="col-md-5">
                        <input
                          type="number"
                          min="0"
                          max="10080"
                          className="form-control form-control-sm"
                          placeholder="Time (minutes)"
                          value={reportForm.minutes}
                          onChange={(e) => setReportForm((p) => ({ ...p, minutes: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="d-flex flex-wrap gap-2 mt-2 align-items-center">
                      <label className="btn btn-light border btn-sm mb-0" style={{ cursor: 'pointer' }}>
                        <i className="fas fa-camera me-1" /> {reportForm.photo ? reportForm.photo.name : 'Add photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="d-none"
                          onChange={(e) => setReportForm((p) => ({ ...p, photo: e.target.files?.[0] || null }))}
                        />
                      </label>
                      <button className="btn btn-primary btn-sm" disabled={reportBusy || !reportForm.work.trim()} onClick={submitReport}>
                        {reportBusy ? 'Submitting...' : 'Submit report'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <small className="text-muted d-block mt-2">Reopen the ticket to submit a new report.</small>
                )}
              </div>
              {/* Remarks & Activity */}
              <div ref={activityRef} id="ticket-activity" className="ticket-premium-card ticket-premium-activity">
                <div className="ticket-premium-activityTitle">Remarks &amp; Activity</div>
                <div className="ticket-premium-timelineMini">
                  <div className="ticket-premium-tlRow"><span className="ticket-premium-tlDot blue" /><div><strong>Ticket Created: {viewingTicket.category_name || viewingTicket.subject || 'Ticket opened'}</strong><div className="text-muted small">{viewingTicket.description || 'No description'}</div></div></div>
                  {viewingTicket.priority && <div className="ticket-premium-tlRow"><span className="ticket-premium-tlDot grey" /><div><strong>Priority set to {String(viewingTicket.priority).charAt(0).toUpperCase() + String(viewingTicket.priority).slice(1)}</strong><div className="text-muted small">{fmt(viewingTicket.created_at)}</div></div></div>}
                </div>
                <div className="ticket-detail-timeline ticket-premium-fullTimeline">
                <div className="d-flex border-bottom">
                  <button className="btn btn-sm flex-fill btn-primary" style={{ borderRadius: 0 }}><i className="fas fa-history me-1" />Customer Timeline — {viewingTicket.pppoe_username || viewingTicket.customer_snapshot?.pppoe_username || 'Customer'} ({(customerCommentsQ.data?.tickets || []).filter((t) => Number(t.id) !== Number(viewingTicket?.id)).length} tickets, {(customerCommentsQ.data?.comments || []).filter((c) => Number(c.ticket_id) !== Number(viewingTicket?.id)).length + (ticketCommentsQ.data?.timeline?.length || 0)} updates)</button>
                </div>
                <div className="tl-filter-bar d-flex flex-wrap gap-1 p-2 border-bottom">
                  {(() => {
                    const tl = ticketCommentsQ.data?.timeline || [];
                    const counts = {
                      all: tl.length,
                      comments: tl.filter(e => e.kind === 'comment' || e.event_type === 'verification').length,
                      calls: tl.filter(e => e.event_type === 'call_handoff').length,
                      assignments: tl.filter(e => ['assigned','reassigned','unassigned','team_updated'].includes(e.event_type)).length,
                      edits: tl.filter(e => e.event_type === 'edited').length,
                      status: tl.filter(e => e.event_type === 'status_changed' || e.event_type === 'created').length,
                    };
                    return [{ v: 'all', l: 'All' }, { v: 'comments', l: 'Notes', icon: 'fa-comment' }, { v: 'calls', l: 'Calls', icon: 'fa-phone' }, { v: 'assignments', l: 'Assignment', icon: 'fa-user' }, { v: 'edits', l: 'Edits', icon: 'fa-pen' }, { v: 'status', l: 'Status', icon: 'fa-rotate' }].map(({ v, l, icon }) => (
                      <button key={v} className={`tl-filter-btn ${timelineFilter===v?'active':''}`} aria-pressed={timelineFilter===v} onClick={() => setTimelineFilter(v)}>
                        {icon && <i className={`fas ${icon} me-1`} aria-hidden="true" />}{l}<span className="tl-filter-count">{counts[v] ?? 0}</span>
                      </button>
                    ));
                  })()}
                </div>
                <div ref={timelineRef} className="tl-body">
                  {ticketCommentsQ.isLoading || customerCommentsQ.isLoading ? (
                    <div className="tl-loading"><i className="fas fa-circle-notch fa-spin me-2" />Loading history...</div>
                  ) : (() => {
                    const ticketTimeline = ticketCommentsQ.data?.timeline || [];
                    const customerTickets = customerCommentsQ.data?.tickets || [];
                    // Exclude current-ticket rows from customer-side lists (fixes double-count).
                    const customerComments = (customerCommentsQ.data?.comments || []).filter((c) => Number(c.ticket_id) !== Number(viewingTicket.id));
                    const customerEvents = (customerCommentsQ.data?.events || []).filter((e) => Number(e.ticket_id) !== Number(viewingTicket.id));
                    const priorTickets = customerTickets
                      .filter(t => Number(t.id) !== Number(viewingTicket.id))
                      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || Number(b.id) - Number(a.id));
                    const filteredCurrent = ticketTimeline.filter(entry => {
                      if (timelineFilter === 'all') return true;
                      if (timelineFilter === 'comments') return entry.kind === 'comment' || entry.event_type === 'verification';
                      if (timelineFilter === 'calls') return entry.event_type === 'call_handoff';
                      if (timelineFilter === 'assignments') return ['assigned','reassigned','unassigned','team_updated'].includes(entry.event_type);
                      if (timelineFilter === 'edits') return entry.event_type === 'edited' || Object.keys(entry.metadata?.changes || {}).some((field) => !['assigned_to', 'additional_technicians', 'status'].includes(field));
                      if (timelineFilter === 'status') return entry.event_type === 'status_changed' || entry.event_type === 'created';
                      return true;
                    });
                    const activityLabel = (entry) => {
                      if (entry.kind === 'comment') return entry.comment;
                      if (entry.event_type === 'created') return 'Ticket opened';
                      if (entry.event_type === 'assigned') return cleanWasSuffix(entry.message.replace(/^Assigned technician:/, 'Assigned to:'));
                      if (entry.event_type === 'reassigned') return cleanWasSuffix(entry.message.replace(/^Re-assigned technician:/, 'Re-assigned to:'));
                      if (entry.event_type === 'unassigned') return entry.message || 'Technician unassigned';
                      if (entry.event_type === 'team_updated') return entry.message || 'Team updated';
                      if (entry.event_type === 'note') return entry.message || entry.comment || 'Note';
                      if (entry.event_type === 'verification') return entry.message || 'Verification call';
                      if (entry.event_type === 'call_handoff') {
                        const call = entry.metadata || {};
                        if (!call.cdr_call_id) return `3CX dialer opened for ${call.phone || 'customer'}; call outcome not verified`;
                        const duration = Number.isFinite(Number(call.duration_seconds))
                          ? ` · ${Math.floor(Number(call.duration_seconds) / 60)}m ${Number(call.duration_seconds) % 60}s`
                          : '';
                        return `3CX ${call.call_status === 'answered' ? 'answered' : 'not answered'} · ${call.extension ? `Ext. ${call.extension}` : 'extension unknown'}${duration}`;
                      }
                      if (entry.event_type === 'status_changed') return entry.message.replace(/^Status:/, 'Status updated:').replace(/\s+—\s+Report:\s+.+$/, '');
                      if (entry.event_type === 'edited') {
                        const changes = entry.metadata?.changes || {};
                        const keys = Object.keys(changes);
                        if (keys.length === 1 && keys[0] === 'description') return 'Remarks updated';
                        const fieldLabels = { description: 'Remarks', resolution_note: 'Resolution', priority: 'Priority', category: 'Category', subject: 'Subject', complaint_no: 'Complaint#', office: 'Office', connection_type: 'Connection', assigned_to: 'Assignee', additional_technicians: 'Team' };
                        return `Updated: ${keys.map(k => fieldLabels[k] || k.replace(/_/g,' ')).join(', ')}`;
                      }
                      return entry.message || 'Activity recorded';
                    };
                    const getEventConfig = (entry) => {
                      const isComment = entry.kind === 'comment';
                      if (isComment && entry.is_internal) return { icon: 'fa-lock', color: '#92400e', bg: '#fffbeb', border: '#fcd34d', dot: '#f59e0b', label: 'Internal Note' };
                      if (isComment) return { icon: 'fa-comment-dots', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6', label: 'Comment' };
                      if (entry.event_type === 'created') return { icon: 'fa-ticket-alt', color: '#065f46', bg: '#ecfdf5', border: '#6ee7b7', dot: '#10b981', label: 'Created' };
                      if (entry.event_type === 'assigned') return { icon: 'fa-user-plus', color: '#1e40af', bg: '#eff6ff', border: '#93c5fd', dot: '#3b82f6', label: 'Assigned' };
                      if (entry.event_type === 'reassigned') return { icon: 'fa-exchange-alt', color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd', dot: '#8b5cf6', label: 'Reassigned' };
                      if (entry.event_type === 'unassigned') return { icon: 'fa-user-minus', color: '#92400e', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b', label: 'Unassigned' };
                      if (entry.event_type === 'team_updated') return { icon: 'fa-users', color: '#1e40af', bg: '#eff6ff', border: '#93c5fd', dot: '#3b82f6', label: 'Team' };
                      if (entry.event_type === 'edited') return { icon: 'fa-edit', color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe', dot: '#7c3aed', label: 'Edit' };
                      if (entry.event_type === 'status_changed') return { icon: 'fa-circle-check', color: '#065f46', bg: '#ecfdf5', border: '#6ee7b7', dot: '#10b981', label: 'Status' };
                      if (entry.event_type === 'note') return { icon: 'fa-sticky-note', color: '#b45309', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b', label: 'Note' };
                      if (entry.event_type === 'verification') return { icon: 'fa-phone-volume', color: '#0d6efd', bg: '#eff6ff', border: '#93c5fd', dot: '#0d6efd', label: 'Verification call' };
                      if (entry.event_type === 'call_handoff') return { icon: 'fa-phone', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4', dot: '#14b8a6', label: '3CX call attempt' };
                      return { icon: 'fa-dot-circle', color: '#475569', bg: '#f8fafc', border: '#e2e8f0', dot: '#94a3b8', label: '' };
                    };
                    const editFieldLabel = (field) => ({ description: 'Remarks', resolution_note: 'Resolution note', priority: 'Priority', category: 'Category', subject: 'Subject', complaint_no: 'Complaint number', office: 'Office', connection_type: 'Connection type', connection_subtype: 'Connection subtype', mobile: 'Mobile', address: 'Address', assigned_to: 'Lead technician', additional_technicians: 'Team members', status: 'Status' }[field] || field.replace(/_/g, ' '));
                    const renderActivity = (entry, i) => {
                      const isComment = entry.kind === 'comment';
                      const cfg = getEventConfig(entry);
                      const editChanges = entry.event_type === 'edited' && entry.metadata?.changes && typeof entry.metadata.changes === 'object'
                        ? Object.entries(entry.metadata.changes)
                        : [];
                      return (
                        <div key={`${entry.kind}-${entry.id || i}`} className="tl-entry">
                          <div className="tl-dot" style={{ background: cfg.dot }}><i className={`fas ${cfg.icon}`} style={{ color: '#fff', fontSize: '9px' }} /></div>
                          <div className="tl-card" style={{ borderColor: cfg.border, background: cfg.bg }}>
                            <div className="tl-card-header">
                              <span className="tl-event-label" style={{ color: cfg.color }}>{cfg.label}</span>
                              {isComment && entry.is_internal && <span className="tl-badge-internal">Internal</span>}
                              <span className="tl-time" title={fmt(entry.created_at)}>{timeAgoUx(entry.created_at)}</span>
                            </div>
                            <div className="tl-card-body">{activityLabel(entry)}</div>
                            {editChanges.length > 0 && (
                              <div className="tl-diff-list">
                                {editChanges.map(([field, diff]) => (
                                  <div className="tl-diff-row" key={field}>
                                    <span className="tl-diff-field">{editFieldLabel(field)}</span>
                                    <div className="tl-diff-values">
                                      <span className="tl-diff-old" title={diff?.from}>{diff?.from || '—'}</span>
                                      <i className="fas fa-arrow-right tl-diff-arrow" />
                                      <span className="tl-diff-new" title={diff?.to}>{diff?.to || '—'}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="tl-actor"><i className="fas fa-user-circle" />{entry.created_by_name || 'System'}</div>
                          </div>
                        </div>
                      );
                    };
                    if (!priorTickets.length && !filteredCurrent.length) return <small className="text-muted">No ticket history recorded yet.</small>;
                    return <>
                      <div ref={prevRef} id="ticket-prev" className="customer-history-section mb-3">
                        <div className="customer-history-heading">Previous Tickets ({priorTickets.length}) <span className="customer-history-order">Newest first</span></div>
                        {priorTickets.length === 0 && <small className="text-muted">No previous tickets.</small>}
                        {priorTickets.map((ticket, ti) => {
                          const activities = [
                            ...customerEvents.filter(e => Number(e.ticket_id) === Number(ticket.id)).map(e => ({ ...e, kind: 'event' })),
                            ...customerComments.filter(c => Number(c.ticket_id) === Number(ticket.id)).map(c => ({ ...c, kind: 'comment' })),
                          ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                          const problem = ticket.category_name || ticket.subject || '-';
                          const description = String(ticket.description || '').trim();
                          const showDescription = description && description.toLowerCase() !== String(problem).trim().toLowerCase();
                          const createdEvent = activities.find(a => a.event_type === 'created');
                          const assignmentEvent = [...activities].reverse().find(a => ['assigned', 'reassigned'].includes(a.event_type));
                          const assignedFromEvent = assignmentEvent?.message?.match(/(?:Assigned|Re-assigned) (?:technician|team):\s*(.+?)\s*\(was/i)?.[1];
                          const createdBy = ticket.created_by_name || createdEvent?.created_by_name || 'System';
                          const handledBy = ticket.assigned_to_name || assignedFromEvent || 'Not assigned';
                          return <details key={ticket.id} className="customer-history-ticket" open={ti === 0}>
                            <summary><strong>{ticket.ticket_no}</strong><span className={`badge ms-2 ${isTerminalStatus(ticket.status) ? 'bg-secondary' : 'bg-warning text-dark'}`}>{ticket.status}</span><span className="ms-2 text-muted">{fmt(ticket.created_at)}</span></summary>
                            <div className="customer-history-content">
                              <div><span className="customer-history-label">Problem</span>{problem}{showDescription ? ` — ${description}` : ''}</div>
                              <div className="customer-history-meta"><span>Created by: {createdBy}</span><span>Handled by: {handledBy}</span></div>
                              <div className={`customer-history-solution ${ticket.resolution_note ? '' : 'text-muted'}`}><strong>Solution</strong>{ticket.resolution_note || 'No closing report recorded'}</div>
                              {activities.length > 0 && <div className="customer-history-worklog"><span className="customer-history-label">Work log</span>{activities.map(renderActivity)}</div>}
                            </div>
                          </details>;
                        })}
                      </div>
                      <div className="tl-section-header">
                        <i className="fas fa-ticket-alt tl-section-icon" style={{ color: '#0d6efd' }} />
                        <span>Current Ticket</span>
                        <span className={`badge ms-1 ${isTerminalStatus(viewingTicket.status) ? 'bg-secondary' : 'bg-primary'}`} style={{ fontSize: '10px' }}>{viewingTicket.status}</span>
                        <strong className="ms-1 text-muted" style={{ fontSize: '11px', fontWeight: 400 }}>{viewingTicket.ticket_no}</strong>
                      </div>
                      <div className="tl-section-sub mb-2 text-muted" style={{ fontSize: '11px' }}>
                        <i className="fas fa-clock me-1" />Created {fmt(viewingTicket.created_at)}
                        {viewingTicket.created_by_name && ` · by ${viewingTicket.created_by_name}`}
                      </div>
                      {filteredCurrent.length ? filteredCurrent.map(renderActivity) : (
                        <div className="tl-empty">
                          <i className="fas fa-stream" />
                          <span>No activity recorded{timelineFilter !== 'all' ? ' for this filter' : ' yet'}.</span>
                          {timelineFilter !== 'all' && <button className="tl-empty-reset" onClick={() => setTimelineFilter('all')}>Show all</button>}
                        </div>
                      )}
                    </>;
                  })()}
                </div>
                <div className="p-2 border-top comment-composer">
                  {isTerminalStatus(viewingTicket.status) ? (
                    <div className="d-flex align-items-center justify-content-between p-2 rounded bg-light border text-muted small">
                      <span>
                        <i className="fas fa-lock me-2 text-secondary" />
                        {viewingTicket.status === 'cancelled'
                          ? 'This ticket is cancelled. Reopen is allowed only when the customer has no other unresolved ticket.'
                          : 'This ticket is closed/solved. Reopen the ticket to add new comments.'}
                      </span>
                      <span className="badge bg-secondary">Read Only</span>
                    </div>
                  ) : (
                    <div className="d-flex gap-2 align-items-end">
                      <div className="flex-grow-1">
                        <textarea className="form-control form-control-sm" rows="2" placeholder="Add a comment for this customer..." value={newComment} maxLength={2000} onChange={(e) => setNewComment(e.target.value)} />
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <div className="form-check">
                            <input className="form-check-input" type="checkbox" id="internalCheck" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                            <label className="form-check-label small" htmlFor="internalCheck" title="Internal notes are visible to staff only, hidden from customer-facing views.">Internal only</label>
                          </div>
                          <small className="text-muted">{String(newComment || '').length}/2000</small>
                        </div>
                      </div>
                      <button className="btn btn-primary btn-sm" disabled={!newComment.trim() || addCommentMut.isPending} onClick={() => addCommentMut.mutate({ id: viewingTicket.id, data: { comment: newComment, is_internal: isInternal } })}>
                        {addCommentMut.isPending ? '...' : 'Add'}
                      </button>
                    </div>
                  )}
                </div>
                </div>
              </div>
                </div>{/* /.ticket-premium-right */}
              </div>{/* /.ticket-premium-grid */}
              {/* Status bar: Created / Resolved / Closed / Due */}
              <div ref={statusRef} id="ticket-status" className="ticket-premium-statusbar">
                {[
                  { label: 'Created', value: viewingTicket.created_at, done: !!viewingTicket.created_at },
                  { label: 'Resolved', value: viewingTicket.resolved_at, done: !!viewingTicket.resolved_at },
                  { label: 'Closed', value: viewingTicket.closed_at, done: !!viewingTicket.closed_at },
                  { label: 'Due', value: viewingTicket.due_at, done: false, isDue: true },
                ].map((s) => (
                  <div key={s.label} className="ticket-premium-statusbarItem" aria-label={`${s.label}: ${s.value ? fmt(s.value) : 'pending'}`}>
                    <span className={`ticket-premium-statusIcon ${s.done ? 'done' : ''}`}>
                      <i className={`fas ${s.done ? 'fa-check' : 'fa-minus'}`} />
                    </span>
                    <span className="ticket-premium-statusText">
                      <small>{s.label}{s.done && s.label !== 'Created' ? ' ✓' : ''}</small>
                      <strong>{s.value ? fmt(s.value) : '—'}{s.isDue && s.value && new Date(s.value).getTime() < Date.now() && !isTerminalStatus(viewingTicket.status) && <span className="badge bg-danger ms-1">OVERDUE</span>}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="ticket-detail-actions ticket-premium-actions">
              {isTerminalStatus(viewingTicket.status) ? (
                <>
                  <span className="badge bg-secondary align-self-center">
                    {viewingTicket.status === 'cancelled' ? 'Cancelled — Read Only' : 'Locked — Solved/Closed'}
                  </span>
                  {viewingTicket.status === 'cancelled' && canAssignTx && (
                    <button
                      className="btn btn-outline-warning btn-sm"
                      onClick={() => reopenMut.mutate(viewingTicket.id)}
                      disabled={reopenMut.isPending}
                    >
                      <i className="fas fa-rotate-left me-1" />
                      {reopenMut.isPending ? 'Reopening...' : 'Reopen cancelled ticket'}
                    </button>
                  )}
                  {viewingTicket.status === 'resolved' && canAssignTx && (
                    <button className="btn btn-success btn-sm" onClick={() => { const t = viewingTicket; setViewingTicket(null); openClosingModal(t); }}><i className="fas fa-check-circle me-1" /> Close with report</button>
                  )}
                  {['closed','resolved'].includes(viewingTicket.status) && pageIsAdmin && (
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => handleRevertTicket(viewingTicket)}
                      disabled={revertMut.isPending}
                      title="Undo an accidental solve/close (Admin only)"
                    >
                      <i className="fas fa-rotate-left me-1" />
                      {revertMut.isPending ? 'Reverting...' : 'Revert solve (Admin)'}
                    </button>
                  )}
                </>
              ) : viewEditing ? (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => setViewEditing(false)}>Cancel</button>
                  <button className="btn btn-success btn-sm" onClick={saveViewEdit} disabled={updateMut.isPending}><i className="fas fa-check me-1" /> {updateMut.isPending ? 'Saving...' : 'Save'}</button>
                </>
              ) : (
                <>
                  {canAssignTx && (
                  <button className="btn btn-primary btn-sm" onClick={() => { setViewingTicket(null); openEditModal(viewingTicket); }}><i className="fas fa-user-plus me-1" /> Assign</button>
                  )}
                  {canAssignTx && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => startViewEdit(viewingTicket)}><i className="fas fa-pen me-1" /> Edit</button>
                  )}
                </>
              )}
              <button className="btn btn-light border btn-sm" onClick={() => window.print()}><i className="fas fa-print me-1" /> Print</button>
              <button className="btn btn-light border btn-sm" onClick={handleCloseViewingTicket}>Close</button>
            </div>
          </div>
        </div>
      )}

      {cancellingTicket && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setCancellingTicket(null); setCancellationReason(''); } }}>
          <div className="support-modal p-4" style={{ width: 'min(520px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="cancel-ticket-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => { setCancellingTicket(null); setCancellationReason(''); }}>×</button>
            <h5 id="cancel-ticket-title" className="fw-bold text-danger mb-2">Cancel Ticket {cancellingTicket.ticket_no}</h5>
            <p className="text-muted small mb-3">This keeps the ticket in history and records the reason.</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const reason = cancellationReason.trim();
              if (!reason) return;
              deleteMut.mutate({ id: cancellingTicket.id, reason });
            }}>
              <div className="mb-3">
                <label className="form-label fw-semibold" htmlFor="ticket-cancellation-reason">Cancellation reason <span className="text-danger">*</span></label>
                <textarea
                  id="ticket-cancellation-reason"
                  className="form-control"
                  rows="3"
                  maxLength={500}
                  required
                  autoFocus
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="For example: duplicate ticket, created by mistake, or customer no longer needs support."
                />
                <div className="form-text">Up to 500 characters. This will be saved in the ticket activity history.</div>
              </div>
              <div className="support-modal-footer d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-light border" onClick={() => { setCancellingTicket(null); setCancellationReason(''); }}>Keep ticket</button>
                <button type="submit" className="btn btn-danger" disabled={deleteMut.isPending || !cancellationReason.trim()}>
                  {deleteMut.isPending ? 'Cancelling...' : 'Cancel ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Closing Report Modal */}
      {closingTicket && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setClosingTicket(null); }}>
          <div className="support-modal p-4" style={{ width: 'min(480px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="closing-modal-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => setClosingTicket(null)}>×</button>
            <h5 id="closing-modal-title" className="fw-bold mb-2"><i className="fas fa-check-circle text-success me-2" />{canAssignTx ? 'Close Ticket — Report' : 'Mark Resolved — Report'}</h5>
            <p className="small text-muted mb-2">Ticket: {closingTicket.ticket_no} · {closingTicket.pppoe_username}</p>
            <label className="form-label fw-bold small text-dark">
              Closing report / resolution comment <span className="text-danger">* (Required)</span>
            </label>
            <textarea 
              className="form-control mb-2" 
              rows="3" 
              required
              placeholder="e.g. Fiber joint fixed, customer confirmed OK, router rebooted..." 
              value={closingNote} 
              onChange={(e) => setClosingNote(e.target.value)} 
            />
            {!closingNote.trim() && (
              <small className="text-danger d-block mb-2" style={{ fontSize: '11.5px' }}>
                * Resolution report is required before closing this ticket.
              </small>
            )}
            <div className="form-check mb-2 p-2 rounded bg-light border">
              <input
                className="form-check-input ms-0 me-2"
                type="checkbox"
                id="closeOnCallCheck"
                checked={closingIsOnCall}
                onChange={(e) => setClosingIsOnCall(e.target.checked)}
              />
              <label className="form-check-label small fw-bold text-dark" htmlFor="closeOnCallCheck" style={{ cursor: 'pointer' }}>
                <i className="fas fa-headset text-primary me-1" /> Mark as On-Call Support (Solved via Phone Call / NOC)
              </label>
              {(!closingTicket.assigned_to && (!closingTicket.additional_technician_ids || !closingTicket.additional_technician_ids.length)) && (
                <div className="small text-muted mt-1" style={{ fontSize: '11px' }}>
                  <i className="fas fa-info-circle text-info me-1" />
                  No technician assigned — defaulting to On-Call Support.
                </div>
              )}
            </div>
            <div className="form-check mb-2">
              <input className="form-check-input" type="checkbox" id="closeSmsCheck" checked={closingSendSms} onChange={(e) => setClosingSendSms(e.target.checked)} />
              <label className="form-check-label small" htmlFor="closeSmsCheck">Notify customer by SMS</label>
            </div>
            <div className="form-check mb-3">
              <input className="form-check-input" type="checkbox" id="closeWaCheck" checked={closingSendWhatsapp} onChange={(e) => setClosingSendWhatsapp(e.target.checked)} />
              <label className="form-check-label small" htmlFor="closeWaCheck">Notify customer by WhatsApp</label>
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button className="btn btn-light border btn-sm" onClick={() => setClosingTicket(null)}>Cancel</button>
              <button 
                className="btn btn-success btn-sm px-3 fw-semibold" 
                disabled={updateMut.isPending || !closingNote.trim()} 
                onClick={() => {
                  if (!closingNote.trim()) {
                    notify.error('Closing report / comment is required to solve the ticket.');
                    return;
                  }
                  // Field technicians mark resolved (office verifies & closes).
                  updateMut.mutate({
                    id: closingTicket.id,
                    data: {
                      status: canAssignTx ? 'closed' : 'resolved',
                      resolution_note: closingNote.trim(),
                      is_on_call: closingIsOnCall,
                      resolution_type: closingIsOnCall ? 'on_call' : 'field_visit',
                      send_sms: closingSendSms,
                      send_whatsapp: closingSendWhatsapp
                    }
                  });
                  setClosingTicket(null);
                }}
              >
                {updateMut.isPending ? (canAssignTx ? 'Closing...' : 'Resolving...') : (canAssignTx ? 'Close as Solved' : 'Mark Resolved')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 3: VERIFICATION CALL AFTER SUPPORT (Page 6 of PDF) --- */}
      {verifyingTicket && (() => {
        // True while the API fetch hasn't returned yet, OR while ticket meta isn't loaded
        const isVerifLoading = verificationLoading ||
          (!verificationLoadError && verificationLoadedTicketId !== Number(verifyingTicket.id));
        const hasTicketMeta = Boolean(verifyingTicket.pppoe_username);
        const verificationType = getVerificationType(verifyingTicket);
        const activeVerificationQuestions = getVerificationQuestions(verifyingTicket);
        const hasCompleteVerificationAnswers = activeVerificationQuestions.every((question) => (
          question.type === 'rating'
            ? Number.isInteger(verifyForm.answers?.[question.key]) &&
              verifyForm.answers[question.key] >= 0 &&
              verifyForm.answers[question.key] <= 10
            : typeof verifyForm.answers?.[question.key] === 'boolean'
        ));
        const hasActiveCallAttempt = Number(verifyingTicket.verification_attempt_id) > 0;
        const customerName = verifyingTicket.customer_name || verifyingTicket.name || verifyingTicket.customer_snapshot?.name || 'গ্রাহক';
        const customerId = verifyingTicket.pppoe_username || verifyingTicket.customer_id || '*';
        const serviceDate = fmt(verifyingTicket.resolved_at || verifyingTicket.closed_at || verifyingTicket.created_at);
        const serviceMonth = verifyingTicket.created_at
          ? new Date(verifyingTicket.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
          : '*';
        const callScripts = {
          shifting: `আসসালামু আলাইকুম ${customerName} স্যার, Speednet থেকে বলছি। আপনার গ্রাহক ID ${customerId}; ${serviceDate}-এ shifting করেছিলেন। Shifting-এর কাজটি সঠিকভাবে বুঝে পেয়েছেন কি? Shifting বাবদ কোনো payment করেছেন কি? ধন্যবাদ স্যার, Speednet-এর সঙ্গে থাকার জন্য।`,
          new_connection: `আসসালামু আলাইকুম ${customerName} স্যার, Speednet থেকে বলছি। সেবা সংক্রান্ত বিষয়ে কথা বলার সময় হবে কি? স্যার, ${serviceMonth} মাসে আপনার গ্রাহক ID ${customerId}-তে নতুন connection নিয়েছিলেন। নতুন connection স্বাভাবিকভাবে ব্যবহার করতে পারছেন কি? ধন্যবাদ স্যার, Speednet-এর সঙ্গে থাকার জন্য।`,
          qc: `আসসালামু আলাইকুম ${customerName} স্যার, Speednet থেকে বলছি। সেবা সংক্রান্ত বিষয়ে কথা বলার সময় হবে কি? স্যার, আপনার গ্রাহক ID ${customerId}; connection ব্যবহার করতে কোনো problem পাচ্ছেন কি? আমাদের service-কে ১০-এর মধ্যে কত rating দেবেন? ধন্যবাদ স্যার, Speednet-এর সঙ্গে থাকার জন্য।`,
          support: `আসসালামু আলাইকুম ${customerName} স্যার, Speednet থেকে বলছি। সেবা সংক্রান্ত বিষয়ে কথা বলার সময় হবে কি? স্যার, ${serviceDate}-এ একটি support নিয়েছিলেন। Support-টি বুঝে পেয়েছেন কি? Support বাবদ কোনো payment করেছেন কি? আমাদের support team-এর ব্যবহারে সন্তুষ্ট কি? ধন্যবাদ স্যার, Speednet-এর সঙ্গে থাকার জন্য।`,
        };
        return (
          <div className="support-modal-backdrop support-modal-backdrop-verification" onMouseDown={(e) => { if (e.target === e.currentTarget) requestCloseVerification(); }}>
            <div className="support-modal verification-call-modal p-4" role="dialog" aria-modal="true" aria-labelledby="verify-modal-title">
              <button className="modal-close-btn" aria-label="Close dialog" onClick={requestCloseVerification}>×</button>
              <div className="verification-call-main">
              <div className="text-center mb-3">
                <h5 id="verify-modal-title" className="fw-bold text-success mb-1">সেবা-পরবর্তী গ্রাহক যাচাইকরণ</h5>
                {hasTicketMeta ? (
                  <>
                    <p className="small text-muted m-0">গ্রাহক: {verifyingTicket.pppoe_username} ({verificationContactNumber})</p>
                    <p className="small text-muted m-0">ক্যাটাগরি: {VERIFICATION_TYPE_LABELS[verificationType]}</p>
                    {verificationContactNumber && (
                      <a
                        className="btn btn-outline-success btn-sm mt-2"
                        href={get3cxCallUri(verificationContactNumber)}
                        aria-label={`${verificationContactNumber} নম্বরে কল করুন`}
                        onClick={() => {
                          const ticketId = verifyingTicket.id;
                          supportService.log3cxCallHandoff(ticketId, 'verification')
                            .then(() => qc.invalidateQueries({ queryKey: ['ticketComments', ticketId] }))
                            .catch((error) => {
                              notify.error(error?.response?.data?.message || '3CX opened, but the call attempt could not be saved.');
                            });
                        }}
                      >
                        <i className="fas fa-phone me-1" aria-hidden="true" /> কল করুন
                      </a>
                    )}
                  </>
                ) : (
                  <p className="small text-muted m-0" style={{ minHeight: '20px' }}>
                    <span style={{ display: 'inline-block', width: 140, height: 14, background: '#e2e8f0', borderRadius: 4, verticalAlign: 'middle' }} />
                  </p>
                )}
              </div>

              {isVerifLoading ? (
                <div className="text-center text-muted py-4">সংরক্ষিত যাচাইকরণ তথ্য লোড হচ্ছে...</div>
            ) : verificationLoadError ? (
              <div className="alert alert-danger mb-0">যাচাইকরণের তথ্য লোড করা যায়নি। নিরাপত্তার জন্য এখন উত্তর জমা দেওয়া বন্ধ আছে। আবার চেষ্টা করতে ফর্মটি বন্ধ করে খুলুন।</div>
            ) : (
              <>
                <div className="alert alert-primary py-2 small" role="note">
                  এই ticket ইতিমধ্যে {verifyingTicket.status || 'Solved/Closed'}। এখানে ticket status বদলাবে না; সব category প্রশ্নের উত্তর দিলে verification Completed হবে, শুধু call outcome/মতামত দিলে Pending থাকবে।
                </div>
                {verificationData && (
                  <div className="alert alert-info py-2 small">
                    <div>আগে জমা হয়েছে: {fmt(verificationData.created_at)}{verificationData.verified_by_name ? ` · ${verificationData.verified_by_name}` : ''}</div>
                    {!verificationEditMode && <div>এটি সংরক্ষিত যাচাইকরণ। পরিবর্তনের জন্য “সংশোধন” নির্বাচন করুন।</div>}
                  </div>
                )}
                {verificationData && !verificationData.answers && (
                  <>
                    <div className="alert alert-warning py-2 small">
                      আগের যাচাইকরণটি সাধারণ প্রশ্নমালায় সংরক্ষিত; এই category-র প্রশ্নগুলোর উত্তর এখনো নেই। নতুন প্রশ্নগুলোর উত্তর দিতে “সংশোধন” নির্বাচন করুন।
                    </div>
                    <details className="border rounded p-2 mb-3">
                      <summary className="small fw-bold">আগের সাধারণ প্রশ্নমালার উত্তর</summary>
                      <div className="pt-2 small">
                        {LEGACY_VERIFICATION_QUESTIONS.map((q) => (
                          <div key={q.key} className="text-muted">
                            {q.text} — {verificationData[q.key] === true ? 'হ্যাঁ' : verificationData[q.key] === false ? 'না' : 'উত্তর নেই'}
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                )}
                <div className="verification-questions mb-3">
                  <p className="fw-bold small text-primary mb-2">
                    {verificationEditMode
                      ? 'অনুগ্রহ করে নিচের প্রশ্নগুলোর উত্তর দিন:'
                      : verificationData && !verificationData.answers
                        ? 'এই category-র প্রশ্নগুলোর উত্তর এখনো সংরক্ষিত নেই:'
                        : 'সংরক্ষিত উত্তর:'}
                  </p>
                  {activeVerificationQuestions.map((q) => {
                    const answer = verifyForm.answers?.[q.key];
                    const updateAnswer = (value) => setVerifyForm((current) => ({
                      ...current,
                      answers: { ...current.answers, [q.key]: value },
                    }));
                    const yesButtonClass = q.key === 'connection_problem' ? 'btn-danger' : 'btn-success';
                    const noButtonClass = q.key === 'connection_problem' ? 'btn-success' : 'btn-danger';
                    return (
                      <div key={q.key} className="d-flex justify-content-between align-items-center flex-wrap py-2 border-bottom">
                        <span className="small fw-semibold" style={{ flex: '1 1 200px' }}>{q.text}</span>
                        {q.type === 'rating' ? (
                          <select className="form-select form-select-sm" style={{ width: 110 }} disabled={!verificationEditMode} value={verifyForm.answers?.[q.key] ?? ''} onChange={(e) => setVerifyForm((current) => ({ ...current, answers: { ...current.answers, [q.key]: e.target.value === '' ? null : Number(e.target.value) } }))}>
                            <option value="">বাছাই করুন</option>{Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}/10</option>)}
                          </select>
                        ) : <div className="btn-group btn-group-sm">
                          <button
                            type="button"
                            disabled={!verificationEditMode}
                            className={`btn ${answer === true ? yesButtonClass : 'btn-outline-secondary'}`}
                            onClick={() => updateAnswer(true)}
                          >
                            ✓ হ্যাঁ
                          </button>
                          <button
                            type="button"
                            disabled={!verificationEditMode}
                            className={`btn ${answer === false ? noButtonClass : 'btn-outline-secondary'}`}
                            onClick={() => updateAnswer(false)}
                          >
                            ✗ না
                          </button>
                        </div>}
                      </div>
                    );
                  })}
                </div>

                <label className="form-label fw-bold small">কথোপকথনের script</label>
                <textarea className="form-control mb-3" rows="4" readOnly value={callScripts[verificationType]} />

                <div className="verification-report-comments">
                  <label className="form-label fw-bold small" htmlFor="verification-feedback">
                    রিপোর্ট নোট <span className="text-muted fw-normal">(ঐচ্ছিক)</span>
                  </label>
                  <textarea
                    id="verification-feedback"
                    className="form-control mb-1"
                    rows="2"
                    value={verifyForm.feedback_remarks}
                    disabled={!verificationEditMode}
                    onChange={(e) => setVerifyForm({ ...verifyForm, feedback_remarks: e.target.value })}
                    placeholder="প্রয়োজন হলে সংক্ষিপ্ত নোট লিখুন..."
                  />
                </div>
                {verificationEditMode && hasActiveCallAttempt && !hasCompleteVerificationAnswers && (
                  <div className="border rounded p-2 mb-3">
                    <label className="form-label fw-bold small" htmlFor="verification-call-outcome">কলের ফলাফল</label>
                    <select
                      id="verification-call-outcome"
                      className="form-select form-select-sm"
                      value={callOutcome}
                      onChange={(event) => setCallOutcome(event.target.value)}
                    >
                      <option value="">ফলাফল নির্বাচন করুন</option>
                      {VERIFICATION_CALL_OUTCOMES.map((outcome) => (
                        <option key={outcome.value} value={outcome.value}>{outcome.label}</option>
                      ))}
                    </select>
                    <small className="text-muted d-block mt-1">
                      অসম্পূর্ণ উত্তর সংরক্ষণ হবে না; শুধু কলের ফলাফল ও নোট save হবে। Verification Pending থাকবে।
                    </small>
                  </div>
                )}

                {verificationHistory.length > 0 && (
                  <details className="border rounded p-2 mb-3">
                    <summary className="small fw-bold">আগের সংশোধনের ইতিহাস ({verificationHistory.length})</summary>
                    <div className="pt-2">
                      {verificationHistory.map((revision) => (
                        <div key={revision.id} className="border-top py-2 small">
                          <div className="fw-semibold">
                            জমার সময়: {fmt(revision.verified_at || revision.archived_at)}
                            {revision.verified_by_name ? ` · ${revision.verified_by_name}` : ''}
                            {revision.revised_by_name ? ` · সংশোধনের সময়: ${fmt(revision.archived_at)} · সংশোধন করেছেন: ${revision.revised_by_name}` : ''}
                          </div>
                          {(revision.answers ? VERIFICATION_QUESTION_SETS[verificationType] : LEGACY_VERIFICATION_QUESTIONS).map((q) => {
                            const answer = revision.answers?.[q.key] ?? revision[q.key];
                            return (
                              <div key={q.key} className="text-muted">
                                {q.text} — {q.type === 'rating' ? (answer ?? 'উত্তর নেই') : (answer === true ? 'হ্যাঁ' : answer === false ? 'না' : 'উত্তর নেই')}
                              </div>
                            );
                          })}
                          {revision.feedback_remarks && <div className="mt-1">মতামত: {revision.feedback_remarks}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="d-flex gap-2">
                  {Number(verifyingTicket.verification_attempt_id) > 0 && (
                    <button
                      className="btn btn-outline-danger"
                      type="button"
                      onClick={handleCancelVerificationCall}
                      disabled={finishVerificationCallMut.isPending || verifyMut.isPending}
                    >
                      {finishVerificationCallMut.isPending ? 'বাতিল হচ্ছে...' : 'কল বাতিল'}
                    </button>
                  )}
                  {verificationData && !verificationEditMode ? (
                    <button className="btn btn-outline-primary w-100" type="button" onClick={() => setVerificationEditMode(true)}>
                      <i className="fas fa-pen me-1" /> সংশোধন
                    </button>
                  ) : (
                    <>
                      {verificationData && (
                        <button
                          className="btn btn-light border"
                          type="button"
                          onClick={() => {
                            setVerifyForm({
                              ...createEmptyVerificationForm(),
                              ...Object.fromEntries(LEGACY_VERIFICATION_QUESTIONS.map(({ key }) => [key, verificationData[key] ?? null])),
                              answers: verificationData.answers || {},
                              feedback_remarks: verificationData.feedback_remarks || '',
                            });
                            setVerificationEditMode(false);
                          }}
                        >
                          পরিবর্তন বাতিল
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-success flex-grow-1"
                        onClick={handleSaveVerification}
                        disabled={
                          verifyMut.isPending ||
                          finishVerificationCallMut.isPending ||
                          (!hasCompleteVerificationAnswers && (!hasActiveCallAttempt || !callOutcome))
                        }
                      >
                        {verifyMut.isPending || finishVerificationCallMut.isPending
                          ? 'সংরক্ষণ হচ্ছে...'
                          : hasCompleteVerificationAnswers
                            ? verificationData ? 'সংশোধন সংরক্ষণ' : 'যাচাইকরণ সম্পন্ন করুন'
                            : 'কলের ফলাফল সংরক্ষণ'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            </div>
            <aside className="verification-history-sidebar" aria-label="Ticket history">
              <div className="verification-history-heading">
                <span className="verification-history-icon"><i className="fas fa-history" aria-hidden="true" /></span>
                <div>
                  <h6 className="mb-0">টিকিটের ইতিহাস</h6>
                  <small>{verifyingTicket.ticket_no || `Ticket #${verifyingTicket.id}`}</small>
                </div>
              </div>

              <section className="verification-history-section">
                <h6><i className="fas fa-ticket-alt me-2" />টিকিট খোলার তথ্য</h6>
                <div className="verification-history-meta">
                  <span>খুলেছেন</span><strong>{verifyingTicket.created_by_name || 'তথ্য নেই'}</strong>
                  <span>সময়</span><strong>{fmt(verifyingTicket.created_at)}</strong>
                  <span>Problem category</span>
                  <strong>
                    {verifyingTicket.category_name
                      || verifyingTicket.category
                      || REMOVED_SUPPORT_CATEGORY_LABELS[Number(verifyingTicket.category_id)]
                      || 'তথ্য নেই'}
                  </strong>
                  <span>সমস্যার বিবরণ</span>
                  <strong>{verifyingTicket.subject || verifyingTicket.description || 'তথ্য নেই'}</strong>
                  <span>বর্তমান অবস্থা</span><strong className="text-capitalize">{verifyingTicket.status || 'তথ্য নেই'}</strong>
                </div>
              </section>

              <section className="verification-history-section">
                <h6><i className="fas fa-clipboard-check me-2" />Resolution Summary / Report</h6>
                <p className={verifyingTicket.resolution_note ? 'mb-0' : 'mb-0 text-muted'}>
                  {verifyingTicket.resolution_note || 'কোনো resolution summary / report নেই।'}
                </p>
                {(verifyingTicket.closed_at || verifyingTicket.resolved_at) && (
                  <small className="verification-history-subtle d-block mt-2">
                    <i className="fas fa-clock me-1" />{fmt(verifyingTicket.closed_at || verifyingTicket.resolved_at)}
                    {verifyingTicket.assigned_to_name ? ` · ${verifyingTicket.assigned_to_name}` : ''}
                  </small>
                )}
              </section>

              <section className="verification-history-section">
                <h6><i className="fas fa-tools me-2" />Work report ({(verifyingTicket.reports || []).length})</h6>
                {(verifyingTicket.reports || []).length ? (
                  <div className="verification-history-reports">
                    {verifyingTicket.reports.map((report) => (
                      <article className="verification-history-report" key={report.id}>
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <strong>{report.author_name || 'Technician'}</strong>
                          <span className={`badge ${report.status === 'approved' ? 'bg-success' : report.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}`}>{report.status || 'submitted'}</span>
                        </div>
                        <p className="mb-1 mt-2">{report.work_done || 'কাজের বিবরণ নেই।'}</p>
                        {report.materials_used && <small className="d-block"><strong>Materials:</strong> {report.materials_used}</small>}
                        {report.review_note && <small className="d-block mt-1"><strong>Review:</strong> {report.review_note}</small>}
                        <small className="verification-history-subtle">{fmt(report.created_at)}</small>
                      </article>
                    ))}
                  </div>
                ) : <p className="mb-0 text-muted">কোনো work report নেই।</p>}
              </section>

              <section className="verification-history-section verification-history-activity">
                <h6><i className="fas fa-comments me-2" />Comments ও activity</h6>
                {ticketCommentsQ.isLoading ? (
                  <p className="text-muted mb-0"><i className="fas fa-circle-notch fa-spin me-2" />History লোড হচ্ছে...</p>
                ) : ticketCommentsQ.isError ? (
                  <div className="small text-danger">
                    <p>Ticket history লোড করা যায়নি।</p>
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => ticketCommentsQ.refetch()}>আবার চেষ্টা করুন</button>
                  </div>
                ) : (ticketCommentsQ.data?.timeline || []).length ? (
                  <div className="verification-history-timeline">
                    {[...(ticketCommentsQ.data?.timeline || [])].reverse().map((entry, index) => {
                      const isComment = entry.kind === 'comment';
                      const eventLabels = {
                        created: 'টিকিট খোলা হয়েছে',
                        assigned: 'টেকনিশিয়ান assign',
                        reassigned: 'টেকনিশিয়ান পরিবর্তন',
                        status_changed: 'Status পরিবর্তন',
                        edited: 'টিকিট update',
                        note: 'নোট',
                        verification: 'Verification',
                        call_handoff: 'Call history',
                        team_updated: 'Team update',
                        unassigned: 'Assignment সরানো হয়েছে',
                      };
                      const body = isComment
                        ? entry.comment
                        : entry.message || eventLabels[entry.event_type] || 'Activity recorded';
                      return (
                        <article className={`verification-history-entry${isComment ? ' is-comment' : ''}`} key={`${entry.kind}-${entry.id || index}`}>
                          <div className="verification-history-entry-top">
                            <strong>{isComment ? (entry.is_internal ? 'Internal comment' : 'Comment') : (eventLabels[entry.event_type] || 'Activity')}</strong>
                            <time dateTime={entry.created_at || undefined}>{fmt(entry.created_at)}</time>
                          </div>
                          <p>{body || 'খালি comment'}</p>
                          <small>{entry.created_by_name || entry.actor_name || 'System'}</small>
                        </article>
                      );
                    })}
                  </div>
                ) : <p className="mb-0 text-muted">এখনো কোনো comment বা activity নেই।</p>}
              </section>
            </aside>
          </div>
        </div>
        );
      })()}

      {/* --- MODAL 4: CREATE SMS TEMPLATE (Page 9 of PDF) --- */}
      {showCreateTemplateModal && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreateTemplateModal(false); }}>
          <div className="support-modal p-4" style={{ width: 'min(480px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="sms-template-modal-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => setShowCreateTemplateModal(false)}>×</button>
            <h5 id="sms-template-modal-title" className="fw-bold mb-3">Add SMS Template</h5>

            <label className="form-label fw-bold small">TEMPLATE NAME</label>
            <input className="form-control mb-3" value={newTemplate.template_name} disabled={newTemplate.template_type === 'System'} title={newTemplate.template_type === 'System' ? 'System format key cannot be renamed' : ''} onChange={(e) => setNewTemplate({ ...newTemplate, template_name: e.target.value })} placeholder="e.g. bKash Payment" />

            <label className="form-label fw-bold small">TYPE</label>
            <select className="form-select mb-3" value={newTemplate.template_type} onChange={(e) => setNewTemplate({ ...newTemplate, template_type: e.target.value })}>
              <option value="Custom">Custom</option>
              <option value="Reminder">Reminder</option>
              <option value="Payment">Payment</option>
              <option value="Support">Support</option>
              <option value="System">System (auto SMS)</option>
            </select>

            <label className="form-label fw-bold small">MESSAGE BODY</label>
            <textarea className="form-control mb-3" rows="5" value={newTemplate.message_body} onChange={(e) => setNewTemplate({ ...newTemplate, message_body: e.target.value })} placeholder="Type template body..." />

            <button className="btn btn-primary w-100" onClick={() => createTemplateMut.mutate(newTemplate)} disabled={createTemplateMut.isPending}>
              {createTemplateMut.isPending ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      {/* View Template Modal — click row to show */}
      {viewingTemplate && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewingTemplate(null); }}>
          <div className="support-modal p-4" style={{ width: 'min(520px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="view-template-modal-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => setViewingTemplate(null)}>×</button>
            <h5 id="view-template-modal-title" className="fw-bold text-primary mb-2"><i className="fas fa-eye me-2" />{viewingTemplate.template_name}</h5>
            <span className="badge bg-info mb-3">{viewingTemplate.template_type}</span>
            <div className="p-3 bg-light border rounded mb-3" style={{ whiteSpace: 'pre-wrap' }}>{viewingTemplate.message_body}</div>
            <div className="d-flex justify-content-end flex-wrap gap-2">
              <button className="btn btn-light border btn-sm" onClick={() => setViewingTemplate(null)}>Close</button>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditingTemplate(viewingTemplate); setNewTemplate({ template_name: viewingTemplate.template_name, template_type: viewingTemplate.template_type, message_body: viewingTemplate.message_body }); setViewingTemplate(null); }}><i className="fas fa-edit me-1" /> Edit</button>
              <button className="btn btn-outline-primary btn-sm" onClick={() => { setSmsBody(viewingTemplate.message_body); setViewingTemplate(null); }}><i className="fas fa-paper-plane me-1" /> Use in SMS</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {editingTemplate && (
        <div className="support-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditingTemplate(null); setNewTemplate({ template_name: '', template_type: 'Custom', message_body: '' }); } }}>
          <div className="support-modal p-4" style={{ width: 'min(480px, 95%)' }} role="dialog" aria-modal="true" aria-labelledby="edit-template-modal-title">
            <button className="modal-close-btn" aria-label="Close dialog" onClick={() => { setEditingTemplate(null); setNewTemplate({ template_name: '', template_type: 'Custom', message_body: '' }); }}>×</button>
            <h5 id="edit-template-modal-title" className="fw-bold mb-3"><i className="fas fa-edit me-2" />Edit SMS Template</h5>
            {editingTemplate.template_type === 'System' && (
              <div className="alert alert-info py-2 small">System auto-SMS format — only the message text can change (name is locked).</div>
            )}
            <label className="form-label fw-bold small">TEMPLATE NAME</label>
            <input className="form-control mb-3" value={newTemplate.template_name} disabled={editingTemplate.template_type === 'System'} onChange={(e) => setNewTemplate({ ...newTemplate, template_name: e.target.value })} />
            <label className="form-label fw-bold small">TYPE</label>
            <select className="form-select mb-3" value={newTemplate.template_type} disabled={editingTemplate.template_type === 'System'} onChange={(e) => setNewTemplate({ ...newTemplate, template_type: e.target.value })}>
              <option value="Custom">Custom</option>
              <option value="Reminder">Reminder</option>
              <option value="Payment">Payment</option>
              <option value="Support">Support</option>
              <option value="System">System (auto SMS)</option>
            </select>
            <label className="form-label fw-bold small">MESSAGE BODY</label>
            <textarea className="form-control mb-3" rows="5" value={newTemplate.message_body} onChange={(e) => setNewTemplate({ ...newTemplate, message_body: e.target.value })} />
            <div className="d-flex gap-2">
              <button className="btn btn-light border flex-fill" onClick={() => { setEditingTemplate(null); setNewTemplate({ template_name: '', template_type: 'Custom', message_body: '' }); }}>Cancel</button>
              <button className="btn btn-primary flex-fill" disabled={updateTemplateMut.isPending} onClick={() => updateTemplateMut.mutate({ id: editingTemplate.id, data: newTemplate })}>
                {updateTemplateMut.isPending ? 'Updating...' : 'Update Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportTickets;
