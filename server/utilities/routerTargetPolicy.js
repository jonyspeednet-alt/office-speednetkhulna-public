const net = require('node:net');
const dns = require('node:dns').promises;

const normalizeRouterHost = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || /[\s/\\?#@%]/.test(raw)) throw new Error('Router target is not allowed');
  const unbracketed = raw.replace(/^\[|\]$/g, '');
  const ipv6 = net.isIP(unbracketed) === 6;
  const parsed = new URL(`http://${ipv6 ? `[${unbracketed}]` : raw}`);
  if (parsed.port || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error('Router host must not include a port or path');
  return parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
};

const blockedV4 = (parts) => parts[0] === 0 || parts[0] === 127 ||
  (parts[0] === 169 && parts[1] === 254) || parts[0] >= 224;

const isBlockedRouterHost = (value) => {
  let host;
  try { host = normalizeRouterHost(value); } catch (_) { return true; }
  if (['localhost', 'metadata', 'metadata.google.internal'].includes(host) || host.endsWith('.localhost') || host.endsWith('.metadata')) return true;
  const family = net.isIP(host);
  if (family === 4) return blockedV4(host.split('.').map(Number));
  if (family !== 6) return false;
  const halves = host.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const words = (halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]).map((word) => parseInt(word, 16));
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if ((words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00) return true;
  if (host === 'fd00:ec2::254') return true;
  if (words.slice(0, 5).every((word) => word === 0) && [0, 0xffff].includes(words[5])) {
    return blockedV4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
  }
  return false;
};

const parseRouterUrl = (value) => {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || isBlockedRouterHost(url.hostname)) {
    throw new Error('Router URL target is not allowed');
  }
  return url;
};

const resolveRouterTarget = async (value) => {
  const hostname = normalizeRouterHost(value);
  if (isBlockedRouterHost(hostname)) throw new Error('Router target is not allowed');
  if (net.isIP(hostname)) return { hostname, address: hostname, family: net.isIP(hostname) };
  let timer;
  let addresses;
  try {
    addresses = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Router DNS lookup timed out')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some((entry) => !net.isIP(entry.address) || isBlockedRouterHost(entry.address))) {
    throw new Error('Router target resolves to a prohibited address');
  }
  return { hostname, address: addresses[0].address, family: addresses[0].family };
};

module.exports = { normalizeRouterHost, isBlockedRouterHost, parseRouterUrl, resolveRouterTarget };
