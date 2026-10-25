import apiClient from '../config/axiosConfig';

/**
 * Updates a specific permission for a user.
 * 
 * @param {number} userId - The ID of the user to update.
 * @param {string} column - The permission key (e.g., 'p_manage_leaves').
 * @param {number} value - 1 to grant, 0 to revoke.
 * @returns {Promise<Object>} - The API response.
 */
export const updatePermission = async (userId, column, value) => {
  try {
    const response = await apiClient.post('/api/permissions/update', {
      user_id: userId,
      column,
      value
    });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Request failed';
    throw new Error(message);
  }
};

export const getManagePermissionsData = async () => {
  try {
    const response = await apiClient.get('/api/permissions/manage');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch permission data', error);
    throw error;
  }
};