// Thin wrapper over the office backend (/api/*). Same backend the web apps use.
import Constants from 'expo-constants';
import { getBaseUrl, getToken } from './session';

const APP_VERSION = Constants?.expoConfig?.version ?? '1.0.0';

const unwrap = async (res) => {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (res.status === 426) {
    throw new Error(`UPDATE_REQUIRED:${json?.message || 'This app version is too old'}`);
  }
  if (res.status === 401) {
    throw new Error('SESSION_EXPIRED:Please login again.');
  }
  if (!res.ok) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  // apiResponse envelope {success, data} — login/refresh return raw {token, user}.
  if (json && typeof json === 'object' && 'success' in json) {
    if (!json.success) throw new Error(json.message || 'Request failed');
    return json.data;
  }
  return json;
};

const req = async (method, path, body, { multipart = false } = {}) => {
  const base = await getBaseUrl();
  if (!base) throw new Error('Server URL not set');
  const token = await getToken();
  const headers = {};
  headers['X-App-Version'] = APP_VERSION;
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (multipart) {
      payload = body; // FormData — fetch sets the content-type boundary itself
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  return unwrap(res);
};

export const api = {
  login: (identifier, password) =>
    req('POST', '/api/auth/login', { identifier, password }),
  refresh: () => req('POST', '/api/auth/refresh'),
  myTickets: (page = 1) =>
    req('GET', `/api/support/tickets?mine=true&page=${page}&limit=50`),
  ticket: (id) => req('GET', `/api/support/tickets/${id}`),
  updateTicket: (id, patch) => req('PATCH', `/api/support/tickets/${id}`, patch),
  addComment: (id, comment) =>
    req('POST', `/api/support/tickets/${id}/comments`, { comment }),
  uploadPhoto: (id, uri, fileName) => {
    const form = new FormData();
    form.append('photo', { uri, name: fileName || 'photo.jpg', type: 'image/jpeg' });
    return req('POST', `/api/support/tickets/${id}/attachments`, form, { multipart: true });
  },
  registerDevice: (fcm_token, platform) =>
    req('POST', '/api/support/device-token', { fcm_token, platform }),
  unregisterDevice: (fcm_token) =>
    req('DELETE', '/api/support/device-token', { fcm_token }),
};
