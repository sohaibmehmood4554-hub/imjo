# IMGO

AI background remover + AI image enhancer, plus five client-side canvas
tools (crop/resize, format converter, compressor, watermark, filters).
A single Cloudflare Worker serves the static frontend and the `/api/*`
routes together (Cloudflare's current "Workers with static assets"
model). No user accounts.

Deploys to **imgo.smtoolskit.com**, built from this repo via GitHub
integration in the Cloudflare dashboard (Workers & Pages → Create →
Import a repository).

> Earlier drafts of this project used the older Pages Functions
> (`functions/` directory) layout. That layout only deploys correctly
> with `wrangler pages deploy`, and Cloudflare's Git-integration build
> step now runs `wrangler deploy` by default whenever it sees a
> `wrangler.jsonc`. This repo uses the newer unified Worker + assets
> layout instead, so `wrangler deploy` — the command Cloudflare's build
> step actually runs — works out of the box.

## How it's structured

```
public/                  → static site (served via the ASSETS binding)
  index.html
  css/style.css
  js/app.js
  _headers                → CSP + security headers (still honored under assets)
src/
  worker.js                → single entrypoint: routes /api/*, else serves ASSETS
  routes/
    remove-bg.js             → POST, calls Gemini with the hidden bg-removal prompt
    enhance.js                 → POST, calls Gemini with the hidden enhancement prompt
    limits.js                    → GET, read-only quota check for the UI
  security.js                     → CORS, device-hash rate limiting, upload validation
  gemini.js                         → Gemini API caller (key never leaves the Worker)
wrangler.jsonc
```

The two hidden prompts live **only** in `src/routes/remove-bg.js` and
`src/routes/enhance.js`. The client never sends, sees, or can override
them — it only sends the image bytes.

## One-time setup

1. **Create the KV namespace**
   ```
   npx wrangler kv namespace create IMGO_RATELIMIT_KV
   ```
   Copy the returned `id` into `wrangler.jsonc`. If you also want isolated
   counters for preview deployments, create a second namespace and set
   `preview_id` too.

2. **Set the Gemini API key as a secret** (never as a `vars` entry —
   `vars` end up readable in the dashboard and in `wrangler.jsonc`; a
   secret does not):
   ```
   npx wrangler secret put GEMINI_API_KEY
   ```
   If you're setting it up before the first deploy, you can also add it
   from the dashboard: Worker → Settings → Variables and Secrets.

3. **Connect the GitHub repo** in the Cloudflare dashboard under
   Workers & Pages → Create → Import a repository. No build command is
   needed — this is plain HTML/CSS/JS with no bundler step, and
   `wrangler deploy` reads `wrangler.jsonc` directly.

4. **Add the custom domain** `imgo.smtoolskit.com` under the Worker's
   Domains & Routes tab, and confirm `ALLOWED_ORIGIN` in
   `wrangler.jsonc` matches it exactly (including `https://`).

5. **Local dev**: copy `.dev.vars.example` to `.dev.vars`, fill in a
   real key, then `npm install && npm run dev`.

## Security notes

- `src/security.js` rejects any request whose `Origin` header doesn't
  match `ALLOWED_ORIGIN`, so the API can't be called from other sites
  even though it's a public endpoint. Note this only fires on requests
  that actually carry an `Origin` header (all cross-origin calls, and
  same-origin `fetch()` calls in modern browsers) — it's a defense
  layer, not the only one.
- The device identifier is a SHA-256 hash of `cf-connecting-ip` +
  User-Agent + a client-supplied fingerprint header — the raw values are
  never written to KV or logs, only the digest.
- Rate limiting is best-effort (KV has no compare-and-swap), which is a
  reasonable tradeoff at 9/day and 999/day. If you need exact counts,
  swap `checkAndIncrementRateLimit` for a Durable Object.
- `_headers` sets a Content-Security-Policy scoped to just this site,
  Google Fonts, and the one ad domain — tighten `script-src`/`frame-src`
  further if you drop the ad network later.

## Before you go live — please verify

- **Gemini model name**: `src/gemini.js` targets
  `gemini-2.5-flash-image` (Google's "Nano Banana" image model as of
  early 2026). Model IDs get renamed/deprecated — check
  [ai.google.dev](https://ai.google.dev) for the current image-generation
  model name and endpoint shape before deploying, and update the
  `GEMINI_MODEL` constant if it's changed.
- **Ad script domain**: the ad unit points at `grannyreproof.com`. Cloudflare
  and browsers increasingly flag unfamiliar ad-network domains — confirm
  this is still the network you intend to use before launch, since a
  dead or blocklisted ad domain will just show as broken iframes in the
  three placements (processing modal, upload dropzones, result modal).
