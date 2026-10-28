// app.js — the live Drishti AI app in the browser.
// The page is one loop, read clockwise:
//   ① Data coming in   → every source (ad channels, Shopify, competitors, news, calendar)
//   ② Agents at work   → the AI Orchestrator streams each agent's reasoning from /api/run
//   ③ Observed → Recommended → what each agent saw, and what it suggests
//   ④ Action taken     → the agent carries it out (small moves) or waits for Approve (big ones),
//                         an action report is emailed, and the changed data flows back into ①.
// Hovering anything shows what is flowing through it (one shared hover card, see TIPS).
import { makeSample, toCSV } from './lib/sample.js';
import { cleanRows, cleanOrders, cleanCompetitors, EVENTS } from './lib/analyze.js';

// When the page is opened from GitHub Pages, talk to the Vercel backend.
const API = location.hostname.endsWith('github.io') ? 'https://drishti-ai-mvp.vercel.app' : '';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ₹ in Indian style: ₹2.3 L, ₹1.1 Cr
function inr(n) {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

// The six agents shown in quadrant ② (matches the deck), with what each one does,
// for the hover card.
const AGENTS = [
  { id: 'ORC', icon: '🧭', name: 'Orchestrator', role: 'Shock filter',
    job: 'Decides which agent to call next. Before anyone acts, it checks whether a drop is the market (news, CPM spikes, festivals) rather than our ads.',
    reads: 'Live news, auction prices, sale calendar' },
  { id: 'P1', icon: '📡', name: 'Signal', role: 'Data trust',
    job: 'Joins what ad platforms claim with real Shopify orders to get TRUE ROAS, and spots broken tracking. If trust drops below 60, nothing runs on its own.',
    reads: 'Ad rows + Shopify orders' },
  { id: 'P2', icon: '🔥', name: 'Fatigue', role: 'Sentinel',
    job: 'Scores every ad 0–100 against its own first days (CTR, how often people saw it, CPM) and pauses ads that have worn out.',
    reads: 'Daily CTR, frequency, CPM per ad' },
  { id: 'P3', icon: '🎨', name: 'Creative', role: 'Studio',
    job: 'Writes replacement ads in English and regional languages, checks them against ASCI rules, and moves videos to the channel they suit (phone feed → TV).',
    reads: 'Tired ads, regions, video results per channel' },
  { id: 'P4', icon: '🎯', name: 'Cohort', role: 'Optimizer',
    job: 'Finds city and audience pockets that lose money, and compares our ads with competitors’ ads. Trims, narrows or shifts spend.',
    reads: 'Spend × region, competitor ads' },
  { id: 'P5', icon: '⚖️', name: 'Budget', role: 'Allocator',
    job: 'Moves tomorrow’s rupee to the channel with the best next-rupee return, paces for festivals, and enforces your “flat revenue → hold” rule.',
    reads: 'True revenue curves, your rule, calendar' },
];
const agent = id => AGENTS.find(a => a.id === id) || { name: id };
const agentName = id => agent(id).name;

// Everything the page knows right now
const state = {
  data: null,        // the loaded data (raw rows + cleaned copies for display)
  result: null,      // the last /api/run result
  audit: [],         // audit log lines
  running: false,
  engine: null,      // AI engine name from /api/health
  agentLog: {},      // what each agent said on this run (for its hover card)
  updates: {},       // source name → lines of data that changed after actions ("fed back")
  mail: {},          // action id → email status text
  loop: 0,           // how many times the loop has run
};

// Safe localStorage (some browsers block it)
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ?fast in the link skips the reading pace (used for quick testing).
const FAST = new URLSearchParams(location.search).has('fast');
const wait = ms => sleep(FAST ? 0 : ms);

// ---------------------------------------------------------------------------
// Theme toggle (light by default)
// ---------------------------------------------------------------------------
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  store.set('drishti-theme', dark ? 'dark' : 'light');
  syncThemeBtn();
};
syncThemeBtn();

// ---------------------------------------------------------------------------
// CONTROLS + loading data
// ---------------------------------------------------------------------------
// "Use your own data" opens the drawer with CSV / Sheet / Meta / Settings
$('#ownBtn').onclick = () => {
  const open = $('#ownData').hidden;
  $('#ownData').hidden = !open;
  $('#ownBtn').setAttribute('aria-expanded', String(open));
};
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
});

function setStatus(text, kind = 'ok') {
  const el = $('#dataStatus');
  el.className = 'data-status ' + kind;
  el.innerHTML = text;
}

// Keep raw rows (sent to the server as they are) plus cleaned copies for the hover glimpses.
function setData(d) {
  state.data = { ...d, clean: cleanRows(d.rows), cleanOrders: cleanOrders(d.orders || []), cleanComp: cleanCompetitors(d.competitors || []) };
  state.updates = {};
  setStatus(describe(state.data));
  renderSources();
}

// Summarise loaded data in one line, e.g. "490 rows · 14 days · Facebook, Google · Shopify orders ✓"
function describe(d) {
  const dates = [...new Set(d.clean.map(r => r.date))];
  const ch = [...new Set(d.clean.map(r => r.channel))];
  return `<b>${esc(d.brand)}</b> · ${d.rows.length} rows · ${dates.length} days · ${esc(ch.join(', '))} · ${d.orders?.length ? 'Shopify orders ✓' : '<span style="color:var(--amber)">no orders file (ROAS estimated)</span>'}${d.competitors?.length ? ' · competitor ads ✓' : ''}`;
}

function loadSample() {
  const brand = $('input[name=brand]:checked').value;
  const s = makeSample(brand, { twists: { pixelBreak: $('#twistPixel').checked, marketShock: $('#twistShock').checked } });
  setData({ ...s, source: 'Sample' });
}
$$('input[name=brand], #twistPixel, #twistShock').forEach(el => el.onchange = loadSample);

// Minimal CSV parser (handles quotes, commas inside quotes, BOM, \r\n)
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// CSV templates = the Glowveda sample, so people can see the expected columns
(function makeTemplates() {
  const s = makeSample('glowveda');
  const url = text => URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  $('#tplAds').href = url(toCSV(s.rows));
  $('#tplOrders').href = url(toCSV(s.orders));
  $('#tplComp').href = url(toCSV(s.competitors));
})();

