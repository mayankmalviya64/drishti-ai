// api/situation.js
// "Run on this situation": you type a real or hypothetical situation in plain words,
// and the Orchestrator answers it for the brand on screen.
//
// POST { text, brand, facts, model }            → first answer (JSON card)
// POST { text, brand, facts, sources, history, question, model } → follow-up chat reply
//
// facts   = numbered numbers from the brand's latest run, sent by the page:
//           [{ id: 'D1', label: 'True ROAS (Shopify orders ÷ ad spend)', value: '3.25' }, ...]
// sources = the list returned by the first answer (data + news), sent back for chat
//
// Every claim must point to a source id ([D1] = Drishti data, [N1] = a news article).
// Anything the AI had to guess goes in "assumptions" and is shown as "Assumed" when
// no source backs it, so you always see what is fact and what is a guess.
import { chat, engineLabel, parseJSON } from '../lib/llm.js';
import { searchNews } from '../lib/news.js';
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

// The rules the AI must follow, shared by the first answer and the chat
const RULES = `You are the Orchestrator of Drishti AI, a team of ad-optimisation agents for an Indian D2C brand (P1 Signal checks tracking and true ROAS from Shopify orders, P2 Fatigue Sentinel, P3 Creative Studio, P4 Cohort Optimizer, P5 Budget Allocator).
A marketer describes a situation (real or hypothetical). Answer it for THIS brand using the numbered sources.
Citation rules:
- Cite sources inline with their ids in square brackets, e.g. [D3] or [N1]. Only use ids from the list.
- Never invent numbers, articles or links. If a number is not in the sources, say it is an assumption.
- When the situation leaves details out, assume sensible values for an Indian D2C brand and say so clearly.
- Assumptions must be about details the situation and the data do NOT give, with a concrete value where it matters
  (e.g. return/RTO rate, COD cancellations, discounts, GST, product and shipping cost, fixed costs, agency fees,
  which channels or regions are hit, how long it lasts). Do not list facts from the sources as assumptions.
- Take the situation seriously even if the data seems to disagree: explain what could make it true and how to check it.
Action rules:
- "doNow" = safe moves the agents can do right away on their own (small budget trims, pausing tired ads, drafting creatives, fixing tracking, pulling reports).
- "needsYou" = anything that needs a human: big budget moves, pricing, stopping a whole channel, talking to a boss, finance or a partner, or anything risky or irreversible.
Use ₹ and plain English. Be specific to the brand's channels, regions and campaigns.`;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 80000); } catch (e) { return json({ error: e.message }, 400); }
  const text = String(body.text || '').trim().slice(0, 800);
  if (text.length < 8) return json({ error: 'Describe the situation in a sentence or two.' }, 400);
  if (!engineLabel()) return json({ error: 'AI engine is not switched on for this server.' }, 503);
  const brand = body.brand || {};
  const facts = Array.isArray(body.facts) ? body.facts.slice(0, 40) : [];
  const prefer = body.model ? String(body.model) : undefined;

  // ---- Follow-up chat: same sources, the conversation so far, one new question ----
  if (body.question) {
    const sources = Array.isArray(body.sources) ? body.sources.slice(0, 50) : [];
    const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 3000) }));
    try {
      const { message, engine, usage } = await chat({
        temperature: 0.3, maxTokens: 700, prefer,
        messages: [
          { role: 'system', content: `${RULES}\nYou are now in a follow-up chat about the situation. Reply in at most 8 short lines or bullets. When the marketer asks what to do, split it into "Agent does now:" and "Needs you:". Mark guesses with "(assumed)".` },
          { role: 'user', content: `Brand: ${JSON.stringify(brand).slice(0, 3000)}\n\nSources:\n${listSources(sources)}\n\nSituation: ${text}` },
          ...history,
          { role: 'user', content: String(body.question).slice(0, 600) },
        ],
      });
      return json({ answer: message.content, engine, usage });
    } catch (e) {
      return json({ error: 'The AI engine is busy right now (free-tier limit). Please try again in a minute.', detail: e.message }, 503);
    }
  }

  // ---- First answer ----
  // 1) Today's news about the situation (never fails: empty list = no headlines found)
  const news = await searchNews(text, brand.category).catch(() => []);
  // 2) One numbered list of sources: Drishti's own data first, then the news
  const sources = [
    ...facts.map(f => ({ id: String(f.id), kind: 'data', title: `${f.label}: ${f.value}` })),
    ...news.map((n, i) => ({ id: `N${i + 1}`, kind: 'news', title: n.title, source: n.source, link: n.link, date: n.date })),
  ];
  try {
    const { message, engine, usage } = await chat({
      json: true, temperature: 0.35, maxTokens: 2300, prefer,
      messages: [
        { role: 'system', content: `${RULES}
Return ONLY a JSON object:
{"title": short name for the situation ≤ 7 words,
 "real": true if the news sources show it is really happening, false if hypothetical,
 "answer": 2-4 sentences that directly answer the marketer, with citations,
 "assumptions": 3-5 of {"text": what you assumed because it was not given, "cite": [ids that support it, or [] if it is a pure guess]},
 "findings": 2-5 of {"text": what the brand's numbers say about this situation, "cite": [ids]},
 "doNow": 2-4 of {"action": concrete move, "why": short reason, "cite": [ids]},
 "needsYou": 1-4 of {"action": decision for the human, "why": short reason, "cite": [ids]},
 "leadership": exactly 5 of {"if": a short trigger in simple English (what happens or what we find), "then": what we will do, in simple English with ₹ or % where useful} — written for senior leaders with no ad jargon (say "return on ad spend" not "ROAS"), each line under 25 words, ordered from most to least important,
 "followUps": 3 short follow-up questions the marketer might ask next}` },
        { role: 'user', content: `Brand: ${JSON.stringify(brand).slice(0, 3000)}\n\nSources:\n${listSources(sources)}\n\nSituation: ${text}` },
      ],
    });
    const raw = parseJSON(message.content);
    if (!raw) throw new Error('unreadable answer');
    return json({ result: clean(raw, sources), sources, engine, usage });
  } catch (e) {
    // The page builds its own answer from the run's numbers when this fails
    return json({ error: e.message, sources }, 503);
  }
}

