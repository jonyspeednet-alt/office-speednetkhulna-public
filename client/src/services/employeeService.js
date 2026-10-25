import apiClient from '../config/axiosConfig';

const API_URL = '/api/employees';

export const getEmployees = async (params = {}) => {
    const { search, dept, status, page, limit } = params || {};
    const query = {};
    const trimmedSearch = typeof search === 'string' ? search.trim() : search;
    if (trimmedSearch) query.search = trimmedSearch;
    if (dept) query.dept = dept;
    if (status && String(status).toLowerCase() !== 'all') query.status = String(status).toLowerCase();
    if (page) query.page = page;
    if (limit) query.limit = limit;
    const response = await apiClient.get(API_URL, { params: query });
    return response.data;
};

export const getDepartments = async () => {
    const response = await apiClient.get(`${API_URL}/departments`);
    return response.data;
};

export const getNextEmployeeId = async () => {
    const response = await apiClient.get(`${API_URL}/next-id`);
    return response.data.id;
};

export const addEmployee = async (formData) => {
    const response = await apiClient.post(API_URL, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

export const getEmployeeById = async (id) => {
    const response = await apiClient.get(`${API_URL}/${id}`);
    return response.data;
};

export const updateEmployee = async (id, formData) => {
    const response = await apiClient.put(`${API_URL}/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// NEW: Toggle employee active/inactive
export const toggleEmployeeStatus = async (id) => {
    const response = await apiClient.patch(`${API_URL}/${id}/status`);
    return response.data;
};

export const resetEmployeePassword = async (id) => {
    const response = await apiClient.post(`${API_URL}/${id}/reset-password`);
    return response.data;
};
