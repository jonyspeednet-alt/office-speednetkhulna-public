import apiClient from '../config/axiosConfig';

/**
 * Fetches dashboard data for the logged-in user.
 * @returns {Promise<Object>} { quotaUsage, entitlements }
 */
export const getUserDashboardData = async () => {
  try {
    const response = await apiClient.get('/api/dashboard/user');
    return response.data;
  } catch (error) {
    console.error('Error fetching user dashboard data:', error);
    throw error;
  }
};