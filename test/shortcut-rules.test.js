import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseAppleMapsUrl, parseGoogleMapsUrl, toAppleMapsUrl } from '../src/index.js';

const { parts, rules } = JSON.parse(readFileSync(new URL('../shortcut/rules.json', import.meta.url), 'utf8'));

/** Fills in each {part}, as shortcut/build.py does. */
function expand(pattern) {
  const filled = pattern.replace(/\{([a-z_]+)\}/g, (_, name) => parts[name]);
  return filled === pattern ? pattern : expand(filled);
}

const compiled = rules.map((r) => ({ ...r, re: new RegExp(expand(r.find), 'i') }));
const MAPS_APP = 'maps://?';

/** What the shortcut does on the phone: every rule in turn. */
function applyRules(url) {
  return compiled.reduce((text, r) => text.replace(r.re, r.replace), url);
}

/** Zoom is a viewport hint the shortcut drops; everything else must match. */
function meaning(appleUrl) {
  const { zoom, ...rest } = parseAppleMapsUrl(appleUrl.replace(MAPS_APP, 'https://maps.apple.com/?'));
  return rest;
}

const EXTRA = [
  'https://www.google.com/maps/place/Golden+Gate+Bridge/@37.8199286,-122.4782551,17z',
  'https://www.google.com/maps/place/Golden+Gate+Bridge/@37.8199286,-122.4782551,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d37.8199286!4d-122.4782551?entry=ttu',
  'https://www.google.com/maps/place/%E6%95%85%E5%AE%AB/@39.9163447,116.3971546,17z',
  'https://www.google.com/maps/place/Caf%C3%A9+de+Flore/data=!4m2!3m1!1s0x0:0x0',
  'https://www.google.com/maps/place/48%C2%B051\'30.0%22N+2%C2%B017\'40.2%22E/@48.8583333,2.2945,17z',
  'https://www.google.com/maps/place/48%C2%B051\'30.0%22N+2%C2%B017\'40.2%22E/@48.85,2.29,17z/data=!3m1!4b1!4m4!3m3!8m2!3d48.8583333!4d2.2945',
  'https://www.google.com/maps/search/coffee/@48.8566,2.3522,14z',
  'https://www.google.com/maps/search/coffee+near+me',
  'https://www.google.com/maps/search/48.8584,+2.2945',
  'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/@48.86,2.31,14z/data=!4m2!4m1!3e2',
  'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/@48.86,2.31,14z/data=!4m2!4m1!3e3',
  'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/@48.86,2.31,14z/data=!4m2!4m1!3e1',
  'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/@48.86,2.31,14z/data=!4m2!4m1!3e0',
  'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/',
  'https://www.google.com/maps/dir//Eiffel+Tower/@48.86,2.31,14z',
  'https://www.google.com/maps/dir/Eiffel+Tower/@48.86,2.31,14z',
  'https://www.google.com/maps/dir/48.8606,2.3376/48.8584,2.2945/data=!3e2',
  'https://www.google.com/maps/dir/Louvre/Pantheon/Eiffel+Tower/',
  'https://www.google.com/maps/search/?api=1&query=Golden+Gate+Bridge',
  'https://www.google.com/maps/search/?query=Golden+Gate+Bridge&api=1&query_place_id=abc',
  'https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945',
  'https://www.google.com/maps/dir/?api=1&origin=Louvre&destination=Eiffel+Tower&travelmode=walking',
  'https://www.google.com/maps/dir/?api=1&destination=Eiffel+Tower&travelmode=TRANSIT',
  'https://www.google.com/maps/dir/?api=1&destination=Eiffel+Tower&travelmode=bicycling',
  'https://www.google.com/maps/dir/?api=1&origin=A&destination=B&waypoints=C',
  'https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z?api=1',
  'https://maps.google.com/?q=Eiffel+Tower&ftid=0x0:0x0&entry=gps',
  'https://maps.google.com/maps?q=Eiffel+Tower',
  'https://www.google.com/maps?q=Eiffel+Tower&ll=48.85,2.29',
  'https://www.google.com/maps?q=48.85,2.29',
  'https://www.google.com/maps/@48.8584,2.2945,15z',
  'https://www.google.com/maps/@48.8584,2.2945,15z/data=!3m1!4b1!3d48.1!4d2.1',
  'https://www.google.com/?q=Eiffel+Tower',
  'https://maps.app.goo.gl/abc123',
  'https://consent.google.com/ml?continue=https://www.google.com/maps/place/Eiffel',
];

/** Every Google Maps link the other test files use, plus the cases above. */
function samples() {
  const found = new Set(EXTRA);
  for (const file of readdirSync(new URL('.', import.meta.url))) {
    if (!file.endsWith('.test.js') || file === 'shortcut-rules.test.js') continue;
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of text.matchAll(/(['`])(https?:\/\/[^'`\s]*google[^'`\s]*)\1/g)) {
      if (!m[2].includes('${')) found.add(m[2]);
    }
  }
  return [...found];
}

test('shortcut rules agree with the library on every Google link they convert', () => {
  let converted = 0;
  for (const url of samples()) {
    const out = applyRules(url);
    if (!out.startsWith(MAPS_APP)) {
      assert.equal(out, url, `a rule half-matched ${url}`);
      continue;
    }
    converted++;
    assert.doesNotMatch(out, /dirflg=X/, `unmapped travel mode for ${url}`);
    const expected = toAppleMapsUrl(parseGoogleMapsUrl(url), { format: 'legacy' });
    assert.ok(expected, `the shortcut converted ${url}, which the library rejects`);
    assert.deepEqual(meaning(out), meaning(expected), `${url}\n  shortcut: ${out}\n  library:  ${expected}`);
  }
  assert.ok(converted >= 25, `only ${converted} links converted on the device`);
});

test('every rule does what its example says', () => {
  for (const { name, example } of rules) {
    const [from, to] = example;
    assert.equal(applyRules(from), to, name);
  }
});

test('shortcut rules leave the rest to the web converter', () => {
  for (const url of [
    'https://www.google.com/maps/dir/Louvre+Museum/Eiffel+Tower/data=!4m2!4m1!3e1', // cycling needs the newer link
    'https://www.google.com/maps/dir/Louvre/Pantheon/Eiffel+Tower/', // stops in between
    'https://www.google.com/maps/search/48.8584,+2.2945', // coordinates as text
    'https://consent.google.com/ml?continue=https://www.google.com/maps/place/Eiffel',
    'https://maps.app.goo.gl/abc123',
  ]) {
    assert.equal(applyRules(url), url);
  }
});
