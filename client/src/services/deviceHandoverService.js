import apiClient from '../config/axiosConfig';

const API_URL = '/api/device-handovers';

export const saveDeviceHandover = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyDeviceHandovers = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextDeviceHandoverNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getDeviceHandoverById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateDeviceHandover = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteDeviceHandover = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
