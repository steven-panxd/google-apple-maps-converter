/**
 * Google Maps: parse any Google Maps URL, and build Google Maps URLs.
 * Builder output follows the official Maps URLs API: https://developers.google.com/maps/documentation/urls
 */
import {
  NUM,
  buildUrl,
  decodeSegment,
  encodeParam,
  formatCoords,
  formatLocation,
  latLng,
  matchCoords,
  parseCoordText,
  toLocation,
  toURL,
  travelMode,
  unsupported,
  validCoords,
  withZoom,
} from './util.js';

/** @typedef {import('./util.js').ParsedLink} ParsedLink @typedef {import('./util.js').TravelMode} TravelMode @typedef {import('./util.js').Location} Location */

// google.com, google.de, google.co.uk, google.com.hk, ...
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3}|com?\.[a-z]{2})$/i;
const AT_SEGMENT = new RegExp(String.raw`^@(${NUM}),(${NUM})(?:,(\d+(?:\.\d+)?)z)?`);
// Place pin inside the `data=` blob: ...!3d<lat>!4d<lng>...
const DATA_PIN = new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`);
// Travel mode inside a /dir/ `data=` blob: !3e0 driving, !3e1 bicycling, !3e2 walking, !3e3 transit.
const DATA_MODE = /!3e([0-3])/;
const DATA_MODES = /** @type {const} */ (['driving', 'bicycling', 'walking', 'transit']);
const API_MODES = new Set(['driving', 'walking', 'bicycling', 'transit']);

const DEFAULT_PLACE_ZOOM = 17;
const DEFAULT_SEARCH_ZOOM = 14;

/** @param {URL} u */
export function isGoogleShortURL(u) {
  const host = u.hostname.toLowerCase();
  return host === 'maps.app.goo.gl' || (host === 'goo.gl' && u.pathname.startsWith('/maps/'));
}

/** @param {URL} u */
export function isGoogleMapsURL(u) {
  if (u.protocol === 'comgooglemaps:' || u.protocol === 'comgooglemapsurl:') return true;
  const host = u.hostname.toLowerCase();
  if (!GOOGLE_HOST.test(host)) return false;
  return host.startsWith('maps.') || u.pathname === '/maps' || u.pathname.startsWith('/maps/');
}

/**
 * Parse a Google Maps URL into the neutral link model. Never throws.
 * Short links (maps.app.goo.gl) come back as `{ kind: 'short' }`.
 *
 * @param {string} url
 * @returns {ParsedLink}
 */
export function parseGoogleMapsUrl(url) {
  const u = toURL(url);
  if (!u) return unsupported('invalid-url');
  if (isGoogleShortURL(u)) return { kind: 'short', url: u.href };
  if (!isGoogleMapsURL(u)) return unsupported('not-google-maps');

  const path = u.pathname.replace(/^\/maps(?=\/|$)/, '');
  const segments = path.split('/').slice(1);
  if (path.endsWith('/')) segments.pop();
  /** @type {GoogleLink} */
  const link = {
    params: u.searchParams,
    segments,
    rawPath: u.pathname,
    at: parseAtSegment(segments),
    pin: matchCoords(DATA_PIN, u.pathname),
  };
  // Maps URLs API links first, then /place/, /search/ and /dir/ paths, then the classic query string.
  return (link.params.get('api') === '1' && parseApiLink(link)) || parsePathLink(link) || parseQueryLink(link);
}

/**
 * Build a Google Maps URL from a parsed link. Returns null for `short` / `unsupported`.
 *
 * @param {ParsedLink} parsed
 * @returns {string | null}
 */
export function toGoogleMapsUrl(parsed) {
  switch (parsed.kind) {
    case 'coords':
      return buildUrl('https://www.google.com/maps/search/', [['api', 1], ['query', formatCoords(parsed)]]);
    case 'place': {
      const text = parsed.address && parsed.address !== parsed.name ? `${parsed.name}, ${parsed.address}` : parsed.name;
      if (parsed.lat === undefined || parsed.lng === undefined) {
        return buildUrl('https://www.google.com/maps/search/', [['api', 1], ['query', text]]);
      }
      // The API has no "name at coordinate" form; Google's own share URLs use this path form.
      return pathUrl('place', text, { lat: parsed.lat, lng: parsed.lng }, parsed.zoom ?? DEFAULT_PLACE_ZOOM);
    }
    case 'search':
      if (parsed.near) return pathUrl('search', parsed.query, parsed.near, parsed.zoom ?? DEFAULT_SEARCH_ZOOM);
      return buildUrl('https://www.google.com/maps/search/', [['api', 1], ['query', parsed.query]]);
    case 'directions':
      return buildUrl('https://www.google.com/maps/dir/', [
        ['api', 1],
        ['origin', formatLocation(parsed.origin)],
        ['destination', formatLocation(parsed.destination)],
        ['waypoints', parsed.waypoints.map(formatLocation).filter(Boolean).join('|')],
        ['travelmode', parsed.travelMode],
      ]);
    default:
      return null;
  }
}

// --- internals ---------------------------------------------------------------

/**
 * @typedef {{ params: URLSearchParams, segments: string[], rawPath: string,
 *   at: { lat: number, lng: number, zoom?: number } | null, pin: { lat: number, lng: number } | null }} GoogleLink
 *   `segments` is the path after /maps; `at` is the @lat,lng,zoom viewport; `pin` the place pin in `data=`.
 */

/** ?api=1 links (https://developers.google.com/maps/documentation/urls). @param {GoogleLink} link @returns {ParsedLink | null} */
function parseApiLink({ params, segments }) {
  const head = segments[0] ?? '';
  if (head === 'dir') return parseApiDirections(params);
  if (head === 'search') {
    const query = params.get('query') ?? '';
    const coords = parseCoordText(query);
    if (coords) return { kind: 'coords', ...coords };
    if (query) return { kind: 'search', query };
    return unsupported(params.has('query_place_id') ? 'place-id-requires-lookup' : 'empty-query');
  }
  const center = parseCoordText(params.get('center'));
  return center ? withZoom({ kind: 'coords', ...center }, Number(params.get('zoom'))) : null;
}

/** /maps/place/<name>/..., /maps/search/<query>/..., /maps/dir/<stops>/... @param {GoogleLink} link @returns {ParsedLink | null} */
function parsePathLink({ segments, rawPath, at, pin }) {
  switch (segments[0]) {
    case 'place': {
      const name = decodeSegment(segments[1] ?? '');
      const fromName = parseCoordText(name);
      if (fromName && !pin) return withZoom({ kind: 'coords', ...fromName }, at?.zoom);
      const coords = pin ?? fromName ?? at;
      if (!name && coords) return withZoom({ kind: 'coords', lat: coords.lat, lng: coords.lng }, at?.zoom);
      if (!name) return null;
      return withZoom({ kind: 'place', name, ...latLng(coords) }, at?.zoom);
    }
    case 'search': {
      const query = decodeSegment(segments[1] ?? '');
      const fromQuery = parseCoordText(query);
      if (fromQuery) return withZoom({ kind: 'coords', ...fromQuery }, at?.zoom);
      // A search that resolved to a single result carries that result's pin.
      if (pin && query) return withZoom({ kind: 'place', name: query, ...pin }, at?.zoom);
      if (!query) return null;
      return withZoom({ kind: 'search', query, ...(at && { near: latLng(at) }) }, at?.zoom);
    }
    case 'dir':
      return parsePathDirections(segments.slice(1), rawPath);
    default:
      return null;
  }
}

/** Classic query strings (?q=, ?ll=, ?saddr=&daddr=), also used by comgooglemaps://, and bare @lat,lng views. @param {GoogleLink} link @returns {ParsedLink} */
function parseQueryLink({ params, at, pin }) {
  const saddr = params.get('saddr');
  const daddr = params.get('daddr');
  if (daddr !== null || saddr !== null) {
    const stops = (daddr ?? '').split(/\s+to:\s*/i).map(toLocation);
    const destination = stops.pop() ?? null;
    if (!destination) return unsupported('missing-destination');
    return {
      kind: 'directions',
      origin: toLocation(saddr),
      destination,
      waypoints: withoutCurrentLocation(stops),
      ...travelMode(googleDirFlag(params.get('dirflg') ?? params.get('directionsmode'))),
    };
  }

  const z = Number(params.get('z') ?? params.get('zoom')) || at?.zoom;
  const q = params.get('q') ?? params.get('query');
  if (q) {
    const coords = parseCoordText(q);
    if (coords) return withZoom({ kind: 'coords', ...coords }, z);
    const near = parseCoordText(params.get('ll') ?? params.get('sll') ?? params.get('center')) ?? latLng(at);
    return withZoom({ kind: 'search', query: q, ...(near && { near }) }, z);
  }

  const ll = parseCoordText(params.get('ll') ?? params.get('center'));
  if (ll) return withZoom({ kind: 'coords', ...ll }, z);

  if (pin) return withZoom({ kind: 'coords', ...pin }, at?.zoom);
  if (at) return withZoom({ kind: 'coords', lat: at.lat, lng: at.lng }, at.zoom);
  if (params.has('cid') || params.has('ftid')) return unsupported('place-id-requires-lookup');
  return unsupported('unrecognized-format');
}

/** "Current location" in the middle of a route means nothing; the Apple parser drops it too. @param {Location[]} stops */
function withoutCurrentLocation(stops) {
  return /** @type {Exclude<Location, null>[]} */ (stops.filter(Boolean));
}

/** @param {'place' | 'search'} type @param {string} text @param {{ lat: number, lng: number }} at @param {number} zoom */
function pathUrl(type, text, at, zoom) {
  return `https://www.google.com/maps/${type}/${encodeParam(text, '+')}/@${formatCoords(at)},${Math.round(zoom)}z`;
}

