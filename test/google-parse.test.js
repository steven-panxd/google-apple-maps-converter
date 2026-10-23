import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleMapsUrl as parse } from '../src/google.js';
import { detectProvider, isShortLink } from '../src/index.js';

test('place URL prefers the data pin over the viewport center', () => {
  const url =
    'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqODE?entry=ttu';
  assert.deepEqual(parse(url), { kind: 'place', name: 'Eiffel Tower', lat: 48.8583701, lng: 2.2944813, zoom: 17 });
});

test('place URL without data falls back to @ coordinates', () => {
  assert.deepEqual(parse('https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1246254,17z'), {
    kind: 'place',
    name: 'Big Ben',
    lat: 51.5007292,
    lng: -0.1246254,
    zoom: 17,
  });
});

test('place name is percent-decoded (CJK, punctuation)', () => {
  const url =
    'https://www.google.com/maps/place/%E6%9D%B1%E4%BA%AC%E3%82%BF%E3%83%AF%E3%83%BC/@35.6585805,139.7454329,17z/data=!4m6!3m5!1s0x0:0x0!8m2!3d35.6585805!4d139.7454329';
  const p = parse(url);
  assert.equal(p.kind, 'place');
  assert.equal(p.name, '東京タワー');
  assert.equal(p.lat, 35.6585805);
});

test('literal + in a name survives (%2B)', () => {
  const p = parse('https://www.google.com/maps/place/A%2BB+Cafe/@1,2,10z');
  assert.equal(p.name, 'A+B Cafe');
});

test('place with only a name and no coordinates', () => {
  assert.deepEqual(parse('https://www.google.com/maps/place/Statue+of+Liberty'), {
    kind: 'place',
    name: 'Statue of Liberty',
  });
});

test('dropped pin in decimal form', () => {
  assert.deepEqual(parse('https://www.google.com/maps/place/40.689247,-74.044502/@40.689247,-74.044502,15z'), {
    kind: 'coords',
    lat: 40.689247,
    lng: -74.044502,
    zoom: 15,
  });
});

test('dropped pin in DMS form', () => {
  const p = parse("https://www.google.com/maps/place/48%C2%B051'30.0%22N+2%C2%B017'40.2%22E/@48.8583,2.2945,17z");
  assert.equal(p.kind, 'coords');
  assert.ok(Math.abs(p.lat - 48.8583333) < 1e-6);
  assert.ok(Math.abs(p.lng - 2.2945) < 1e-6);
});

test('DMS in the southern/western hemispheres is negative', () => {
  const p = parse("https://www.google.com/maps/place/33%C2%B051'25.0%22S+151%C2%B012'54.0%22W");
  assert.equal(p.kind, 'coords');
  assert.ok(p.lat < 0 && p.lng < 0);
});

test('bare map view', () => {
  assert.deepEqual(parse('https://www.google.com/maps/@37.7749295,-122.4194155,12z'), {
    kind: 'coords',
    lat: 37.7749295,
    lng: -122.4194155,
    zoom: 12,
  });
});

test('path search near a location', () => {
  assert.deepEqual(parse('https://www.google.com/maps/search/coffee+shops/@40.7128,-74.006,14z'), {
    kind: 'search',
    query: 'coffee shops',
    near: { lat: 40.7128, lng: -74.006 },
    zoom: 14,
  });
});

test('path search that resolved to one result becomes a place', () => {
  const p = parse('https://www.google.com/maps/search/louvre/@48.86,2.33,15z/data=!3m1!4b1!4m2!3d48.8606111!4d2.337644');
  assert.deepEqual(p, { kind: 'place', name: 'louvre', lat: 48.8606111, lng: 2.337644, zoom: 15 });
});

test('path search with coordinates as the query', () => {
  assert.deepEqual(parse('https://www.google.com/maps/search/22.2783,+114.1747'), {
    kind: 'coords',
    lat: 22.2783,
    lng: 114.1747,
  });
});