async function readFiles() {
  const fa = $('#fileAds').files[0], fo = $('#fileOrders').files[0], fc = $('#fileComp').files[0];
  if (!fa) return;
  try {
    const rows = parseCSV(await fa.text());
    const orders = fo ? parseCSV(await fo.text()) : [];
    const competitors = fc ? parseCSV(await fc.text()) : [];
    if (!rows.length) throw new Error('The ad file has no rows.');
    setData({ brand: fa.name.replace(/\.csv$/i, ''), category: 'consumer products', rows, orders, competitors, source: 'CSV' });
  } catch (e) { setStatus('Could not read the file: ' + esc(e.message), 'err'); }
}
$('#fileAds').onchange = readFiles;
$('#fileOrders').onchange = readFiles;
$('#fileComp').onchange = readFiles;

async function connect(body) {
  const res = await fetch(API + '/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

$('#loadSheet').onclick = async () => {
  const a = $('#sheetAds').value.trim(), o = $('#sheetOrders').value.trim();
  if (!a) return setStatus('Paste the ads sheet link first.', 'err');
  setStatus('Reading Google Sheet…', '');
  try {
    const rows = parseCSV((await connect({ type: 'sheet', url: a })).csv);
    const orders = o ? parseCSV((await connect({ type: 'sheet', url: o })).csv) : [];
    setData({ brand: 'Your brand (Google Sheet)', category: 'consumer products', rows, orders, source: 'Google Sheets' });
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

$('#loadMeta').onclick = async () => {
  const token = $('#metaToken').value.trim(), account = $('#metaAccount').value.trim();
  if (!token || !account) return setStatus('Meta needs a token and an ad account ID.', 'err');
  setStatus('Pulling from the Meta Marketing API…', '');
  try {
    const { rows } = await connect({ type: 'meta', token, account });
    setData({ brand: 'Your Meta account', category: 'consumer products', rows, orders: [], source: 'Meta Ads API' });
    setStatus(describe(state.data) + '<br><small>Tip: add a Shopify orders CSV in "Upload CSV" for true ROAS.</small>');
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

// Settings remembered on this device only
const remember = (sel, key) => {
  const saved = store.get(key);
  if (saved !== null) $(sel).value = saved;
  $(sel).addEventListener('change', e => store.set(key, e.target.value.trim()));
};
remember('#webhook', 'drishti-webhook');
remember('#email', 'drishti-email');
remember('#flatDays', 'drishti-flat-days');

// Ask the backend which AI engine is on (Groq / Gemini / rules)
fetch(API + '/api/health').then(r => r.json()).then(h => { state.engine = h.engine; $('#engine').textContent = h.engine; }).catch(() => {});

// ---------------------------------------------------------------------------
// ① DATA COMING IN: one tile per source, hover to peek at the rows
// ---------------------------------------------------------------------------
const ICONS = { Facebook: '📘', Instagram: '📸', Meta: '♾️', Google: '🔎', JioHotstar: '📺' };

// The list of sources for the loaded data. Each has a name (used to route
// "fed back" updates to the right tile), an icon and a one-line summary.
function sourceList() {
  const d = state.data; if (!d) return [];
  const last = [...new Set(d.clean.map(r => r.date))].sort().slice(-1)[0];
  const channels = [...new Set(d.clean.map(r => r.channel))];
  const list = channels.map(ch => {
    const today = d.clean.filter(r => r.channel === ch && r.date === last);
    const ads = new Set(d.clean.filter(r => r.channel === ch).map(r => r.ad));
    return { key: ch, icon: ICONS[ch] || '📊', name: ch === 'JioHotstar' ? 'JioHotstar · TV' : ch + ' Ads',
      sub: `${ads.size} ad${ads.size > 1 ? 's' : ''} · ${inr(today.reduce((s, r) => s + r.spend, 0))}/day`, on: true };
  });
  list.push({ key: 'Shopify', icon: '🛍️', name: 'Shopify orders', on: d.cleanOrders.length > 0,
    sub: d.cleanOrders.length ? `${Math.round(d.cleanOrders.filter(o => o.date === last).reduce((s, o) => s + o.orders, 0)).toLocaleString('en-IN')} orders yesterday` : 'not connected · ROAS estimated' });
  list.push({ key: 'Competitors', icon: '🕵️', name: 'Competitor ads', on: d.cleanComp.length > 0,
    sub: d.cleanComp.length ? `${new Set(d.cleanComp.map(c => c.competitor)).size} rivals · Ad Library` : 'not connected' });
  list.push({ key: 'News', icon: '📰', name: 'Live news', on: true, sub: 'Google News · read each run' });
  list.push({ key: 'Calendar', icon: '📅', name: 'India sale calendar', on: true, sub: nextEvent() });
  return list;
}

function nextEvent() {
  const now = Date.now();
  const e = EVENTS.map(x => ({ ...x, in: Math.round((new Date(x.date + 'T00:00:00Z') - now) / 864e5) })).find(x => x.in >= 0);
  return e ? `${e.name} in ${e.in} days` : 'festive dates';
}

function renderSources() {
  const list = sourceList();
  $('#srcCount').textContent = `${list.filter(s => s.on).length} sources · hover to peek`;
  $('#sources').innerHTML = list.map(s => {
    const upd = (state.updates[s.key] || [])[0];
    return `<div class="src ${s.on ? '' : 'off'}" id="src-${s.key.replace(/\W/g, '')}" data-tip="src" data-key="${esc(s.key)}" tabindex="0">
      <span class="ic">${s.icon}</span><b>${esc(s.name)}</b><small>${esc(s.sub)}</small>
      ${upd ? `<span class="upd">↺ ${esc(upd)}</span>` : ''}<span class="stream"></span></div>`;
  }).join('');
}

// Data streaming in: dots move along each source tile while the loop reads it.
function setFlowing(on) { $$('.src:not(.off)').forEach(el => el.classList.toggle('flowing', on)); }

// ---------------------------------------------------------------------------
// The loop's stage: highlights the active quadrant and animates the arrows
// ---------------------------------------------------------------------------
function stage(n, label) {
  ['#q1', '#q2', '#q3', '#q4'].forEach((s, i) => $(s).closest('.q, .lower').classList.toggle('active', i + 1 === n || (n >= 3 && i >= 2)));
  $('#flow12').classList.toggle('on', n === 1 || n === 2);
  $('#flow23').classList.toggle('on', n === 3);
  $('#hub').classList.toggle('running', state.running);
  if (label) $('#hubIn').innerHTML = label;
}

// ---------------------------------------------------------------------------
// ② AGENTS AT WORK (streamed)
// ---------------------------------------------------------------------------
function renderStrip() {
  $('#agentStrip').innerHTML = AGENTS.map(a =>
    `<div class="agent-node" id="node-${a.id}" style="--c:var(--${a.id})" data-tip="agent" data-id="${a.id}" tabindex="0"><div class="dot">${a.icon}</div><b>${a.name}</b>${a.role}</div>`).join('');
}
renderStrip();

function setNode(id, status) {
  const n = $('#node-' + id); if (!n) return;
  n.classList.remove('working', 'done', 'alert');
  n.classList.add(status);
}

function addFeed(html, cls, agentId) {
  const feed = $('#feed');
  const div = document.createElement('div');
  div.className = 'ev ' + (cls || '');
  div.style.setProperty('--c', `var(--${agentId || 'ORC'})`);
  div.innerHTML = html;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return div;
}

// Events arrive faster than people can read, so show them at a readable pace.
const PACE = { thought: 650, working: 500, done: 750, alert: 750 };

async function showEvent(e) {
  if (e.type === 'start') {
    $('#engine').textContent = e.engine;
    addFeed(`<span class="tag">RUN</span><span class="txt">Loop ${state.loop} for <b>${esc(e.brand)}</b>: ${e.period.days} days of data (${e.period.from} → ${e.period.to}), ${esc(e.totals.channels.join(', '))}, ${inr(e.totals.spend)} spend.</span>`, '', 'ORC');
    stage(2, '<b>② Agents</b><small>thinking…</small>');
    await wait(400);
  } else if (e.type === 'thought') {
    addFeed(`<span class="tag">thinks</span><span class="txt">${esc(e.text)}</span>`, 'thought');
    (state.agentLog.ORC ||= []).push(e.text);
    await wait(PACE.thought);
  } else if (e.type === 'agent') {
    setNode(e.agent, e.status);
    if (e.status === 'working') {
      state.workingEl = addFeed(`<span class="tag">${esc(agentName(e.agent))}</span><span class="txt typing">${esc(e.text)}</span>`, 'working', e.agent);
      await wait(PACE.working);
    } else {
      if (state.workingEl) state.workingEl.remove();
      (state.agentLog[e.agent] ||= []).push(e.text);
      addFeed(`<span class="tag">${esc(agentName(e.agent))}</span><span class="txt">${e.status === 'alert' ? '<b>⚠</b> ' : ''}${esc(e.text)}</span>`, e.status, e.agent);
      await wait(PACE[e.status] || 600);
    }
  } else if (e.type === 'result') {
    state.result = e;
    const nAuto = e.actions.filter(a => a.tier === 'auto').length, nAsk = e.actions.filter(a => a.tier === 'approval').length;
    addFeed(`<span class="tag">Done</span><span class="txt">Finished${e.seconds >= 1 ? ` in ${e.seconds}s` : ''}. ${e.actions.length} recommendations: ${nAuto} carried out now, ${nAsk} wait for you ↓</span>`, 'final', 'P5');
    renderResults(e);
    renderDetails(e);
    await playActions(e);
  } else if (e.type === 'error') {
    addFeed(`<span class="tag">Error</span><span class="txt">${esc(e.message)}</span>`, 'alert', 'P2');
  }
}

async function run() {
  if (state.running) return;
  if (!state.data?.rows?.length) { $('#ownData').hidden = false; return setStatus('Load some data first.', 'err'); }
  state.running = true; state.loop++;
  state.agentLog = {}; state.mail = {};
  const btn = $('#runBtn');
  btn.disabled = true; btn.classList.remove('idle'); btn.textContent = 'Loop running…';
  $('#feed').innerHTML = '';
  renderStrip();
  $('#rows').innerHTML = '';
  $('#actCount').textContent = ''; $('#statusPill').textContent = ''; $('#statusPill').className = 'pill';

  // ① Data comes in first
  stage(1, '<b>① Data</b><small>reading…</small>');
  setFlowing(true);
  await wait(900);

  const queue = []; let finished = false;
  // Reader: pulls lines off the network stream into a queue
  const reader = (async () => {
    try {
      const res = await fetch(API + '/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: state.data.brand, category: state.data.category, rows: state.data.rows, orders: state.data.orders,
          competitors: state.data.competitors || [], breakevenRoas: Number($('#breakeven').value) || 2, flatlineDays: Number($('#flatDays').value) || 2 }),
      });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Server error ' + res.status); }
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) queue.push(JSON.parse(line)); }
      }
    } catch (e) { queue.push({ type: 'error', message: e.message + ' Check your connection and try again.' }); }
    finished = true;
  })();
  // Player: shows queued events at a human pace
  while (!finished || queue.length) {
    if (queue.length) await showEvent(queue.shift()); else await sleep(60);
  }
  await reader;
  setFlowing(false);
  state.running = false;
  btn.disabled = false; btn.textContent = '↻ Run the loop again';
  hubIdle();
}
$('#runBtn').onclick = run;
$('#runBtn').classList.add('idle');
$('#hub').onclick = () => (state.result ? $('#details').scrollIntoView({ behavior: 'smooth' }) : run());

