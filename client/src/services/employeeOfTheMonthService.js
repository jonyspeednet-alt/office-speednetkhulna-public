import apiClient from '../config/axiosConfig';

const API_URL = '/api/employee-of-the-month';

export const getMonthlyAwards = async () => (await apiClient.get(API_URL)).data;

export const getLatestMonthlyAward = async () => (await apiClient.get(`${API_URL}/latest`)).data;

export const saveMonthlyAward = async (awardMonth, data) => (
  await apiClient.put(`${API_URL}/${encodeURIComponent(awardMonth)}`, data)
).data;

export const deleteMonthlyAward = async (awardMonth) => (
  await apiClient.delete(`${API_URL}/${encodeURIComponent(awardMonth)}`)
).data;
