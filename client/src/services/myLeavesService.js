import apiClient from '../config/axiosConfig';

export const getMyLeaves = async () => {
  try {
    const response = await apiClient.get('/api/my-leaves');
    return response.data;
  } catch (error) {
    console.error('Error fetching leaves:', error);
    throw error;
  }
};