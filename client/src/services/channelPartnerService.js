import apiClient from "../config/axiosConfig";

const base = "/api/channel-partners";

// User management
export const getChannelUsers = async (resellerId, options = {}) => {
  const params = {};
  if (options.status) params.status = options.status;
  if (options.search) params.search = options.search;
  return (await apiClient.get(`${base}/${resellerId}/users`, { params })).data;
};

export const addChannelUser = async (resellerId, payload) =>
  (await apiClient.post(`${base}/${resellerId}/users`, payload)).data;

export const updateChannelUser = async (resellerId, userId, payload) =>
  (await apiClient.put(`${base}/${resellerId}/users/${userId}`, payload)).data;

export const deleteChannelUser = async (resellerId, userId) =>
  (await apiClient.delete(`${base}/${resellerId}/users/${userId}`)).data;

// User payment collection tracking
export const getUserPayments = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/user-payments`, {
      params: { month },
    })
  ).data;

export const initMonthlyPayments = async (resellerId, month) =>
  (await apiClient.post(`${base}/${resellerId}/user-payments/init`, { month }))
    .data;

export const recordUserPayment = async (resellerId, payload) =>
  (await apiClient.post(`${base}/${resellerId}/user-payments/record`, payload))
    .data;

export const bulkRecordPayments = async (resellerId, month, payments) =>
  (
    await apiClient.post(`${base}/${resellerId}/user-payments/bulk`, {
      month,
      payments,
    })
  ).data;

// Commission
export const getCommissionSummary = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/commission-summary`, {
      params: { month },
    })
  ).data;

export const generateCommission = async (resellerId, month) =>
  (await apiClient.post(`${base}/${resellerId}/commission-generate`, { month }))
    .data;

export const adjustCommission = async (resellerId, logId, payload) =>
  (
    await apiClient.patch(
      `${base}/${resellerId}/commission/${logId}/adjust`,
      payload,
    )
  ).data;

export const finalizeCommission = async (resellerId, logId) =>
  (await apiClient.patch(`${base}/${resellerId}/commission/${logId}/finalize`))
    .data;

export const unfinalizeCommission = async (resellerId, logId) =>
  (await apiClient.patch(`${base}/${resellerId}/commission/${logId}/unfinalize`))
    .data;

export const getCommissionHistory = async (resellerId) =>
  (await apiClient.get(`${base}/${resellerId}/commission-history`)).data;

// Commission payments (to partner)
export const recordCommissionPayment = async (resellerId, payload) =>
  (await apiClient.post(`${base}/${resellerId}/commission-payments`, payload))
    .data;

export const getCommissionPayments = async (resellerId) =>
  (await apiClient.get(`${base}/${resellerId}/commission-payments`)).data;

// Statement
export const getChannelStatement = async (resellerId) =>
  (await apiClient.get(`${base}/${resellerId}/statement`)).data;

// Maxim sync (no Maestro API — snapshots via worker)
export const startMaximSync = async (resellerId, month, suffix) =>
  (await apiClient.post(`${base}/${resellerId}/maxim-sync`, { month, suffix }))
    .data;

export const getMaximSyncStatus = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/maxim-sync/status`, {
      params: month ? { month } : {},
    })
  ).data;

export const getMaximPrefill = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/maxim-prefill`, {
      params: { month },
    })
  ).data;

export const saveMaximSuffix = async (resellerId, suffix) =>
  (await apiClient.put(`${base}/${resellerId}/maxim-suffix`, { suffix })).data;

export const getMaximHealth = async (resellerId) =>
  (await apiClient.get(`${base}/${resellerId}/maxim-health`)).data;

// Excel Import
export const importChannelData = async (resellerId, month, file) => {
  const formData = new FormData();
  formData.append("month", month);
  formData.append("file", file);
  return (
    await apiClient.post(`${base}/${resellerId}/import-user-list`, formData)
  ).data;
};

export const downloadReconciliationReport = async (
  resellerId,
  reconciliationId,
) => {
  const response = await apiClient.get(
    `${base}/${resellerId}/reconciliation/${reconciliationId}/report`,
  );
  if (response.data?.pdf_url) {
    window.open(response.data.pdf_url, "_blank");
  }
  return response.data;
};

export const getReconciliations = async (resellerId) =>
  (await apiClient.get(`${base}/${resellerId}/reconciliation/list`)).data;

// Product catalog
export const listChannelProducts = async (activeOnly = true) =>
  (
    await apiClient.get(`${base}/products`, {
      params: { active_only: activeOnly ? 1 : 0 },
    })
  ).data;

export const importChannelProducts = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  return (await apiClient.post(`${base}/products/import`, formData)).data;
};

export const importResellerProducts = async (resellerId, month, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return (
    await apiClient.post(`${base}/${resellerId}/products/import-usage`, formData, {
      params: { month },
    })
  ).data;
};

export const createChannelProduct = async (payload) =>
  (await apiClient.post(`${base}/products`, payload)).data;

export const updateChannelProduct = async (productId, payload) =>
  (await apiClient.put(`${base}/products/${productId}`, payload)).data;

export const getUserProducts = async (resellerId, userId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/users/${userId}/products`, {
      params: { month },
    })
  ).data;

export const saveUserProducts = async (resellerId, userId, payload) =>
  (
    await apiClient.put(`${base}/${resellerId}/users/${userId}/products`, payload)
  ).data;

export const getProductSummary = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/product-summary`, {
      params: { month },
    })
  ).data;

export const getManualProductCharge = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/manual-product-charge`, {
      params: { month },
    })
  ).data;

export const saveManualProductCharge = async (resellerId, payload) =>
  (await apiClient.post(`${base}/${resellerId}/manual-product-charge`, payload))
    .data;

export const getPartnerProductUsage = async (resellerId, month) =>
  (
    await apiClient.get(`${base}/${resellerId}/product-usage`, {
      params: { month },
    })
  ).data;
