import apiClient from '../config/axiosConfig';

const API_URL = '/api/punishments';

export const savePunishmentLetter = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyPunishmentLetters = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextPunishmentNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getPunishmentLetterById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updatePunishmentLetter = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deletePunishmentLetter = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