function hubIdle() {
  const r = state.result;
  stage(0, r ? `<small>Health</small><span class="big">${r.ahi.after.value}</span><small>was ${r.ahi.before.value} · loop ${state.loop}</small>` : '<b>Drishti loop</b><small>press Run</small>');
}

// ---------------------------------------------------------------------------
// ③ OBSERVED → RECOMMENDED and ④ ACTION TAKEN
// Each action is one row: [④ action] ←thread← [③ recommendation].
// ---------------------------------------------------------------------------
const statusClass = s => /^Green/.test(s) ? 's-green' : /^Amber/.test(s) ? 's-amber' : 's-red';

function money(a) {
  if (!a.impact) return '';
  if (a.kind === 'budget' || a.kind === 'migrate') return '+' + inr(a.impact) + ' revenue/day';
  return inr(a.impact) + '/day';
}

function recCard(a) {
  return `<div class="card-r" style="--c:var(--${a.agent})" data-tip="rec" data-id="${a.id}" tabindex="0">
    <div class="who"><span class="tag">${esc(agentName(a.agent))}</span><span class="lbl">${a.rule ? 'your rule fired' : 'observed'}</span><span class="money" style="margin-left:auto">${money(a)}</span></div>
    <p class="obs">${esc(a.observed || a.detail)}</p>
    <p class="rec">${esc(a.recommend || a.title)}</p></div>`;
}

