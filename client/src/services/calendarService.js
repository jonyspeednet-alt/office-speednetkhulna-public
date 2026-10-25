import apiClient from '../config/axiosConfig';

export const getLeaveEvents = async (start, end) => {
  try {
    const response = await apiClient.get('/api/calendar/events', {
      params: { start, end }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    throw error;
  }
};