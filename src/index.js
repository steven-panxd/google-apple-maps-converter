/**
 * google-apple-maps-converter — convert Google Maps links to Apple Maps links and back.
 * Zero dependencies; runs in Node >= 18, browsers, Safari extensions and userscripts.
 */
import { detectAppleLinkFormat, isAppleMapsURL, isAppleShortURL, parseAppleMapsUrl, toAppleMapsUrl } from './apple.js';
import { isGoogleMapsURL, isGoogleShortURL, parseGoogleMapsUrl, toGoogleMapsUrl } from './google.js';
import { toURL, unsupported } from './util.js';

export { detectAppleLinkFormat, parseAppleMapsUrl, parseGoogleMapsUrl, toAppleMapsUrl, toGoogleMapsUrl };

/** @typedef {import('./util.js').ParsedLink} ParsedLink @typedef {'google' | 'apple'} Provider */

const CONSENT_HOST = /^consent\.google\./i;

/**
 * Which map service a link belongs to, or null if neither.
 * @param {string} url
 * @returns {Provider | null}
 */
export function detectProvider(url) {
  const u = toURL(url);
  if (!u) return null;
  if (isGoogleShortURL(u) || isGoogleMapsURL(u)) return 'google';
  if (isAppleShortURL(u) || isAppleMapsURL(u)) return 'apple';
  return null;
}

/** @param {string} url */
export function isShortLink(url) {
  const u = toURL(url);
  return !!u && (isGoogleShortURL(u) || isAppleShortURL(u));
}

/**
 * Parse a Google Maps or Apple Maps URL into the neutral link model. Never throws.
 * @param {string} url
 * @returns {ParsedLink}
 */
export function parseMapsUrl(url) {
  switch (detectProvider(url)) {
    case 'google':
      return parseGoogleMapsUrl(url);
    case 'apple':
      return parseAppleMapsUrl(url);
    default:
      return unsupported(toURL(url) ? 'not-a-maps-link' : 'invalid-url');
  }
}

/**
 * Expand a short link (maps.app.goo.gl/..., goo.gl/maps/..., maps.apple/p/...) to the full URL.
 * Stops at the first non-short URL, so it never hits the target's consent or "unsupported" pages.
 * Needs network access; in a browser this only works where CORS allows (extensions, Shortcuts, servers).
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal, maxRedirects?: number }} [options]
 * @returns {Promise<string>}
 */
export async function resolveShortLink(url, { fetch: fetchImpl = globalThis.fetch, signal, maxRedirects = 5 } = {}) {
  if (!fetchImpl) throw new Error('No fetch implementation available');
  let current = url.trim();
  for (let hop = 0; hop < maxRedirects; hop++) {
    const res = await fetchImpl(current, { redirect: 'manual', signal });
    const location = res.headers?.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
    } else if (res.type === 'opaqueredirect') {
      // Browsers hide manual redirect targets; let fetch follow and read the final URL.
      current = (await fetchImpl(current, { redirect: 'follow', signal })).url || current;
    } else {
      break;
    }
    current = unwrapConsent(current);
    if (!isShortLink(current)) return current;
  }
  throw new Error(`Short link did not redirect: ${url}`);
}

/**
 * One-stop conversion: detects the source, expands short links if needed, and builds the target URL.
 * `url` is null when the link can't be converted; `parsed.reason` says why.
 *
 * @param {string} input
 * @param {{ to?: Provider | 'auto', appleFormat?: 'unified' | 'legacy' | 'auto', device?: import('./apple.js').Device, fetch?: typeof fetch, signal?: AbortSignal }} [options]
 *   `to: 'auto'` (default) converts to the other service. `appleFormat: 'auto'` picks the Apple Maps
 *   link format for `device` (default: this browser), see `detectAppleLinkFormat`.
 * @returns {Promise<{ url: string | null, from: Provider | null, to: Provider, parsed: ParsedLink, resolvedUrl: string }>}
 */
export async function convert(input, { to = 'auto', appleFormat, device, ...fetchOptions } = {}) {
  let resolvedUrl = input.trim();
  const from = detectProvider(resolvedUrl);
  let parsed = parseMapsUrl(resolvedUrl);
  if (parsed.kind === 'short') {
    resolvedUrl = await resolveShortLink(parsed.url, fetchOptions);
    parsed = parseMapsUrl(resolvedUrl);
  }
  /** @type {Provider} */
  const target = to === 'auto' ? (from === 'apple' ? 'google' : 'apple') : to;
  const url = target === 'apple' ? toAppleMapsUrl(parsed, { format: appleFormat, device }) : toGoogleMapsUrl(parsed);
  return { url, from, to: target, parsed, resolvedUrl };
}

/** EU users may get bounced through consent.google.com?continue=<real url>. @param {string} url */
function unwrapConsent(url) {
  const u = toURL(url);
  const next = u && CONSENT_HOST.test(u.hostname) ? u.searchParams.get('continue') : null;
  return next ?? url;
}