// The action card changes as the agent works: pending → executing → done (or waiting → approved / rejected)
function actCard(a) {
  const st = a.state || 'pending';
  const who = `<div class="who"><span class="tag" style="--c:var(--${a.agent})">${esc(agentName(a.agent))}</span><span class="lbl">${{ executing: 'agent working', done: 'action taken', waiting: 'needs you', rejected: 'not done', undone: 'rolled back', pending: '' }[st] || ''}</span></div>`;
  const mail = state.mail[a.id] ? `<span class="mail ${state.mail[a.id].ok ? 'sent' : ''}">📧 ${esc(state.mail[a.id].text)}</span>` : '';
  if (st === 'pending') return `<div class="card-a pending">…</div>`;
  if (st === 'executing') return `<div class="card-a executing" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">⚙ ${esc(a.execute || a.title)}</div></div>`;
  if (st === 'waiting') return `<div class="card-a waiting" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">✋ Ready to: ${esc(a.execute || a.title)}</div>
    <div class="foot"><span class="badge wait">Big move · your call</span><button class="mini yes" data-act="approve" data-id="${a.id}">Approve</button><button class="mini" data-act="reject" data-id="${a.id}">Reject</button></div></div>`;
  if (st === 'done') return `<div class="card-a done" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">✓ ${esc(a.feedback || a.title)}</div>
    <div class="foot"><span class="badge auto">${a.tier === 'auto' ? (a.rule ? 'Your rule · done automatically' : 'Small move · done automatically') : 'Approved by you · done'}${a.sentTo ? ' · sent to ' + esc(a.sentTo) : ''}</span>${a.tier === 'auto' ? `<button class="mini" data-act="undo" data-id="${a.id}">Undo</button>` : ''}${mail}</div></div>`;
  return `<div class="card-a ${st}" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${st === 'rejected' ? '✕ Rejected: nothing changed' : '↩ Rolled back: ' + esc(a.title)}</div>
    <div class="foot"><span class="badge off">${st === 'rejected' ? 'You said no' : 'Undone by you'}${a.sentTo ? ' · sent to ' + esc(a.sentTo) : ''}</span>${mail}</div></div>`;
}

// Thread colour + label follow the action's state
function threadClass(a) {
  return { executing: 't-exec', done: 't-done', waiting: 't-wait', rejected: 't-off', undone: 't-off' }[a.state] || '';
}
const THREAD_LABEL = { executing: 'acting', done: 'done', waiting: 'your OK?', rejected: 'stopped', undone: 'undone' };

function rowHTML(a) {
  return `<div class="row" id="row-${a.id}" data-id="${a.id}">
    <div class="slot-a">${actCard(a)}</div>
    <div class="thread ${threadClass(a)} ${a.state ? 'drawn' : ''}"><i></i><b>${THREAD_LABEL[a.state] || ''}</b></div>
    ${recCard(a)}</div>`;
}

// Re-draw one row's action side + thread without re-animating the recommendation
function updateRow(a, travel) {
  const row = $('#row-' + a.id); if (!row) return;
  row.querySelector('.slot-a').innerHTML = actCard(a);
  const th = row.querySelector('.thread');
  th.className = `thread ${threadClass(a)} ${a.state ? 'drawn' : ''}`;
  th.querySelector('b').textContent = THREAD_LABEL[a.state] || '';
  if (travel) { th.classList.remove('travel'); void th.offsetWidth; th.classList.add('travel'); }
  row.querySelectorAll('[data-act]').forEach(b => b.onclick = () => decide(Number(b.dataset.id), b.dataset.act));
  countActions();
}

function countActions() {
  const acts = state.result?.actions || [];
  const done = acts.filter(a => a.state === 'done').length, ask = acts.filter(a => a.state === 'waiting').length;
  $('#actCount').textContent = `${done} done · ${ask} waiting for you`;
}

// The choreography: recommendation appears → thread draws → agent acts → data flows back
async function playActions(r) {
  $('#statusPill').textContent = r.ahi.after.status;
  $('#statusPill').className = 'pill ' + statusClass(r.ahi.after.status);
  $('#rows').innerHTML = r.actions.length ? '' : '<div class="row empty-row"><div class="empty">Nothing to do.</div><div></div><div class="empty">No leaks found in this data.</div></div>';
  stage(3, '<b>③ Findings</b><small>recommending…</small>');
  for (const a of r.actions) log(`${agentName(a.agent)} observed: ${a.observed || a.detail}`);

  for (const a of r.actions) {
    a.state = undefined;
    $('#rows').insertAdjacentHTML('beforeend', rowHTML(a));
    const row = $('#row-' + a.id);
    row.scrollIntoView({ block: 'nearest', behavior: FAST ? 'auto' : 'smooth' });
    await wait(650);
    stage(4, '<b>④ Action</b><small>agents acting…</small>');
    a.state = a.tier === 'auto' ? 'executing' : 'waiting';
    updateRow(a, true);
    if (a.tier === 'auto') {
      log(`${agentName(a.agent)}: ${a.execute || a.title}`);
      await wait(1000);
      a.state = 'done';
      updateRow(a);
      log(`${agentName(a.agent)} done: ${a.feedback || a.title}`);
      await feedBack(a);
    } else {
      log(`${agentName(a.agent)} asked for approval: "${a.title}"`);
      await wait(350);
    }
  }
  // Back to the top so the first (most important) rows are in view
  $('#rows').scrollTo({ top: 0, behavior: FAST ? 'auto' : 'smooth' });
  // One email for everything the agents did on their own this run (plus what waits for you)
  await emailReport(r.actions.filter(a => a.state === 'done'), r.actions.filter(a => a.state === 'waiting'));
}

// After an action, the changed data goes back into ① (the next run reads it)
async function feedBack(a, line) {
  const text = line || a.feedback || a.title;
  const keys = [a.channel, a.to].filter(Boolean).map(k => (k === 'Calendar' ? 'Calendar' : k));
  const flow = $('#flow41');
  flow.classList.add('on', 'pulse');
  for (const k of keys) {
    (state.updates[k] ||= []).unshift(text);
  }
  renderSources();
  for (const k of keys) {
    const tile = $('#src-' + k.replace(/\W/g, ''));
    if (tile) { tile.classList.remove('fed'); void tile.offsetWidth; tile.classList.add('fed'); }
  }
  await wait(700);
  flow.classList.remove('pulse');
  if (!state.running) setTimeout(() => flow.classList.remove('on'), 1200);
}

