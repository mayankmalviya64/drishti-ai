// api/ask.js
// POST { question, context } → the Orchestrator answers a follow-up question
// about the run the visitor just watched (context = the run's key results).
import { chat, engineLabel } from '../lib/llm.js';
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 60000); } catch (e) { return json({ error: e.message }, 400); }
  const q = String(body.question || '').slice(0, 500);
  if (!q) return json({ error: 'Ask a question.' }, 400);
  if (!engineLabel()) return json({ answer: 'Follow-up questions need the AI engine, which is not switched on for this deployment yet. Every number above comes from the agents\' formulas, so you can still trace each decision.' });
  try {
    const { message, engine, usage } = await chat({
      temperature: 0.3, maxTokens: 450,
      messages: [
        { role: 'system', content: 'You are the Orchestrator of Drishti AI, a team of five ad-optimisation agents (P1 Signal, P2 Fatigue Sentinel, P3 Creative Studio, P4 Cohort Optimizer, P5 Budget Allocator). Answer the marketer\'s question using ONLY the run results (and what-if scenario comparisons, if given). Be concise (max 5 sentences), concrete, use ₹ and the numbers. If something is not in the results, say so.' },
        { role: 'user', content: `Run results (JSON): ${JSON.stringify(body.context || {}).slice(0, 12000)}\n\nQuestion: ${q}` },
      ],
    });
    return json({ answer: message.content, engine, usage });
  } catch (e) {
    return json({ answer: 'The AI engine is busy right now (free-tier limit). Please try again in a minute.', error: e.message });
  }
}
