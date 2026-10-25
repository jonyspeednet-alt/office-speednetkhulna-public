import apiClient from '../config/axiosConfig';

const API_URL = '/api/internet-registrations';

export const getInternetRegistrations = async () => {
  const response = await apiClient.get(API_URL);
  return response.data;
};

export const getInternetBranches = async () => {
  const response = await apiClient.get(`${API_URL}/branches`);
  return response.data;
};

export const getInternetPackages = async () => {
  const response = await apiClient.get(`${API_URL}/packages`);
  return response.data;
};

export const createInternetRegistration = async (data) => {
  const response = await apiClient.post(API_URL, data);
  return response.data;
};

export const getInternetFreeIds = async () => {
  const response = await apiClient.get(`${API_URL}/free-ids`);
  return response.data;
};

export const createInternetFreeIds = async (data) => {
  const response = await apiClient.post(`${API_URL}/free-ids`, data);
  return response.data;
};

export const createInternetFreeIdsBulk = async (rows) => {
  const response = await apiClient.post(`${API_URL}/free-ids/bulk`, { rows });
  return response.data;
};
