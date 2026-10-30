// api/scenario.js
// POST { text, brand: { name, category, who, channels, regions, campaigns, rivals } }
// Your own condition: reads today's news about what you typed, then the AI drafts a
// scenario for this brand (what changes in the ad data, which rivals, their strategy,
// and how we should respond). Returns { draft, engine?, usage? }.
// The draft is only a set of numbers on the data; the agents, your rules and the
// approval limits still decide every action when it runs.
import { chat, engineLabel, parseJSON } from '../lib/llm.js';
import { searchNews } from '../lib/news.js';
import { cleanDraft, draftLocally, DRAFT_LIMITS } from '../lib/scenarios.js';
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 40000); } catch (e) { return json({ error: e.message }, 400); }
  const text = String(body.text || '').trim().slice(0, 500);
  if (text.length < 8) return json({ error: 'Describe the situation in a sentence or two.' }, 400);
  const brand = body.brand || {};

  // 1) Today's news about it (never fails: an empty list just means no headlines found)
  const news = await searchNews(text, brand.category).catch(() => []);

  // 2) No AI key on this server → keyword draft
  if (!engineLabel()) return json({ draft: draftLocally(text, brand, news) });

  const L = DRAFT_LIMITS;
  try {
    const { message, engine, usage } = await chat({
      json: true, temperature: 0.4, maxTokens: 1400, prefer: body.model ? String(body.model) : undefined,
      messages: [
        { role: 'system', content: `You are the Orchestrator of Drishti AI, an ad-optimisation agent team for Indian D2C brands. A marketer describes a situation in plain words. Using the brand profile and today's headlines, draft a realistic scenario for the next few days and return ONLY a JSON object:
{"label": short name ≤ 6 words,
 "headline": one news-style line,
 "note": 1-2 plain sentences on how it hits this brand's ads and sales,
 "days": how many of the last days it affects (${L.days[0]}-${L.days[1]}),
 "external": true only if it is a market-wide shock (outage, war, lockdown, auction-wide price spike) where big automatic spend moves would be unsafe,
 "effects": up to 4 of {"channel": one of the brand's channels or "", "region": one of the brand's regions or "", "campaign": a word from one of its campaign names or "", "cpm": ad-price multiplier ${L.cpm[0]}-${L.cpm[1]}, "ctr": click-rate multiplier ${L.ctr[0]}-${L.ctr[1]}, "cvr": sale-rate multiplier ${L.cvr[0]}-${L.cvr[1]}, "why": short reason},
 "rivals": up to 3 real competitor brands in this category in India (use names from the headlines or the brand's known rivals when they fit) as {"name", "strategy": what they are doing in this situation, "channel": one of the brand's channels where they push, "campaign": start with the exact theme (text before "·") of one of the brand's campaigns, then " · " and their angle, "engagement": their click rate as a fraction ${L.engagement[0]}-${L.engagement[1]}},
 "moves": 2-4 concrete responses for this brand (₹ amounts, channels, regions, creatives) that respect the marketer's rules and approvals.
Use 1 for "no change". Be specific to India and to this brand. Do not invent headlines; if the news does not mention it, treat it as hypothetical.` },
        { role: 'user', content: `Brand: ${JSON.stringify(brand).slice(0, 4000)}\n\nToday's headlines:\n${news.map(n => `- ${n.title} (${n.source})`).join('\n') || '- none found'}\n\nSituation: ${text}` },
      ],
    });
    const raw = parseJSON(message.content);
    if (!raw) throw new Error('unreadable draft');
    return json({ draft: cleanDraft({ ...raw, text, news, by: engine }, brand), engine, usage });
  } catch (e) {
    // AI busy or confused → still give a usable draft
    return json({ draft: draftLocally(text, brand, news), error: e.message });
  }
}
