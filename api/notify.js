// api/notify.js
// POST { webhook, action, decision, brand }
// Sends an approval request or decision to Slack or Discord (the "approval inbox").
// The webhook is the visitor's own; if none is given, the server's SLACK_WEBHOOK_URL is used.
// Only official Slack / Discord webhook hosts are allowed.
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

const ALLOWED = /^https:\/\/(hooks\.slack\.com\/services\/|(discord|discordapp)\.com\/api\/webhooks\/)/;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 20000); } catch (e) { return json({ error: e.message }, 400); }
  const hook = body.webhook || process.env.SLACK_WEBHOOK_URL;
  if (!hook) return json({ sent: false, reason: 'no-webhook' });
  if (!ALLOWED.test(hook)) return json({ error: 'Only Slack or Discord webhook URLs are allowed.' }, 400);

  const a = body.action || {};
  const verb = { approve: '✅ Approved', reject: '❌ Rejected', request: '🟡 Approval needed', undo: '↩️ Rolled back' }[body.decision] || 'ℹ️ Update';
  const text = `*Drishti AI · ${body.brand || 'Brand'}*\n${verb}: ${a.title || ''}\n${a.detail || ''}${a.impact ? `\nImpact: ₹${Number(a.impact).toLocaleString('en-IN')}/day` : ''}\nAgent: ${a.agent || ''} · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
  const isDiscord = /discord/.test(hook);
  const res = await fetch(hook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isDiscord ? { content: text.replace(/\*/g, '**') } : { text }),
    signal: AbortSignal.timeout(8000),
  });
  return json({ sent: res.ok, status: res.status, to: isDiscord ? 'Discord' : 'Slack' });
}
