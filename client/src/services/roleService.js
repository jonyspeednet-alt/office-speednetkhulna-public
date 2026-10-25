import apiClient from '../config/axiosConfig';

export const getRoles = async () => {
  try {
    const response = await apiClient.get('/api/roles');
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to fetch roles';
    throw new Error(message);
  }
};

export const saveRole = async (roleData) => {
  try {
    const response = await apiClient.post('/api/roles/save', roleData);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to save role';
    throw new Error(message);
  }
};

export const deleteRole = async (id) => {
  try {
    const response = await apiClient.delete(`/api/roles/${id}`);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to delete role';
    throw new Error(message);
  }
};

export const assignRoleToUser = async (userId, roleId) => {
  try {
    const response = await apiClient.post('/api/roles/assign', { user_id: userId, role_id: roleId });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || 'Failed to assign role';
    throw new Error(message);
  }
};
