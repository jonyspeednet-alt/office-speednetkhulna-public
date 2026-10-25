import apiClient from '../config/axiosConfig';

const API_URL = '/api/salary-increments';

export const saveSalaryIncrement = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMySalaryIncrements = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextSalaryIncrementNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getSalaryIncrementById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateSalaryIncrement = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteSalaryIncrement = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
