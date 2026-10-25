import * as SecureStore from 'expo-secure-store';

const KEYS = { baseUrl: 'sn_base_url', token: 'sn_token', user: 'sn_user' };

export const getBaseUrl = () => SecureStore.getItemAsync(KEYS.baseUrl);
export const setBaseUrl = (v) => SecureStore.setItemAsync(KEYS.baseUrl, String(v || '').replace(/\/+$/, ''));
export const getToken = () => SecureStore.getItemAsync(KEYS.token);
export const setToken = (v) => SecureStore.setItemAsync(KEYS.token, v);
export const getUser = async () => {
  const raw = await SecureStore.getItemAsync(KEYS.user);
  return raw ? JSON.parse(raw) : null;
};
export const setUser = (u) => SecureStore.setItemAsync(KEYS.user, JSON.stringify(u));
export const clearSession = async () => {
  await SecureStore.deleteItemAsync(KEYS.token);
  await SecureStore.deleteItemAsync(KEYS.user);
};
