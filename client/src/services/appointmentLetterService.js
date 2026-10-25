import apiClient from '../config/axiosConfig';

const API_URL = '/api/appointment-letters';

export const saveAppointmentLetter = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyAppointmentLetters = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getAppointmentLetterById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateAppointmentLetter = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteAppointmentLetter = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
