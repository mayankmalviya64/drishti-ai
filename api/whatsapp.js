// api/whatsapp.js
// WhatsApp action reports with Approve / Hold / Reject buttons (Meta WhatsApp Cloud API).
//
// Three jobs in one route:
//  1. POST from the page  { to, brand, runId, health, done: [text], waiting: [{ id, agent, title, impact }] }
//       → sends one short summary, then one message with 3 buttons per action that needs you.
//     POST from the page  { to, note }  → sends one short line (e.g. "Approved on the site: …").
//  2. GET ?hub.mode=subscribe…  → Meta's one-time webhook check (echo back the challenge).
//     GET ?run=<runId>          → the page asks "any decisions from WhatsApp yet?"
//  3. POST from Meta (a button was tapped) → saves the decision and replies "✅ Approved: …".
//
// Env on Vercel: WA_TOKEN (access token), WA_PHONE_ID (phone number ID),
// WA_VERIFY_TOKEN (any secret word, also typed into Meta's webhook form),
// WA_APP_SECRET (optional: checks that button taps really come from Meta),
// plus the Redis store from lib/kv.js.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, preflight } from '../lib/http.js';
import { kv, kvReady, pairs } from '../lib/kv.js';

export const OPTIONS = preflight;

const GRAPH = 'https://graph.facebook.com/v21.0';
const DAY2 = 60 * 60 * 48; // keep a run's decisions for 2 days
const VERBS = { a: 'approve', h: 'hold', r: 'reject' };
const SAID = { approve: '✅ Approved', hold: '⏸ On hold', reject: '❌ Rejected' };
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const rupees = n => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);

// Send one WhatsApp message (text or interactive). Returns Meta's answer.
async function send(to, message) {
  const res = await fetch(`${GRAPH}/${process.env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...message }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j;
}
const text = body => ({ type: 'text', text: { body } });

// Explain Meta's errors in plain words for the status line on the page
function why(e) {
  if (e.code === 131047 || /24 hour|re-engagement/i.test(e.message)) return 'window-closed';
  if (e.code === 131030 || /not in allowed list|recipient phone number not/i.test(e.message)) return 'number-not-verified';
  if (e.code === 190) return 'token-expired';
  return cut(e.message || e, 100);
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  // Meta's one-time webhook check
  if (q.get('hub.mode') === 'subscribe') {
    const ok = q.get('hub.verify_token') && q.get('hub.verify_token') === process.env.WA_VERIFY_TOKEN;
    return new Response(ok ? q.get('hub.challenge') : 'forbidden', { status: ok ? 200 : 403 });
  }
  // The page polling for decisions on one run
  const run = q.get('run');
  if (!run || !kvReady()) return json({ decisions: {} });
  try { return json({ decisions: pairs(await kv('HGETALL', `drishti:wa:${run}`)) }); }
  catch { return json({ decisions: {} }); }
}

export async function POST(request) {
  const raw = await request.text();
  if (raw.length > 30000) return json({ error: 'Too large' }, 400);
  let body; try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'Bad JSON' }, 400); }

  // A button tap arriving from Meta
  if (body.object === 'whatsapp_business_account') return fromMeta(request, raw, body);

  // A report from the page
  if (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID) return json({ sent: false, reason: 'not-configured' });
  const to = String(body.to || '').replace(/\D/g, '');
  if (to.length < 10 || to.length > 15) return json({ error: 'Phone number needs the country code, e.g. 91 98765 43210.' }, 400);

  try {
    if (body.note) { await send(to, text(cut(body.note, 500))); return json({ sent: true }); }

    const done = (body.done || []).slice(0, 8), waiting = (body.waiting || []).slice(0, 20);
    // 1) the crisp summary
    const lines = [`*Drishti AI · ${cut(body.brand || 'Brand', 40)}*`];
    if (body.health) lines.push(`Health ${body.health}`);
    if (done.length) lines.push('', `✅ *Done (${(body.doneCount || done.length)})*`, ...done.map(t => `• ${cut(t, 90)}`));
    if (waiting.length) lines.push('', `⏳ *Needs you (${waiting.length})* — tap below`);
    await send(to, text(lines.join('\n')));

    // 2) one message with Approve / Hold / Reject per action (first 5; the rest stay on the site)
    const run = String(body.runId || '').replace(/\W/g, '').slice(0, 24);
    for (const [i, a] of waiting.slice(0, 5).entries()) {
      const head = `${i + 1}/${waiting.length} · ${cut(a.agent || 'Agent', 20)}${a.impact ? ` · ${rupees(a.impact)}/day` : ''}`;
      await send(to, {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `${head}\n${cut(a.title, 300)}` },
          action: { buttons: ['a', 'h', 'r'].map(v => ({ type: 'reply', reply: { id: `${v}:${run}:${a.id}`, title: { a: 'Approve', h: 'Hold', r: 'Reject' }[v] } })) },
        },
      });
      // Remember the title so the confirmation can name the action
      if (kvReady()) { await kv('HSET', `drishti:wa:${run}:titles`, String(a.id), cut(a.title, 120)); await kv('EXPIRE', `drishti:wa:${run}:titles`, DAY2); }
    }
    if (waiting.length > 5) await send(to, text(`+${waiting.length - 5} more waiting on the site.`));
    return json({ sent: true, buttons: Math.min(5, waiting.length), store: kvReady() });
  } catch (e) {
    return json({ sent: false, reason: why(e) });
  }
}

// Meta tells us a button was tapped → save the decision and confirm in the chat
async function fromMeta(request, raw, body) {
  // Optional check that the call really comes from Meta (signed with the app secret)
  const secret = process.env.WA_APP_SECRET;
  if (secret) {
    const sig = request.headers.get('x-hub-signature-256') || '';
    const want = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return json({ error: 'bad signature' }, 401);
  }
  const msgs = body.entry?.flatMap(e => e.changes?.flatMap(c => c.value?.messages || []) || []) || [];
  for (const m of msgs) {
    const id = m.interactive?.button_reply?.id || m.button?.payload || '';
    const [v, run, actionId] = id.split(':');
    if (!VERBS[v] || !run || !actionId) continue;
    const decision = VERBS[v];
    let title = '';
    if (kvReady()) {
      await kv('HSET', `drishti:wa:${run}`, actionId, decision);
      await kv('EXPIRE', `drishti:wa:${run}`, DAY2);
      title = (await kv('HGET', `drishti:wa:${run}:titles`, actionId)) || '';
    }
    try { await send(m.from, text(`${SAID[decision]}${title ? `: ${title}` : ''}`)); } catch {}
  }
  // Meta only needs a quick 200 back
  return json({ ok: true });
}