// Approve / Reject (big moves) and Undo (small ones)
async function decide(id, act) {
  const a = state.result.actions.find(x => x.id === id); if (!a) return;
  if (act === 'approve') {
    log(`You approved "${a.title}"`);
    a.state = 'executing'; updateRow(a, true);
    await wait(900);
    a.state = 'done'; updateRow(a);
    log(`${agentName(a.agent)} done: ${a.feedback || a.title}`);
    feedBack(a);
    emailReport([a], []);
  } else if (act === 'reject') {
    a.state = 'rejected'; updateRow(a);
    log(`You rejected "${a.title}"`);
  } else if (act === 'undo') {
    a.state = 'undone'; updateRow(a);
    log(`You rolled back "${a.title}"`);
    feedBack(a, `restored: ${a.title}`);
  }
  // Post the decision to the approvals channel (Slack / Discord), if set up
  try {
    const res = await fetch(API + '/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook: $('#webhook').value.trim() || undefined, action: a, decision: act, brand: state.result.brand }) });
    const j = await res.json();
    if (j.sent) { a.sentTo = j.to; log(`Posted to ${j.to}`); updateRow(a); }
  } catch {}
}

// ---------------------------------------------------------------------------
// Email: the action report. Sent through FormSubmit (free, no account), straight
// from the browser. The first email to a new address asks that address to click
// "Activate" once; after that every report arrives normally.
// ---------------------------------------------------------------------------
async function emailReport(done, waiting) {
  const to = $('#email').value.trim();
  if (!done.length && !waiting.length) return;
  const mark = (list, status) => { for (const a of list) { state.mail[a.id] = status; updateRow(a); } };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return mark(done, { ok: false, text: 'no email set, so no report sent' });
  mark(done, { ok: false, text: `sending report to ${to}…` });
  const r = state.result;
  const sample = state.data.source === 'Sample';
  const body = {
    _subject: `Drishti AI · ${done.length} action${done.length === 1 ? '' : 's'} taken for ${r.brand}`,
    _template: 'table', _captcha: 'false',
    Brand: r.brand + (sample ? ' (sample brand, fictional data)' : ''),
    'Health score': `${r.ahi.before.value} → ${r.ahi.after.value} (${r.ahi.after.status})`,
  };
  done.forEach((a, i) => {
    body[`Action ${i + 1} · ${agentName(a.agent)}`] = `DONE: ${a.feedback || a.title}\nWhy: ${a.observed || a.detail}`;
  });
  waiting.forEach((a, i) => { body[`Waiting for you ${i + 1}`] = `${a.recommend || a.title}\nWhy: ${a.observed || a.detail}`; });
  body.Time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  try {
    const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    const ok = String(j.success) === 'true';
    const activate = /activat/i.test(j.message || '');
    const status = ok ? { ok: true, text: `report emailed to ${to}` }
      : activate ? { ok: false, text: `one-time step: open the "Activate" email sent to ${to}, then reports arrive` }
      : { ok: false, text: `email not sent (${cut(j.message || 'service busy', 60)})` };
    mark(done, status);
    log(status.ok ? `Action report emailed to ${to}` : `Email: ${status.text}`);
  } catch (e) {
    mark(done, { ok: false, text: 'email service unreachable' });
  }
}

function log(text) {
  const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.audit.unshift(`${t} · ${text}`);
  const el = $('#audit'); if (el) el.innerHTML = state.audit.slice(0, 120).map(x => `<li>${esc(x)}</li>`).join('');
}

// ---------------------------------------------------------------------------
// Result strip under the loop: health score + the three numbers that matter
// ---------------------------------------------------------------------------
function gauge(value, status) {
  // Semicircle gauge 0–100
  const color = /^Green/.test(status) ? 'var(--green)' : /^Amber/.test(status) ? 'var(--amber)' : 'var(--red)';
  const len = Math.PI * 56, fill = (len * Math.max(0, Math.min(100, value))) / 100;
  return `<svg viewBox="0 0 140 74" aria-label="Agent Health Index ${value}">
    <path d="M14 68 A56 56 0 0 1 126 68" fill="none" stroke="var(--line)" stroke-width="11" stroke-linecap="round"/>
    <path d="M14 68 A56 56 0 0 1 126 68" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${fill} ${len}"/></svg>`;
}

function renderResults(r) {
  const after = r.ahi.after, before = r.ahi.before;
  const roasUp = Math.round(((r.impact.trueRoasProjected - r.impact.trueRoasNow) / (r.impact.trueRoasNow || 1)) * 100);
  const storm = r.shock?.external ? `<div class="storm">🌩 <b>Storm Mode:</b> CPMs spiked on every channel at once. This is the market, not the agents: caps tightened, every budget move needs you.</div>` : '';
  const broken = r.signal.trackingBreaks.length ? `<div class="storm">🔧 <b>Tracking alert:</b> ${esc(r.signal.trackingBreaks.map(b => b.channel).join(', '))} under-reported sales yesterday. Its budget moves are frozen until fixed.</div>` : '';
  $('#results').hidden = false;
  $('#results').innerHTML = `
    <div data-tip="ahi"><div class="gauge">${gauge(after.value, after.status)}<div class="val">${after.value}</div><div class="glbl">Agent Health Index · was ${before.value}</div></div></div>
    <div><small>True ROAS (Shopify-checked)</small><b class="n">${r.impact.trueRoasNow} → ${r.impact.trueRoasProjected}</b> <span class="up">+${roasUp}%</span></div>
    <div><small>Spend on tired ads</small><b class="n">${r.impact.fatiguedPctNow}% → 0%</b></div>
    <div><small>Spend freed per day</small><b class="n">${inr(r.impact.freedPerDay)}</b></div>
    <div class="head">${esc(r.briefing.headline)} <a href="#details">See the reasoning ↓</a>${storm}${broken}<small>Projected values assume you approve every move.</small></div>`;
}

// ---------------------------------------------------------------------------
// Hover cards. Each element with data-tip="name" gets its card from TIPS[name].
// ---------------------------------------------------------------------------
const glimpseRows = (list, cols) => `<table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${list.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ''}">${esc(c[1](r))}</td>`).join('')}</tr>`).join('')}</table>`;
const fedBlock = key => (state.updates[key]?.length ? `<div class="k">Fed back after actions</div><ul>${state.updates[key].slice(0, 4).map(u => `<li class="new">↺ ${esc(u)}</li>`).join('')}</ul>` : '');

