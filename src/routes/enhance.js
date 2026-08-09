// src/routes/enhance.js
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
  'Analyze this image for quality degradation, noise, exposure imbalance, ' +
  'and blur. Perform intelligent upscale and enhancement: sharpen textures, ' +
  'restore original details, correct colors, balance contrast, and optimize ' +
  'dynamic range while preserving original facial features and natural depth.';

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
    console.error('enhance failed:', err.message);
    return jsonResponse({ error: 'Enhancement failed. Please try again.' }, 502, headers);
  }
}
