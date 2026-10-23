<p align="center"><img src="https://raw.githubusercontent.com/steven-panxd/google-apple-maps-converter/main/docs/logo.png" width="96" height="96" alt="Maps Link Converter icon: a red location pin and a dotted route to a blue navigation arrow"></p>

# Google Maps ↔ Apple Maps Link Converter

**Open any Google Maps link in Apple Maps on iPhone, in one tap from the share sheet.** Places, dropped pins, searches and routes keep their exact location and travel mode, short links included. The shortcut converts on your phone. Works the other way too.

[![GitHub stars](https://img.shields.io/github/stars/steven-panxd/google-apple-maps-converter?style=social)](https://github.com/steven-panxd/google-apple-maps-converter)
[![npm](https://img.shields.io/npm/v/google-apple-maps-converter)](https://www.npmjs.com/package/google-apple-maps-converter)
[![license](https://img.shields.io/github/license/steven-panxd/google-apple-maps-converter)](LICENSE)

<p align="center"><img src="https://raw.githubusercontent.com/steven-panxd/google-apple-maps-converter/main/docs/demo.gif" width="280" alt="Long-press a Google Maps link, tap Share, then Open in Apple Maps: Apple Maps opens at the Eiffel Tower"></p>

<p align="center">
  <a href="https://www.icloud.com/shortcuts/b1bf1dce8a7543c9bdd21148cc95735b"><img src="https://img.shields.io/badge/Get_the_iPhone_shortcut-111111?style=for-the-badge" alt="Get the iPhone shortcut"></a>
  <br>
  or paste a link at <a href="https://maps.xuedo.ng/"><b>maps.xuedo.ng</b></a>
</p>

## How do I open a Google Maps link in Apple Maps on iPhone?

1. Open **[the shortcut](https://www.icloud.com/shortcuts/b1bf1dce8a7543c9bdd21148cc95735b)** on your iPhone and tap **Add Shortcut**.
2. Open the Google Maps link. It opens in Google Maps or Safari: tap **Share**, then **Open in Apple Maps**. In Messages or WeChat, which can't share a link, you can also copy it and run the shortcut from the Shortcuts app instead: it reads the clipboard.
3. The first time, iOS asks whether the shortcut may send the link to Maps. Tap **Always Allow**. Short links ask once more, so Google can say where they point.

Tested on a real iPhone (iOS 18.3) with links from Messages, the Google Maps app and WeChat, and on iOS 18.6 and 26. Not in your share sheet? Open the Shortcuts app once, or scroll the share sheet and tap **Edit Actions** to add it to your favourites. Full guide with screenshots: **[maps.xuedo.ng/shortcut](https://maps.xuedo.ng/shortcut/)**.

**Privacy:** the shortcut converts links on your iPhone and opens Apple Maps directly. No account, no tracking, no server of mine. Short links (maps.app.goo.gl) are expanded by asking Google, which made them. Links the shortcut doesn't recognise, such as cycling routes, routes with stops in between or bare coordinates, open [maps.xuedo.ng](https://maps.xuedo.ng/), a static page that converts them in Safari on your phone.

## Why?

Google Maps is great for finding places, and it's what friends send. Apple Maps is what's built into iPhone, CarPlay, Siri and Apple Watch. This bridges the two without copying addresses by hand.

## How do I convert an Apple Maps link to Google Maps?

Paste it into the [web converter](https://maps.xuedo.ng/). It detects the direction and gives you a Google Maps link that works on Android, Windows and in any browser.

## What links work?

Google Maps places, dropped pins (including `48°51′30″N` style), searches, and directions with stops and travel mode; `maps.app.goo.gl` short links; every Google country domain. Apple Maps `maps.apple.com` links in both the current and classic formats, and iOS 26 `maps.apple/p/` short links. Links that carry only an internal place ID (Google `?cid=`) can't be converted.

## For developers

```sh
npm install google-apple-maps-converter
```

```js
import { convert } from 'google-apple-maps-converter';

const { url } = await convert('https://maps.app.goo.gl/…');
// → https://maps.apple.com/place?coordinate=48.8583701,2.2944813&name=Eiffel%20Tower
```

Zero dependencies; runs in Node, browsers, extensions and userscripts. No API key. You can also link straight to the converter: `https://maps.xuedo.ng/?url=<encoded link>&go=1` opens the converted map.

<details>
<summary><b>Full API</b></summary>

```js
import {
  convert,            // (url, { to?: 'auto' | 'apple' | 'google', appleFormat?: 'unified' | 'legacy' | 'auto', device?, fetch?, signal? }) → Promise<{ url, from, to, parsed, resolvedUrl }>
  parseMapsUrl,       // (url) → ParsedLink: auto-detects Google or Apple, never throws, no network
  parseGoogleMapsUrl, // (url) → ParsedLink
  parseAppleMapsUrl,  // (url) → ParsedLink
  toAppleMapsUrl,     // (parsed, { format?: 'unified' | 'legacy' | 'auto', device? }) → string | null
  detectAppleLinkFormat, // (device?) → 'unified' | 'legacy': which Apple Maps links this device can open
  toGoogleMapsUrl,    // (parsed) → string | null
  resolveShortLink,   // (url, { fetch?, signal?, maxRedirects? = 5 }) → Promise<string>: expands maps.app.goo.gl / maps.apple short links
  unwrapConsent,      // (url) → string: the real link inside an EU consent.google.com?continue=… page
  detectProvider,     // (url) → 'google' | 'apple' | null
  isShortLink,        // (url) → boolean
} from 'google-apple-maps-converter';
```

Parsing and building are synchronous and offline. Only `convert` on a short link (or `resolveShortLink`) makes a network request, to Google or Apple's redirect server; pass `fetch` to route it elsewhere (a proxy, a test stub) and `signal` to cancel it. `convert` never throws for a bad link: it returns `url: null` and says why in `parsed.reason`. It rejects only when a short link can't be expanded.

`ParsedLink` is a small provider-neutral model:

```ts
| { kind: 'place', name, address?, lat?, lng?, zoom? }
| { kind: 'coords', lat, lng, zoom? }
| { kind: 'search', query, near?: { lat, lng }, zoom? }
| { kind: 'directions', origin, destination, waypoints, travelMode? } // a stop is { lat, lng } | { query } | null (current location)
| { kind: 'short', url }
| { kind: 'unsupported', reason }
```

</details>

<details>
<summary><b>Supported link formats</b></summary>

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

</details>

<details>
<summary><b>Which Apple Maps link format? (iOS 18.4 and older iPhones)</b></summary>

Apple has two kinds of Maps links:

- **Unified** (`maps.apple.com/place?…`, `/directions?…`): Apple's [current format](https://developer.apple.com/documentation/mapkit/unified-map-urls). Supports waypoints and cycling, but **iPhones before iOS 18.4** (and Macs before macOS 15.4) open Apple Maps and ignore it.
- **Legacy** (`maps.apple.com/?ll=…&q=…`, `?saddr=…&daddr=…&dirflg=w`): works on every iPhone, Mac and on the web, but can't carry waypoints or cycling.

The default is unified. Pass `'auto'` to pick per device:

```js
// In a browser: reads navigator.userAgent
const { url } = await convert(link, { appleFormat: 'auto' });

// On a server: pass the visitor's user agent
const { url } = await convert(link, { appleFormat: 'auto', device: { userAgent: req.headers['user-agent'] } });
```

`'auto'` returns unified only when the device is known to handle it (iOS/iPadOS 18.4+, and non-Apple devices, which open Apple Maps on the web). Macs get legacy: their browsers don't reveal the macOS version. Whenever it can't tell — no user agent, a hidden or unusual one, an error reading it — it falls back to legacy, which always opens. iOS 26 Safari freezes its reported version at `18_6`, which still counts as new enough.

</details>

## Contributing

Found a link that doesn't convert? [Open an issue](https://github.com/steven-panxd/google-apple-maps-converter/issues/new?title=Unsupported%20link) with the link. Pull requests welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

If it saves you a few taps, a [⭐ star](https://github.com/steven-panxd/google-apple-maps-converter) helps other people find it.

## License

[MIT](LICENSE) © Steven Pan
