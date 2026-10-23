/**
 * Apple Maps: parse any Apple Maps URL, and build Apple Maps URLs.
 * Unified URLs (iOS 18.4+ / macOS 15.4+): https://developer.apple.com/documentation/mapkit/unified-map-urls
 * Legacy URLs: https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html
 */
import {
  buildUrl,
  formatCoords,
  formatLocation,
  parseCoordText,
  toLocation,
  toURL,
  travelMode,
  unsupported,
  withZoom,
} from './util.js';

/**
 * @typedef {import('./util.js').ParsedLink} ParsedLink
 * @typedef {import('./util.js').TravelMode} TravelMode
 * @typedef {'unified' | 'legacy'} AppleLinkFormat
 * @typedef {{ userAgent?: string, maxTouchPoints?: number }} Device
 */

const APPLE_HOST = /^(?:beta\.)?maps\.apple\.com$/i;
// Labels Apple Maps puts on pins that aren't a named place.
const GENERIC_PIN_LABEL = /^(dropped pin|marked location|my location|current location)$/i;

const UNIFIED_MODES = /** @type {Record<string, TravelMode>} */ ({
  driving: 'driving',
  walking: 'walking',
  transit: 'transit',
  cycling: 'bicycling',
});
const TO_UNIFIED_MODE = /** @type {Record<TravelMode, string>} */ ({
  driving: 'driving',
  walking: 'walking',
  transit: 'transit',
  bicycling: 'cycling',
});
const TO_LEGACY_DIRFLG = /** @type {Record<TravelMode, string | undefined>} */ ({
  driving: 'd',
  walking: 'w',
  transit: 'r',
  bicycling: undefined, // no legacy flag for cycling
});

/** Short links shared from Apple Maps on iOS 26+: https://maps.apple/p/... @param {URL} u */
export function isAppleShortURL(u) {
  return u.hostname.toLowerCase() === 'maps.apple';
}

/** @param {URL} u */
export function isAppleMapsURL(u) {
  return u.protocol === 'maps:' || APPLE_HOST.test(u.hostname);
}

/**
 * Parse an Apple Maps URL (unified, legacy or maps:// scheme) into the neutral link model. Never throws.
 * Short links (maps.apple/p/...) come back as `{ kind: 'short' }`.
 *
 * @param {string} url
 * @returns {ParsedLink}
 */
export function parseAppleMapsUrl(url) {
  const u = toURL(url);
  if (!u) return unsupported('invalid-url');
  if (isAppleShortURL(u)) return { kind: 'short', url: u.href };
  if (!isAppleMapsURL(u)) return unsupported('not-apple-maps');

  const params = u.searchParams;
  const path = u.protocol === 'maps:' ? '' : u.pathname.toLowerCase().replace(/\/+$/, '');

  switch (path) {
    case '/place':
    case '/look-around':
    case '/report-a-problem':
      return parsePlace(params);
    case '/search': {
      const query = params.get('query') ?? params.get('q') ?? '';
      const coords = parseCoordText(query);
      if (coords) return { kind: 'coords', ...coords };
      if (!query) return unsupported('empty-query');
      const near = parseCoordText(params.get('center'));
      return { kind: 'search', query, ...(near && { near }) };
    }
    case '/directions': {
      const destination = toLocation(params.get('destination'));
      if (!destination) return unsupported(params.has('destination-place-id') ? 'place-id-requires-lookup' : 'missing-destination');
      const mode = params.get('mode')?.toLowerCase();
      return {
        kind: 'directions',
        origin: toLocation(params.get('source')),
        destination,
        waypoints: params.getAll('waypoint').map(toLocation).filter((w) => w !== null),
        ...travelMode(mode ? UNIFIED_MODES[mode] : undefined),
      };
    }
    case '/frame': {
      const center = parseCoordText(params.get('center') ?? params.get('coordinate'));
      return center ? { kind: 'coords', ...center } : unsupported('unrecognized-format');
    }
    case '':
    case '/maps':
      return parseLegacy(params);
    default:
      return unsupported('unrecognized-format');
  }
}

