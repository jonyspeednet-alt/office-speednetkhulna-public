import apiClient from '../config/axiosConfig';

const API_URL = '/api/office-work';

export const getWorkEntries = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const addWorkEntry = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const updateWorkEntry = async ({ id, data }) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const toggleWorkEntry = async (id) => {
  const response = await apiClient.put(`${API_URL}/${id}/toggle`, {});
  return response.data;
};

export const deleteWorkEntry = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};

export const addWorkSession = async ({ id, data }) => {
  const response = await apiClient.post(`${API_URL}/${id}/sessions`, data);
  return response.data;
};

export const getWorkPerformanceSummary = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/performance/summary`, { params });
  return response.data;
};

export const getWorkKpiTargets = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/performance/kpi-targets`, { params });
  return response.data;
};

export const upsertWorkKpiTarget = async (data) => {
  const response = await apiClient.post(`${API_URL}/performance/kpi-targets`, data);
  return response.data;
};
