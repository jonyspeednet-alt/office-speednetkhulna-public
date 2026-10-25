import apiClient from '../config/axiosConfig';

const API_URL = '/api/termination-letters';

export const saveTerminationLetter = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyTerminationLetters = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getTerminationLetterById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateTerminationLetter = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteTerminationLetter = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