/** @param {string[]} segments */
function parseAtSegment(segments) {
  for (const seg of segments) {
    const m = AT_SEGMENT.exec(seg);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!validCoords(lat, lng)) return null;
    return { lat, lng, ...(m[3] && { zoom: Number(m[3]) }) };
  }
  return null;
}

/** Google legacy dirflg (w walking, r transit, b bicycling; h/t are avoid-flags) or app `directionsmode`. @param {string | null} flags @returns {TravelMode | undefined} */
function googleDirFlag(flags) {
  if (!flags) return undefined;
  const f = flags.toLowerCase();
  if (API_MODES.has(f)) return /** @type {TravelMode} */ (f);
  if (f.includes('w')) return 'walking';
  if (f.includes('r')) return 'transit';
  if (f.includes('b')) return 'bicycling';
  if (f.includes('d')) return 'driving';
  return undefined;
}

/** @param {URLSearchParams} params @returns {ParsedLink} */
function parseApiDirections(params) {
  const mode = params.get('travelmode')?.toLowerCase();
  const waypoints = withoutCurrentLocation((params.get('waypoints') ?? '').split('|').map(toLocation));
  const destination = toLocation(params.get('destination'));
  if (!destination) return unsupported('missing-destination');
  return {
    kind: 'directions',
    origin: toLocation(params.get('origin')),
    destination,
    waypoints,
    ...travelMode(mode && API_MODES.has(mode) ? /** @type {TravelMode} */ (mode) : undefined),
  };
}

/** /maps/dir/<origin>/<stop>/.../<destination>/@lat,lng,z/data=... @param {string[]} segments @param {string} rawPath @returns {ParsedLink} */
function parsePathDirections(segments, rawPath) {
  const end = segments.findIndex((s) => s.startsWith('@') || s.startsWith('data=') || s.startsWith('am='));
  const stops = (end === -1 ? segments : segments.slice(0, end)).map((s) => toLocation(decodeSegment(s)));
  if (stops.length === 0 || stops.every((s) => s === null)) return unsupported('missing-destination');
  const modeMatch = DATA_MODE.exec(rawPath);
  const mode = modeMatch ? DATA_MODES[Number(modeMatch[1])] : undefined;
  // A single stop is the place the user wants to go to.
  const origin = stops.length > 1 ? stops.shift() ?? null : null;
  const destination = stops.pop() ?? null;
  if (!destination) return unsupported('missing-destination');
  return { kind: 'directions', origin, destination, waypoints: withoutCurrentLocation(stops), ...travelMode(mode) };
}
