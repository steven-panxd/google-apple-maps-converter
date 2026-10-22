/**
 * Short-link expander for the web converter.
 * GET /resolve?url=https://maps.app.goo.gl/abc → { "url": "https://www.google.com/maps/place/..." }
 * Only Google and Apple map short links are accepted, so this can't be used as an open proxy.
 */
import { isShortLink, resolveShortLink } from '../src/index.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

/** @param {unknown} body @param {number} status @param {Record<string, string>} [headers] */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
  });
}

export default {
  /** @param {Request} request @param {unknown} env @param {ExecutionContext} ctx */
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const { pathname, searchParams } = new URL(request.url);
    if (pathname !== '/resolve') return json({ error: 'Not found' }, 404);

    const target = searchParams.get('url')?.trim();
    if (!target || !isShortLink(target)) {
      return json({ error: 'Pass a Google or Apple Maps short link as ?url=' }, 400);
    }

    // Short links are immutable, so cache the answer at the edge.
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.internal/resolve?url=${encodeURIComponent(target)}`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      const url = await resolveShortLink(target, { signal: AbortSignal.timeout(8000) });
      const response = json({ url }, 200, { 'cache-control': 'public, max-age=86400' });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch {
      return json({ error: 'Could not expand this short link' }, 502);
    }
  },
};