test('Maps URLs API: search', () => {
  assert.deepEqual(parse('https://www.google.com/maps/search/?api=1&query=Space+Needle+Seattle'), {
    kind: 'search',
    query: 'Space Needle Seattle',
  });
  assert.deepEqual(parse('https://www.google.com/maps/search/?api=1&query=47.6205,-122.3493'), {
    kind: 'coords',
    lat: 47.6205,
    lng: -122.3493,
  });
});

test('Maps URLs API: place id only cannot be converted offline', () => {
  assert.deepEqual(parse('https://www.google.com/maps/search/?api=1&query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0'), {
    kind: 'unsupported',
    reason: 'place-id-requires-lookup',
  });
});

test('Maps URLs API: directions with waypoints and travel mode', () => {
  const url =
    'https://www.google.com/maps/dir/?api=1&origin=Paris&destination=Lyon&waypoints=Dijon%7CBeaune&travelmode=driving';
  assert.deepEqual(parse(url), {
    kind: 'directions',
    origin: { query: 'Paris' },
    destination: { query: 'Lyon' },
    waypoints: [{ query: 'Dijon' }, { query: 'Beaune' }],
    travelMode: 'driving',
  });
});

test('Maps URLs API: directions without origin use current location', () => {
  assert.deepEqual(parse('https://www.google.com/maps/dir/?api=1&destination=48.8584,2.2945&travelmode=walking'), {
    kind: 'directions',
    origin: null,
    destination: { lat: 48.8584, lng: 2.2945 },
    waypoints: [],
    travelMode: 'walking',
  });
});

test('Maps URLs API: map view', () => {
  assert.deepEqual(parse('https://www.google.com/maps/@?api=1&map_action=map&center=-33.8569,151.2152&zoom=10'), {
    kind: 'coords',
    lat: -33.8569,
    lng: 151.2152,
    zoom: 10,
  });
});

test('path directions with travel mode in data blob', () => {
  const url =
    'https://www.google.com/maps/dir/Times+Square,+New+York/Central+Park/@40.77,-73.97,14z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x0:0x0!2m2!1d-73.98!2d40.75!1m5!1m1!1s0x0:0x0!2m2!1d-73.96!2d40.78!3e2';
  assert.deepEqual(parse(url), {
    kind: 'directions',
    origin: { query: 'Times Square, New York' },
    destination: { query: 'Central Park' },
    waypoints: [],
    travelMode: 'walking',
  });
});

test('path directions with empty origin (current location)', () => {
  assert.deepEqual(parse('https://www.google.com/maps/dir//Golden+Gate+Bridge/@37.8,-122.4,13z'), {
    kind: 'directions',
    origin: null,
    destination: { query: 'Golden Gate Bridge' },
    waypoints: [],
  });
});

test('path directions with intermediate stops and transit', () => {
  const p = parse('https://www.google.com/maps/dir/A/B/C/D/data=!4m2!4m1!3e3');
  assert.deepEqual(p, {
    kind: 'directions',
    origin: { query: 'A' },
    destination: { query: 'D' },
    waypoints: [{ query: 'B' }, { query: 'C' }],
    travelMode: 'transit',
  });
});

test('path directions with a single stop treat it as the destination', () => {
  assert.deepEqual(parse('https://www.google.com/maps/dir/Lyon/'), {
    kind: 'directions',
    origin: null,
    destination: { query: 'Lyon' },
    waypoints: [],
  });
});

test('legacy ?q= on maps.google.com', () => {
  assert.deepEqual(parse('https://maps.google.com/?q=Sydney+Opera+House'), { kind: 'search', query: 'Sydney Opera House' });
  assert.deepEqual(parse('https://maps.google.com/maps?q=-33.8568,151.2153&z=16'), {
    kind: 'coords',
    lat: -33.8568,
    lng: 151.2153,
    zoom: 16,
  });
});

