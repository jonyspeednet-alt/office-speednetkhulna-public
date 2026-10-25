import apiClient from '../config/axiosConfig';

export const getUserProfile = async (id = null, month = '', year = '') => {
  const params = { month, year };
  let url = '/api/profile';
  if (id) {
    url += `/${id}`;
  }
  const response = await apiClient.get(url, { params });
  return response.data;
};

export const getProfileHistory = async (id, limit = 50) => {
  const response = await apiClient.get(`/api/employees/${id}/history`, { params: { limit } });
  return response.data;
};