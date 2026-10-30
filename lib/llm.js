// lib/llm.js
// One tiny client for free LLM APIs that speak the OpenAI "chat completions" format.
// Order of preference: Groq (fast, free tier) → Google Gemini (free tier).
// Keys live only in server environment variables (never in the browser):
//   GROQ_API_KEY    from https://console.groq.com/keys
//   GEMINI_API_KEY  from https://aistudio.google.com/apikey

// Server keys. In the browser there is no `process`, so this is empty and the
// agents fall back to the built-in rules engine (used when the backend is unreachable).
const ENV = globalThis.process?.env || {};

// Groq's free models each have their OWN rate limits on the same key, so when one is
// busy the next one usually still has room. Best first, smallest last.
// (Checked 30 Oct 2026 with /api/health?check=1: these are the chat models this key can use.
//  Groq retires models now and then; a retired one answers 404 and is skipped automatically.)
const GROQ_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];

// Extra settings per model: keep the hidden "thinking" short so a run uses fewer tokens
const EXTRA = model => /gpt-oss/.test(model) ? { reasoning_effort: 'low' }
  : /qwen/.test(model) ? { reasoning_format: 'hidden' } : {};

// Models that just said "too many requests" (or no longer exist) rest here until the time shown.
// Kept in memory, so it lasts while this server instance is warm.
const coolUntil = new Map();
const cool = (model, seconds) => coolUntil.set(model, Date.now() + seconds * 1000);
const resting = model => (coolUntil.get(model) || 0) > Date.now();

// prefer: a model name picked on the page; it is tried first.
export function providers(prefer) {
  const list = [];
  if (ENV.GROQ_API_KEY) {
    const groq = [...new Set([ENV.GROQ_MODEL || GROQ_MODELS[0], ...GROQ_MODELS])];
    for (const model of groq) {
      list.push({ name: 'Groq', model, url: 'https://api.groq.com/openai/v1/chat/completions', key: ENV.GROQ_API_KEY });
    }
  }
  // Google Gemini: a completely separate company and quota, so it still answers if all of Groq is busy.
  // (gemini-2.5-flash is closed to new keys; these two were checked on 30 Oct 2026, tool calls included.)
  if (ENV.GEMINI_API_KEY) {
    for (const model of [...new Set([ENV.GEMINI_MODEL || 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'])]) {
      list.push({ name: 'Gemini', model, url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: ENV.GEMINI_API_KEY });
    }
  }
  // Put the picked model first (only models we have a key for can be picked)
  const i = prefer ? list.findIndex(p => p.model === prefer) : -1;
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

// Every model the page may offer, for the model picker
export function models() {
  return providers().map(p => ({ id: p.model, label: `${p.name} · ${p.model}` }));
}

// Friendly label for the UI, e.g. "Groq · llama-3.3-70b-versatile"
export function engineLabel(prefer) {
  const p = providers(prefer)[0];
  return p ? `${p.name} · ${p.model}` : null;
}

// How long Groq asks us to wait, from the Retry-After header or "try again in 7.5s"
function waitSeconds(res, text) {
  const h = Number(res.headers.get('retry-after'));
  if (h > 0) return h;
  const m = /try again in ([\d.]+)(ms|s|m)/i.exec(text || '');
  if (!m) return 20;
  return m[2] === 'ms' ? Number(m[1]) / 1000 : m[2] === 'm' ? Number(m[1]) * 60 : Number(m[1]);
}

// Send one chat request. Tries each provider/model in turn until one answers.
// Models that are rate-limited are skipped (and rest for a bit), so the next model answers at once.
// body: { messages, tools?, json? (true → ask for a JSON object), temperature?, deadline? (ms timestamp: give up after) }
export async function chat({ messages, tools, json = false, temperature = 0.3, maxTokens = 900, prefer, deadline }) {
  const errors = [];
  const all = providers(prefer);
  // Rested models first; resting ones only as a last resort
  const order = [...all.filter(p => !resting(p.model)), ...all.filter(p => resting(p.model))];
  for (const p of order) {
    const left = deadline ? deadline - Date.now() : 20000;
    if (left < 2000) { errors.push('out of time'); break; }
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model, messages, temperature, max_tokens: maxTokens, ...(p.name === 'Groq' ? EXTRA(p.model) : { reasoning_effort: 'low' }),
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(Math.min(20000, left)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || '';
        if (res.status === 429) cool(p.model, Math.min(120, waitSeconds(res, msg) + 1));          // busy: rest a little
        else if (res.status === 404 || /decommission|does not exist|not found/i.test(msg)) cool(p.model, 3600); // gone: rest an hour
        throw new Error(`${res.status} ${msg}`.slice(0, 200));
      }
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error('empty reply');
      // How many tokens this call used, and what the provider says is left (Groq sends these headers)
      const h = name => { const v = res.headers.get(name); return v == null ? null : Number(v); };
      const usage = { tokens: data.usage?.total_tokens || 0, model: p.model, provider: p.name,
        requestsLeftToday: h('x-ratelimit-remaining-requests'), requestsPerDay: h('x-ratelimit-limit-requests'),
        tokensLeftThisMinute: h('x-ratelimit-remaining-tokens'), tokensPerMinute: h('x-ratelimit-limit-tokens') };
      return { message, engine: `${p.name} · ${p.model}`, usage };
    } catch (e) {
      if (e.name === 'TimeoutError') cool(p.model, 30); // too slow right now: let the next model answer
      errors.push(`${p.name}/${p.model}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'No AI key configured');
}

// Pull a JSON object out of a reply, even if the model wrapped it in ```json fences.
export function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
