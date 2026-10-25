import translations from './translations';

const STORAGE_KEY = 'app_locale';
const DEFAULT_LOCALE = 'en';
let currentLocale = DEFAULT_LOCALE;

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const readStoredLocale = () => {
  if (!isBrowser()) return DEFAULT_LOCALE;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw && translations[raw] ? raw : DEFAULT_LOCALE;
};

const resolvePath = (obj, path) => {
  return String(path)
    .split('.')
    .reduce((acc, part) => (acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined), obj);
};

const interpolate = (value, params = {}) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (_, key) => (params[key] != null ? String(params[key]) : `{${key}}`));
};

export const initLocale = (forcedLocale) => {
  const next = forcedLocale && translations[forcedLocale] ? forcedLocale : 'en';
  currentLocale = next;
  if (isBrowser()) {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.setAttribute('lang', next);
  }
  return next;
};

export const setLocale = (locale) => initLocale(locale);

export const getLocale = () => currentLocale;

export const t = (key, params = {}, fallback = '') => {
  const primary = resolvePath(translations[currentLocale] || {}, key);
  if (primary != null) return interpolate(primary, params);

  const fromDefault = resolvePath(translations[DEFAULT_LOCALE] || {}, key);
  if (fromDefault != null) return interpolate(fromDefault, params);

  return fallback || key;
};

initLocale(readStoredLocale());