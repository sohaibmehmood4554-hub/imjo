// functions/_lib/gemini.js
//
// Thin wrapper around the Gemini image ("Nano Banana") generateContent
// endpoint. The hidden prompts live ONLY here, server-side, and are
// never sent to or derivable by the client. The API key is read from
// env.GEMINI_API_KEY (a Cloudflare secret) and attached to the
// outbound request only — it is never echoed back in any response.

const GEMINI_MODEL = 'gemini-2.5-flash-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * @param {object} env - Pages Functions environment (must have GEMINI_API_KEY secret)
 * @param {string} base64Image - raw base64 image data (no data: prefix)
 * @param {string} mimeType - e.g. 'image/png'
 * @param {string} hiddenPrompt - the fixed backend instruction, never client-supplied
 * @returns {Promise<{mimeType: string, base64: string}>}
 */
export async function callGeminiImageEdit(env, base64Image, mimeType, hiddenPrompt) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Server misconfiguration: GEMINI_API_KEY secret is not set.');
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: hiddenPrompt },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // Deliberately don't leak upstream response body (could contain
    // request echoes) to the client — log server-side only.
    console.error('Gemini API error', res.status, await res.text().catch(() => ''));
    throw new Error(`Gemini request failed with status ${res.status}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inline_data || p.inlineData);
  const inline = imagePart?.inline_data || imagePart?.inlineData;

  if (!inline?.data) {
    throw new Error('Gemini did not return image data.');
  }

  return {
    mimeType: inline.mime_type || inline.mimeType || 'image/png',
    base64: inline.data,
  };
}
