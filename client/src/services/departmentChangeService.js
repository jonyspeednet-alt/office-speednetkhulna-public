import apiClient from '../config/axiosConfig';

const API_URL = '/api/department-changes';

export const saveDepartmentChange = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyDepartmentChanges = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextDepartmentChangeNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getDepartmentChangeById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateDepartmentChange = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteDepartmentChange = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
