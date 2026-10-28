// lib/llm.js
// One tiny client for free LLM APIs that speak the OpenAI "chat completions" format.
// Order of preference: Groq (fast, free tier) → Google Gemini (free tier).
// Keys live only in server environment variables (never in the browser):
//   GROQ_API_KEY    from https://console.groq.com/keys
//   GEMINI_API_KEY  from https://aistudio.google.com/apikey

export function providers() {
  const list = [];
  if (process.env.GROQ_API_KEY) {
    for (const model of [process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']) {
      list.push({ name: 'Groq', model, url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY });
    }
  }
  if (process.env.GEMINI_API_KEY) {
    list.push({ name: 'Gemini', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: process.env.GEMINI_API_KEY });
  }
  return list;
}

// Friendly label for the UI, e.g. "Groq · llama-3.3-70b-versatile"
export function engineLabel() {
  const p = providers()[0];
  return p ? `${p.name} · ${p.model}` : null;
}

// Send one chat request. Tries each provider/model in turn until one answers.
// body: { messages, tools?, json? (true → ask for a JSON object), temperature? }
export async function chat({ messages, tools, json = false, temperature = 0.3, maxTokens = 900 }) {
  const errors = [];
  for (const p of providers()) {
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
      return { message, engine: `${p.name} · ${p.model}` };
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
