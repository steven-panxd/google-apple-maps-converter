import { convert, isShortLink, toAppleMapsUrl } from './lib/index.js';

// Short-link expander (worker/). Short links can't be expanded from a web page because of CORS.
// Empty until the worker is deployed; short links then ask the user for the full link.
const RESOLVER = '';
const ISSUES = 'https://github.com/steven-panxd/google-apple-maps-converter/issues/new';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const input = /** @type {HTMLTextAreaElement} */ ($('link'));
const status = $('status');
const result = $('result');
const openBtn = /** @type {HTMLAnchorElement} */ ($('open'));
const urlEl = /** @type {HTMLAnchorElement} */ ($('result-url'));
const copyBtn = $('copy');
const note = $('result-note');

const NAMES = { apple: 'Apple Maps', google: 'Google Maps' };
const MODES = { driving: 'Driving', walking: 'Walking', transit: 'Transit', bicycling: 'Cycling' };

let run = 0;

/** Pull the first map link out of pasted text like "Meet here: https://maps.app.goo.gl/abc". */
function extractLink(text) {
  const m =
    text.match(/(?:https?:\/\/|maps:\/*|comgooglemaps:\/\/)[^\s<>"']+/i) ??
    text.match(/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple(?:\.com)?\/|(?:www\.)?google\.[a-z.]+\/maps)[^\s<>"']*/i);
  if (!m) return null;
  const link = m[0].replace(/[.,;!?)]+$/, '');
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
  if (!loc) return 'your location';
  return 'query' in loc ? loc.query : `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
}

function describe(parsed) {
  switch (parsed.kind) {
    case 'place':
      return parsed.address ? `${parsed.name}, ${parsed.address}` : parsed.name;
    case 'coords':
      return `Pin at ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`;
    case 'search':
      return parsed.near ? `Search for “${parsed.query}” in the same area` : `Search for “${parsed.query}”`;
    case 'directions': {
      const stops = parsed.waypoints.length;
      const mode = parsed.travelMode ? `${MODES[parsed.travelMode]} directions` : 'Directions';
      const via = stops ? `, ${stops} stop${stops > 1 ? 's' : ''}` : '';
      return `${mode} from ${fmtLoc(parsed.origin)} to ${fmtLoc(parsed.destination)}${via}`;
    }
    default:
      return '';
  }
}

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
    return showError('Short links can’t be expanded here yet. Open the link in your browser, then paste the full address from the address bar.');
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
  $('result-dest').textContent = target;
  $('result-what').textContent = describe(r.parsed);
  urlEl.textContent = r.url;
  urlEl.href = openBtn.href = r.url;
  openBtn.textContent = `Open in ${target}`;
  copyBtn.textContent = 'Copy link';

  const legacy = r.to === 'apple' ? toAppleMapsUrl(r.parsed, { format: 'legacy' }) : null;
  note.hidden = !legacy;
  if (legacy) {
    note.innerHTML = '';
    note.append('On iOS older than 18.4? Use the ');
    const a = Object.assign(document.createElement('a'), { href: legacy, textContent: 'classic Apple Maps link' });
    a.style.color = 'inherit';
    note.append(a, '.');
  }

  setStatus(`${NAMES[r.from]} link detected${short ? ', short link expanded' : ''}.`);
  const wasHidden = result.hidden;
  result.hidden = false;
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

const pasteBtn = $('paste');
if (navigator.clipboard?.readText) {
  pasteBtn.addEventListener('click', async () => {
    try {
      input.value = await navigator.clipboard.readText();
      update();
    } catch {
      input.focus();
    }
  });
} else {
  pasteBtn.hidden = true;
}

for (const btn of document.querySelectorAll('[data-example]')) {
  btn.addEventListener('click', () => {
    input.value = btn.getAttribute('data-example');
    update();
  });
}

// ?url=<link> pre-fills the converter; &go=1 jumps straight to the converted map.
const params = new URLSearchParams(location.search);
if (params.get('url')) {
  input.value = params.get('url');
  update({ go: params.get('go') === '1' });
}
