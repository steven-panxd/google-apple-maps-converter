import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, detectAppleLinkFormat, toAppleMapsUrl } from '../src/index.js';

const ua = {
  ios16: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  ios183: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
  ios184: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
  ios26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  wechatIos17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47',
  ipadIos17: 'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  desktopSafari17: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  desktopSafari185: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  desktopSafari26: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
};

test('iPhones and iPads: newer links from iOS 18.4', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: ua.ios16 }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.ios183 }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.ios184 }), 'unified');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.wechatIos17 }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.ipadIos17 }), 'legacy');
});

test('iOS 26 Safari reports a frozen OS 18_6 and still gets newer links', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: ua.ios26 }), 'unified');
});

test('iPads asking for desktop sites are told apart from Macs by touch points', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: ua.desktopSafari17, maxTouchPoints: 5 }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.desktopSafari185, maxTouchPoints: 5 }), 'unified');
});

test('Macs: newer links only from Safari 26; other Mac browsers give no hint', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: ua.desktopSafari185, maxTouchPoints: 0 }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.desktopSafari26, maxTouchPoints: 0 }), 'unified');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.macChrome }), 'legacy');
});

test('non-Apple devices open maps.apple.com on the web, which takes newer links', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: ua.android }), 'unified');
  assert.equal(detectAppleLinkFormat({ userAgent: ua.windows }), 'unified');
});

test('falls back to classic links when the device cannot be told', () => {
  assert.equal(detectAppleLinkFormat({ userAgent: '' }), 'legacy');
  assert.equal(detectAppleLinkFormat({ userAgent: 'Mozilla/5.0' }), 'legacy');
  assert.equal(detectAppleLinkFormat({}), 'legacy');
  assert.equal(detectAppleLinkFormat(null), 'legacy');
  // Node has no navigator, so the default is the safe one.
  assert.equal(detectAppleLinkFormat(), 'legacy');
  const blocked = {
    get userAgent() {
      throw new Error('blocked by privacy settings');
    },
  };
  assert.equal(detectAppleLinkFormat(blocked), 'legacy');
});

const route = {
  kind: 'directions',
  origin: { query: 'Pantheon, Rome' },
  destination: { query: "St. Peter's Basilica" },
  waypoints: [],
  travelMode: 'walking',
};

test("toAppleMapsUrl format: 'auto' follows the device", () => {
  assert.equal(
    toAppleMapsUrl(route, { format: 'auto', device: { userAgent: ua.ios16 } }),
    "https://maps.apple.com/?saddr=Pantheon,+Rome&daddr=St.+Peter's+Basilica&dirflg=w",
  );
  assert.equal(
    toAppleMapsUrl(route, { format: 'auto', device: { userAgent: ua.ios26 } }),
    "https://maps.apple.com/directions?source=Pantheon,%20Rome&destination=St.%20Peter's%20Basilica&mode=walking",
  );
});

test("convert appleFormat: 'auto' passes the device through", async () => {
  const link = 'https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1246254,17z';
  const old = await convert(link, { appleFormat: 'auto', device: { userAgent: ua.ios16 } });
  const current = await convert(link, { appleFormat: 'auto', device: { userAgent: ua.ios26 } });
  assert.equal(old.url, 'https://maps.apple.com/?ll=51.5007292,-0.1246254&q=Big+Ben&z=17');
  assert.equal(current.url, 'https://maps.apple.com/place?coordinate=51.5007292,-0.1246254&name=Big%20Ben');
});

test('the default stays the newer format, as in 0.1', () => {
  assert.match(toAppleMapsUrl(route), /^https:\/\/maps\.apple\.com\/directions\?/);
});
