// api/telegram.js
// Telegram action reports with Approve / Hold / Reject buttons (free Telegram Bot API).
//
// Three jobs in one route:
//  1. POST from the page  { chat, brand, runId, health, role, undo, done: [{ id, title }], waiting: [{ id, agent, title, impact, act }] }
//       `undo: true` (the Director) → the "Done" list comes with an ↩ Undo button per action.
//       → sends one short summary, then one message with 3 buttons per action this person may decide.
//       The page sends one POST per team member. `act: false` means their role can't decide that
//       action (e.g. an Intern, or a Manager on a move above their limit), so it is listed without buttons.
//     POST from the page  { chat, note } → sends one short line (e.g. "Approved on the site: …").
//  2. GET ?link=<code>  → the visitor opened t.me/<bot>?start=<code>; we find their chat and return its id.
//  3. GET ?run=<runId>&open=1,2,3&team=<chat>,<chat>&done=4,5&directors=<chat> → "any buttons tapped, and by whom?"
//       Only taps from the chats listed in `team` (people whose role can decide) count.
//       Undo taps on done actions count only from `directors`; they come back as `undos`.
//  4. GET ?phone=<chatId> → did this chat tap "Share my number"? (so the site can show the number)
//
// Two ways of hearing about taps:
//  • With Upstash connected (KV_REST_API_URL/TOKEN): Telegram calls this route itself the moment
//    someone taps (a "webhook", set up automatically). We check their role, answer the tap, edit the
//    message and save the decision in Upstash, so taps work even when the Drishti page is closed.
//    The page then just reads the saved decisions.
//  • Without Upstash: no webhook, so Telegram keeps new messages and taps for us, and we read them
//    with getUpdates whenever the page asks (only works while a Drishti page is open).
//
// Env on Vercel: TELEGRAM_BOT_TOKEN (from @BotFather), optional KV_REST_API_URL + KV_REST_API_TOKEN.
import { createHash } from 'node:crypto';
import { json, preflight } from '../lib/http.js';
import { kv, kvReady, pairs } from '../lib/kv.js';

export const OPTIONS = preflight;

const VERBS = { a: 'approve', h: 'hold', r: 'reject', u: 'undo' };
const SAID = { approve: '✅ Approved', hold: '⏸ On hold', reject: '❌ Rejected', undo: '↩ Undone' };
const KEEP_SECONDS = 30 * 60; // the page listens for taps for 30 minutes, so keep updates that long
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const rupees = n => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(1)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`);
// Telegram's HTML mode needs these three characters escaped
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Call one Telegram Bot API method. Throws with Telegram's error code if it fails.
async function tg(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (!j.ok) throw Object.assign(new Error(j.description || 'Telegram error'), { code: j.error_code });
  return j.result;
}
const say = (chat, html, extra = {}) => tg('sendMessage', { chat_id: chat, text: html, parse_mode: 'HTML', ...extra });

// Explain Telegram's errors in plain words for the status line on the page
function why(e) {
  if (e.code === 401 || e.code === 404) return 'not-configured';
  if (e.code === 403) return 'blocked';            // the visitor stopped / blocked the bot
  if (e.code === 400 && /chat not found/i.test(e.message)) return 'not-linked';
  return cut(e.message || e, 100);
}

// Read the messages and button taps Telegram is holding for us.
// Updates older than 30 minutes are confirmed (Telegram then forgets them), so the list stays short.
async function updates() {
  const list = await tg('getUpdates', { timeout: 0, limit: 100, allowed_updates: ['message', 'callback_query'] });
  const now = Date.now() / 1000;
  const date = u => u.message?.date ?? u.callback_query?.message?.date ?? 0;
  const old = list.filter(u => now - date(u) > KEEP_SECONDS);
  if (old.length) await tg('getUpdates', { offset: old.at(-1).update_id + 1, limit: 1, timeout: 0 }).catch(() => {});
  return list.filter(u => now - date(u) <= KEEP_SECONDS);
}

const at = () => new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const answer = (cb, text, alert = false) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: alert }).catch(() => {});
const LINKED = '✅ <b>Linked to Drishti AI.</b>\nAction reports will arrive here, with Approve / Hold / Reject buttons for the big moves.\n\nWant your number shown on the site? Tap the button below (optional).';
const SHARE_KB = { reply_markup: { keyboard: [[{ text: '📱 Share my number', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
const DAY = 24 * 60 * 60;

// A secret Telegram sends back with every webhook call, so nobody else can fake taps.
// Made from the bot token, so there is no extra setting to manage.
const hookSecret = () => createHash('sha256').update('drishti-hook:' + process.env.TELEGRAM_BOT_TOKEN).digest('hex').slice(0, 48);

// Point Telegram's webhook at this route when Upstash is connected (or remove it when not).
// Checked once per server start; only the production site may claim the webhook.
let hookChecked = null;
function ensureHook(request) {
  if (process.env.VERCEL_ENV !== 'production') return Promise.resolve();
  hookChecked ||= (async () => {
    const want = kvReady() ? `https://${request.headers.get('host')}/api/telegram` : '';
    const info = await tg('getWebhookInfo');
    if (info.url === want) return;
    if (want) await tg('setWebhook', { url: want, secret_token: hookSecret(), allowed_updates: ['message', 'callback_query'] });
    else await tg('deleteWebhook'); // back to getUpdates mode
  })().catch(() => { hookChecked = null; }); // try again next time
  return hookChecked;
}

