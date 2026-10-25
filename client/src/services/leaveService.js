import apiClient from '../config/axiosConfig';

/**
 * Updates the status of a leave request.
 * 
 * @param {number} id - The ID of the leave request.
 * @param {string} status - 'Approved', 'Rejected', or 'Pending'.
 * @param {string} [note] - Optional admin remark.
 * @returns {Promise<Object>} - The API response.
 */
export const updateLeaveStatus = async (id, status, note = '') => {
  try {
    const response = await apiClient.put(`/api/leaves/${id}/status`, {
      status,
      note
    });
    return response.data;
  } catch (error) {
    // Handle error (e.g., throw it to be caught by the component)
    const message = error.response?.data?.message || 'Failed to update status';
    throw new Error(message);
  }
};

/**
 * Updates the end_date of a leave request (early return).
 * @param {number} id - Leave request ID
 * @param {string} endDate - New end date (YYYY-MM-DD)
 * @param {string} [reason] - Optional reason for early return
 */
export const updateLeaveEndDate = async (id, endDate, reason = '') => {
  try {
    const response = await apiClient.patch(`/api/leaves/${id}/end-date`, {
      end_date: endDate,
      reason
    });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to update end date';
    throw new Error(message);
  }
};

/**
 * Fetches grouped leave requests.
 * @param {Object} params - { search, month, year }
 */
export const getLeaveRequests = async (params = {}) => {
  try {
    const response = await apiClient.get('/api/leaves', { params });
    const payload = response.data;
    if (Array.isArray(payload)) {
      return {
        items: payload,
        pagination: {
          page: 1,
          limit: payload.length || 20,
          total_items: payload.length,
          total_pages: 1
        }
      };
    }
    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      pagination: payload?.pagination || {
        page: 1,
        limit: 20,
        total_items: 0,
        total_pages: 1
      }
    };
  } catch (error) {
    console.error('Error fetching leaves:', error);
    throw error;
  }
};
