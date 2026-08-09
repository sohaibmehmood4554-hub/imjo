// src/routes/limits.js
// GET -> { deviceRemaining, globalRemaining, deviceLimit, globalLimit }
// Read-only: does NOT increment any counter.

import { corsHeaders, jsonResponse, enforceOrigin, getDeviceHash } from '../security.js';

function todayUtcKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

export async function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env, request) });
}

export async function handleGet(request, env) {
  const originError = enforceOrigin(env, request);
  if (originError) return originError;

  const headers = corsHeaders(env, request);
  const day = todayUtcKey();
  const deviceHash = await getDeviceHash(request);

  const [deviceCountRaw, globalCountRaw] = await Promise.all([
    env.IMGO_RATELIMIT_KV.get(`device:${day}:${deviceHash}`),
    env.IMGO_RATELIMIT_KV.get(`global:${day}`),
  ]);

  const deviceLimit = parseInt(env.PER_DEVICE_DAILY_LIMIT || '9', 10);
  const globalLimit = parseInt(env.GLOBAL_DAILY_LIMIT || '999', 10);
  const deviceCount = parseInt(deviceCountRaw || '0', 10);
  const globalCount = parseInt(globalCountRaw || '0', 10);

  return jsonResponse(
    {
      deviceRemaining: Math.max(0, deviceLimit - deviceCount),
      globalRemaining: Math.max(0, globalLimit - globalCount),
      deviceLimit,
      globalLimit,
    },
    200,
    headers
  );
}
