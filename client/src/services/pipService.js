import apiClient from '../config/axiosConfig';

const API_URL = '/api/pips';

export const savePip = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyPips = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextPipNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getPipById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updatePip = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deletePip = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
