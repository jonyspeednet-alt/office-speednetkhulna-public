import apiClient from '../config/axiosConfig';

export const getResellers = async (search = '', options = {}) => {
  const params = { search };
  if (options.status) params.status = options.status;
  if (options.partner_type) params.partner_type = options.partner_type;
  return (await apiClient.get('/api/resellers/resellers', { params })).data;
};
export const getPartnerSheetRows = async (tab) => (await apiClient.get('/api/resellers/partner-sheets', { params: { tab } })).data;
export const createReseller = async (payload) => (await apiClient.post('/api/resellers/resellers', payload)).data;
export const getResellerProfile = async (id) => (await apiClient.get(`/api/resellers/resellers/${id}`)).data;
export const getResellerProfileDetails = async (id) => (await apiClient.get(`/api/resellers/resellers/${id}/details`)).data;
export const updateReseller = async (id, payload) => (await apiClient.put(`/api/resellers/resellers/${id}`, payload)).data;

export const getResellerStatusNoc = async (options = {}) => {
  const params = {};
  if (options.status) params.status = options.status;
  return (await apiClient.get('/api/resellers/reseller-status-noc', { params })).data;
};

export const submitBandwidthRequest = async (payload) => (await apiClient.post('/api/resellers/bandwidth-requests', payload)).data;
export const getBandwidthRequests = async (status = '') => (await apiClient.get('/api/resellers/bandwidth-requests', { params: { status } })).data;
export const reviewBandwidthRequest = async (id, status, note = undefined) => (
  await apiClient.patch(`/api/resellers/bandwidth-requests/${id}/review`, {
    status,
    ...(note !== undefined ? { note } : {})
  })
).data;
export const applyBandwidthRequest = async (id, payload = {}) => (await apiClient.post(`/api/resellers/bandwidth-requests/${id}/apply`, payload)).data;

export const getBillingLogs = async (reseller_id = '') => (await apiClient.get('/api/resellers/billing-logs', { params: { reseller_id } })).data;
export const addBillingLog = async (payload) => (await apiClient.post('/api/resellers/billing-logs', payload)).data;
export const addDiscount = async (resellerId, payload) => (await apiClient.post(`/api/resellers/resellers/${resellerId}/discounts`, payload)).data;

export const getMonthlySummary = async (month = '', options = {}) =>
  (await apiClient.get('/api/resellers/monthly-summary', {
    params: {
      month,
      ...(options.partner_type ? { partner_type: options.partner_type } : {})
    },
    timeout: 60000
  })).data;

export const getInvoice = async (resellerId, params = {}) => {
  const queryParams = typeof params === 'string' ? { month: params } : params;
  return (await apiClient.get(`/api/resellers/invoice/${resellerId}`, { params: queryParams })).data;
};
export const getInvoiceByBillId = async (billId) => (await apiClient.get(`/api/resellers/invoice/by-bill/${billId}`)).data;
export const sendInvoiceEmail = async (resellerId, payload) => (await apiClient.post(`/api/resellers/invoice/${resellerId}/send-email`, payload)).data;
export const sendInvoiceEmailByBillId = async (billId, payload) => (await apiClient.post(`/api/resellers/invoice/by-bill/${billId}/send-email`, payload)).data;


export const updateMonthlySummaryPayDate = async (reseller_id, date) => (await apiClient.patch('/api/resellers/monthly-summary/next-pay-date', { reseller_id, date })).data;

export const changeResellerRate = async (id, payload) => (await apiClient.post(`/api/resellers/resellers/${id}/rate-change`, payload)).data;
export const getResellerRateChangeLogs = async (id) => (await apiClient.get(`/api/resellers/resellers/${id}/rate-change-logs`)).data;

export const finalizeInvoice = async (resellerId, payload) => (await apiClient.post(`/api/resellers/invoice/${resellerId}/finalize`, payload)).data;

export const listBillingRules = async (resellerId, month = '') => (
  await apiClient.get(`/api/resellers/resellers/${resellerId}/billing-rules`, { params: month ? { month } : {} })
).data;
export const createBillingRule = async (resellerId, payload) => (
  await apiClient.post(`/api/resellers/resellers/${resellerId}/billing-rules`, payload)
).data;
export const updateBillingRule = async (resellerId, ruleId, payload) => (
  await apiClient.patch(`/api/resellers/resellers/${resellerId}/billing-rules/${ruleId}`, payload)
).data;
export const deactivateBillingRule = async (resellerId, ruleId, payload = {}) => (
  await apiClient.delete(`/api/resellers/resellers/${resellerId}/billing-rules/${ruleId}`, { data: payload })
).data;

export const getPartnerReport = async (params = {}) => (await apiClient.get('/api/resellers/partner-report', { params, timeout: 60000 })).data;
export const getPartnerTrends = async (params = {}) => (await apiClient.get('/api/resellers/partner-report/trends', { params, timeout: 60000 })).data;
export const getPartnerDetailReport = async (id, params = {}) => (await apiClient.get(`/api/resellers/partner-report/${id}`, { params, timeout: 60000 })).data;

export const getPartnerLifetimeReport = async (id, params = {}) => (await apiClient.get(`/api/resellers/partner-report/${id}/lifetime`, { params, timeout: 60000 })).data;

export const previewRetroactiveBandwidthCorrection = async (resellerId, payload) =>
  (await apiClient.post(`/api/resellers/resellers/${resellerId}/retroactive-bandwidth/preview`, payload)).data;

export const applyRetroactiveBandwidthCorrection = async (resellerId, payload) =>
  (await apiClient.post(`/api/resellers/resellers/${resellerId}/retroactive-bandwidth/apply`, payload)).data;


