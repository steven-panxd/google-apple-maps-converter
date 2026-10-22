import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAppleMapsUrl, toGoogleMapsUrl } from '../src/index.js';

const directions = (extra = {}) => ({
  kind: 'directions',
  origin: null,
  destination: { query: 'Golden Gate Bridge' },
  waypoints: [],
  ...extra,
});

// --- Apple, unified (default) ---

test('apple: coords → /place?coordinate', () => {
  assert.equal(toAppleMapsUrl({ kind: 'coords', lat: 48.8584, lng: 2.2945, zoom: 15 }), 'https://maps.apple.com/place?coordinate=48.8584,2.2945');
});

test('apple: place with coords → /place with name and address', () => {
  assert.equal(
    toAppleMapsUrl({ kind: 'place', name: 'Apple Park', address: '1 Apple Park Way', lat: 37.33, lng: -122.009 }),
    'https://maps.apple.com/place?coordinate=37.33,-122.009&name=Apple%20Park&address=1%20Apple%20Park%20Way',
  );
});

test('apple: place without coords → /search, or /place?address when there is one', () => {
  assert.equal(toAppleMapsUrl({ kind: 'place', name: '東京タワー' }), 'https://maps.apple.com/search?query=%E6%9D%B1%E4%BA%AC%E3%82%BF%E3%83%AF%E3%83%BC');
  assert.equal(
    toAppleMapsUrl({ kind: 'place', name: 'Home', address: '1 Main St' }),
    'https://maps.apple.com/place?address=1%20Main%20St&name=Home',
  );
});

test('apple: search near a point → /search?center', () => {
  assert.equal(
    toAppleMapsUrl({ kind: 'search', query: 'coffee & tea', near: { lat: 40.7, lng: -74 } }),
    'https://maps.apple.com/search?query=coffee%20%26%20tea&center=40.7,-74',
  );
});

test('apple: directions keep waypoints and cycling', () => {
  assert.equal(
    toAppleMapsUrl(directions({ origin: { lat: 1.5, lng: 2.5 }, waypoints: [{ query: 'X' }, { query: 'Y' }], travelMode: 'bicycling' })),
    'https://maps.apple.com/directions?source=1.5,2.5&destination=Golden%20Gate%20Bridge&waypoint=X&waypoint=Y&mode=cycling',
  );
  assert.equal(toAppleMapsUrl(directions()), 'https://maps.apple.com/directions?destination=Golden%20Gate%20Bridge');
});

// --- Apple, legacy ---

test('apple legacy: coords and place', () => {
  assert.equal(
    toAppleMapsUrl({ kind: 'coords', lat: 48.8584, lng: 2.2945, zoom: 15 }, { format: 'legacy' }),
    'https://maps.apple.com/?ll=48.8584,2.2945&q=48.8584,2.2945&z=15',
  );
  assert.equal(
    toAppleMapsUrl({ kind: 'place', name: 'Eiffel Tower', lat: 48.8583701, lng: 2.2944813, zoom: 17 }, { format: 'legacy' }),
    'https://maps.apple.com/?ll=48.8583701,2.2944813&q=Eiffel+Tower&z=17',
  );
});

test('apple legacy: directions drop waypoints and cycling', () => {
  assert.equal(
    toAppleMapsUrl(directions({ waypoints: [{ query: 'X' }], travelMode: 'walking' }), { format: 'legacy' }),
    'https://maps.apple.com/?daddr=Golden+Gate+Bridge&dirflg=w',
  );
  assert.equal(toAppleMapsUrl(directions({ travelMode: 'bicycling' }), { format: 'legacy' }), 'https://maps.apple.com/?daddr=Golden+Gate+Bridge');
});

test('apple legacy: zoom is clamped to 2–21', () => {
  assert.match(toAppleMapsUrl({ kind: 'coords', lat: 0, lng: 0, zoom: 1 }, { format: 'legacy' }), /z=2$/);
  assert.match(toAppleMapsUrl({ kind: 'coords', lat: 0, lng: 0, zoom: 22.4 }, { format: 'legacy' }), /z=21$/);
});

// --- Google ---

test('google: coords → api=1 search', () => {
  assert.equal(toGoogleMapsUrl({ kind: 'coords', lat: 48.8584, lng: 2.2945 }), 'https://www.google.com/maps/search/?api=1&query=48.8584,2.2945');
});

test('google: place with coords → /maps/place/<name>/@lat,lng', () => {
  assert.equal(
    toGoogleMapsUrl({ kind: 'place', name: 'Apple Park', address: '1 Apple Park Way, Cupertino', lat: 37.334859, lng: -122.00904 }),
    'https://www.google.com/maps/place/Apple+Park,+1+Apple+Park+Way,+Cupertino/@37.334859,-122.00904,17z',
  );
});

test('google: place without coords → api=1 query', () => {
  assert.equal(toGoogleMapsUrl({ kind: 'place', name: 'A/B Café' }), 'https://www.google.com/maps/search/?api=1&query=A%2FB%20Caf%C3%A9');
});

test('google: search with and without a center', () => {
  assert.equal(
    toGoogleMapsUrl({ kind: 'search', query: 'pizza', near: { lat: 51.5, lng: -0.12 } }),
    'https://www.google.com/maps/search/pizza/@51.5,-0.12,14z',
  );
  assert.equal(toGoogleMapsUrl({ kind: 'search', query: 'pizza' }), 'https://www.google.com/maps/search/?api=1&query=pizza');
});

test('google: directions → api=1 dir with waypoints and travel mode', () => {
  assert.equal(
    toGoogleMapsUrl(directions({ origin: { query: 'Paris' }, waypoints: [{ query: 'Dijon' }, { lat: 47, lng: 4.8 }], travelMode: 'bicycling' })),
    'https://www.google.com/maps/dir/?api=1&origin=Paris&destination=Golden%20Gate%20Bridge&waypoints=Dijon%7C47,4.8&travelmode=bicycling',
  );
  assert.equal(toGoogleMapsUrl(directions()), 'https://www.google.com/maps/dir/?api=1&destination=Golden%20Gate%20Bridge');
});

test('short / unsupported → null for both targets', () => {
  for (const parsed of [{ kind: 'short', url: 'https://maps.app.goo.gl/x' }, { kind: 'unsupported', reason: 'x' }]) {
    assert.equal(toAppleMapsUrl(parsed), null);
    assert.equal(toGoogleMapsUrl(parsed), null);
  }
});
