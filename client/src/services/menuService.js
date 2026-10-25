import apiClient from '../config/axiosConfig';

export const getMenus = async () => {
  try {
    const res = await apiClient.get('/api/admin/menus');
    return res.data;
  } catch (err) {
    console.error('getMenus error', err);
    throw err;
  }
};

export const saveMenu = async (payload) => {
  try {
    const res = await apiClient.post('/api/admin/menus', payload);
    return res.data;
  } catch (err) {
    console.error('saveMenu error', err);
    throw err;
  }
};

export const deleteMenu = async (id) => {
  try {
    const res = await apiClient.delete(`/api/admin/menus/${id}`);
    return res.data;
  } catch (err) {
    console.error('deleteMenu error', err);
    throw err;
  }
};

export const updateMenuOrder = async (items) => {
  try {
    const res = await apiClient.post('/api/admin/menus/order', items);
    return res.data;
  } catch (err) {
    console.error('updateMenuOrder error', err);
    throw err;
  }
};
