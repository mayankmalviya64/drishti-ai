# Drishti AI

**See every ad leak before it costs you.** Five AI agents that watch a D2C brand's ads on Facebook, Instagram, Google and OTT/TV, fix what is leaking money within guardrails, ask before big moves, and grade themselves on true (Shopify) revenue.

- Live app: https://drishti-ai-mvp.vercel.app (also served at https://mayankmalviya64.github.io/drishti-ai/, which calls the same backend)
- How it works (story + playground): `story.html`

## Try it in 30 seconds
1. Pick a sample brand (or press **Use your own data**: CSV, Google Sheet, Meta ad account, competitor ads).
2. Put your email address in **Action reports to**, then press **Run the loop**. Read the page clockwise:
   ① data coming in → ② agents at work → ③ observed → recommended → ④ action taken → updated data fed back into ①.
3. Approve or reject the big moves; small ones (and your "flat revenue → hold" rule) run on their own and can be undone. Each action is emailed as a report; decisions can also post to Slack/Discord.
4. Hover any source, agent, card or arrow to see what is flowing through it.

Add a twist (pixel break or market shock) to see the diagnosis change: tracking breaks freeze spend moves; market shocks trigger Storm Mode instead of blaming the agents.

## Architecture
| Part | File | What it does |
|---|---|---|
| App page | `index.html`, `app.css`, `app.js` | 4-quadrant loop (data in → agents → recommendations → actions → fed back), hover cards, threads from each recommendation to its action, email reports via FormSubmit; details below the fold |
| Agent maths | `lib/analyze.js` | P1 data trust, P2 fatigue score, P4 cohorts + competitor check, P5 marginal-ROAS allocation + flat-revenue hold rule, P3 video → TV channel fit, AHI, tiered actions |
| Orchestrator | `lib/agent.js` | LLM tool-calling loop over the five agents; P3 writes regional ad copy + ASCI check; rules-engine fallback |
| LLM client | `lib/llm.js` | Groq (Llama 3.3 70B) → Gemini fallback, OpenAI-compatible |
| Live news | `lib/news.js` | Google News RSS for the "is it us or the world?" shock filter |
| Sample data | `lib/sample.js` | Glowveda (Shreya), Crunchkart (Aarush) and Shyamlal Masale (Mr. Shyamlal) 14-day exports |
| API | `api/run.js` (stream), `api/connect.js` (Sheets, Meta), `api/notify.js` (Slack/Discord), `api/ask.js`, `api/health.js` | Vercel functions |

## Environment variables (Vercel)
- `GROQ_API_KEY`: free key from https://console.groq.com/keys (turns on AI reasoning)
- `GEMINI_API_KEY` (optional fallback): https://aistudio.google.com/apikey
- `SLACK_WEBHOOK_URL` (optional default approvals channel)

Without a key the app still works with the built-in rules engine.

## Local preview
`node scripts/dev-server.mjs` → http://localhost:8790 (add `?run` to auto-run, `&fast` to skip the reading pace). `node scripts/run-local.mjs glowveda [pixel|shock]` runs the agents in the terminal.
