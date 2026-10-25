import apiClient from '../config/axiosConfig';

const API_URL = '/api/route-visits';

export const getRoutes = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/routes`, { params });
  return response.data;
};

export const addRoute = async (data) => {
  const response = await apiClient.post(`${API_URL}/routes`, data);
  return response.data;
};

export const getVisits = async (params = {}) => {
  const response = await apiClient.get(API_URL, { params });
  return response.data;
};

export const addVisit = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const updateVisit = async ({ id, data }) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const verifyVisit = async ({ id, action = 'verify' }) => {
  const response = await apiClient.patch(`${API_URL}/${id}/verify`, { action });
  return response.data;
};

export const getDailyReport = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/reports/daily`, { params });
  return response.data;
};

export const getMonthlyReport = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/reports/monthly`, { params });
  return response.data;
};

export const getTargets = async (params = {}) => {
  const response = await apiClient.get(`${API_URL}/targets`, { params });
  return response.data;
};

export const upsertTarget = async (data) => {
  const response = await apiClient.post(`${API_URL}/targets`, data);
  return response.data;
};
