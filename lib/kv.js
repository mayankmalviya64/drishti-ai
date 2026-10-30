// lib/kv.js
// A tiny Redis helper (Upstash, over plain HTTPS, so no extra package is needed).
// Used to remember Telegram button taps between the webhook (Telegram calls it the
// moment someone taps) and the page (which asks for them every second). Vercel
// functions forget everything between calls, so this small store is the shared memory.
// Env: KV_REST_API_URL + KV_REST_API_TOKEN (Vercel's Upstash integration names)
//   or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvReady = () => Boolean(url() && token());

// Run one Redis command, e.g. kv('HSET', 'key', 'field', 'value')
export async function kv(...command) {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// HGETALL comes back as a flat list [field, value, field, value…]; turn it into an object
export const pairs = list => {
  const out = {};
  for (let i = 0; i < (list || []).length; i += 2) out[list[i]] = list[i + 1];
  return out;
};
