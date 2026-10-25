import apiClient from '../config/axiosConfig';

export const getSystemLogs = async (params = {}) => {
  const response = await apiClient.get('/api/system-logs', { params });
  return response.data;
};
