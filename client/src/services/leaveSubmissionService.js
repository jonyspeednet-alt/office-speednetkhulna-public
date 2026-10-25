import apiClient from '../config/axiosConfig';

/**
 * Submits a leave application.
 * 
 * @param {Object} data - The leave application data.
 * @param {string} data.reason - The reason for leave.
 * @param {Array} data.items - Array of leave lines { leave_type_id, start_date, end_date, half_day_period }.
 * @returns {Promise<Object>} - The API response.
 */
export const submitLeaveRequest = async (data) => {
  try {
    const response = await apiClient.post('/api/leaves/apply', data);
    return response.data;
  } catch (error) {
    // Extract error message from backend response
    const message = error.response?.data?.message || 'Failed to submit leave application.';
    throw new Error(message);
  }
};

/**
 * Fetches data required for the leave application form.
 */
export const getLeaveFormData = async () => {
  try {
    const response = await apiClient.get('/api/leaves/form-data');
    return response.data;
  } catch (error) {
    throw new Error('Failed to load form data');
  }
};