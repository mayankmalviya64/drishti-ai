// api/health.js
// GET → tells the page which AI engine and connectors are switched on.
import { engineLabel, models } from '../lib/llm.js';
import { json, preflight } from '../lib/http.js';

export const OPTIONS = preflight;

export function GET() {
  return json({ ok: true, engine: engineLabel(), models: models(), slackDefault: !!process.env.SLACK_WEBHOOK_URL });
}
