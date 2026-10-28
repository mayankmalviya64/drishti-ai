// app.js — the live Drishti AI app in the browser.
// Flow: 1) load data (sample / CSV / Google Sheet / Meta API)
//       2) POST it to /api/run and show each streamed agent event as it arrives
//       3) show decisions; Approve / Reject / Undo are logged and sent to Slack/Discord
import { makeSample, toCSV } from './lib/sample.js';

// When the page is opened from GitHub Pages, talk to the Vercel backend.
const API = location.hostname.endsWith('github.io') ? 'https://drishti-ai-mvp.vercel.app' : '';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ₹ in Indian style: ₹2.3 L, ₹1.1 Cr
function inr(n) {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

// The six agents shown in the strip (matches the deck)
const AGENTS = [
  { id: 'ORC', icon: '🧭', name: 'Orchestrator', role: 'Shock filter' },
  { id: 'P1', icon: '📡', name: 'Signal', role: 'Data trust' },
  { id: 'P2', icon: '🔥', name: 'Fatigue', role: 'Sentinel' },
  { id: 'P3', icon: '🎨', name: 'Creative', role: 'Studio' },
  { id: 'P4', icon: '🎯', name: 'Cohort', role: 'Optimizer' },
  { id: 'P5', icon: '⚖️', name: 'Budget', role: 'Allocator' },
];
const agentName = id => (AGENTS.find(a => a.id === id) || {}).name || id;

// Everything the page knows right now
const state = { data: null, result: null, audit: [], running: false, engine: null };

// Safe localStorage (some browsers block it)
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

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
// 1 · CONNECT
// ---------------------------------------------------------------------------
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
  if (t.dataset.tab === 'sample') loadSample();
});

function setStatus(text, kind = 'ok') {
  const el = $('#dataStatus');
  el.className = 'data-status ' + kind;
  el.innerHTML = text;
}

// Summarise loaded data in one line, e.g. "490 rows · 14 days · Meta, Google · Shopify orders ✓"
function describe(d) {
  const dates = [...new Set(d.rows.map(r => r.date || r.Date || r.day))].filter(Boolean).sort();
  const ch = [...new Set(d.rows.map(r => r.channel || r.Channel || r.platform || 'Meta'))];
  return `<b>${esc(d.brand)}</b> · ${d.rows.length} rows · ${dates.length} days · ${esc(ch.join(', '))} · ${d.orders?.length ? 'Shopify orders ✓' : '<span style="color:var(--amber)">no orders file (ROAS estimated)</span>'}`;
}

function loadSample() {
  const brand = $('input[name=brand]:checked').value;
  const s = makeSample(brand, { twists: { pixelBreak: $('#twistPixel').checked, marketShock: $('#twistShock').checked } });
  state.data = { ...s, source: 'Sample' };
  setStatus(describe(state.data));
  renderConnectors();
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
})();

async function readFiles() {
  const fa = $('#fileAds').files[0], fo = $('#fileOrders').files[0];
  if (!fa) return;
  try {
    const rows = parseCSV(await fa.text());
    const orders = fo ? parseCSV(await fo.text()) : [];
    if (!rows.length) throw new Error('The ad file has no rows.');
    state.data = { brand: fa.name.replace(/\.csv$/i, ''), category: 'consumer products', rows, orders, source: 'CSV' };
    setStatus(describe(state.data));
  } catch (e) { setStatus('Could not read the file: ' + esc(e.message), 'err'); }
  renderConnectors();
}
$('#fileAds').onchange = readFiles;
$('#fileOrders').onchange = readFiles;

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
    state.data = { brand: 'Your brand (Google Sheet)', category: 'consumer products', rows, orders, source: 'Google Sheets' };
    setStatus(describe(state.data));
  } catch (e) { setStatus(esc(e.message), 'err'); }
  renderConnectors();
};

