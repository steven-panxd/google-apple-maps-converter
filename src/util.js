/**
 * Shared helpers and the provider-neutral link model.
 *
 * @typedef {{ lat: number, lng: number }} LatLng
 *
 * @typedef {LatLng | { query: string } | null} Location
 *   A directions stop. `null` means "current location".
 *
 * @typedef {'driving' | 'walking' | 'bicycling' | 'transit'} TravelMode
 *
 * @typedef {(
 *   | { kind: 'place', name: string, address?: string, lat?: number, lng?: number, zoom?: number }
 *   | { kind: 'coords', lat: number, lng: number, zoom?: number }
 *   | { kind: 'search', query: string, near?: LatLng, zoom?: number }
 *   | { kind: 'directions', origin: Location, destination: Location, waypoints: Location[], travelMode?: TravelMode }
 *   | { kind: 'short', url: string }
 *   | { kind: 'unsupported', reason: string }
 * )} ParsedLink
 */

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
export const NUM_PATTERN = NUM;
const COORD_TEXT = new RegExp(String.raw`^\s*(${NUM})\s*,\s*(${NUM})\s*$`);
const DMS_TEXT =
  /^\s*(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,3})['′]\s*([\d.]+)["″]?\s*([EW])\s*$/i;

/** Lenient URL parsing: trims, adds a missing https:// and never throws. @param {unknown} url */
export function toURL(url) {
  if (typeof url !== 'string') return null;
  let s = url.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** @param {string} reason @returns {ParsedLink} */
export function unsupported(reason) {
  return { kind: 'unsupported', reason };
}

/** Decode a path segment or form value where `+` means space. @param {string} s */
export function decodeSegment(s) {
  const plus = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus).trim();
  } catch {
    return plus.trim();
  }
}

/** @param {number} lat @param {number} lng */
export function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** @param {RegExp} re @param {string} s @returns {LatLng | null} */
export function matchCoords(re, s) {
  const m = re.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validCoords(lat, lng) ? { lat, lng } : null;
}

/** "48.85,2.29" or 48°51'30.0"N 2°17'40.2"E @param {string | null | undefined} s @returns {LatLng | null} */
export function parseCoordText(s) {
  if (!s) return null;
  const plain = matchCoords(COORD_TEXT, s);
  if (plain) return plain;
  const m = DMS_TEXT.exec(s);
  if (!m) return null;
  const toDeg = (/** @type {string} */ d, /** @type {string} */ min, /** @type {string} */ sec, /** @type {string} */ hemi) =>
    (Number(d) + Number(min) / 60 + Number(sec) / 3600) * (/[SW]/i.test(hemi) ? -1 : 1);
  const lat = round(toDeg(m[1], m[2], m[3], m[4]));
  const lng = round(toDeg(m[5], m[6], m[7], m[8]));
  return validCoords(lat, lng) ? { lat, lng } : null;
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 1e7) / 1e7;
}

/** @param {LatLng | null | undefined} c @returns {LatLng | undefined} */
export function latLng(c) {
  return c ? { lat: c.lat, lng: c.lng } : undefined;
}

/**
 * @template {object} T
 * @param {T} obj @param {number | null | undefined} z
 * @returns {T}
 */
export function withZoom(obj, z) {
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? { ...obj, zoom: z } : obj;
}

/** @param {string | null | undefined} text @returns {Location} */
export function toLocation(text) {
  const t = (text ?? '').trim();
  if (!t || /^(my |current )?location$/i.test(t)) return null;
  return parseCoordText(t) ?? { query: t };
}

/** @param {TravelMode | undefined} mode */
export function travelMode(mode) {
  return mode ? { travelMode: mode } : {};
}

/** @param {LatLng} c */
export function formatCoords(c) {
  return `${c.lat},${c.lng}`;
}

/** @param {Location} loc */
export function formatLocation(loc) {
  if (!loc) return undefined;
  return 'query' in loc ? loc.query : formatCoords(loc);
}

/**
 * Build `base?k=v&...`, skipping empty values. Commas stay readable (lat,lng).
 * @param {string} base
 * @param {[string, string | number | undefined][]} params
 * @param {{ space?: string }} [options] how to encode spaces
 */
export function buildUrl(base, params, { space = '%20' } = {}) {
  const query = params
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeParam(String(v), space)}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

/** @param {string} v @param {string} [space] */
export function encodeParam(v, space = '%20') {
  return encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%20/g, space);
}
