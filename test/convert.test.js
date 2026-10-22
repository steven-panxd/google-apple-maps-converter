import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, detectProvider, parseMapsUrl, resolveShortLink, toAppleMapsUrl, toGoogleMapsUrl } from '../src/index.js';

/** Fetch stub: `redirects` maps a URL to its Location header; anything else is a 200. */
function fakeFetch(redirects, calls = []) {
  return async (url, init) => {
    calls.push([url, init?.redirect]);
    const location = redirects[url];
    return location
      ? { status: 301, url, headers: new Headers({ location }) }
      : { status: 200, url, headers: new Headers() };
  };
}

test('detectProvider', () => {
  assert.equal(detectProvider('https://maps.app.goo.gl/abc'), 'google');
  assert.equal(detectProvider('https://www.google.co.uk/maps/@1,2,3z'), 'google');
  assert.equal(detectProvider('comgooglemaps://?q=Paris'), 'google');
  assert.equal(detectProvider('https://maps.apple/p/abc'), 'apple');
  assert.equal(detectProvider('https://maps.apple.com/place?coordinate=1,2'), 'apple');
  assert.equal(detectProvider('maps://?q=Paris'), 'apple');
  assert.equal(detectProvider('https://www.openstreetmap.org/'), null);
});

test('parseMapsUrl dispatches by provider', () => {
  assert.equal(parseMapsUrl('https://www.google.com/maps/@1,2,3z').kind, 'coords');
  assert.equal(parseMapsUrl('https://maps.apple.com/search?query=x').kind, 'search');
  assert.equal(parseMapsUrl('https://example.com').reason, 'not-a-maps-link');
});

test('resolveShortLink stops at the first full URL (Apple would otherwise end on /unsupported)', async () => {
  const target = 'https://maps.apple.com/place?coordinate=37.334859,-122.009040&name=Apple%20Park';
  const calls = [];
  const fetch = fakeFetch({ 'https://maps.apple/p/abc': target, [target]: 'https://maps.apple.com/unsupported' }, calls);
  assert.equal(await resolveShortLink('https://maps.apple/p/abc', { fetch }), target);
  assert.deepEqual(calls, [['https://maps.apple/p/abc', 'manual']]);
});

test('resolveShortLink follows chained short links', async () => {
  const fetch = fakeFetch({
    'https://goo.gl/maps/abc': 'https://maps.app.goo.gl/xyz',
    'https://maps.app.goo.gl/xyz': 'https://www.google.com/maps/place/X/@1,2,3z',
  });
  assert.equal(await resolveShortLink('https://goo.gl/maps/abc', { fetch }), 'https://www.google.com/maps/place/X/@1,2,3z');
});

test('resolveShortLink unwraps the EU consent page', async () => {
  const target = 'https://www.google.com/maps/place/X/@1,2,3z';
  const fetch = fakeFetch({
    'https://maps.app.goo.gl/abc': `https://consent.google.com/m?continue=${encodeURIComponent(target)}&gl=DE`,
  });
  assert.equal(await resolveShortLink('https://maps.app.goo.gl/abc', { fetch }), target);
});

test('resolveShortLink falls back to redirect: follow in browsers (opaqueredirect)', async () => {
  const target = 'https://www.google.com/maps/place/X/@1,2,3z';
  const fetch = async (url, init) =>
    init.redirect === 'manual' ? { type: 'opaqueredirect', status: 0, url: '', headers: new Headers() } : { status: 200, url: target };
  assert.equal(await resolveShortLink('https://maps.app.goo.gl/abc', { fetch }), target);
});

test('resolveShortLink rejects a link that did not redirect', async () => {
  await assert.rejects(resolveShortLink('https://maps.app.goo.gl/abc', { fetch: fakeFetch({}) }), /did not redirect/);
});

test('convert: Google → Apple without network', async () => {
  const fetch = () => assert.fail('should not fetch');
  const r = await convert('https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1246254,17z', { fetch });
  assert.equal(r.from, 'google');
  assert.equal(r.to, 'apple');
  assert.equal(r.url, 'https://maps.apple.com/place?coordinate=51.5007292,-0.1246254&name=Big%20Ben');
});

test('convert: Apple → Google without network', async () => {
  const r = await convert('https://maps.apple.com/directions?destination=Sausalito&mode=cycling');
  assert.equal(r.to, 'google');
  assert.equal(r.url, 'https://www.google.com/maps/dir/?api=1&destination=Sausalito&travelmode=bicycling');
});

test('convert: Apple short link is resolved then converted', async () => {
  const fetch = fakeFetch({
    'https://maps.apple/p/U8rE9v8n8iVZjr':
      'https://maps.apple.com/place?address=Apple%20Inc.,%201%20Apple%20Park%20Way&coordinate=37.334859,-122.009040&name=Apple%20Park&place-id=I7C250D2CDCB364A&map=h',
  });
  const r = await convert('https://maps.apple/p/U8rE9v8n8iVZjr', { fetch });
  assert.equal(r.url, 'https://www.google.com/maps/place/Apple+Park,+Apple+Inc.,+1+Apple+Park+Way/@37.334859,-122.00904,17z');
});

test('convert: Google short link is resolved then converted', async () => {
  const fetch = fakeFetch({
    'https://maps.app.goo.gl/abc':
      'https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z/data=!4m2!3d48.8583701!4d2.2944813?g_st=ic',
  });
  const r = await convert('https://maps.app.goo.gl/abc', { fetch });
  assert.equal(r.url, 'https://maps.apple.com/place?coordinate=48.8583701,2.2944813&name=Eiffel%20Tower');
});

test('convert: explicit target and legacy Apple format', async () => {
  const r = await convert('https://maps.apple.com/place?coordinate=1.5,2.5', { to: 'apple', appleFormat: 'legacy' });
  assert.equal(r.url, 'https://maps.apple.com/?ll=1.5,2.5&q=1.5,2.5');
});

test('convert: unsupported link returns null with a reason', async () => {
  const r = await convert('https://maps.google.com/?cid=123');
  assert.equal(r.url, null);
  assert.equal(r.parsed.reason, 'place-id-requires-lookup');
});

// Round trips: converting there and back must keep what both services can express.
const roundTrips = [
  'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m2!3d48.8583701!4d2.2944813',
  'https://www.google.com/maps/@37.7749295,-122.4194155,12z',
  'https://www.google.com/maps/search/coffee/@40.7128,-74.006,14z',
  'https://www.google.com/maps/dir/?api=1&origin=Paris&destination=Lyon&waypoints=Dijon&travelmode=bicycling',
  'https://maps.apple.com/place?coordinate=37.334859,-122.009040&name=Apple%20Park',
  'https://maps.apple.com/search?query=pizza&center=51.507984,-0.128015',
  'https://maps.apple.com/directions?source=A&destination=40.5,-73.5&waypoint=B&mode=transit',
];

for (const original of roundTrips) {
  test(`round trip: ${original}`, () => {
    const first = parseMapsUrl(original);
    const other = detectProvider(original) === 'google' ? toAppleMapsUrl(first) : toGoogleMapsUrl(first);
    const back = parseMapsUrl(other);
    const strip = ({ zoom, ...rest }) => rest; // zoom is not representable in unified Apple URLs
    assert.deepEqual(strip(back), strip(first));
  });
}
