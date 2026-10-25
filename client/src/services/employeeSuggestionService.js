import apiClient from '../config/axiosConfig';

const API_URL = '/api/employee-suggestions';

export const saveEmployeeSuggestion = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyEmployeeSuggestions = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextEmployeeSuggestionNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getEmployeeSuggestionById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateEmployeeSuggestion = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteEmployeeSuggestion = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