test('legacy ?q= with ?ll= becomes a search near that point', () => {
  assert.deepEqual(parse('https://maps.google.com/?q=pizza&ll=40.7,-74.0'), {
    kind: 'search',
    query: 'pizza',
    near: { lat: 40.7, lng: -74 },
  });
});

test('legacy ?ll= only', () => {
  assert.deepEqual(parse('https://maps.google.com/?ll=35.68,139.76&z=11'), {
    kind: 'coords',
    lat: 35.68,
    lng: 139.76,
    zoom: 11,
  });
});

test('legacy saddr/daddr with "to:" waypoints and dirflg', () => {
  assert.deepEqual(parse('https://maps.google.com/maps?saddr=Boston&daddr=Worcester+to:Springfield&dirflg=r'), {
    kind: 'directions',
    origin: { query: 'Boston' },
    destination: { query: 'Springfield' },
    waypoints: [{ query: 'Worcester' }],
    travelMode: 'transit',
  });
});

test('legacy daddr only, "My Location" origin', () => {
  assert.deepEqual(parse('https://maps.google.com/?saddr=My+Location&daddr=Berlin'), {
    kind: 'directions',
    origin: null,
    destination: { query: 'Berlin' },
    waypoints: [],
  });
});

test('country domains are recognized', () => {
  for (const host of ['www.google.co.uk', 'www.google.com.hk', 'www.google.de', 'google.com', 'maps.google.co.jp']) {
    const p = parse(`https://${host}/maps/place/X/@1.5,2.5,10z`);
    assert.equal(p.kind, 'place', host);
  }
});

test('missing scheme is tolerated', () => {
  assert.equal(parse('www.google.com/maps/@1,2,3z').kind, 'coords');
  assert.equal(parse('  maps.app.goo.gl/abc123  ').kind, 'short');
});

test('short links are flagged, not parsed', () => {
  assert.deepEqual(parse('https://maps.app.goo.gl/AbCdEf123'), { kind: 'short', url: 'https://maps.app.goo.gl/AbCdEf123' });
  assert.equal(parse('https://goo.gl/maps/AbCdEf123').kind, 'short');
  assert.equal(isShortLink('https://goo.gl/maps/x'), true);
  assert.equal(isShortLink('https://goo.gl/other'), false);
});

test('cid links need a lookup', () => {
  assert.deepEqual(parse('https://maps.google.com/?cid=1234567890123456789'), {
    kind: 'unsupported',
    reason: 'place-id-requires-lookup',
  });
});

test('non-Google and look-alike hosts are rejected', () => {
  assert.equal(parse('https://www.bing.com/maps?q=x').reason, 'not-google-maps');
  assert.equal(parse('https://google.com.evil.com/maps/@1,2,3z').reason, 'not-google-maps');
  assert.equal(parse('https://www.google.com/search?q=maps').reason, 'not-google-maps');
  assert.equal(parse('not a url at all').reason, 'invalid-url');
  assert.equal(detectProvider('https://example.com'), null);
  assert.equal(detectProvider('https://www.google.com/maps'), 'google');
});

test('out-of-range coordinates are ignored', () => {
  assert.equal(parse('https://www.google.com/maps/@95,200,3z').kind, 'unsupported');
});

test('directions need somewhere to go; "current location" in between is dropped', () => {
  assert.equal(parse('https://maps.google.com/?saddr=Paris').reason, 'missing-destination');
  assert.equal(parse('https://maps.google.com/?saddr=Paris&daddr=').reason, 'missing-destination');
  assert.equal(parse('https://www.google.com/maps/dir/Paris/My+Location/').reason, 'missing-destination');
  assert.deepEqual(parse('https://www.google.com/maps/dir/Paris/My+Location/Lyon/').waypoints, []);
  assert.deepEqual(parse('https://www.google.com/maps/dir/?api=1&destination=Lyon&waypoints=My+Location|Dijon').waypoints, [
    { query: 'Dijon' },
  ]);
});
