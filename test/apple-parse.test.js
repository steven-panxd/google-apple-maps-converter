import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppleMapsUrl as parse } from '../src/apple.js';

test('unified /place shared from iOS (real redirect target of a maps.apple short link)', () => {
  const url =
    'https://maps.apple.com/place?address=Apple%20Inc.,%201%20Apple%20Park%20Way,%20Cupertino,%20CA%2095014,%20United%20States&coordinate=37.334859,-122.009040&name=Apple%20Park&place-id=I7C250D2CDCB364A&map=h';
  assert.deepEqual(parse(url), {
    kind: 'place',
    name: 'Apple Park',
    address: 'Apple Inc., 1 Apple Park Way, Cupertino, CA 95014, United States',
    lat: 37.334859,
    lng: -122.00904,
  });
});

test('unified /place with coordinate only', () => {
  assert.deepEqual(parse('https://maps.apple.com/place?coordinate=40.779092,-73.962932'), {
    kind: 'coords',
    lat: 40.779092,
    lng: -73.962932,
  });
});

test('unified /place with address only', () => {
  assert.deepEqual(parse('https://maps.apple.com/place?address=1000%20Fifth%20Ave,%20NY,NY,10028%20United%20States'), {
    kind: 'place',
    name: '1000 Fifth Ave, NY,NY,10028 United States',
  });
});

test('unified /place with a generic pin name is just coords', () => {
  assert.deepEqual(parse('https://maps.apple.com/place?coordinate=1.5,2.5&name=Dropped%20Pin'), {
    kind: 'coords',
    lat: 1.5,
    lng: 2.5,
  });
});

test('unified /place with only a place-id needs a lookup', () => {
  assert.deepEqual(parse('https://maps.apple.com/place?place-id=IF149E70A3B3C4CB2'), {
    kind: 'unsupported',
    reason: 'place-id-requires-lookup',
  });
});

test('/place with older q/ll params', () => {
  assert.deepEqual(parse('https://maps.apple.com/place?q=Ferry%20Building&ll=37.7955,-122.3937&auid=123'), {
    kind: 'place',
    name: 'Ferry Building',
    lat: 37.7955,
    lng: -122.3937,
  });
});

test('/look-around and /report-a-problem reuse place parsing', () => {
  assert.equal(parse('https://maps.apple.com/look-around?coordinate=40.706974,-74.011281').kind, 'coords');
  assert.equal(parse('https://maps.apple.com/look-around?address=The%20Eiffel%20Tower,Paris,France').kind, 'place');
});

test('unified /search', () => {
  assert.deepEqual(parse('https://maps.apple.com/search?query=pizza&center=51.507984,-0.128015&span=0.05,0.05'), {
    kind: 'search',
    query: 'pizza',
    near: { lat: 51.507984, lng: -0.128015 },
  });
  assert.deepEqual(parse('https://maps.apple.com/search?query=pizza'), { kind: 'search', query: 'pizza' });
});

test('unified /directions with waypoints and cycling', () => {
  const url =
    'https://maps.apple.com/directions?source=328%20Riverside%20Drive,%20New%20York&destination=40.596896,-73.514907&waypoint=40.779092,-73.962932&waypoint=476%20Fifth%20Ave&mode=cycling&avoid=tolls';
  assert.deepEqual(parse(url), {
    kind: 'directions',
    origin: { query: '328 Riverside Drive, New York' },
    destination: { lat: 40.596896, lng: -73.514907 },
    waypoints: [{ lat: 40.779092, lng: -73.962932 }, { query: '476 Fifth Ave' }],
    travelMode: 'bicycling',
  });
});

test('unified /directions without source starts at current location', () => {
  assert.deepEqual(parse('https://maps.apple.com/directions?destination=Sausalito,%20CA&mode=transit'), {
    kind: 'directions',
    origin: null,
    destination: { query: 'Sausalito, CA' },
    waypoints: [],
    travelMode: 'transit',
  });
});

test('unified /frame', () => {
  assert.deepEqual(parse('https://maps.apple.com/frame?center=40.753035,-73.981846&span=0.05,0.05'), {
    kind: 'coords',
    lat: 40.753035,
    lng: -73.981846,
  });
});

test('legacy ?q= search, with sll', () => {
  assert.deepEqual(parse('https://maps.apple.com/?q=Mexican+Restaurant&sll=50.894967,4.341626&z=10'), {
    kind: 'search',
    query: 'Mexican Restaurant',
    near: { lat: 50.894967, lng: 4.341626 },
    zoom: 10,
  });
});

test('legacy ?ll= with a name is a place, with "Dropped Pin" is coords', () => {
  assert.deepEqual(parse('http://maps.apple.com/?ll=50.894967,4.341626&q=Atomium&z=15'), {
    kind: 'place',
    name: 'Atomium',
    lat: 50.894967,
    lng: 4.341626,
    zoom: 15,
  });
  assert.deepEqual(parse('http://maps.apple.com/?ll=50.894967,4.341626&q=Dropped%20Pin'), {
    kind: 'coords',
    lat: 50.894967,
    lng: 4.341626,
  });
});

test('legacy ?address=', () => {
  assert.deepEqual(parse('https://maps.apple.com/?address=1+Infinite+Loop,+Cupertino,+CA'), {
    kind: 'place',
    name: '1 Infinite Loop, Cupertino, CA',
  });
});

test('legacy directions', () => {
  assert.deepEqual(parse('https://maps.apple.com/?saddr=Cupertino&daddr=San+Francisco&dirflg=w'), {
    kind: 'directions',
    origin: { query: 'Cupertino' },
    destination: { query: 'San Francisco' },
    waypoints: [],
    travelMode: 'walking',
  });
});

test('maps:// app scheme', () => {
  assert.deepEqual(parse('maps://?q=48.8584,2.2945'), { kind: 'coords', lat: 48.8584, lng: 2.2945 });
  assert.equal(parse('maps:?daddr=Paris').kind, 'directions');
});

test('short links are flagged, not parsed', () => {
  assert.deepEqual(parse('https://maps.apple/p/U8rE9v8n8iVZjr'), { kind: 'short', url: 'https://maps.apple/p/U8rE9v8n8iVZjr' });
});

test('non-Apple and unknown paths are rejected', () => {
  assert.equal(parse('https://www.apple.com/maps/').reason, 'not-apple-maps');
  assert.equal(parse('https://maps.apple.com.evil.com/place?coordinate=1,2').reason, 'not-apple-maps');
  assert.equal(parse('https://maps.apple.com/guides').reason, 'unrecognized-format');
});
