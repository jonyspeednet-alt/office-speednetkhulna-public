import apiClient from '../config/axiosConfig';

export const getWhatsAppStatus = async () => {
  const response = await apiClient.get('/api/internal/whatsapp/status');
  return response.data;
};

export const getWhatsAppQr = async () => {
  const response = await apiClient.get('/api/internal/whatsapp/qr');
  return response.data;
};

export const startWhatsApp = async () => {
  const response = await apiClient.post('/api/internal/whatsapp/start');
  return response.data;
};

export const reconnectWhatsApp = async () => {
  const response = await apiClient.post('/api/internal/whatsapp/reconnect');
  return response.data;
};

export const stopWhatsApp = async () => {
  const response = await apiClient.post('/api/internal/whatsapp/stop');
  return response.data;
};

export const sendWhatsAppTestMessage = async () => {
  const response = await apiClient.post('/api/internal/whatsapp/test');
  return response.data;
};

export const sendWhatsAppTestImage = async () => {
  const response = await apiClient.post('/api/internal/whatsapp/test-image');
  return response.data;
};
