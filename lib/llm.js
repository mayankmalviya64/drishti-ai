// lib/llm.js
// One tiny client for free LLM APIs that speak the OpenAI "chat completions" format.
// Order of preference: Groq (fast, free tier) → Google Gemini (free tier).
// Keys live only in server environment variables (never in the browser):
//   GROQ_API_KEY    from https://console.groq.com/keys
//   GEMINI_API_KEY  from https://aistudio.google.com/apikey

// Server keys. In the browser there is no `process`, so this is empty and the
// agents fall back to the built-in rules engine (used when the backend is unreachable).
const ENV = globalThis.process?.env || {};

// prefer: a model name picked on the page; it is tried first.
export function providers(prefer) {
  const list = [];
  if (ENV.GROQ_API_KEY) {
    for (const model of [ENV.GROQ_MODEL || 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']) {
      list.push({ name: 'Groq', model, url: 'https://api.groq.com/openai/v1/chat/completions', key: ENV.GROQ_API_KEY });
    }
  }
  if (ENV.GEMINI_API_KEY) {
    list.push({ name: 'Gemini', model: ENV.GEMINI_MODEL || 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: ENV.GEMINI_API_KEY });
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

// Send one chat request. Tries each provider/model in turn until one answers.
// body: { messages, tools?, json? (true → ask for a JSON object), temperature? }
export async function chat({ messages, tools, json = false, temperature = 0.3, maxTokens = 900, prefer }) {
  const errors = [];
  for (const p of providers(prefer)) {
    try {
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model, messages, temperature, max_tokens: maxTokens,
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${data?.error?.message || ''}`.slice(0, 200));
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error('empty reply');
      // How many tokens this call used, and what the provider says is left (Groq sends these headers)
      const h = name => { const v = res.headers.get(name); return v == null ? null : Number(v); };
      const usage = { tokens: data.usage?.total_tokens || 0, model: p.model, provider: p.name,
        requestsLeftToday: h('x-ratelimit-remaining-requests'), requestsPerDay: h('x-ratelimit-limit-requests'),
        tokensLeftThisMinute: h('x-ratelimit-remaining-tokens'), tokensPerMinute: h('x-ratelimit-limit-tokens') };
      return { message, engine: `${p.name} · ${p.model}`, usage };
    } catch (e) {
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
