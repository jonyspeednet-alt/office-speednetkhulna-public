import apiClient from '../config/axiosConfig';

const API_URL = '/api/phone-directory';


export const getPhones = async (page = 1, search = '') => {
  const response = await apiClient.get(`${API_URL}?page=${page}&search=${search}`);
  return response.data;
};

export const getUsers = async () => {
  const response = await apiClient.get(`${API_URL}/users`);
  return response.data;
};

export const addPhone = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const updatePhone = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deletePhone = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};

export const exportPhonesCSV = async (search = '') => {
  const response = await apiClient.get(`${API_URL}/export?search=${search}`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `phone_directory_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
};