// "D1 · True ROAS: 3.25" lines for the prompt
function listSources(sources) {
  return sources.map(s => `[${s.id}] ${s.kind === 'news' ? `News (${s.source || 'web'}${s.date ? ', ' + s.date : ''}): ` : 'Drishti data: '}${s.title}`).join('\n') || '- none';
}

// Keep only well-formed fields, drop citations to ids that do not exist
function clean(r, sources) {
  const ids = new Set(sources.map(s => s.id));
  const str = (v, n = 400) => String(v ?? '').slice(0, n);
  const cites = c => (Array.isArray(c) ? c : []).map(String).filter(id => ids.has(id)).slice(0, 4);
  const list = (arr, max, map) => (Array.isArray(arr) ? arr : []).slice(0, max).map(map).filter(x => Object.values(x).some(v => v && v.length));
  return {
    title: str(r.title, 80) || 'Your situation',
    real: !!r.real && sources.some(s => s.kind === 'news'),
    answer: str(r.answer, 900),
    assumptions: list(r.assumptions, 5, a => ({ text: str(a.text ?? a), cite: cites(a.cite) })),
    findings: list(r.findings, 5, a => ({ text: str(a.text ?? a), cite: cites(a.cite) })),
    doNow: list(r.doNow, 4, a => ({ action: str(a.action ?? a), why: str(a.why, 240), cite: cites(a.cite) })),
    needsYou: list(r.needsYou, 4, a => ({ action: str(a.action ?? a), why: str(a.why, 240), cite: cites(a.cite) })),
    // 5 "If this happens → we will do this" lines for leadership
    leadership: list(r.leadership, 5, a => ({ if: str(a.if ?? a.when, 200), then: str(a.then ?? a.do ?? a, 260) })),
    followUps: (Array.isArray(r.followUps) ? r.followUps : []).slice(0, 3).map(q => str(q, 120)).filter(Boolean),
  };
}
