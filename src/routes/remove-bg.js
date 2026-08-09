// src/routes/remove-bg.js
// POST { image: base64String, mimeType: string }
// Returns { image: base64String, mimeType: string }

import {
  corsHeaders,
  jsonResponse,
  enforceOrigin,
  getDeviceHash,
  checkAndIncrementRateLimit,
  validateImageUpload,
} from '../security.js';
import { callGeminiImageEdit } from '../gemini.js';

// HIDDEN PROMPT — never exposed to the client, never accepted as input.
const HIDDEN_PROMPT =
  'Segment and isolate the main foreground subject from this image. ' +
  'Completely remove the background, rendering all non-subject pixels ' +
  'fully transparent (PNG format with alpha channel). Do not introduce ' +
  'color artifacts, blur, or edge distortion around fine details like ' +
  'hair or clothing.';

export async function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(env, request) });
}

export async function handlePost(request, env) {
  const originError = enforceOrigin(env, request);
  if (originError) return originError;

  const headers = corsHeaders(env, request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400, headers);
  }

  const { image, mimeType } = body || {};
  const validationError = validateImageUpload(image?.length, mimeType);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400, headers);
  }

  const deviceHash = await getDeviceHash(request);
  const rateCheck = await checkAndIncrementRateLimit(env, deviceHash);
  if (!rateCheck.allowed) {
    return jsonResponse(
      {
        error: 'Daily processing limit reached. Please try again tomorrow.',
        scope: rateCheck.reason,
      },
      429,
      headers
    );
  }

  try {
    const result = await callGeminiImageEdit(env, image, mimeType, HIDDEN_PROMPT);
    return jsonResponse({ image: result.base64, mimeType: result.mimeType }, 200, headers);
  } catch (err) {
    console.error('remove-bg failed:', err.message);
    return jsonResponse({ error: 'Background removal failed. Please try again.' }, 502, headers);
  }
}
