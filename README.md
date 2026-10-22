# Google Maps ↔ Apple Maps Link Converter

**Convert Google Maps links to Apple Maps links, and Apple Maps links to Google Maps links.**
Paste a `google.com/maps` or `maps.app.goo.gl` link and get an Apple Maps link that opens the same place, pin, search or route on iPhone, iPad and Mac. Works the other way too: turn a `maps.apple.com` or `maps.apple/p/…` link into a Google Maps link for friends on Android.

[![npm](https://img.shields.io/npm/v/google-apple-maps-converter)](https://www.npmjs.com/package/google-apple-maps-converter)
[![license](https://img.shields.io/github/license/steven-panxd/google-apple-maps-converter)](LICENSE)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

- 🔁 **Both directions**: Google Maps → Apple Maps and Apple Maps → Google Maps
- 🔗 **Short links**: expands `maps.app.goo.gl`, `goo.gl/maps` and Apple's iOS 26 `maps.apple/p/…` links
- 📍 **Precise**: uses the place's real pin, not the map's viewport center
- 🧭 **Directions**: origin, destination, waypoints and travel mode (driving, walking, transit, cycling)
- 🔑 **No API key**, no tracking, zero dependencies; runs in Node, browsers, Safari extensions and userscripts

**👉 Try it online: [steven-panxd.github.io/google-apple-maps-converter](https://steven-panxd.github.io/google-apple-maps-converter/)**

## How do I open a Google Maps link in Apple Maps?

Convert the link, then open the result:

```js
import { convert } from 'google-apple-maps-converter';

const { url } = await convert('https://maps.app.goo.gl/…');
// → https://maps.apple.com/place?coordinate=48.8583701,2.2944813&name=Eiffel%20Tower
```

On iPhone, `maps.apple.com` links open straight in the Apple Maps app.

## How do I convert an Apple Maps link to Google Maps?

The same call works in reverse; the direction is detected automatically:

```js
const { url } = await convert('https://maps.apple/p/U8rE9v8n8iVZjr');
// → https://www.google.com/maps/place/Apple+Park,+Apple+Inc.,+1+Apple+Park+Way,+Cupertino,+CA+95014,+United+States/@37.334859,-122.00904,17z
```

## Install

```sh
npm install google-apple-maps-converter
```

## API

```js
import {
  convert,            // (url, { to?: 'auto' | 'apple' | 'google', appleFormat?: 'unified' | 'legacy' }) → Promise<{ url, from, to, parsed, resolvedUrl }>
  parseMapsUrl,       // (url) → ParsedLink: auto-detects Google or Apple, never throws, no network
  parseGoogleMapsUrl, // (url) → ParsedLink
  parseAppleMapsUrl,  // (url) → ParsedLink
  toAppleMapsUrl,     // (parsed, { format?: 'unified' | 'legacy' }) → string | null
  toGoogleMapsUrl,    // (parsed) → string | null
  resolveShortLink,   // (url) → Promise<string>: expands maps.app.goo.gl / maps.apple short links
  detectProvider,     // (url) → 'google' | 'apple' | null
  isShortLink,        // (url) → boolean
} from 'google-apple-maps-converter';
```

Parsing and building are synchronous and offline. Only `convert` on a short link (or `resolveShortLink`) makes a network request, to Google or Apple's redirect server.

`ParsedLink` is a small provider-neutral model:

```ts
| { kind: 'place', name, address?, lat?, lng?, zoom? }
| { kind: 'coords', lat, lng, zoom? }
| { kind: 'search', query, near?: { lat, lng }, zoom? }
| { kind: 'directions', origin, destination, waypoints, travelMode? } // a stop is { lat, lng } | { query } | null (current location)
| { kind: 'short', url }
| { kind: 'unsupported', reason }
```

## Supported links

### Google Maps

| Link | Parsed as |
|---|---|
| `maps.app.goo.gl/…`, `goo.gl/maps/…` | short link → expanded |
| `/maps/place/<name>/@lat,lng,17z/data=…!3d<lat>!4d<lng>` | place (exact pin from `data`) |
| `/maps/place/<lat,lng>` or `/maps/place/48°51'30"N 2°17'40"E` | dropped pin |
| `/maps/@lat,lng,12z` | map location |
| `/maps/search/<query>/@lat,lng,14z` | search near a point |
| `/maps/dir/<A>/<B>/…/data=…!3e2` | directions with travel mode |
| `?api=1` search, directions, map ([Maps URLs API](https://developers.google.com/maps/documentation/urls)) | search, directions, map location |
| `maps.google.com/?q=…`, `?ll=…`, `?saddr=…&daddr=…+to:…` | search, map location, directions |
| `comgooglemaps://` app scheme | same as the query-string forms |
| `google.co.uk`, `google.com.hk`, `google.de`, … | all country domains |

### Apple Maps

| Link | Parsed as |
|---|---|
| `maps.apple/p/…` (iOS 26 share links) | short link → expanded |
| `/place?coordinate=…&name=…&address=…` | place |
| `/search?query=…&center=…` | search |
| `/directions?source=…&destination=…&waypoint=…&mode=cycling` | directions |
| `/frame?center=…`, `/look-around`, `/report-a-problem` | map location or place |
| legacy `?q=…&ll=…`, `?address=…`, `?saddr=…&daddr=…&dirflg=w` | place, search, directions |
| `maps://` app scheme | same as legacy |

By default Apple Maps links use Apple's [unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls) (iOS 18.4+, macOS 15.4+), which support waypoints and cycling. Pass `appleFormat: 'legacy'` for older devices.

## FAQ

**Why do Google Maps links open in Google Maps (or Safari) instead of Apple Maps on my iPhone?**
iOS opens `google.com/maps` links in the Google Maps app or the browser. Converting the link to `maps.apple.com` makes it open in Apple Maps.

**Can it convert `maps.app.goo.gl` short links?**
Yes. Short links don't contain a location, so the library follows the redirect once to get the full link. It stops at the first full URL, so it never hits Google's EU consent page or Apple's `/unsupported` page.

**Does it need a Google Maps or Apple MapKit API key?**
No. It only reads and writes URLs.

**What can't be converted?**
Links that carry only an internal place ID (Google `?cid=` / `query_place_id`, Apple `place-id` without coordinates). Resolving those needs the provider's API, so they return `{ kind: 'unsupported', reason: 'place-id-requires-lookup' }`.

**Is anything lost in conversion?**
Map zoom isn't part of Apple's unified URLs, and legacy Apple links can't express waypoints or cycling. Everything else (place name, address, exact coordinates, route stops, travel mode) carries over.

**Can I use it in a web page?**
Parsing and converting full links works anywhere. Expanding short links from a plain web page is blocked by CORS, so do that in Node, a browser extension, an iOS Shortcut or a small server.

## Roadmap

- [x] [Web converter page](https://steven-panxd.github.io/google-apple-maps-converter/)
- [ ] Short-link expansion on the web page
- [ ] iOS Shortcut (convert from the share sheet)
- [ ] Safari extension (iOS and macOS): open Google Maps links in Apple Maps automatically
- [ ] Userscript

Ideas and PRs welcome. If you hit a link that doesn't convert, please [open an issue](https://github.com/steven-panxd/google-apple-maps-converter/issues) with the link.

## Development

```sh
npm test
```

## License

[MIT](LICENSE) © Steven Pan