// Handle one button tap. `who` knows what the tapper may do and who decided before:
//   who.name           → "Mayank (Director)"
//   who.mayUndo(id)    → may this person undo this done action?
//   who.mayDecide(id)  → may this person Approve / Hold / Reject this action?
//   who.decided(id)    → the decision already taken on it, if any
//   who.save(kind,id,d)→ remember the new decision (kind 'dec' or 'undo'); false if someone beat them to it
async function handleTap(cb, run, who) {
  const [v, , id] = (cb.data || '').split(':');
  const name = who.name;
  if (v === 'u') {
    // ↩ Undo on an action the agents already carried out: Directors only
    if (!who.mayUndo(id)) return answer(cb, 'Only the Director can undo actions.', true);
    if (!(await who.save('undo', id, { by: String(cb.message.chat.id), name, at: Date.now() }))) return answer(cb, 'Already undone.');
    await answer(cb, `${SAID.undo} by ${name}`);
    // Confirm in the chat which action was undone ("↩ Undo 3" → line "3. …" of the summary)
    const btn = (cb.message.reply_markup?.inline_keyboard || []).flat().find(b => b.callback_data === cb.data);
    const n = /\d+/.exec(btn?.text || '')?.[0];
    const line = n ? (cb.message.text || '').split('\n').find(l => l.startsWith(`${n}. `)) : '';
    await say(cb.message.chat.id, `<b>↩ Undone by ${esc(name)}</b> · ${at()}${line ? `\n${esc(line.replace(/^\d+\.\s*/, ''))}` : ''}`,
      { reply_to_message_id: cb.message.message_id }).catch(() => {});
    // Take the tapped Undo button off the message, so it can't be pressed twice
    const kb = (cb.message.reply_markup?.inline_keyboard || []).map(row => row.filter(b => b.callback_data !== cb.data)).filter(row => row.length);
    await tg('editMessageReplyMarkup', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(() => {});
    return;
  }
  // Someone whose role doesn't allow this (e.g. an Intern, or a Manager on a move above their limit)
  if (!who.mayDecide(id)) return answer(cb, 'Your role on this team can only view this action.', true);
  // Approve / Reject are final: the first one wins. Hold can still be followed by a final decision.
  const before = await who.decided(id);
  if (before && before.act !== 'hold') return answer(cb, `Already decided by ${before.name}.`, true);
  if (before && v === 'h') return answer(cb, `Already on hold (${before.name}).`);
  await who.save('dec', id, { act: VERBS[v], by: String(cb.message.chat.id), name, at: Date.now() });
  // Stop the button's spinner (with a toast) and write the decision, the person and their role under the message.
  // Approve / Reject remove the buttons; Hold keeps Approve and Reject for later.
  await answer(cb, `${SAID[VERBS[v]]} by ${name}`);
  await tg('editMessageText', {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id, parse_mode: 'HTML',
    text: `${esc(cb.message.text)}\n\n<b>${SAID[VERBS[v]]} by ${esc(name)}</b> · ${at()}`,
    ...(v === 'h' ? { reply_markup: { inline_keyboard: [[
      { text: '✅ Approve', callback_data: `a:${run}:${id}` }, { text: '❌ Reject', callback_data: `r:${run}:${id}` }]] } } : {}),
  }).catch(() => {});
}

// Webhook: Telegram sends us one update (a message or a button tap) the moment it happens.
async function onUpdate(u) {
  const msg = u.message;
  // Someone opened the invite link → remember their chat for the page, and greet them
  const code = /^\/start (\w{1,32})$/.exec(msg?.text || '')?.[1];
  if (code) {
    await kv('SET', `tg:link:${code}`, JSON.stringify({ chat: String(msg.chat.id), name: msg.from?.first_name || msg.chat.title || 'you' }), 'EX', 900);
    await say(msg.chat.id, LINKED, SHARE_KB);
    return;
  }
  // They shared their OWN number (not a forwarded contact)
  if (msg?.contact && msg.contact.user_id === msg.from?.id) {
    await kv('SET', `tg:phone:${msg.chat.id}`, msg.contact.phone_number.replace(/[^\d+]/g, ''), 'EX', DAY);
    await say(msg.chat.id, '👍 Number saved on the Drishti site.', { reply_markup: { remove_keyboard: true } });
    return;
  }
  const cb = u.callback_query;
  if (!cb?.message) return;
  const [v, run, id] = (cb.data || '').split(':');
  if (!VERBS[v] || !run || !id) return answer(cb, '');
  // What this chat was allowed to do, saved when their report was sent
  let me = null; try { me = JSON.parse(await kv('HGET', `tg:ctx:${run}`, String(cb.message.chat.id))); } catch {}
  if (!me) return answer(cb, 'This report has expired or was not sent to you. Run the agent again for fresh buttons.', true);
  await handleTap(cb, run, {
    name: me.name || cb.from?.first_name || 'Someone',
    mayUndo: x => me.undo && me.done.includes(x),
    mayDecide: x => me.acts.includes(x),
    decided: async x => { try { return JSON.parse(await kv('HGET', `tg:dec:${run}`, x)); } catch { return null; } },
    // Undo: only the first tap counts (HSETNX = "set only if not set yet")
    save: async (kind, x, d) => {
      const ok = kind === 'undo' ? await kv('HSETNX', `tg:undo:${run}`, x, JSON.stringify(d)) : await kv('HSET', `tg:dec:${run}`, x, JSON.stringify(d));
      await kv('EXPIRE', `tg:${kind}:${run}`, DAY);
      return kind !== 'undo' || ok === 1;
    },
  });
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (!process.env.TELEGRAM_BOT_TOKEN) return json({ reason: 'not-configured' });
  try {
    await ensureHook(request);
    // With Upstash, the webhook already did the work: just read what it saved
    if (kvReady()) {
      const code = (q.get('link') || '').replace(/\W/g, '').slice(0, 32);
      if (code) { const hit = await kv('GET', `tg:link:${code}`); return json(hit ? { linked: true, ...JSON.parse(hit) } : { linked: false }); }
      const phoneChat = (q.get('phone') || '').replace(/[^\d-]/g, '').slice(0, 20);
      if (phoneChat) { const phone = await kv('GET', `tg:phone:${phoneChat}`); return json(phone ? { phone } : {}); }
      const run = (q.get('run') || '').replace(/\W/g, '').slice(0, 24);
      if (!run) return json({ decisions: {} });
      const parse = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.parse(v)]));
      const [dec, und] = await Promise.all([kv('HGETALL', `tg:dec:${run}`), kv('HGETALL', `tg:undo:${run}`)]);
      return json({ decisions: parse(pairs(dec)), undos: parse(pairs(und)), instant: true });
    }

    // 2) Linking: look for "/start <code>" sent by the visitor, then greet them
    const code = (q.get('link') || '').replace(/\W/g, '').slice(0, 32);
    if (code) {
      const hit = (await updates()).find(u => u.message?.text === `/start ${code}`);
      if (!hit) return json({ linked: false });
      const { chat, from } = hit.message;
      // Telegram never tells bots your number by itself, so offer a one-tap "Share my number" button
      await say(chat.id, LINKED, SHARE_KB);
      return json({ linked: true, chat: String(chat.id), name: from?.first_name || chat.title || 'you' });
    }

    // 4) Phone: the visitor shared their own contact card with the bot
    const phoneChat = (q.get('phone') || '').replace(/[^\d-]/g, '').slice(0, 20);
    if (phoneChat) {
      const hit = (await updates()).find(u => String(u.message?.chat?.id) === phoneChat && u.message?.contact
        && u.message.contact.user_id === u.message.from?.id); // only their OWN number, not a forwarded contact
      if (!hit) return json({});
      await say(phoneChat, '👍 Number saved on the Drishti site.', { reply_markup: { remove_keyboard: true } }).catch(() => {});
      return json({ phone: hit.message.contact.phone_number.replace(/[^\d+]/g, '') });
    }

    // 3) Decisions: button taps for this run's still-open actions
    const run = (q.get('run') || '').replace(/\W/g, '').slice(0, 24);
    const open = new Set((q.get('open') || '').split(',').filter(Boolean));
    // Chats allowed to decide. Missing = old page version, so anyone who got buttons counts.
    const team = q.has('team') ? new Set(q.get('team').split(',').filter(Boolean)) : null;
    if (!run) return json({ decisions: {} });
    const decisions = {}, undos = {};
    const doneIds = new Set((q.get('done') || '').split(',').filter(Boolean));
    const directors = new Set((q.get('directors') || '').split(',').filter(Boolean));
    const held = new Set((q.get('held') || '').split(',').filter(Boolean)); // already on hold on the site: don't redo the Hold
    // Who is who, from the page: { chatId: "Mayank (Director)" }, so every decision names the person and their role
    let names = {}; try { names = JSON.parse(q.get('names') || '{}'); } catch {}
    const label = cb => names[String(cb.from?.id)] || names[String(cb.message.chat.id)] || cb.from?.first_name || 'Someone';
    const allowed = (set, cb) => set.has(String(cb.from?.id ?? cb.message.chat.id)) || set.has(String(cb.message.chat.id));
    for (const u of await updates()) {
      const cb = u.callback_query;
      const [v, r, id] = (cb?.data || '').split(':');
      if (!VERBS[v] || r !== run) continue;
      if (v === 'u' ? !doneIds.has(id) || undos[id] : !open.has(id)) continue;
      // Already on hold on the site: count the Hold without redoing it
      if (v === 'h' && held.has(id)) { decisions[id] ||= { act: 'hold', by: String(cb.message.chat.id), name: label(cb) }; continue; }
      await handleTap(cb, run, {
        name: label(cb),
        mayUndo: () => allowed(directors, cb),
        mayDecide: () => !team || allowed(team, cb),
        decided: async x => decisions[x],
        save: async (kind, x, d) => { (kind === 'undo' ? undos : decisions)[x] = d; return true; },
      });
    }
    return json({ decisions, undos });
  } catch (e) {
    return json({ decisions: {}, undos: {}, reason: why(e) });
  }
}

