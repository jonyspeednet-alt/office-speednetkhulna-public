import apiClient from '../config/axiosConfig';

const BASE = '/api/partner-onboardings';

export const createPartnerOnboarding = async (formData, photoFile) => {
  const hasFile = !!photoFile;
  if (hasFile) {
    const fd = new FormData();
    fd.append('form_data', JSON.stringify(formData));
    fd.append('photo', photoFile);
    const res = await apiClient.post(BASE, fd);
    return res.data;
  }
  const res = await apiClient.post(BASE, { form_data: formData });
  return res.data;
};

export const getPartnerOnboardings = async (params = {}) => {
  const res = await apiClient.get(BASE, { params });
  return res.data;
};

export const getPartnerOnboarding = async (id) => {
  const res = await apiClient.get(`${BASE}/${id}`);
  return res.data;
};

export const updatePartnerOnboarding = async (id, formData, photoFile) => {
  const hasFile = !!photoFile;
  if (hasFile) {
    const fd = new FormData();
    fd.append('form_data', JSON.stringify(formData));
    fd.append('photo', photoFile);
    const res = await apiClient.put(`${BASE}/${id}`, fd);
    return res.data;
  }
  const res = await apiClient.put(`${BASE}/${id}`, { form_data: formData });
  return res.data;
};

export const deletePartnerOnboarding = async (id) => {
  const res = await apiClient.delete(`${BASE}/${id}`);
  return res.data;
};

export const updateOnboardingStatus = async (id, status) => {
  const res = await apiClient.patch(`${BASE}/${id}/status`, { status });
  return res.data;
};

export const convertOnboardingToReseller = async (id) => {
  const res = await apiClient.post(`${BASE}/${id}/convert`);
  return res.data;
};