const TIPS = {
  src(el) {
    const key = el.dataset.key, d = state.data; if (!d) return '';
    const last = [...new Set(d.clean.map(r => r.date))].sort().slice(-1)[0];
    if (key === 'Shopify') {
      if (!d.cleanOrders.length) return `<h4>🛍️ Shopify orders</h4><p>Not connected. Without real orders Drishti estimates true revenue (platforms usually over-claim ~1.6×). Upload an orders CSV under “Use your own data”.</p>`;
      const rows = d.cleanOrders.filter(o => o.date === last);
      return `<h4>🛍️ Shopify orders · what really sold</h4><p>Orders tagged by UTM source. This is how Drishti checks what the ad platforms claim.</p>
        <div class="k">Latest pull · ${esc(last)}</div>${glimpseRows(rows, [['Source', o => o.channel], ['Orders', o => Math.round(o.orders).toLocaleString('en-IN'), 'n'], ['Revenue', o => inr(o.revenue), 'n']])}${fedBlock(key)}`;
    }
    if (key === 'Competitors') {
      if (!d.cleanComp.length) return `<h4>🕵️ Competitor ads</h4><p>Not connected. Upload a competitor CSV (Meta Ad Library export) to let the Cohort agent compare.</p>`;
      const rows = d.cleanComp.filter(c => c.date === last);
      return `<h4>🕵️ Competitor ads · Meta Ad Library</h4><p>What rival brands run, and how well people engage with it.</p>
        <div class="k">Latest pull · ${esc(last)}</div>${glimpseRows(rows.length ? rows : d.cleanComp.slice(-3), [['Brand', c => c.competitor], ['Where', c => c.channel], ['Campaign', c => cut(c.campaign, 26)], ['Engage', c => (c.rate * 100).toFixed(1) + '%', 'n']])}${fedBlock(key)}`;
    }
    if (key === 'News') {
      const h = state.result?.shock?.headlines || [];
      return `<h4>📰 Live news · Google News</h4><p>Read at the start of every run, so the Orchestrator can tell a market shock (outage, CPM war, budget cuts) from a problem in our ads.</p>
        ${h.length ? `<div class="k">Headlines read on the last run</div><ul>${h.slice(0, 4).map(x => `<li>${esc(cut(x.title, 90))}</li>`).join('')}</ul>` : '<div class="k">Headlines appear here after a run</div>'}`;
    }
    if (key === 'Calendar') {
      const now = Date.now();
      const up = EVENTS.map(x => ({ ...x, in: Math.round((new Date(x.date + 'T00:00:00Z') - now) / 864e5) })).filter(x => x.in >= -3).slice(0, 4);
      return `<h4>📅 India sale calendar</h4><p>Festivals push CPMs up. The Budget agent paces spend around them, and the shock filter won’t blame an ad for a festival dip.</p>
        ${glimpseRows(up, [['Event', e => e.name], ['Date', e => e.date], ['In', e => (e.in >= 0 ? e.in + ' days' : 'just passed'), 'n']])}${fedBlock(key)}`;
    }
    // An ad channel: show the latest rows streaming in
    const rows = d.clean.filter(r => r.channel === key && r.date === last).sort((x, y) => y.spend - x.spend);
    const tot = rows.reduce((s, r) => ({ spend: s.spend + r.spend, clicks: s.clicks + r.clicks, rev: s.rev + r.platform_revenue }), { spend: 0, clicks: 0, rev: 0 });
    return `<h4>${ICONS[key] || '📊'} ${esc(key)} · ${rows.length} rows a day</h4>
      <p>Per ad × region: spend, impressions, reach, clicks, conversions and the revenue ${esc(key)} <i>claims</i>.</p>
      <div class="k">Latest pull · ${esc(last)} · top ${Math.min(4, rows.length)} of ${rows.length}</div>
      ${glimpseRows(rows.slice(0, 4), [['Ad', r => cut(r.ad, 24)], ['Region', r => cut(r.region, 12)], ['Spend', r => inr(r.spend), 'n'], ['Clicks', r => r.clicks.toLocaleString('en-IN'), 'n'], ['Claimed', r => inr(r.platform_revenue), 'n']])}
      <p style="color:var(--muted)">Day total: ${inr(tot.spend)} spend · ${tot.clicks.toLocaleString('en-IN')} clicks · ${inr(tot.rev)} claimed sales</p>${fedBlock(key)}`;
  },
  agent(el) {
    const a = agent(el.dataset.id);
    const said = state.agentLog[a.id] || [];
    return `<h4>${a.icon} ${esc(a.name)} ${esc(a.role)}</h4><p>${esc(a.job)}</p><div class="k">Reads</div><p>${esc(a.reads)}</p>
      <div class="k">${said.length ? 'On this run' : 'Status'}</div>${said.length ? `<ul>${said.slice(-3).map(t => `<li>${esc(cut(t, 220))}</li>`).join('')}</ul>` : '<p>Waiting for Run.</p>'}`;
  },
  rec(el) {
    const a = state.result?.actions.find(x => x.id === Number(el.dataset.id)); if (!a) return '';
    return `<h4>${esc(agentName(a.agent))} · evidence</h4><p>${esc(a.detail)}</p>
      <div class="k">Why ${a.tier === 'auto' ? 'it acts on its own' : 'it asks you'}</div>
      <p>${a.tier === 'auto' ? (a.rule ? 'This is your standing rule, so it runs without asking.' : 'Small move (under ₹5,000/day or a budget shift under 10%), so it runs and can be undone.') : 'Big move, or the data/market needs a human eye, so it waits for Approve.'}</p>`;
  },
  act(el) {
    const a = state.result?.actions.find(x => x.id === Number(el.dataset.id)); if (!a) return '';
    const sample = state.data?.source === 'Sample';
    return `<h4>⚙ What the agent does</h4><p>${esc(a.execute || a.title)}</p>
      <div class="k">On a connected account</div><p>${esc(apiCall(a))}${sample ? ' <i>(sample brand: applied to the sample data)</i>' : ''}</p>
      <div class="k">Fed back into ①</div><p class="new">↺ ${esc(a.feedback || a.title)}</p>
      ${state.mail[a.id] ? `<div class="k">Report</div><p>📧 ${esc(state.mail[a.id].text)}</p>` : ''}`;
  },
  ahi() {
    const r = state.result; if (!r) return '';
    return `<h4>Agent Health Index</h4><p>One score for how healthy the ad account is, graded on TRUE revenue. Weighted geometric mean, so one weak area can’t hide behind strong ones.</p>
      ${glimpseRows(['P2', 'P3', 'P4', 'P5'].map(k => ({ k })), [['Agent', x => agentName(x.k)], ['Before', x => r.ahi.before.scores[x.k], 'n'], ['After', x => r.ahi.after.scores[x.k], 'n']])}
      <p>Data gate (Signal): ${r.signal.trustScore}/100 → ${r.signal.gateOpen ? 'open' : 'SHUT'}</p>`;
  },
  hub() {
    const r = state.result;
    return `<h4>The Drishti loop</h4><p>① data comes in → ② agents diagnose → ③ they recommend → ④ they act (or ask you) → the changed data flows back into ①, and the next hourly run checks whether the fix worked.</p>
      ${r ? `<p>Loop ${state.loop}: health ${r.ahi.before.value} → ${r.ahi.after.value}. Click for the full reasoning.</p>` : '<p>Click to run.</p>'}`;
  },
  flow12() {
    const d = state.data; if (!d) return '';
    return `<h4>① → ②  Raw data to the agents</h4><p>${d.rows.length.toLocaleString('en-IN')} ad rows, ${d.cleanOrders.length} order rows${d.cleanComp.length ? `, ${d.cleanComp.length} competitor rows` : ''}, plus live news and the calendar. The Signal agent cleans and joins them first.</p>`;
  },
  flow23() { return `<h4>② → ③  Findings</h4><p>Each agent turns what it found into a plain recommendation, with the numbers behind it (hover a card in ③).</p>`; },
  flow41() {
    const all = Object.values(state.updates).flat();
    return `<h4>④ → ①  Updated data fed back</h4><p>Every action changes the account: paused ads stop spending, moved budgets show up on the new channel. The next run reads this and checks whether the fix worked.</p>
      ${all.length ? `<ul>${[...new Set(all)].slice(0, 5).map(u => `<li class="new">↺ ${esc(u)}</li>`).join('')}</ul>` : ''}`;
  },
  rule() { return `<h4>Your standing rule</h4><p>If a campaign’s revenue stays flat for this many days and it is below break-even, the Budget agent puts it on hold on its own and emails you a report. In a market shock it asks first.</p>`; },
  email() { return `<h4>✉️ Try it with your own email address</h4><p><b>Replace this email address with yours</b> to receive the action reports and feel the live demo: press Run, and the agents email you what they did.</p><p>After each run, one email lists every action taken and what waits for your approval. Each approval sends its own report.</p><p style="color:var(--muted)">Sent via FormSubmit. The first time, your inbox gets a one-time “Activate” email; click it, run the loop again, and reports arrive.</p>`; },
  'brand-glowveda'() { return `<h4>Glowveda</h4><p>Shreya’s skincare brand · ₹1.5 Cr/month on Facebook, Instagram, Google and JioHotstar TV. Fictional sample data.</p>`; },
  'brand-crunchkart'() { return `<h4>Crunchkart</h4><p>Aarush’s snacks brand · ₹9 L/month on Facebook, Instagram and Google. Fictional sample data.</p>`; },
};

