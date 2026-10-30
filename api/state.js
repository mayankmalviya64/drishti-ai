// api/state.js
// One shared copy of the site's saved data, so every device opens the same thing:
// runs per brand, the audit log, custom conditions, AI usage log, rules, team, settings.
// GET  → { savedAt, keys: { 'drishti-saved-runs': '…', … } }  (or {} if nothing saved yet)
// POST { savedAt, keys } → stores it (newest wins).
// Kept in Upstash (the same small store Telegram uses).
import { kv, kvReady } from '../lib/kv.js';
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;
const KEY = 'site:state';

export async function GET() {
  if (!kvReady()) return json({ off: true });
  try { return json(JSON.parse((await kv('GET', KEY)) || '{}')); }
  catch (e) { return json({ error: e.message }, 500); }
}

export async function POST(request) {
  if (!kvReady()) return json({ off: true });
  let body;
  try { body = await readBody(request, 3_000_000); } catch (e) { return json({ error: e.message }, 400); }
  if (!body.keys || typeof body.keys !== 'object') return json({ error: 'nothing to save' }, 400);
  // Only the site's own keys, as text
  const keys = Object.fromEntries(Object.entries(body.keys).filter(([k, v]) => /^drishti-[a-z-]+$/.test(k) && typeof v === 'string'));
  try {
    // Never overwrite a newer copy with an older one (e.g. a device that was offline for a while)
    const now = JSON.parse((await kv('GET', KEY)) || '{}');
    if ((now.savedAt || 0) > (body.savedAt || 0)) return json({ ok: false, stale: true, savedAt: now.savedAt });
    await kv('SET', KEY, JSON.stringify({ savedAt: body.savedAt || Date.now(), keys }));
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}
