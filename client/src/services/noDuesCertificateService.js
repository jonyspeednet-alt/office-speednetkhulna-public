import apiClient from '../config/axiosConfig';

const API_URL = '/api/no-dues-certificates';

export const saveNoDuesCertificate = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyNoDuesCertificates = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextNoDuesNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getNoDuesCertificateById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateNoDuesCertificate = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteNoDuesCertificate = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
