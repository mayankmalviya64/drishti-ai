// api/health.js
// GET            → tells the page which AI engine and connectors are switched on.
// GET ?check=1   → pre-demo check: sends one tiny request to every AI model and reports
//                  which ones answer right now (and why the others don't).
import { engineLabel, models, providers, loadBoard, modelBoard } from '../lib/llm.js';
import { json, preflight } from '../lib/http.js';

export const OPTIONS = preflight;

export async function GET(request) {
  await loadBoard();
  const base = { ok: true, engine: engineLabel(), models: models(), board: modelBoard(), slackDefault: !!process.env.SLACK_WEBHOOK_URL,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN, email: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) };
  if (!new URL(request.url).searchParams.has('check')) return json(base);

  // One 1-token request per model, all at once
  const slow = name => new Promise(ok => setTimeout(() => ok({ model: name, ok: false, why: 'no answer in 15s' }), 15000));
  const check = await Promise.all(providers().map(p => Promise.race([slow(`${p.name} · ${p.model}`), (async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(p.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await Promise.race([res.json().catch(() => ({})), new Promise(ok => setTimeout(() => ok({ error: { message: 'reply too slow' } }), 12000))]);
      return { model: `${p.name} · ${p.model}`, ok: res.ok, status: res.status, ms: Date.now() - t0,
        why: res.ok ? 'answering' : String(data?.error?.message || '').slice(0, 220),
        requestsLeftToday: Number(res.headers.get('x-ratelimit-remaining-requests')) || null,
        tokensLeftThisMinute: Number(res.headers.get('x-ratelimit-remaining-tokens')) || null };
    } catch (e) {
      return { model: `${p.name} · ${p.model}`, ok: false, why: e.message };
    }
  })()])));
  // Every model this Groq key may use today (Groq retires models now and then)
  let groqModels = null;
  if (process.env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: AbortSignal.timeout(8000) });
      const body = await Promise.race([r.json(), new Promise(ok => setTimeout(() => ok({}), 8000))]);
      groqModels = (body.data || []).filter(m => m.active !== false).map(m => m.id).sort();
    } catch {}
  }
  return json({ ...base, check, groqModels });
}