// The API call an agent makes for each kind of action on a real, connected account
function apiCall(a) {
  return {
    hold: `${a.channel} Marketing API → campaign status = PAUSED (“on hold”)`,
    pause: `${a.channel} API → ad status = PAUSED; new ads created from Creative Studio variants`,
    migrate: `${a.channel} API → pause ad; ${a.to} ad server → create the same video spot with its budget`,
    shift: `${a.channel} API → campaign budget −30%; ${a.to} API → duplicate campaign with that budget`,
    cohort: `${a.channel} API → ad-set targeting / bid update for that region`,
    budget: 'Each channel’s API → daily budget update',
    pacing: 'Budget plan → 15% held in reserve',
    tracking: `${a.channel} budget locked; alert to the tracking owner`,
    prep: 'Creative Studio → variants saved as drafts, ready to A/B',
  }[a.kind] || a.title;
}

// One floating card follows whatever is hovered (or focused / tapped on phones).
const tip = $('#tip');
let tipFor = null;
function showTip(el) {
  const html = TIPS[el.dataset.tip]?.(el);
  if (!html) return hideTip();
  tipFor = el;
  tip.innerHTML = html; tip.hidden = false;
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  // prefer below the element; flip above if there is no room; keep inside the screen
  let top = r.bottom + 8;
  if (top + t.height > innerHeight - 8) top = Math.max(8, r.top - t.height - 8);
  const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  tip.style.top = top + 'px'; tip.style.left = left + 'px';
  // highlight the whole row when a recommendation or action is hovered
  $$('.row.hl').forEach(x => x.classList.remove('hl'));
  el.closest('.row')?.classList.add('hl');
}
function hideTip() { tip.hidden = true; tipFor = null; $$('.row.hl').forEach(x => x.classList.remove('hl')); }
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el && el !== tipFor) showTip(el); else if (!el && tipFor) hideTip(); });
document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('focusout', hideTip);
// Phones have no hover: a tap shows the card, a tap elsewhere hides it.
document.addEventListener('touchstart', e => { const el = e.target.closest('[data-tip]'); if (el && !e.target.closest('button, input, a')) showTip(el); else hideTip(); }, { passive: true });
addEventListener('scroll', hideTip, { passive: true, capture: true });

