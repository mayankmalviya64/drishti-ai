// lib/http.js
// Small helpers shared by the API routes: CORS (so the GitHub Pages copy of the
// site can call this backend too) and JSON responses.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// Answer the browser's CORS "preflight" check.
export const preflight = () => new Response(null, { status: 204, headers: CORS });

// Read a JSON body safely, with a size limit (protects the free function from huge uploads).
export async function readBody(request, maxBytes = 4_000_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Upload too large (max ~4 MB). Trim to the last 30 days.');
  return text ? JSON.parse(text) : {};
}
