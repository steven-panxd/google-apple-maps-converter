import { convert, isShortLink, toAppleMapsUrl } from './lib/index.js';

// Short-link expander (worker/). Short links can't be expanded from a web page because of CORS.
// Empty until the worker is deployed; short links then ask the user for the full link.
const RESOLVER = '';
const ISSUES = 'https://github.com/steven-panxd/google-apple-maps-converter/issues/new';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const input = /** @type {HTMLInputElement} */ ($('link'));
const status = $('status');
const result = $('result');
const map = $('result-map');
const mapCredit = $('map-credit');
const openBtn = /** @type {HTMLAnchorElement} */ ($('open'));
const urlEl = /** @type {HTMLAnchorElement} */ ($('result-url'));
const copyBtn = $('copy');
const note = $('result-note');

const NAMES = { apple: 'Apple Maps', google: 'Google Maps' };
const MODES = { driving: 'Driving', walking: 'Walking', transit: 'Transit', bicycling: 'Cycling' };

let run = 0;

/** Pull the first map link out of pasted text like "Meet here: https://maps.app.goo.gl/abc". */
function extractLink(text) {
  // Quotes stay inside the match: links carry them in names (St. Peter's) and pins (48°51'30"N).
  const m =
    text.match(/(?:https?:\/\/|maps:\/*|comgooglemaps:\/\/)[^\s<>]+/i) ??
    text.match(/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple(?:\.com)?\/|(?:www\.)?google\.[a-z.]+\/maps)[^\s<>]*/i);
  if (!m) return null;
  const link = m[0].replace(/[.,;!?)"'”’]+$/, '');
  // EU visitors may land on consent.google.com?continue=<real link> after a short link.
  try {
    const u = new URL(link);
    if (/^consent\.google\./i.test(u.hostname) && u.searchParams.get('continue')) return u.searchParams.get('continue');
  } catch {}
  return link;
}

/** fetch() stand-in for resolveShortLink: asks the worker, answers like a redirect. */
async function viaResolver(url) {
  const res = await fetch(`${RESOLVER}?url=${encodeURIComponent(url)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error || `Resolver returned ${res.status}`);
  return { status: 301, headers: new Headers({ location: body.url }) };
}

function setStatus(text, { error = false, html = false } = {}) {
  status.classList.toggle('error', error);
  if (html) status.innerHTML = text;
  else status.textContent = text;
}

function fmtLoc(loc) {
  if (!loc) return 'Your location';
  return 'query' in loc ? loc.query : `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
}

function describe(parsed) {
  switch (parsed.kind) {
    case 'place':
      return parsed.name;
    case 'coords':
      return `${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`;
    case 'search':
      return `“${parsed.query}”`;
    case 'directions':
      return `${fmtLoc(parsed.origin)} → ${fmtLoc(parsed.destination)}`;
    default:
      return '';
  }
}

/** Second line under the place, e.g. "Walking directions in Apple Maps, 2 stops". */
function subtitle(parsed, target) {
  if (parsed.kind === 'coords') return `A dropped pin in ${target}`;
  if (parsed.kind === 'search') return `A search in ${target}`;
  if (parsed.kind !== 'directions') return `in ${target}`;
  const mode = parsed.travelMode ? `${MODES[parsed.travelMode]} directions` : 'Directions';
  const stops = parsed.waypoints.length;
  return `${mode} in ${target}${stops ? `, ${stops} stop${stops > 1 ? 's' : ''}` : ''}`;
}

/** The point a link is about, if it has one. */
function pointOf(parsed) {
  if ((parsed.kind === 'place' || parsed.kind === 'coords') && parsed.lat !== undefined) return parsed;
  if (parsed.kind === 'search' && parsed.near) return parsed.near;
  if (parsed.kind === 'directions' && parsed.destination && 'lat' in parsed.destination) return parsed.destination;
  return null;
}

let mapPoint = null;
let mapWidth = 0;

/** Lay OpenStreetMap tiles under the pin so the link's coordinates sit at the centre. */
function drawMap(point) {
  mapPoint = point;
  map.querySelectorAll('.tile').forEach((t) => t.remove());
  map.hidden = !point;
  mapCredit.hidden = !point;
  if (!point) return;
  const zoom = 16;
  const n = 2 ** zoom;
  const lat = (point.lat * Math.PI) / 180;
  const px = ((point.lng + 180) / 360) * n * 256;
  const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * 256;
  const w = (mapWidth = map.clientWidth || 560);
  const h = map.clientHeight || 220;
  const left = px - w / 2;
  const top = py - h / 2;
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
      if (ty < 0 || ty >= n) continue;
      const img = document.createElement('img');
      img.className = 'tile';
      img.alt = '';
      img.src = `https://tile.openstreetmap.org/${zoom}/${((tx % n) + n) % n}/${ty}.png`;
      img.style.left = `${Math.round(tx * 256 - left)}px`;
      img.style.top = `${Math.round(ty * 256 - top)}px`;
      map.append(img);
    }
  }
}

// Redraw when the card changes width (phone rotation, window resize) so the pin stays centred.
new ResizeObserver(() => {
  if (mapPoint && !map.hidden && map.clientWidth !== mapWidth) drawMap(mapPoint);
}).observe(map);

function errorFor(parsed) {
  switch (parsed.reason) {
    case 'not-a-maps-link':
      return 'That isn’t a Google Maps or Apple Maps link.';
    case 'place-id-requires-lookup':
      return 'This link only has an internal place ID, no name or coordinates. Open it in your browser, then paste the address from the address bar.';
    case 'missing-destination':
      return 'This route has no destination to convert.';
    case 'empty-query':
      return 'This search link is empty.';
    default:
      return null;
  }
}

function showError(text) {
  result.hidden = true;
  setStatus(text, { error: true });
}

async function update({ go = false } = {}) {
  const id = ++run;
  const raw = input.value.trim();
  if (!raw) {
    result.hidden = true;
    setStatus('');
    return;
  }
  const link = extractLink(raw);
  if (!link) return showError('Paste a full link, starting with https://');

  const short = isShortLink(link);
  if (short && !RESOLVER) {
    return showError('Short links can’t be expanded here yet. Open the link in your browser, then paste the full address from the address bar. The iPhone shortcut below handles short links.');
  }
  if (short) setStatus('Expanding the short link…');

  let r;
  try {
    r = await convert(link, { fetch: viaResolver });
  } catch {
    if (id !== run) return;
    return showError('Couldn’t expand this short link. Open it in your browser, then paste the full address from the address bar.');
  }
  if (id !== run) return;

  if (!r.url) {
    const known = errorFor(r.parsed);
    if (known) return showError(known);
    result.hidden = true;
    setStatus(
      `This kind of link isn’t supported yet. <a href="${ISSUES}?title=${encodeURIComponent('Unsupported link')}&body=${encodeURIComponent(link)}">Report it on GitHub</a> and it’ll be added.`,
      { error: true, html: true },
    );
    return;
  }

  if (go) {
    location.replace(r.url);
    return;
  }

  const target = NAMES[r.to];
  $('result-what').textContent = describe(r.parsed);
  $('result-dest').textContent = subtitle(r.parsed, target);
  urlEl.textContent = r.url;
  urlEl.href = openBtn.href = r.url;
  openBtn.textContent = `Open in ${target}`;
  copyBtn.textContent = 'Copy link';

  const legacy = r.to === 'apple' ? toAppleMapsUrl(r.parsed, { format: 'legacy' }) : null;
  note.hidden = !legacy;
  if (legacy) {
    note.replaceChildren('On iOS older than 18.4? Use the ', Object.assign(document.createElement('a'), { href: legacy, textContent: 'classic Apple Maps link' }), '.');
  }

  setStatus('');
  const wasHidden = result.hidden;
  result.hidden = false;
  drawMap(pointOf(r.parsed));
  if (wasHidden) {
    result.classList.remove('arrive');
    void result.offsetWidth;
    result.classList.add('arrive');
  }
}

let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(update, 200);
});
input.addEventListener('paste', () => setTimeout(update, 0));

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(openBtn.href);
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => (copyBtn.textContent = 'Copy link'), 1600);
});

// Paste button: on phones, long-press › Paste in a text field is slower than one tap.
const pasteBtn = $('paste-btn');
if (navigator.clipboard?.readText) {
  pasteBtn.hidden = false;
  pasteBtn.addEventListener('click', async () => {
    try {
      input.value = await navigator.clipboard.readText();
      update();
    } catch {
      input.focus();
    }
  });
}
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    input.blur();
    update();
  }
});

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    input.value = btn.getAttribute('data-example');
    input.scrollLeft = 0;
    update();
  });
}

// Star count next to the GitHub button; the button works without it.
fetch('https://api.github.com/repos/steven-panxd/google-apple-maps-converter')
  .then((res) => (res.ok ? res.json() : null))
  .then((repo) => {
    if (repo && repo.stargazers_count > 0) $('stars').textContent = repo.stargazers_count.toLocaleString('en');
  })
  .catch(() => {});

// ?url=<link> shows just the answer; &go=1 jumps straight to the converted map.
const params = new URLSearchParams(location.search);
if (params.get('url')) {
  input.value = params.get('url');
  update({ go: params.get('go') === '1' });
}
