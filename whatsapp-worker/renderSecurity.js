const safeRasterDataUri = (value) => typeof value === 'string' && value.length <= 2 * 1024 * 1024 &&
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';

const isAllowedRenderUrl = (raw) => {
  if (raw === 'about:blank' || safeRasterDataUri(raw)) return true;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return (url.hostname === 'fonts.googleapis.com' && ['/css', '/css2'].includes(url.pathname)) ||
      (url.hostname === 'fonts.gstatic.com' && url.pathname.startsWith('/s/'));
  } catch { return false; }
};

// Generated letters are static documents, not web applications. Restrict only
// screenshot pages; WhatsApp's own application page still needs its JavaScript.
const secureRenderPage = async (page) => {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const handled = isAllowedRenderUrl(request.url()) ? request.continue() : request.abort('blockedbyclient');
    handled.catch(() => {});
  });
};

const boundedRenderClip = (box) => {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0 || box.width > 1200 || box.height > 6000) {
    throw new Error('Approval letter exceeds screenshot size limits');
  }
  return { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)),
    width: Math.ceil(box.width), height: Math.ceil(box.height) };
};

module.exports = { safeRasterDataUri, isAllowedRenderUrl, secureRenderPage, boundedRenderClip };
