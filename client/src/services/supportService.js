import apiClient from '../config/axiosConfig';

const unwrap = (response) => response.data?.data ?? response.data;

export const getSupportDashboard = async (params = {}) => unwrap(await apiClient.get('/api/support/dashboard', { params }));
export const getSupportTickets = async (params = {}) => {
  const res = await apiClient.get('/api/support/tickets', { params });
  const data = unwrap(res);
  // server returns {rows,total,page,limit,totalPages} when paginated; normalize to that shape
  if (data && typeof data === 'object' && Array.isArray(data.rows)) return data;
  // legacy array fallback
  if (Array.isArray(data)) return { rows: data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  return data;
};
export const getTechnicianSupportRegister = async (params = {}) =>
  unwrap(await apiClient.get('/api/support/reports/technician-register', { params }));
export const searchSupportCustomers = async (q) => unwrap(await apiClient.get('/api/support/customers/search', { params: { q } }));
export const createSupportTicket = async (data) => unwrap(await apiClient.post('/api/support/tickets', data));
export const updateSupportTicket = async (id, data) => unwrap(await apiClient.patch(`/api/support/tickets/${id}`, data));
export const deleteSupportTicket = async (id, data) => unwrap(await apiClient.delete(`/api/support/tickets/${id}`, { data }));
// Admin-only undo for an accidental solve/close.
export const revertSolvedTicket = async (id, data) => unwrap(await apiClient.post(`/api/support/tickets/${id}/revert`, data));
export const getTicketComments = async (id) => unwrap(await apiClient.get(`/api/support/tickets/${id}/comments`));
export const addTicketComment = async (id, data) => unwrap(await apiClient.post(`/api/support/tickets/${id}/comments`, data));
export const getCustomerComments = async (customerId) => unwrap(await apiClient.get(`/api/support/customers/${customerId}/comments`));
export const syncMikrotikCustomers = async () => unwrap(await apiClient.post('/api/support/mikrotik/sync'));

// --- MikroTik router management (FRONTEND contract; Agent B backend) ---
export const getMikrotikRouters = async (params = {}) => unwrap(await apiClient.get('/api/support/mikrotik/routers', { params }));
export const getMikrotikRouter = async (id) => unwrap(await apiClient.get(`/api/support/mikrotik/routers/${id}`));
export const createMikrotikRouter = async (data) => unwrap(await apiClient.post('/api/support/mikrotik/routers', data));
export const updateMikrotikRouter = async (id, data) => unwrap(await apiClient.patch(`/api/support/mikrotik/routers/${id}`, data));
export const deleteMikrotikRouter = async (id, hard = false) =>
  unwrap(await apiClient.delete(`/api/support/mikrotik/routers/${id}`, { params: hard ? { hard: true } : {} }));
// Frontend timeout 20s for test (backend may take a while dialing RouterOS)
export const testMikrotikRouter = async (id) =>
  unwrap(await apiClient.post(`/api/support/mikrotik/routers/${id}/test`, {}, { timeout: 20000 }));
export const syncMikrotikRouter = async (id) => unwrap(await apiClient.post(`/api/support/mikrotik/routers/${id}/sync`));
export const getMikrotikSyncRuns = async (params = {}) => unwrap(await apiClient.get('/api/support/mikrotik/sync-runs', { params }));

export const saveVerificationCall = async (data) => unwrap(await apiClient.post('/api/support/verification', data));
export const getVerificationCallQueue = async (params = {}) =>
  unwrap(await apiClient.get('/api/support/verification-calls/queue', { params }));
export const getVerificationCallReport = async (params = {}) =>
  unwrap(await apiClient.get('/api/support/verification-calls/report', { params }));
export const getVerificationCallAnalytics = async (params = {}) =>
  unwrap(await apiClient.get('/api/support/verification-calls/analytics', { params }));
export const exportVerificationCallMonth = async (month) =>
  apiClient.get('/api/support/verification-calls/analytics/export', {
    params: { month },
    responseType: 'blob',
  });
export const startVerificationCallAttempt = async (ticketId) =>
  unwrap(await apiClient.post(`/api/support/verification-calls/tickets/${ticketId}/attempts`));
export const finishVerificationCallAttempt = async (ticketId, attemptId, data) =>
  unwrap(await apiClient.patch(`/api/support/verification-calls/tickets/${ticketId}/attempts/${attemptId}`, data));

export const getSmsTemplates = async () => unwrap(await apiClient.get('/api/support/sms-templates'));
export const getSmsTemplate = async (id) => unwrap(await apiClient.get(`/api/support/sms-templates/${id}`));
export const createSmsTemplate = async (data) => unwrap(await apiClient.post('/api/support/sms-templates', data));
export const updateSmsTemplate = async (id, data) => unwrap(await apiClient.put(`/api/support/sms-templates/${id}`, data));
export const deleteSmsTemplate = async (id) => unwrap(await apiClient.delete(`/api/support/sms-templates/${id}`));
export const sendSmsPortal = async (data) => unwrap(await apiClient.post('/api/support/send-sms', data));
export const getSmsBalance = async (params = {}) => unwrap(await apiClient.get('/api/support/sms-balance', { params }));

// --- Ticket live line status (per-call timeout 12s) ---
export const getTicketLiveStatus = async (ticketId) =>
  unwrap(await apiClient.get(`/api/support/tickets/${ticketId}/live-status`, { timeout: 12000 }));
export const getTicket = async (id) => unwrap(await apiClient.get(`/api/support/tickets/${id}`));
export const log3cxCallHandoff = async (id, source) =>
  unwrap(await apiClient.post(`/api/support/tickets/${id}/call-handoffs`, { source }));
export const getMyTicketSummary = async () => unwrap(await apiClient.get('/api/support/tickets/my-summary'));
export const submitWorkReport = async (id, formData) =>
  unwrap(await apiClient.post(`/api/support/tickets/${id}/reports`, formData));
export const reviewWorkReport = async (id, reportId, data) =>
  unwrap(await apiClient.patch(`/api/support/tickets/${id}/reports/${reportId}`, data));
export const getSmsLogs = async (params = {}) => unwrap(await apiClient.get('/api/support/sms-logs', { params }));
export const getWhatsAppSessions = async () => unwrap(await apiClient.get('/api/support/whatsapp/sessions'));
export const reconnectWhatsAppSession = async (session) => unwrap(await apiClient.post('/api/support/whatsapp/reconnect', { session }));
export const disconnectWhatsAppSession = async (session) => unwrap(await apiClient.post('/api/support/whatsapp/disconnect', { session }));
