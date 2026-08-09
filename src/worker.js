// src/worker.js
// Single Worker entrypoint (Cloudflare's current "Workers with static
// assets" model — replaces the legacy Pages Functions `functions/`
// convention, which only `wrangler pages deploy` understands).
//
// Routing: /api/* is handled here; everything else is served straight
// from the ASSETS binding (the public/ directory), including
// public/_headers and 404 handling.

import * as removeBg from './routes/remove-bg.js';
import * as enhance from './routes/enhance.js';
import * as limits from './routes/limits.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/remove-bg') {
      if (request.method === 'OPTIONS') return removeBg.handleOptions(request, env);
      if (request.method === 'POST') return removeBg.handlePost(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/enhance') {
      if (request.method === 'OPTIONS') return enhance.handleOptions(request, env);
      if (request.method === 'POST') return enhance.handlePost(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/limits') {
      if (request.method === 'OPTIONS') return limits.handleOptions(request, env);
      if (request.method === 'GET') return limits.handleGet(request, env);
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Everything else: serve the static site from public/.
    return env.ASSETS.fetch(request);
  },
};
