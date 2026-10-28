# Drishti AI

**See every ad leak before it costs you.** Five AI agents that watch a D2C brand's ads on Meta, Google and OTT, fix what is leaking money within guardrails, ask before big moves, and grade themselves on true (Shopify) revenue.

- Live app: https://drishti-ai-mvp.vercel.app (also served at https://mayankmalviya64.github.io/drishti-ai/, which calls the same backend)
- How it works (story + playground): `story.html`

## Try it in 30 seconds
1. Pick a sample brand (or upload a CSV, paste a Google Sheet link, or pull a Meta ad account).
2. Press **Run the agents** and watch the Orchestrator call each agent, reason, and decide.
3. Approve or reject the big moves; small ones auto-apply and can be undone. Decisions can post to Slack/Discord.

Add a twist (pixel break or market shock) to see the diagnosis change: tracking breaks freeze spend moves; market shocks trigger Storm Mode instead of blaming the agents.

## Architecture
| Part | File | What it does |
|---|---|---|
| App page | `index.html`, `app.css`, `app.js` | 3 panels: Connect → Agents at work (streamed) → Decisions; details below the fold |
| Agent maths | `lib/analyze.js` | P1 data trust, P2 fatigue score, P4 cohorts, P5 marginal-ROAS allocation, AHI, tiered actions |
| Orchestrator | `lib/agent.js` | LLM tool-calling loop over the five agents; P3 writes regional ad copy + ASCI check; rules-engine fallback |
| LLM client | `lib/llm.js` | Groq (Llama 3.3 70B) → Gemini fallback, OpenAI-compatible |
| Live news | `lib/news.js` | Google News RSS for the "is it us or the world?" shock filter |
| Sample data | `lib/sample.js` | Glowveda (Shreya) and Crunchkart (Aarush) 14-day exports |
| API | `api/run.js` (stream), `api/connect.js` (Sheets, Meta), `api/notify.js` (Slack/Discord), `api/ask.js`, `api/health.js` | Vercel functions |

## Environment variables (Vercel)
- `GROQ_API_KEY`: free key from https://console.groq.com/keys (turns on AI reasoning)
- `GEMINI_API_KEY` (optional fallback): https://aistudio.google.com/apikey
- `SLACK_WEBHOOK_URL` (optional default approvals channel)

Without a key the app still works with the built-in rules engine.

## Local preview
`node scripts/dev-server.mjs` → http://localhost:8790 (add `?run` to auto-run, `&fast` to skip the reading pace). `node scripts/run-local.mjs glowveda [pixel|shock]` runs the agents in the terminal.