// ---------------------------------------------------------------------------
// Details below the fold
// ---------------------------------------------------------------------------
function renderDetails(r) {
  $('#details').hidden = false;

  $('#briefCard').innerHTML = `<h3>Briefing for the marketing manager</h3>
    <p><b>${esc(r.briefing.headline)}</b></p><p>${esc(r.briefing.briefing)}</p>
    <p style="color:var(--muted)">For the owner: ${esc(r.briefing.owner_note)}</p>
    <p class="hint">Reasoning engine: ${esc(r.engine)} · Data ${esc(r.period.from)} → ${esc(r.period.to)}</p>`;

  // Claimed vs true ROAS per channel (the measurement trap)
  const max = Math.max(...r.signal.perChannel.map(c => c.platformRoas), 1);
  $('#roasCard').innerHTML = `<h3>Platform-claimed vs true ROAS</h3>
    <div class="legend"><i style="background:var(--line-strong)"></i>Platform says<i style="background:var(--sky)"></i>Shopify orders say</div>
    <div class="bars">${r.signal.perChannel.map(c => `<div class="row"><b>${esc(c.channel)}</b><div><div class="track">
      <div class="claimed" style="width:${(c.platformRoas / max) * 100}%"></div><div class="true" style="width:${(c.trueRoas / max) * 100}%"></div></div>
      <div class="nums">${c.platformRoas} claimed · ${c.trueRoas} true · over-claims ${c.overclaim}×</div></div></div>`).join('')}</div>
    <p class="hint">Data trust ${r.signal.trustScore}/100${r.signal.issues.length ? ' · ' + esc(r.signal.issues.join('; ')) : ''}</p>`;

  // Shock filter: 5 checks + live headlines
  const s = r.shock || { checks: [], headlines: [] };
  $('#shockCard').innerHTML = `<h3>Is it us or the world? ${s.external ? '<span class="pill s-amber">Market shock</span>' : '<span class="pill s-green">Inside the account</span>'}</h3>
    <ul class="checks">${s.checks.map(c => `<li><b>${esc(c.name)}</b>${esc(c.result)}</li>`).join('')}</ul>
    ${s.headlines?.length ? `<div class="section-label">Live headlines read this run</div><ul class="news">${s.headlines.slice(0, 5).map(h => `<li><a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.title)}</a></li>`).join('')}</ul>` : ''}`;

  // Creative variants
  $('#creativeCard').innerHTML = `<h3>New ads drafted by Creative Studio</h3>
    ${r.variants.length ? r.variants.map(v => `<p class="hint">Replacing <b>${esc(v.ad)}</b> (${esc(v.channel)})</p>
      <div class="variants">${v.variants.map(x => `<div class="variant"><div class="lang">${esc(x.language)}</div>
        <div class="hook">${esc(x.hook)}</div><div>${esc(x.headline)}</div><div class="meta">CTA: ${esc(x.cta)}${x.angle ? ' · ' + esc(x.angle) : ''}</div>
        <div class="meta ${x.check.pass ? 'ok' : 'no'}">${x.check.pass ? '✓' : '⚠'} ${esc(x.check.note)}</div></div>`).join('')}</div>`).join('')
      : '<p>No ad needed replacing this run.</p>'}`;

  $('#fatigueCard').innerHTML = `<h3>Fatigue scores</h3><table><tr><th>Ad</th><th>Score</th><th>CTR</th><th>Outlook</th></tr>
    ${r.fatigue.ads.map(a => `<tr><td>${esc(a.ad)}<br><small style="color:var(--muted)">${esc(a.channel)} · ${esc(a.cause)}</small></td>
      <td><b style="color:${a.score >= 60 ? 'var(--red)' : a.score >= 40 ? 'var(--amber)' : 'var(--green)'}">${a.score}</b></td>
      <td>${a.ctrBase}% → ${a.ctrNow}%</td><td>${a.status === 'fatigued' ? 'Tired now' : a.daysToFatigue ? `~${a.daysToFatigue} days left` : 'Stable'}</td></tr>`).join('')}</table>`;

  const w = { P2: 0.30, P3: 0.20, P4: 0.25, P5: 0.25 };
  $('#ahiCard').innerHTML = `<h3>How the score is built</h3>
    <p>Each KPI is scored 0–100 against baseline and target, then rolled up as a weighted geometric mean, so one weak agent can't hide behind strong ones.</p>
    <p><code>AHI = G × P2^.30 × P3^.20 × P4^.25 × P5^.25</code></p>
    <table><tr><th>Agent</th><th>Weight</th><th>Before</th><th>After</th></tr>
    ${Object.keys(w).map(k => `<tr><td>${agentName(k)}</td><td>${w[k] * 100}%</td><td>${r.ahi.before.scores[k]}</td><td><b>${r.ahi.after.scores[k]}</b></td></tr>`).join('')}
    <tr><td>Signal (gate G)</td><td>gate</td><td colspan="2">${r.signal.trustScore} → ${r.signal.gateOpen ? 'open' : 'SHUT'}</td></tr></table>`;

  const chips = ['Why is true ROAS lower than what Meta shows?', 'Which action matters most and why?', 'Explain this to a business owner in two lines', 'What would you do before Diwali?'];
  $('#askChips').innerHTML = chips.map(c => `<button type="button">${esc(c)}</button>`).join('');
  $$('#askChips button').forEach(b => b.onclick = () => { $('#askInput').value = b.textContent; ask(); });
  log(`Run finished · ${r.engine}`);
}

// Ask a follow-up question about this run
async function ask(ev) {
  ev?.preventDefault();
  const q = $('#askInput').value.trim(); if (!q || !state.result) return;
  const r = state.result;
  $('#askAnswer').innerHTML = '<span class="typing">Thinking</span>';
  const context = { brand: r.brand, briefing: r.briefing, impact: r.impact, ahi: r.ahi, actions: r.actions.map(({ agent, title, detail, tier, state: s }) => ({ agent, title, detail, tier, decision: s })),
    channels: r.signal.perChannel, fatigue: r.fatigue.ads.slice(0, 5), losingCohorts: r.cohort.losing.slice(0, 5), budget: { shifts: r.budget.shifts, upcomingEvents: r.budget.upcomingEvents }, shock: { external: r.shock?.external, checks: r.shock?.checks } };
  try {
    const res = await fetch(API + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context }) });
    const j = await res.json();
    $('#askAnswer').textContent = j.answer || j.error;
  } catch (e) { $('#askAnswer').textContent = 'Could not reach the Orchestrator. ' + e.message; }
}
$('#askForm').onsubmit = ask;

// The loop fills the rest of the screen below the controls (the controls can wrap
// onto two lines, so measure where the loop really starts).
function fitLoop() {
  const top = $('#loop').getBoundingClientRect().top + scrollY;
  document.documentElement.style.setProperty('--above', top + 'px');
}
addEventListener('resize', fitLoop);
new ResizeObserver(fitLoop).observe($('.controls'));
$('#ownBtn').addEventListener('click', fitLoop);

// Start with the sample brand loaded so Run works straight away.
// A link ending in ?run starts the agents immediately (handy for sharing a live demo).
loadSample();
hubIdle();
if (new URLSearchParams(location.search).has('run')) setTimeout(run, 300);
