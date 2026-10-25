import apiClient from '../config/axiosConfig';

/**
 * Fetches the sidebar menu structure and user role.
 * @returns {Promise<Object>} { role, menuData }
 */
export const getSidebarMenus = async () => {
  try {
    const response = await apiClient.get('/api/sidebar');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch sidebar menus', error);
    throw error;
  }
};