$('#loadMeta').onclick = async () => {
  const token = $('#metaToken').value.trim(), account = $('#metaAccount').value.trim();
  if (!token || !account) return setStatus('Meta needs a token and an ad account ID.', 'err');
  setStatus('Pulling from the Meta Marketing API…', '');
  try {
    const { rows } = await connect({ type: 'meta', token, account });
    state.data = { brand: 'Your Meta account', category: 'consumer products', rows, orders: [], source: 'Meta Ads API' };
    setStatus(describe(state.data) + '<br><small>Tip: add a Shopify orders CSV in "Upload CSV" for true ROAS.</small>');
  } catch (e) { setStatus(esc(e.message), 'err'); }
  renderConnectors();
};

// Settings remembered on this device only
$('#webhook').value = store.get('drishti-webhook') || '';
$('#webhook').onchange = e => { store.set('drishti-webhook', e.target.value.trim()); renderConnectors(); };

// The little list of connectors above the Run button
function renderConnectors() {
  const d = state.data || {};
  const items = [
    [`Ad data · ${d.source || '—'}`, d.rows ? 'on' : ''],
    ['Shopify orders', d.orders?.length ? 'on' : ''],
    ['Live news (Google News)', 'live'],
    ['India sale calendar', 'on'],
    [$('#webhook').value ? 'Slack/Discord approvals' : 'Approvals: in-app', $('#webhook').value ? 'on' : 'on'],
    [state.engine ? `AI: ${state.engine}` : 'AI: built-in rules', state.engine ? 'live' : 'on'],
  ];
  $('#connectors').innerHTML = items.map(([t, c]) => `<li class="${c}">${esc(t)}</li>`).join('');
}

// Ask the backend which AI engine is on (Groq / Gemini / rules)
fetch(API + '/api/health').then(r => r.json()).then(h => { state.engine = h.engine; renderConnectors(); }).catch(() => {});

// ---------------------------------------------------------------------------
// 2 · AGENTS AT WORK (streamed)
// ---------------------------------------------------------------------------
function renderStrip() {
  $('#agentStrip').innerHTML = AGENTS.map(a =>
    `<div class="agent-node" id="node-${a.id}" style="--c:var(--${a.id})"><div class="dot">${a.icon}</div><b>${a.name}</b>${a.role}</div>`).join('');
}
renderStrip();

function setNode(id, status) {
  const n = $('#node-' + id); if (!n) return;
  n.classList.remove('working', 'done', 'alert');
  n.classList.add(status);
}

function addFeed(html, cls, agent) {
  const feed = $('#feed');
  const div = document.createElement('div');
  div.className = 'ev ' + (cls || '');
  div.style.setProperty('--c', `var(--${agent || 'ORC'})`);
  div.innerHTML = html;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return div;
}

// Events arrive faster than people can read, so show them at a readable pace.
const PACE = { thought: 650, working: 500, done: 750, alert: 750 };
// ?fast in the link skips the reading pace (used for quick testing).
if (new URLSearchParams(location.search).has('fast')) for (const k in PACE) PACE[k] = 0;

async function showEvent(e) {
  if (e.type === 'start') {
    $('#engine').textContent = e.engine;
    addFeed(`<span class="tag">RUN</span><span class="txt">Hourly check for <b>${esc(e.brand)}</b>: ${e.period.days} days of data (${e.period.from} → ${e.period.to}), ${esc(e.totals.channels.join(', '))}, ${inr(e.totals.spend)} spend.</span>`, '', 'ORC');
    await sleep(PACE.thought ? 400 : 0);
  } else if (e.type === 'thought') {
    addFeed(`<span class="tag">thinks</span><span class="txt">${esc(e.text)}</span>`, 'thought');
    await sleep(PACE.thought);
  } else if (e.type === 'agent') {
    setNode(e.agent, e.status);
    if (e.status === 'working') {
      state.workingEl = addFeed(`<span class="tag">${esc(agentName(e.agent))}</span><span class="txt typing">${esc(e.text)}</span>`, 'working', e.agent);
      await sleep(PACE.working);
    } else {
      if (state.workingEl) state.workingEl.remove();
      addFeed(`<span class="tag">${esc(agentName(e.agent))}</span><span class="txt">${e.status === 'alert' ? '<b>⚠</b> ' : ''}${esc(e.text)}</span>`, e.status, e.agent);
      await sleep(PACE[e.status] || 600);
    }
  } else if (e.type === 'result') {
    state.result = e;
    const nAuto = e.actions.filter(a => a.tier === 'auto').length, nAsk = e.actions.filter(a => a.tier === 'approval').length;
    addFeed(`<span class="tag">Done</span><span class="txt">Finished${e.seconds >= 1 ? ` in ${e.seconds}s` : ''}. ${nAuto} small ${nAuto === 1 ? 'fix' : 'fixes'} applied automatically, ${nAsk} bigger ${nAsk === 1 ? 'move waits' : 'moves wait'} for you →</span>`, 'final', 'P5');
    renderDecisions(e);
    renderDetails(e);
  } else if (e.type === 'error') {
    addFeed(`<span class="tag">Error</span><span class="txt">${esc(e.message)}</span>`, 'alert', 'P2');
  }
}

