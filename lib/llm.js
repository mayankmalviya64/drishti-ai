// lib/llm.js
// One tiny client for free LLM APIs that speak the OpenAI "chat completions" format.
// Order of preference: Groq (fast, free tier) → Google Gemini (free tier).
// Keys live only in server environment variables (never in the browser):
//   GROQ_API_KEY    from https://console.groq.com/keys
//   GEMINI_API_KEY  from https://aistudio.google.com/apikey

import { kv, kvReady, pairs } from './kv.js';

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

// ---------------------------------------------------------------------------
// MODEL BOARD: how many tokens each model has used per call in the past, and what
// the provider last said about its limits. Kept in Upstash (shared by every server
// instance) and cached here for 30 seconds. Used to try the thriftiest model first
// and to skip any model that is about to hit its limit.
// ---------------------------------------------------------------------------
let board = {}, boardAt = 0;
export async function loadBoard() {
  if (!kvReady() || Date.now() - boardAt < 30000) return board;
  boardAt = Date.now();
  try {
    const [stats, limits] = await Promise.all([kv('HGETALL', 'ai:stats'), kv('HGETALL', 'ai:limits')]);
    const next = {};
    // stats fields look like "openai/gpt-oss-20b|tokens" → 41230
    for (const [field, v] of Object.entries(pairs(stats))) {
      const cut = field.lastIndexOf('|');
      (next[field.slice(0, cut)] ||= { calls: 0, tokens: 0 })[field.slice(cut + 1)] = Number(v);
    }
    for (const [model, v] of Object.entries(pairs(limits))) { try { (next[model] ||= { calls: 0, tokens: 0 }).limits = JSON.parse(v); } catch {} }
    board = next;
  } catch {}
  return board;
}
// Average tokens per call so far (a model never used yet counts as 0, so it gets tried and measured)
const avgTokens = model => { const b = board[model]; return b?.calls ? b.tokens / b.calls : 0; };
// Is this model about to hit a limit? Returns the reason, or null.
// Groq tells us after every call: requests left today, and tokens left this minute.
function nearLimit(model, maxTokens = 900) {
  const L = board[model]?.limits; if (!L) return null;
  const now = Date.now();
  if (L.requestsLeftToday != null && now < (L.requestsResetAt || 0)
    && L.requestsLeftToday < Math.max(10, (L.requestsPerDay || 0) * 0.05)) return `only ${L.requestsLeftToday} requests left today`;
  if (L.tokensLeftThisMinute != null && now < (L.tokensResetAt || 0) && L.tokensLeftThisMinute < maxTokens * 3) return `only ${L.tokensLeftThisMinute} tokens left this minute`;
  return null;
}
// Groq's reset times look like "2m59.56s", "7.66s" or "120ms"
function resetMs(text) {
  if (!text) return 0;
  let ms = 0;
  for (const [, n, unit] of String(text).matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[unit];
  return ms;
}
// After each answer: add its tokens to the model's totals and save the latest limits
async function recordUse(p, tokens, res) {
  const h = name => { const v = res.headers.get(name); return v == null ? null : Number(v); };
  const now = Date.now();
  const limits = p.name === 'Groq' ? {
    requestsLeftToday: h('x-ratelimit-remaining-requests'), requestsPerDay: h('x-ratelimit-limit-requests'),
    requestsResetAt: now + resetMs(res.headers.get('x-ratelimit-reset-requests')),
    tokensLeftThisMinute: h('x-ratelimit-remaining-tokens'), tokensPerMinute: h('x-ratelimit-limit-tokens'),
    tokensResetAt: now + resetMs(res.headers.get('x-ratelimit-reset-tokens')), at: now } : null;
  const b = (board[p.model] ||= { calls: 0, tokens: 0 });
  b.calls++; b.tokens += tokens; if (limits) b.limits = limits;
  if (!kvReady()) return;
  await Promise.all([
    kv('HINCRBY', 'ai:stats', `${p.model}|calls`, 1), kv('HINCRBY', 'ai:stats', `${p.model}|tokens`, tokens),
    limits && kv('HSET', 'ai:limits', p.model, JSON.stringify(limits)),
  ]).catch(() => {});
}
// The order chat() will try models in right now, with the reasons (shown on the page)
export function modelBoard(prefer) {
  return rankModels(prefer).map(({ p, why }) => ({ model: p.model, provider: p.name, avgTokens: Math.round(avgTokens(p.model)),
    calls: board[p.model]?.calls || 0, skip: why }));
}
// Thriftiest first (fewest tokens per call in the past). A model picked on the page goes first.
// Models that are resting or near a limit go to the very end: used only if nothing else answers.
function rankModels(prefer, maxTokens) {
  const all = providers().map(p => ({ p, why: resting(p.model) ? 'resting after an error' : nearLimit(p.model, maxTokens) }));
  const ok = all.filter(x => !x.why).sort((a, b) => avgTokens(a.p.model) - avgTokens(b.p.model));
  const i = prefer ? ok.findIndex(x => x.p.model === prefer) : -1;
  if (i > 0) ok.unshift(...ok.splice(i, 1));
  return [...ok, ...all.filter(x => x.why)];
}

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
  // Alternate Groq and Gemini (G1, Gm1, G2, Gm2, …) so trouble at one company jumps straight to the other.
  // qwen has been slow to answer at times, so it goes last.
  const groqs = list.filter(p => p.name === 'Groq' && !/qwen/.test(p.model)), gems = list.filter(p => p.name === 'Gemini');
  const mixed = [];
  for (let k = 0; k < Math.max(groqs.length, gems.length); k++) { if (groqs[k]) mixed.push(groqs[k]); if (gems[k]) mixed.push(gems[k]); }
  list.splice(0, list.length, ...mixed, ...list.filter(p => !mixed.includes(p)));
  // Put the picked model first (only models we have a key for can be picked)
  const i = prefer ? list.findIndex(p => p.model === prefer) : -1;
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
}

// Every model the page may offer, for the model picker
export function models() {
  return providers().map(p => ({ id: p.model, label: `${p.name} · ${p.model}` }));
}

// Friendly label for the UI, e.g. "Groq · openai/gpt-oss-20b" (the model that would be tried first now)
export function engineLabel(prefer) {
  const p = rankModels(prefer)[0]?.p;
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
  await loadBoard();
  // Fewest-tokens model first; resting or nearly-out models only as a last resort
  const order = rankModels(prefer, maxTokens).map(x => x.p);
  for (const p of order) {
    const left = deadline ? deadline - Date.now() : 20000;
    if (left < 2000) { errors.push('out of time'); break; }
    const limit = Math.min(15000, left);
    try {
      // Hard stop: whatever the network does (even a reply that trickles in slowly), give up after `limit`
      const { res, data } = await Promise.race([(async () => {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model, messages, temperature, max_tokens: maxTokens, ...(p.name === 'Groq' ? EXTRA(p.model) : { reasoning_effort: 'low' }),
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(limit),
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
      })(), new Promise((_, no) => setTimeout(() => no(Object.assign(new Error(`no answer in ${limit / 1000}s`), { name: 'TimeoutError' })), limit + 500))]);
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
      await recordUse(p, usage.tokens, res);
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
