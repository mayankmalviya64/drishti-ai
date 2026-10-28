// api/run.js
// POST { brand, category, rows, orders, breakevenRoas }
// Streams the agents' work as newline-delimited JSON (one event per line),
// so the browser can show each step the moment it happens.
import { runDrishti } from '../lib/agent.js';
import { CORS, json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  let input;
  try { input = await readBody(request); } catch (e) { return json({ error: e.message }, 400); }
  if (!Array.isArray(input.rows) || !input.rows.length) return json({ error: 'No ad rows received.' }, 400);
  if (input.rows.length > 20000) return json({ error: 'Too many rows (max 20,000). Use the last 30 days.' }, 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = event => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        await runDrishti(input, emit);
      } catch (e) {
        emit({ type: 'error', message: e.message || String(e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS } });
}
