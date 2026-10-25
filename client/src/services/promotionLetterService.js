import apiClient from '../config/axiosConfig';

const API_URL = '/api/promotions';

export const savePromotionLetter = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyPromotionLetters = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextPromotionNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getPromotionLetterById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updatePromotionLetter = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deletePromotionLetter = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
