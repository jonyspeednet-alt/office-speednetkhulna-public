import axios from 'axios';

// Cookie-based partner_token auth → always send credentials.
const api = axios.create({
  baseURL: '/api/partner',
  withCredentials: true,
});

export const resolveImage = (value, name) => {
  if (value && (value.startsWith('http') || value.startsWith('/'))) return value;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    name || 'Partner',
  )}&background=random&size=128`;
};

export default api;
