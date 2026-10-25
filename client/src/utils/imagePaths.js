const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toInitials = (name) => {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
};

const svgDataUri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export const BRAND_LOGO_URL = '/speednet_logo.webp?v=20260912';
export const BRAND_LOGO_LOCAL_URL = '/speednet_logo.webp?v=20260912';
export const BRAND_LOGO_FALLBACK_URL = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="80" viewBox="0 0 260 80" role="img" aria-label="Logo unavailable"><rect width="260" height="80" rx="10" fill="#f3f4f6"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#6b7280">Logo unavailable</text></svg>`
);

export const buildAvatarDataUri = (name = 'User') => {
  const initials = escapeXml(toInitials(name));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#4e73df"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#ffffff">${initials}</text></svg>`;
  return svgDataUri(svg);
};

export const buildImagePlaceholderDataUri = (label = 'No Image') => {
  const safeLabel = escapeXml(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250"><rect width="400" height="250" fill="#eef2ff"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="600" fill="#59607a">${safeLabel}</text></svg>`;
  return svgDataUri(svg);
};
