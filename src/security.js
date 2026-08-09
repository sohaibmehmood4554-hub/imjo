// functions/_lib/security.js
//
// Shared helpers for the IMGO Cloudflare Pages Functions:
//  - strict CORS enforcement (only ALLOWED_ORIGIN may call the API)
//  - privacy-centric device fingerprint hashing (never store raw IP/UA)
//  - atomic-ish daily rate limiting via KV (per-device + global)
//
// None of this ever touches or logs the Gemini API key. That key is
// read once from env.GEMINI_API_KEY (a Cloudflare secret) inside the
// route handler and attached server-side to the outbound Gemini
// request only.

/** Build the CORS headers for a response, locked to the configured origin. */
export function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '';
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin && origin === allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Reject any request that isn't coming from the allowed origin. */
export function enforceOrigin(env, request) {
  const origin = request.headers.get('Origin') || '';
  if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
    return jsonResponse(
      { error: 'Origin not allowed.' },
      403,
      corsHeaders(env, request)
    );
  }
  return null;
}

/**
 * Derive a stable, non-reversible per-device identifier.
 * Combines Cloudflare's trusted client IP with a client-supplied
 * fingerprint (User-Agent, screen resolution, timezone offset) that
 * the frontend sends as an X-Device-Fingerprint header. We hash
 * everything with SHA-256 immediately — the raw IP/UA/fingerprint is
 * never written to KV or logs, only the resulting digest.
 */
export async function getDeviceHash(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown-ip';
  const ua = request.headers.get('user-agent') || 'unknown-ua';
  const fp = request.headers.get('x-device-fingerprint') || 'unknown-fp';

  const raw = `${ip}::${ua}::${fp}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw)
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

function todayUtcKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Seconds remaining until the next 00:00 UTC boundary, for KV TTL. */
function secondsUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
  );
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/**
 * Check + increment both the per-device and global daily counters.
 * Returns { allowed: boolean, reason?: string }.
 *
 * This isn't perfectly atomic (KV doesn't offer CAS in Workers), but
 * for a 9/day and 999/day cap the race window is small enough that a
 * worst-case off-by-a-few overshoot is an acceptable tradeoff versus
 * pulling in Durable Objects for this. If you need hard exactness,
 * swap this for a Durable Object counter.
 */
export async function checkAndIncrementRateLimit(env, deviceHash) {
  const day = todayUtcKey();
  const ttl = secondsUntilNextUtcMidnight();

  const deviceKey = `device:${day}:${deviceHash}`;
  const globalKey = `global:${day}`;

  const [deviceCountRaw, globalCountRaw] = await Promise.all([
    env.IMGO_RATELIMIT_KV.get(deviceKey),
    env.IMGO_RATELIMIT_KV.get(globalKey),
  ]);

  const deviceCount = parseInt(deviceCountRaw || '0', 10);
  const globalCount = parseInt(globalCountRaw || '0', 10);

  const deviceLimit = parseInt(env.PER_DEVICE_DAILY_LIMIT || '9', 10);
  const globalLimit = parseInt(env.GLOBAL_DAILY_LIMIT || '999', 10);

  if (deviceCount >= deviceLimit) {
    return { allowed: false, reason: 'device' };
  }
  if (globalCount >= globalLimit) {
    return { allowed: false, reason: 'global' };
  }

  await Promise.all([
    env.IMGO_RATELIMIT_KV.put(deviceKey, String(deviceCount + 1), { expirationTtl: ttl }),
    env.IMGO_RATELIMIT_KV.put(globalKey, String(globalCount + 1), { expirationTtl: ttl }),
  ]);

  return { allowed: true };
}

/** Basic server-side guardrails on the uploaded image before we spend a Gemini call on it. */
export function validateImageUpload(base64Length, mimeType) {
  const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BASE64_CHARS = 12_000_000; // ~9MB decoded, generous but bounded

  if (!ALLOWED_MIME.includes(mimeType)) {
    return 'Unsupported image type. Use PNG, JPEG, or WEBP.';
  }
  if (!base64Length || base64Length > MAX_BASE64_CHARS) {
    return 'Image too large or missing.';
  }
  return null;
}
