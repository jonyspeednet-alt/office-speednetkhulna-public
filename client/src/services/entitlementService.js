import apiClient from '../config/axiosConfig';

const API_URL = '/api/entitlements';

export const getEntitlementsData = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const addEntitlement = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const updateEntitlement = async (id, total_days) => {
  const response = await apiClient.put(`${API_URL}/${id}`, { total_days });
  return response.data;
};

export const deleteEntitlement = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};