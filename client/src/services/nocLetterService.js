import apiClient from '../config/axiosConfig';

const API_URL = '/api/noc-letters';

export const saveNocLetter = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyNocLetters = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextNocNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getNocLetterById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateNocLetter = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteNocLetter = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
