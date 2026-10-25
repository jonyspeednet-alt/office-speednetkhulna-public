import apiClient from '../config/axiosConfig';

const API_URL = '/api/experience-certificates';

export const saveExperienceCertificate = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyExperienceCertificates = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextExperienceCertificateNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getExperienceCertificateById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateExperienceCertificate = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteExperienceCertificate = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