/**
 * Build an Apple Maps URL from a parsed link. Returns null for `short` / `unsupported`.
 *
 * `format: 'unified'` (default) uses the iOS 18.4+ URLs, which support waypoints and cycling.
 * `format: 'legacy'` uses the classic query-string URLs every device understands; it drops waypoints and cycling.
 * `format: 'auto'` picks one for the device with `detectAppleLinkFormat(device)`.
 *
 * @param {ParsedLink} parsed
 * @param {{ format?: AppleLinkFormat | 'auto', device?: Device }} [options]
 * @returns {string | null}
 */
export function toAppleMapsUrl(parsed, { format = 'unified', device } = {}) {
  const chosen = format === 'auto' ? detectAppleLinkFormat(device) : format;
  return chosen === 'legacy' ? toLegacy(parsed) : toUnified(parsed);
}

/**
 * Which Apple Maps link format a device can open.
 *
 * The newer links (/place, /directions) need iOS 18.4, iPadOS 18.4 or macOS 15.4; older systems open
 * Apple Maps but ignore them. Classic links work everywhere but can't carry stops or cycling. So this
 * returns 'unified' only when the device is known to handle it, and 'legacy' whenever in doubt: no user
 * agent, a hidden or unusual one, or an error reading it.
 *
 * In a browser it reads `navigator` by default; on a server, pass the request's user agent.
 *
 * @param {Device} [device] defaults to `globalThis.navigator`
 * @returns {AppleLinkFormat}
 */
export function detectAppleLinkFormat(device = globalThis.navigator) {
  try {
    const ua = String(device?.userAgent ?? '');
    const atLeast = (/** @type {number} */ major, /** @type {number} */ minor, /** @type {number} */ wantMajor, /** @type {number} */ wantMinor) =>
      major > wantMajor || (major === wantMajor && minor >= wantMinor);

    // iOS 26 Safari reports a frozen "OS 18_6", which still reads as new enough.
    const ios = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)_(\d+)/.exec(ua);
    if (ios) return atLeast(Number(ios[1]), Number(ios[2]), 18, 4) ? 'unified' : 'legacy';

    // Macs, and iPads asking for desktop sites, report a frozen OS version. On iPad, Safari's own
    // version follows the system release. On a Mac it doesn't (Safari 26 also runs on macOS 14 and
    // 15), so nothing tells the macOS version apart: Macs get classic links.
    if (/\bMacintosh\b/.test(ua)) {
      const isIPad = Number(device?.maxTouchPoints ?? 0) > 1;
      const safari = /\bVersion\/(\d+)(?:\.(\d+))?.*\bSafari\//.exec(ua);
      if (!isIPad || !safari) return 'legacy';
      return atLeast(Number(safari[1]), Number(safari[2] ?? 0), 18, 4) ? 'unified' : 'legacy';
    }

    // Everyone else opens maps.apple.com in the browser, which understands the newer links.
    if (/\b(?:Android|Windows|Linux|CrOS)\b/.test(ua)) return 'unified';
    return 'legacy';
  } catch {
    return 'legacy';
  }
}

// --- internals ---------------------------------------------------------------

/** /place, /look-around, /report-a-problem; also older `/place?q=&ll=` share links. @param {URLSearchParams} params @returns {ParsedLink} */
function parsePlace(params) {
  const coords = parseCoordText(params.get('coordinate') ?? params.get('ll'));
  const address = params.get('address')?.trim() || undefined;
  const label = params.get('name') ?? params.get('q') ?? '';
  const name = label.trim() && !GENERIC_PIN_LABEL.test(label.trim()) && !parseCoordText(label) ? label.trim() : undefined;

  if (name || address) {
    return {
      kind: 'place',
      name: /** @type {string} */ (name ?? address),
      ...(name && address && address !== name && { address }),
      ...coords,
    };
  }
  if (coords) return { kind: 'coords', ...coords };
  return unsupported(params.has('place-id') || params.has('auid') ? 'place-id-requires-lookup' : 'unrecognized-format');
}

