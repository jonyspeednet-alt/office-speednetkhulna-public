import apiClient from '../config/axiosConfig';

const API_URL = '/api/procurement';

export const listPurchaseOrders = async (params = {}) => {
  const response = await apiClient.get(API_URL, { params });
  const data = response.data;
  // Backend returns { rows, total, page, limit } in paginated mode, plain array otherwise
  if (Array.isArray(data)) return { rows: data, total: data.length };
  return { rows: data.rows || [], total: data.total || 0, page: data.page, limit: data.limit };
};

export const getPurchaseOrderDetails = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const createPurchaseOrder = async (payload) => {
  const response = await apiClient.post(API_URL, payload);
  return response.data;
};

export const updatePOStatus = async (id, status) => {
  const response = await apiClient.patch(`${API_URL}/${id}/status`, { status });
  return response.data;
};

export const PO_STATUSES = ['pending', 'approved', 'rejected', 'ordered', 'received', 'cancelled'];

export const PO_STATUS_TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  rejected: ['pending'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: []
};

export const isTerminalPOStatus = (status) => status === 'received' || status === 'cancelled';
