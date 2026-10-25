import apiClient from '../config/axiosConfig';

const API_URL = '/api/employee-of-the-year';

export const saveEmployeeOfTheYear = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyEmployeeOfTheYear = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextEmployeeOfTheYearNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getEmployeeOfTheYearById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateEmployeeOfTheYear = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteEmployeeOfTheYear = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