async function run() {
  if (state.running) return;
  if (!state.data?.rows?.length) return setStatus('Load some data first.', 'err');
  state.running = true;
  const btn = $('#runBtn');
  btn.disabled = true; btn.classList.remove('idle'); btn.textContent = 'Agents working…';
  $('#feed').innerHTML = '';
  renderStrip();
  $('#decisions').innerHTML = '<div class="empty"><div class="empty-art">⏳</div><p>Decisions appear here as soon as the agents finish.</p></div>';
  $('#statusPill').textContent = ''; $('#statusPill').className = 'pill';

  const queue = []; let finished = false;
  // Reader: pulls lines off the network stream into a queue
  const reader = (async () => {
    try {
      const res = await fetch(API + '/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: state.data.brand, category: state.data.category, rows: state.data.rows, orders: state.data.orders, breakevenRoas: Number($('#breakeven').value) || 2 }),
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
  state.running = false;
  btn.disabled = false; btn.textContent = '↻ Run again';
}
$('#runBtn').onclick = run;
$('#runBtn').classList.add('idle');

// ---------------------------------------------------------------------------
// 3 · DECISIONS
// ---------------------------------------------------------------------------
const statusClass = s => /^Green/.test(s) ? 's-green' : /^Amber/.test(s) ? 's-amber' : 's-red';

function gauge(value, status) {
  // Semicircle gauge 0–100
  const color = /^Green/.test(status) ? 'var(--green)' : /^Amber/.test(status) ? 'var(--amber)' : 'var(--red)';
  const len = Math.PI * 60, fill = (len * Math.max(0, Math.min(100, value))) / 100;
  return `<svg viewBox="0 0 150 86" aria-label="Agent Health Index ${value}">
    <path d="M15 78 A60 60 0 0 1 135 78" fill="none" stroke="var(--line)" stroke-width="12" stroke-linecap="round"/>
    <path d="M15 78 A60 60 0 0 1 135 78" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${fill} ${len}"/></svg>`;
}

function renderDecisions(r) {
  const after = r.ahi.after, before = r.ahi.before;
  $('#statusPill').textContent = after.status;
  $('#statusPill').className = 'pill ' + statusClass(after.status);
  const roasUp = Math.round(((r.impact.trueRoasProjected - r.impact.trueRoasNow) / (r.impact.trueRoasNow || 1)) * 100);
  const storm = r.shock?.external ? `<div class="storm">🌩 <b>Storm Mode:</b> CPMs spiked on every channel at once. This is the market, not the agents: caps tightened, every budget move needs you.</div>` : '';
  const broken = r.signal.trackingBreaks.length ? `<div class="storm">🔧 <b>Tracking alert:</b> ${esc(r.signal.trackingBreaks.map(b => b.channel).join(', '))} under-reported sales yesterday. Its budget moves are frozen until fixed.</div>` : '';

  $('#decisions').innerHTML = `
    ${storm}${broken}
    <div class="score-row">
      <div class="gauge">${gauge(after.value, after.status)}<div class="val">${after.value}</div><div class="lbl">Agent Health Index · was ${before.value}</div></div>
      <div>
        <div class="agent-scores">
          <div title="Data Trust gate (must be 60+)">Signal<b>${r.signal.trustScore}</b>gate</div>
          ${['P2', 'P3', 'P4', 'P5'].map(k => `<div>${agentName(k)}<b style="color:${after.scores[k] >= 70 ? 'var(--green)' : after.scores[k] >= 50 ? 'var(--amber)' : 'var(--red)'}">${after.scores[k]}</b>was ${before.scores[k]}</div>`).join('')}
        </div>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><small>True ROAS</small><b>${r.impact.trueRoasNow} → ${r.impact.trueRoasProjected}</b> <span class="up">+${roasUp}%</span></div>
      <div class="kpi"><small>Spend on tired ads</small><b>${r.impact.fatiguedPctNow}% → 0%</b></div>
      <div class="kpi"><small>Spend freed per day</small><b>${inr(r.impact.freedPerDay)}</b></div>
    </div>
    <div class="headline">${esc(r.briefing.headline)}</div>
    <div class="section-label">Actions · ${r.actions.filter(a => a.tier === 'approval').length} need you</div>
    <div id="actionList">${r.actions.map(actionCard).join('')}</div>
    <p class="hint">Projected values assume you approve every move. <a href="#details">See the reasoning ↓</a></p>`;
  $$('#actionList [data-act]').forEach(b => b.onclick = () => decide(Number(b.dataset.id), b.dataset.act));
  for (const a of r.actions) log(`${agentName(a.agent)}: ${a.tier === 'auto' ? 'auto-applied' : 'requested approval for'} "${a.title}"`);
}

function actionCard(a) {
  const st = a.state || (a.tier === 'auto' ? 'applied' : 'waiting');
  let foot;
  if (st === 'applied') foot = `<span class="badge auto">✓ Auto-applied (small move)</span><button class="mini" data-act="undo" data-id="${a.id}">Undo</button>`;
  else if (st === 'waiting') foot = `<span class="badge wait">Needs your approval</span><button class="mini yes" data-act="approve" data-id="${a.id}">Approve</button><button class="mini" data-act="reject" data-id="${a.id}">Reject</button>`;
  else foot = `<span class="badge ${st === 'approved' ? 'auto' : 'wait'}">${{ approved: '✓ Approved', rejected: '✕ Rejected', undone: '↩ Rolled back' }[st]}${a.sentTo ? ' · sent to ' + a.sentTo : ''}</span>`;
  return `<div class="action ${a.tier} ${st}" style="--c:var(--${a.agent})">
    <div class="top"><span class="tag">${agentName(a.agent)}</span><span class="title">${esc(a.title)}</span></div>
    <div class="detail">${esc(a.detail)}</div>
    <div class="foot"><span class="money">${a.impact ? (a.kind === 'budget' ? '+' + inr(a.impact) + ' revenue/day' : inr(a.impact) + '/day') : ''}</span>${foot}</div></div>`;
}

async function decide(id, act) {
  const a = state.result.actions.find(x => x.id === id); if (!a) return;
  a.state = { approve: 'approved', reject: 'rejected', undo: 'undone' }[act];
  log(`You ${a.state} "${a.title}"`);
  // Post the decision to the approvals channel (Slack / Discord), if set up
  try {
    const res = await fetch(API + '/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook: $('#webhook').value.trim() || undefined, action: a, decision: act, brand: state.result.brand }) });
    const j = await res.json();
    if (j.sent) { a.sentTo = j.to; log(`Posted to ${j.to}`); }
  } catch {}
  $('#actionList').innerHTML = state.result.actions.map(actionCard).join('');
  $$('#actionList [data-act]').forEach(b => b.onclick = () => decide(Number(b.dataset.id), b.dataset.act));
}

function log(text) {
  const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.audit.unshift(`${t} · ${text}`);
  const el = $('#audit'); if (el) el.innerHTML = state.audit.slice(0, 80).map(x => `<li>${esc(x)}</li>`).join('');
}

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
    <div class="legend"><i style="background:var(--line)"></i>Platform says<i style="background:var(--teal)"></i>Shopify orders say</div>
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

// Start with the sample brand loaded so Run works straight away.
// A link ending in ?run starts the agents immediately (handy for sharing a live demo).
loadSample();
if (new URLSearchParams(location.search).has('run')) setTimeout(run, 300);
