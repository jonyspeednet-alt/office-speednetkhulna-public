import apiClient from '../config/axiosConfig';

const API_URL = '/api/meeting-minutes';

export const saveMeetingMinutes = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getMyMeetingMinutes = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getNextMeetingMinutesNumbers = async () => {
  const response = await apiClient.get(`${API_URL}/next-numbers`);
  return response.data;
};

export const getMeetingMinutesById = async (id) => {
  const response = await apiClient.get(`${API_URL}/${id}`);
  return response.data;
};

export const updateMeetingMinutes = async (id, data) => {
  const response = await apiClient.put(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteMeetingMinutes = async (id) => {
  const response = await apiClient.delete(`${API_URL}/${id}`);
  return response.data;
};