export async function POST(request) {
  const raw = await request.text();
  if (raw.length > 30000) return json({ error: 'Too large' }, 400);
  let body; try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'Bad JSON' }, 400); }

  if (!process.env.TELEGRAM_BOT_TOKEN) return json({ sent: false, reason: 'not-configured' });
  // Telegram's own webhook call (it carries our secret). Always answer 200, or Telegram keeps retrying.
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (secret) {
    if (secret !== hookSecret() || !kvReady()) return json({ ok: false }, 403);
    try { await onUpdate(body); } catch {}
    return json({ ok: true });
  }
  await ensureHook(request);
  const chat = String(body.chat || '');
  if (!/^-?\d{1,20}$/.test(chat)) return json({ sent: false, reason: 'not-linked' });

  try {
    if (body.note) { await say(chat, esc(cut(body.note, 500))); return json({ sent: true }); }

    const done = (body.done || []).slice(0, 8), waiting = (body.waiting || []).slice(0, 8);
    // 1) the crisp summary
    // Actions this person may decide get buttons; the rest are only listed (for their information)
    const mine = waiting.filter(a => a.act !== false), others = waiting.filter(a => a.act === false);
    const lines = [`<b>Drishti AI · ${esc(cut(body.brand || 'Brand', 40))}</b>`];
    if (body.role) lines.push(`Your role: ${esc(cut(body.role, 60))}`);
    if (body.health) lines.push(`Health ${esc(body.health)}`);
    // done items: { id, title } (older pages send plain text)
    const doneText = d => (typeof d === 'string' ? d : d.title);
    const canUndo = body.undo && done.some(d => d.id != null);
    if (done.length) lines.push('', `✅ <b>Done (${body.doneCount || done.length})</b>${canUndo ? ', tap ↩ to undo any' : ''}`,
      ...done.map((d, i) => `${canUndo ? `${i + 1}.` : '•'} ${esc(cut(doneText(d), 120))}`));
    if (mine.length) lines.push('', `⏳ <b>Needs you (${mine.length})</b>, tap below`);
    if (others.length) lines.push('', `👀 <b>Waiting for someone else (${others.length})</b>`,
      ...others.map(a => `• ${esc(cut(a.title, 120))}${a.impact ? ` · ${rupees(a.impact)}/day` : ''}${a.who ? ` · ${esc(cut(a.who, 40))}` : ''}`));
    const run = String(body.runId || '').replace(/\W/g, '').slice(0, 24);
    // Remember what this person may do on this run, so the webhook can check their taps with the page closed
    if (kvReady() && run) {
      const ctx = { name: body.name ? `${cut(body.name, 40)}${body.role ? ` (${cut(body.role, 30)})` : ''}` : '', acts: mine.map(a => String(a.id)),
        undo: Boolean(body.undo), done: done.filter(d => d.id != null).map(d => String(d.id)) };
      await kv('HSET', `tg:ctx:${run}`, chat, JSON.stringify(ctx)).catch(() => {});
      await kv('EXPIRE', `tg:ctx:${run}`, DAY).catch(() => {});
    }
    // The Director gets "↩ Undo 1", "↩ Undo 2"… under the summary, three per row
    const undoKb = [];
    if (canUndo) done.forEach((d, i) => { if (i % 3 === 0) undoKb.push([]); undoKb.at(-1).push({ text: `↩ Undo ${i + 1}`, callback_data: `u:${run}:${d.id}` }); });
    await say(chat, lines.join('\n'), undoKb.length ? { reply_markup: { inline_keyboard: undoKb } } : {});

    // 2) one message with Approve / Hold / Reject per action
    for (const [i, a] of mine.entries()) {
      const head = `${i + 1}/${mine.length} · ${esc(cut(a.agent || 'Agent', 20))}${a.impact ? ` · ${rupees(a.impact)}/day` : ''}`;
      await say(chat, `<b>${head}</b>\n${esc(cut(a.title, 600))}`, {
        reply_markup: { inline_keyboard: [[
          { text: '✅ Approve', callback_data: `a:${run}:${a.id}` },
          { text: '⏸ Hold', callback_data: `h:${run}:${a.id}` },
          { text: '❌ Reject', callback_data: `r:${run}:${a.id}` },
        ]] },
      });
    }
    return json({ sent: true, buttons: mine.length + (canUndo ? done.length : 0) });
  } catch (e) {
    return json({ sent: false, reason: why(e) });
  }
}
