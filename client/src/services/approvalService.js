import apiClient from '../config/axiosConfig';

export const getApprovalData = async (id) => {
  try {
    const response = await apiClient.get(`/api/approval/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching approval data:', error);
    throw error;
  }
};