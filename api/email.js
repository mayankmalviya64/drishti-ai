// api/email.js
// POST { to, subject, lines: [ [label, text], ... ] }
// Emails an action report through Gmail (SMTP) from the server.
// This is the main email route; the browser falls back to FormSubmit, and then to
// a pre-filled "open in your email app" link, if this one is not set up or fails.
// Needs two env vars on Vercel: GMAIL_USER (the sending Gmail address) and
// GMAIL_APP_PASSWORD (a 16-letter Google "App password", not the normal password).
import nodemailer from 'nodemailer';
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function POST(request) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return json({ sent: false, reason: 'not-configured' });

  let body;
  try { body = await readBody(request, 20000); } catch (e) { return json({ error: e.message }, 400); }
  const to = String(body.to || '').trim();
  if (!EMAIL.test(to)) return json({ error: 'Invalid email address.' }, 400);

  // Keep it a Drishti report only (so the route can't be used to send anything else)
  const subject = 'Drishti AI · ' + String(body.subject || 'Action report').replace(/^Drishti AI · /, '').slice(0, 120);
  const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 30)
    .map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 600)]);

  // Plain text + a simple HTML table version of the same report
  const text = lines.map(([k, v]) => `${k}\n${v}`).join('\n\n');
  const html = `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${lines.map(([k, v]) =>
    `<tr><td style="padding:6px 12px;vertical-align:top;font-weight:bold;color:#c2410c">${esc(k)}</td><td style="padding:6px 12px;white-space:pre-line">${esc(v)}</td></tr>`).join('')}</table>`;

  try {
    const mail = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await mail.sendMail({ from: `"Drishti AI" <${user}>`, to, subject, text, html });
    return json({ sent: true, to });
  } catch (e) {
    return json({ sent: false, reason: String(e.message || e).slice(0, 120) });
  }
}