/** Legacy maps.apple.com/?q=...&ll=...&saddr=...&daddr=... and the maps:// scheme. @param {URLSearchParams} params @returns {ParsedLink} */
function parseLegacy(params) {
  const saddr = params.get('saddr');
  const daddr = params.get('daddr');
  if (daddr !== null || saddr !== null) {
    const destination = toLocation(daddr);
    if (!destination) return unsupported('missing-destination');
    return {
      kind: 'directions',
      origin: toLocation(saddr),
      destination,
      waypoints: [],
      ...travelMode(appleDirFlag(params.get('dirflg'))),
    };
  }

  const z = Number(params.get('z'));
  const ll = parseCoordText(params.get('ll'));
  const q = params.get('q')?.trim() ?? '';
  const qCoords = parseCoordText(q);

  if (params.get('address')) {
    const placed = parsePlace(params);
    return placed.kind === 'place' ? withZoom(placed, z) : placed;
  }
  if (qCoords) return withZoom({ kind: 'coords', ...qCoords }, z);
  if (q && ll) {
    return GENERIC_PIN_LABEL.test(q) ? withZoom({ kind: 'coords', ...ll }, z) : withZoom({ kind: 'place', name: q, ...ll }, z);
  }
  if (q) {
    const near = parseCoordText(params.get('sll'));
    return withZoom({ kind: 'search', query: q, ...(near && { near }) }, z);
  }
  if (ll) return withZoom({ kind: 'coords', ...ll }, z);
  if (params.has('auid')) return unsupported('place-id-requires-lookup');
  return unsupported('unrecognized-format');
}

/** @param {string | null} flag @returns {TravelMode | undefined} */
function appleDirFlag(flag) {
  switch (flag?.toLowerCase()) {
    case 'd':
      return 'driving';
    case 'w':
      return 'walking';
    case 'r':
      return 'transit';
    default:
      return undefined;
  }
}

/** @param {ParsedLink} parsed */
function toUnified(parsed) {
  const base = 'https://maps.apple.com';
  switch (parsed.kind) {
    case 'coords':
      return buildUrl(`${base}/place`, [['coordinate', formatCoords(parsed)]]);
    case 'place':
      if (parsed.lat !== undefined && parsed.lng !== undefined) {
        return buildUrl(`${base}/place`, [
          ['coordinate', formatCoords({ lat: parsed.lat, lng: parsed.lng })],
          ['name', parsed.name],
          ['address', parsed.address],
        ]);
      }
      if (parsed.address) return buildUrl(`${base}/place`, [['address', parsed.address], ['name', parsed.name]]);
      return buildUrl(`${base}/search`, [['query', parsed.name]]);
    case 'search':
      return buildUrl(`${base}/search`, [['query', parsed.query], ['center', parsed.near && formatCoords(parsed.near)]]);
    case 'directions':
      return buildUrl(`${base}/directions`, [
        ['source', formatLocation(parsed.origin)],
        ['destination', formatLocation(parsed.destination)],
        ...parsed.waypoints.map((w) => /** @type {[string, string | undefined]} */ (['waypoint', formatLocation(w)])),
        ['mode', parsed.travelMode && TO_UNIFIED_MODE[parsed.travelMode]],
      ]);
    default:
      return null;
  }
}

/** @param {ParsedLink} parsed */
function toLegacy(parsed) {
  const base = 'https://maps.apple.com/';
  const opts = { space: '+' };
  switch (parsed.kind) {
    case 'coords': {
      const ll = formatCoords(parsed);
      return buildUrl(base, [['ll', ll], ['q', ll], ['z', legacyZoom(parsed.zoom)]], opts);
    }
    case 'place':
      if (parsed.lat !== undefined && parsed.lng !== undefined) {
        return buildUrl(
          base,
          [['ll', formatCoords({ lat: parsed.lat, lng: parsed.lng })], ['q', parsed.name], ['address', parsed.address], ['z', legacyZoom(parsed.zoom)]],
          opts,
        );
      }
      return buildUrl(base, [['q', parsed.address ? `${parsed.name}, ${parsed.address}` : parsed.name]], opts);
    case 'search':
      return buildUrl(base, [['q', parsed.query], ['sll', parsed.near && formatCoords(parsed.near)], ['z', legacyZoom(parsed.zoom)]], opts);
    case 'directions':
      return buildUrl(
        base,
        [
          ['saddr', formatLocation(parsed.origin)],
          ['daddr', formatLocation(parsed.destination)],
          ['dirflg', parsed.travelMode && TO_LEGACY_DIRFLG[parsed.travelMode]],
        ],
        opts,
      );
    default:
      return null;
  }
}

/** Apple Maps accepts zoom 2–21. @param {number | undefined} z */
function legacyZoom(z) {
  if (z === undefined) return undefined;
  return Math.min(21, Math.max(2, Math.round(z)));
}
