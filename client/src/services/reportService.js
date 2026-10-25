import apiClient from '../config/axiosConfig';

/**
 * Fetches the leave summary report data.
 * 
 * @param {Object} params - Filter parameters.
 * @param {string} [params.employee_id]
 * @param {string} [params.start_date]
 * @param {string} [params.end_date]
 * @returns {Promise<Object>}
 */
export const getLeaveSummaryReport = async (params = {}) => {
  try {
    const response = await apiClient.get('/api/reports/leave-summary', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching report:', error);
    throw error;
  }
};