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
import { RULE_TYPES, DEFAULT_RULES, cleanRule, ruleText } from './lib/rules.js';

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

// ---------------------------------------------------------------------------
// ICONS: small line icons drawn as inline SVG (24 × 24, stroke only), so every
// logo on the page has the same thin, minimal style. ic('eye') returns the SVG text.
// Any element with data-icon="name" in the HTML gets its icon filled in on load.
// ---------------------------------------------------------------------------
const ICON_PATHS = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  phoenix: '<path d="M12 21c-1.5-2-2-4-1.2-6.2C8.6 14 5.5 11.8 3 7.5c3 .8 5.4 1.9 7.2 3.3C9.6 8.2 10 5.5 12 3c2 2.5 2.4 5.2 1.8 7.8 1.8-1.4 4.2-2.5 7.2-3.3-2.5 4.3-5.6 6.5-7.8 7.3.8 2.2.3 4.2-1.2 6.2Z"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  loop: '<path d="M3 12a9 9 0 0 1 15.7-6L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.7 6L3 16"/><path d="M8 16H3v5"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  present: '<path d="M2 3h20M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3M7 21l5-5 5 5"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
  storm: '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2 8.7"/><path d="m13 12-3 5h4l-3 5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  // the six agents
  compass: '<circle cx="12" cy="12" r="9.5"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1Z"/>',
  signal: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/><circle cx="12" cy="12" r="2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  target: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.5"/>',
  scale: '<path d="m16 16 3-8 3 8a4.5 4.5 0 0 1-6 0Z"/><path d="m2 16 3-8 3 8a4.5 4.5 0 0 1-6 0Z"/><path d="M7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  // data sources
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5.5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  google: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 12h-8.5"/>',
  infinity: '<path d="M12 12c-2-2.7-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z"/>',
  tv: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="m17 2-5 5-5-5"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>',
  news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
};
const ic = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.chart}</svg>`;
// fill every <span data-icon="…"> already in the page (or inside a freshly drawn part)
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { if (!el.firstChild) el.innerHTML = ic(el.dataset.icon); });
}
fillIcons();

// The six agents shown in box ② (matches the deck), with what each one does,
// for the detail panel.
const AGENTS = [
  { id: 'ORC', icon: 'compass', name: 'Orchestrator', role: 'Shock filter',
    job: 'Decides which agent to call next. Before anyone acts, it checks whether a drop is the market (news, CPM spikes, festivals) rather than our ads.',
    reads: 'Live news, auction prices, sale calendar' },
  { id: 'P1', icon: 'signal', name: 'Signal', role: 'Data trust',
    job: 'Joins what ad platforms claim with real Shopify orders to get TRUE ROAS, and spots broken tracking. If trust drops below 60, nothing runs on its own.',
    reads: 'Ad rows + Shopify orders' },
  { id: 'P2', icon: 'flame', name: 'Fatigue', role: 'Sentinel',
    job: 'Scores every ad 0–100 against its own first days (CTR, how often people saw it, CPM) and pauses ads that have worn out.',
    reads: 'Daily CTR, frequency, CPM per ad' },
  { id: 'P3', icon: 'sparkles', name: 'Creative', role: 'Studio',
    job: 'Writes replacement ads in English and regional languages, checks them against ASCI rules, and moves videos to the channel they suit (phone feed → TV).',
    reads: 'Tired ads, regions, video results per channel' },
  { id: 'P4', icon: 'target', name: 'Cohort', role: 'Optimizer',
    job: 'Finds city and audience pockets that lose money, and compares our ads with competitors’ ads. Trims, narrows or shifts spend.',
    reads: 'Spend × region, competitor ads' },
  { id: 'P5', icon: 'scale', name: 'Budget', role: 'Allocator',
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
  rules: [],         // your standing rules, e.g. [{ type: 'flat', a: 2 }]
  models: [],        // AI models the backend can use (for the picker in ②)
  paceCut: {},       // channel → ₹/day the agents stopped spending (slows that tile's live counter)
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
// (there are two theme buttons: one on the landing page, one in the sidebar)
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $$('.theme-btn').forEach(b => {
    b.innerHTML = ic(dark ? 'sun' : 'moon');
    b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  });
}
$$('.theme-btn').forEach(b => b.onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  store.set('drishti-theme', dark ? 'dark' : 'light');
  syncThemeBtn();
});
syncThemeBtn();

// ---------------------------------------------------------------------------
// SCREENS: the landing page and the agent screen live in the same file.
// <html class="in-app"> shows the agent screen; the link gets #agent so the
// browser's Back button returns to the landing page.
// ---------------------------------------------------------------------------
function showApp(push = true) {
  document.documentElement.classList.add('in-app');
  if (push && location.hash !== '#agent') history.pushState(null, '', '#agent');
  closeSheets();
  scrollTo(0, 0);
  requestAnimationFrame(fitLoop);
}
function showLanding(push = true) {
  document.documentElement.classList.remove('in-app');
  if (push) history.pushState(null, '', location.pathname + location.search);
  closeSheets();
  scrollTo(0, 0);
}
$('#startBtn').onclick = () => showApp();
$('#homeBtn').onclick = () => showLanding();
$('#homeLink').onclick = e => { e.preventDefault(); showLanding(); };
// Back / Forward: #agent → agent screen, no hash → landing. Other hashes are in-page jumps.
addEventListener('popstate', () => {
  if (location.hash === '#agent') showApp(false);
  else if (!location.hash) showLanding(false);
});

// In-page links (#loop, #results, #details…) scroll smoothly instead of changing the URL,
// so the landing / agent switch above is never confused by them.
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.getAttribute('href').length < 2) return;
  const target = document.querySelector(a.getAttribute('href'));
  if (!target) return;
  e.preventDefault();
  closeSheets();
  // Results and Reasoning only exist after a run: until then, point at the Run button instead
  if (target.closest('[hidden]')) {
    scrollTo({ top: 0, behavior: 'smooth' });
    $('#runBtn').classList.remove('idle'); void $('#runBtn').offsetWidth; $('#runBtn').classList.add('idle');
    return;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------------
// SLIDING PANELS: rules, your data, about, agents and the detail panel all slide
// in from the right. Only one is open at a time; the dark scrim behind closes it.
// On phones the sidebar slides in from the left the same way.
// ---------------------------------------------------------------------------
const SHEETS = ['#rulesPanel', '#ownData', '#aboutPanel', '#agentsPanel', '#drawer'];
function openSheet(sel) {
  closeSheets(sel);
  const el = $(sel);
  el.hidden = false;
  $('#scrim').hidden = false;
  void el.offsetWidth;                 // let the browser draw it off-screen first, so it slides in
  el.classList.add('open');
  $('#scrim').classList.add('open');
  $('#ownBtn').setAttribute('aria-expanded', String(sel === '#ownData'));
  $('#rulesBtn').setAttribute('aria-expanded', String(sel === '#rulesPanel'));
}
function closeSheets(except) {
  for (const sel of SHEETS) {
    const el = $(sel);
    if (sel === except || !el.classList.contains('open')) continue;
    el.classList.remove('open');
    setTimeout(() => { if (!el.classList.contains('open')) el.hidden = true; }, 320);
  }
  $('#side').classList.remove('open');
  $$('.row.hl').forEach(x => x.classList.remove('hl'));
  if (!except) {
    $('#scrim').classList.remove('open');
    setTimeout(() => { if (!$('#scrim').classList.contains('open')) $('#scrim').hidden = true; }, 260);
  }
  $('#ownBtn').setAttribute('aria-expanded', 'false');
  $('#rulesBtn').setAttribute('aria-expanded', 'false');
}
const isOpen = sel => $(sel).classList.contains('open');
$('#scrim').onclick = () => closeSheets();
$$('[data-close]').forEach(b => b.onclick = () => closeSheets());
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

// Phones: the menu button slides the sidebar in; picking anything closes it again.
$('#menuBtn').onclick = () => {
  $('#side').classList.add('open');
  $('#scrim').hidden = false; void $('#scrim').offsetWidth; $('#scrim').classList.add('open');
};

// "About" and "Meet the agents" buttons (on the landing page and in the sidebar)
$$('[data-open]').forEach(b => b.onclick = () => openSheet(b.dataset.open === 'about' ? '#aboutPanel' : '#agentsPanel'));

// ---------------------------------------------------------------------------
// CONTROLS + loading data
// ---------------------------------------------------------------------------
// "Connect data" opens the panel with CSV / Sheet / Meta / Settings
$('#ownBtn').onclick = () => (isOpen('#ownData') ? closeSheets() : openSheet('#ownData'));
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
  state.paceCut = {};
  for (const k of Object.keys(counts)) delete counts[k];
  setStatus(describe(state.data));
  renderSources();
}

// Summarise loaded data in one line, e.g. "490 rows · 14 days · Facebook, Google · Shopify orders ✓"
function describe(d) {
  const dates = [...new Set(d.clean.map(r => r.date))];
  const ch = [...new Set(d.clean.map(r => r.channel))];
  return `<b>${esc(d.brand)}</b> · ${d.rows.length} rows · ${dates.length} days · ${esc(ch.join(', '))} · ${d.orders?.length ? `${esc(d.ordersFrom || 'Shopify')} orders ✓` : '<span style="color:var(--amber)">no orders file (ROAS estimated)</span>'}${d.competitors?.length ? ' · competitor ads ✓' : ''}` +
    (d.connected?.length ? `<br><small>Connected: ${esc(d.connected.join(' · '))}</small>` : '');
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
    mergeIn({ rows, label: 'Meta Ads API' });
    if (!state.data.orders?.length) setStatus(describe(state.data) + '<br><small>Tip: connect Shopify or GA4 (or upload an orders CSV) for true ROAS.</small>');
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

// ---------------------------------------------------------------------------
// Several sources together: each new connection is ADDED to your own data.
//   • ad rows replace only the channels they bring (Google Ads replaces Google rows, keeps Meta)
//   • orders (Shopify / GA4 / a partner) replace the earlier orders source
// The first real connection drops the fictional sample ads, so real and sample never mix,
// except when you connect only an orders source: then the sample ads stay until you add yours.
// ---------------------------------------------------------------------------
function mergeIn({ rows = [], orders = null, label, ordersFrom }) {
  const cur = state.data || {};
  const fromSample = cur.source === 'Sample';
  const channelOf = r => cleanRows([r])[0]?.channel;
  const newCh = new Set(rows.map(channelOf));
  const keepRows = fromSample && rows.length ? [] : (cur.rows || []).filter(r => !newCh.has(channelOf(r)));
  const next = {
    brand: fromSample && rows.length ? 'Your brand' : cur.brand || 'Your brand',
    category: cur.category || 'consumer products',
    rows: [...keepRows, ...rows],
    orders: orders || (fromSample && rows.length ? [] : cur.orders || []),
    competitors: fromSample && rows.length ? [] : cur.competitors || [],
    ordersFrom: orders ? ordersFrom || label : (fromSample && rows.length ? undefined : cur.ordersFrom),
    source: rows.length || !fromSample ? 'Connected' : 'Sample',
    connected: [...new Set([...(fromSample ? [] : cur.connected || []), label])],
  };
  if (!next.rows.length) return setStatus(`${esc(label)} is connected. Now connect an ad source (Meta, Google Ads or a partner) so the agents have ads to check.`, 'err');
  setData(next);
  if (next.source === 'Sample') setStatus(describe(state.data) + `<br><small>${esc(label)} orders are in; the ads are still the sample brand's until you connect your ad account.</small>`);
}

$('#loadGads').onclick = async () => {
  const token = $('#gadsToken').value.trim(), devToken = $('#gadsDev').value.trim(), customer = $('#gadsCustomer').value.trim();
  if (!token || !devToken || !customer) return setStatus('Google Ads needs an access token, a developer token and a customer ID.', 'err');
  setStatus('Pulling from the Google Ads API…', '');
  try {
    const { rows } = await connect({ type: 'gads', token, devToken, customer, manager: $('#gadsManager').value.trim() });
    mergeIn({ rows, label: 'Google Ads API' });
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

$('#loadGa4').onclick = async () => {
  const token = $('#ga4Token').value.trim(), property = $('#ga4Property').value.trim();
  if (!token || !property) return setStatus('GA4 needs an access token and a property ID.', 'err');
  setStatus('Pulling purchases from GA4…', '');
  try {
    const { orders } = await connect({ type: 'ga4', token, property });
    mergeIn({ orders, label: 'GA4', ordersFrom: 'GA4' });
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

$('#loadShop').onclick = async () => {
  const shop = $('#shopDomain').value.trim(), token = $('#shopToken').value.trim();
  if (!shop || !token) return setStatus('Shopify needs the store address and an Admin API token.', 'err');
  setStatus('Pulling orders from Shopify…', '');
  try {
    const { orders } = await connect({ type: 'shopify', shop, token });
    mergeIn({ orders, label: 'Shopify API', ordersFrom: 'Shopify' });
  } catch (e) { setStatus(esc(e.message), 'err'); }
};

// Partners without a simple live API for small brands: upload the report each one exports.
// kind 'ads'   → ad rows (spend, clicks, sales the platform claims), tagged with the partner's channel
// kind 'sales' → orders (what really sold), used like Shopify orders
const PARTNERS = [
  { name: 'Amazon Ads', ch: 'Amazon', kind: 'ads', where: 'Amazon Ads console → Reports → Sponsored Products, daily, campaign + ad' },
  { name: 'Flipkart Ads', ch: 'Flipkart', kind: 'ads', where: 'Flipkart Ads → Reports → Campaign performance, daily' },
  { name: 'Myntra Ads', ch: 'Myntra', kind: 'ads', where: 'Myntra Partner Portal → Ads → Performance report' },
  { name: 'Nykaa Ads', ch: 'Nykaa', kind: 'ads', where: 'Nykaa Ads platform → Reports → Daily campaign report' },
  { name: 'Blinkit Ads', ch: 'Blinkit', kind: 'ads', where: 'Blinkit brand portal → Ads → Campaign report' },
  { name: 'Zepto Ads', ch: 'Zepto', kind: 'ads', where: 'Zepto brand dashboard → Ads → Download report' },
  { name: 'Swiggy Instamart Ads', ch: 'Instamart', kind: 'ads', where: 'Swiggy Ads → Instamart → Campaign report' },
  { name: 'YouTube', ch: 'Google', kind: 'ads', where: 'Google Ads → Campaigns → filter Video → Download (CSV)' },
  { name: 'LinkedIn Ads', ch: 'LinkedIn', kind: 'ads', where: 'Campaign Manager → Analyze → Export, time breakdown Daily' },
  { name: 'Snapchat Ads', ch: 'Snapchat', kind: 'ads', where: 'Ads Manager → Reports → Daily breakdown → Export' },
  { name: 'Pinterest Ads', ch: 'Pinterest', kind: 'ads', where: 'Ads Manager → Reporting → Export, daily' },
  { name: 'X Ads', ch: 'X', kind: 'ads', where: 'X Ads → Campaigns → Data → Export, daily' },
  { name: 'InMobi', ch: 'InMobi', kind: 'ads', where: 'InMobi Advertiser dashboard → Reports → Export' },
  { name: 'WooCommerce', ch: '', kind: 'sales', where: 'WooCommerce → Orders → Export (include UTM source / order attribution)' },
  { name: 'Amazon Seller Central', ch: 'Amazon', kind: 'sales', where: 'Seller Central → Reports → Business Reports → by date' },
  { name: 'Flipkart Seller Hub', ch: 'Flipkart', kind: 'sales', where: 'Seller Hub → Reports → Orders report' },
  { name: 'Razorpay', ch: '', kind: 'sales', where: 'Razorpay Dashboard → Transactions → Payments → Export (with notes / UTM)' },
  { name: 'Shiprocket', ch: '', kind: 'sales', where: 'Shiprocket → Orders → Export, delivered orders' },
  { name: 'AppsFlyer', ch: '', kind: 'sales', where: 'AppsFlyer → Export data → In-app events (af_purchase), by media source' },
  { name: 'Branch', ch: '', kind: 'sales', where: 'Branch → Data Feeds → Exports → purchase events by channel' },
];
let partner = null;
$('#partners').innerHTML = `<div class="k">Ad platforms</div>${PARTNERS.filter(p => p.kind === 'ads').map(p => `<button type="button" class="pchip" data-p="${esc(p.name)}">${esc(p.name)}</button>`).join('')}
  <div class="k">Sales, payments &amp; attribution</div>${PARTNERS.filter(p => p.kind === 'sales').map(p => `<button type="button" class="pchip" data-p="${esc(p.name)}">${esc(p.name)}</button>`).join('')}`;
$$('.pchip').forEach(b => b.onclick = () => {
  partner = PARTNERS.find(p => p.name === b.dataset.p);
  $$('.pchip').forEach(x => x.classList.toggle('on', x === b));
  $('#partnerUp').hidden = false;
  $('#partnerLabel').textContent = `Upload your ${partner.name} report (CSV)`;
  $('#partnerHint').innerHTML = `Where to find it: ${esc(partner.where)}.<br>${partner.kind === 'ads'
    ? 'Needs date, campaign, ad, spend, impressions, clicks; conversions and sales value if the report has them. Every row is tagged as ' + esc(partner.ch) + '.'
    : 'Needs a date, the order value and, if possible, the traffic source (UTM source / media source). One row per order is fine.'}`;
  $('#filePartner').value = '';
});
$('#filePartner').onchange = async () => {
  const f = $('#filePartner').files[0]; if (!f || !partner) return;
  try {
    const raw = parseCSV(await f.text());
    if (!raw.length) throw new Error('The file has no rows.');
    if (partner.kind === 'ads') mergeIn({ rows: raw.map(r => ({ ...r, channel: partner.ch })), label: partner.name });
    else mergeIn({ orders: ordersFromReport(raw, partner.ch), label: partner.name, ordersFrom: partner.name });
  } catch (e) { setStatus(`Could not read the ${esc(partner.name)} file: ${esc(e.message)}`, 'err'); }
};

// A sales report (one row per order, or already per day) → { date, channel, orders, revenue } per day and source
function ordersFromReport(raw, fallbackCh) {
  const get = (r, names) => { for (const k of Object.keys(r)) if (names.includes(k.trim().toLowerCase())) return r[k]; };
  const money = v => Number(String(v ?? '').replace(/[₹,\s]/g, '')) || 0;
  const map = new Map();
  for (const r of raw) {
    const date = cleanOrders([{ date: get(r, ['date', 'order date', 'created_at', 'created at', 'event_time', 'event time', 'day']) }])[0]?.date;
    if (!date) continue;
    const ch = get(r, ['utm_source', 'utm source', 'source', 'channel', 'media_source', 'media source', 'attribution', 'origin']) || fallbackCh || 'Direct';
    const k = date + '||' + ch;
    const x = map.get(k) || { date, channel: ch, orders: 0, revenue: 0 };
    x.orders += money(get(r, ['orders', 'units ordered', 'order count', 'total orders'])) || 1;
    x.revenue += money(get(r, ['revenue', 'total', 'amount', 'order total', 'total_price', 'order value', 'ordered product sales', 'event_revenue', 'event revenue', 'gmv']));
    map.set(k, x);
  }
  if (!map.size) throw new Error('No dated rows found. The report needs a date column.');
  return [...map.values()];
}

// Settings remembered on this device only
const remember = (sel, key) => {
  const saved = store.get(key);
  if (saved !== null) $(sel).value = saved;
  $(sel).addEventListener('change', e => store.set(key, e.target.value.trim()));
};
remember('#webhook', 'drishti-webhook');
remember('#email', 'drishti-email');
remember('#phone', 'drishti-phone');

// Email / WhatsApp switches for action reports. Each one turns on or off by itself:
// Email is on by default, WhatsApp is optional, and with both on every report goes to both.
const sendsTo = via => $(`.via [data-via="${via}"]`).getAttribute('aria-checked') === 'true';
function setChannels(on) {
  $$('.via button').forEach(b => b.setAttribute('aria-checked', String(on.includes(b.dataset.via))));
  $('#emailWrap').hidden = !on.includes('email');
  $('#phoneWrap').hidden = !on.includes('whatsapp');
  store.set('drishti-channels', on.join(','));
}
$$('.via button').forEach(b => b.onclick = () => {
  const on = $$('.via button').filter(x => (x === b) !== (x.getAttribute('aria-checked') === 'true')).map(x => x.dataset.via);
  setChannels(on);
});
setChannels((store.get('drishti-channels') ?? 'email').split(',').filter(Boolean));

// ---------------------------------------------------------------------------
// YOUR RULES: a list you can add to, edit and remove from.
// Each rule is a sentence with blanks, e.g. "Pause an ad if cost per sale is above ₹[800] for [3] days".
// Saved on this device; sent to the agents with every run.
// ---------------------------------------------------------------------------
function loadRules() {
  let saved = null;
  try { saved = JSON.parse(store.get('drishti-rules') || 'null'); } catch {}
  // Older visits saved only the flat-revenue days; turn that into the first rule.
  const oldDays = store.get('drishti-flat-days');
  const list = Array.isArray(saved) ? saved : oldDays ? [{ type: 'flat', a: Number(oldDays) }] : DEFAULT_RULES;
  state.rules = list.map(cleanRule).filter(Boolean);
}
function saveRules() { store.set('drishti-rules', JSON.stringify(state.rules)); renderRuleSum(); }

// The rule as a sentence with number boxes in place of the blanks
function ruleInputs(r, i) {
  const t = RULE_TYPES[r.type];
  const box = k => `<input class="field tiny" type="number" data-i="${i}" data-k="${k}" value="${r[k]}" min="${t[k].min}" max="${t[k].max}" step="${t[k].step}" aria-label="Rule ${i + 1}, ${k === 'a' ? 'first' : 'second'} number">`;
  // split on the blanks so the boxes go exactly where {a} and {b} are
  return t.text.split(/(\{[ab]\})/).map(part => (part === '{a}' ? box('a') : part === '{b}' ? box('b') : esc(part))).join('');
}

function renderRules() {
  $('#ruleList').innerHTML = state.rules.length
    ? state.rules.map((r, i) => `<li><span class="rl-agent" style="--c:var(--${RULE_TYPES[r.type].agent})">${esc(agentName(RULE_TYPES[r.type].agent))}</span>
        <span class="rl-text">${ruleInputs(r, i)}</span>
        <button class="mini" type="button" data-del="${i}" aria-label="Remove this rule">✕</button></li>`).join('')
    : '<li class="none">No rules yet. The agents will still recommend fixes, but nothing runs on your standing orders.</li>';
  // typing in a box updates that rule
  $$('#ruleList input').forEach(inp => inp.onchange = () => {
    const r = state.rules[Number(inp.dataset.i)];
    r[inp.dataset.k] = Number(inp.value);
    Object.assign(r, cleanRule(r)); inp.value = r[inp.dataset.k];
    saveRules();
  });
  $$('#ruleList [data-del]').forEach(b => b.onclick = () => { state.rules.splice(Number(b.dataset.del), 1); saveRules(); renderRules(); });
  renderRuleSum();
}

// The short version in the sidebar: how many rules are on (the full, editable list is in the panel)
function renderRuleSum() {
  $('#ruleSum').textContent = state.rules.length ? String(state.rules.length) : '';
}

$('#ruleType').innerHTML = Object.entries(RULE_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.text.replace('{a}', '…').replace('{b}', '…'))}</option>`).join('');
$('#addRule').onclick = () => {
  const t = RULE_TYPES[$('#ruleType').value];
  state.rules.push({ type: $('#ruleType').value, a: t.a.def, b: t.b?.def });
  saveRules(); renderRules();
  $('#ruleList li:last-child input')?.focus();
};
$('#resetRules').onclick = () => { state.rules = DEFAULT_RULES.map(r => ({ ...r })); saveRules(); renderRules(); };
$('#rulesBtn').onclick = () => (isOpen('#rulesPanel') ? closeSheets() : openSheet('#rulesPanel'));
loadRules();
renderRules();

// Ask the backend which AI engine is on (Groq / Gemini / rules)
// and which models it can switch between (for the picker in ②).
// If the backend doesn't answer within 8 seconds (server down, or a network that
// blocks vercel.app), mark it offline so runs happen right here in the browser.
fetch(API + '/api/health', { signal: AbortSignal.timeout(8000) }).then(r => r.json()).then(h => {
  state.engine = h.engine;
  state.models = h.models || [];
  renderModelPick();
}).catch(() => { state.offline = true; renderModelPick(); });

// The model picker: the default model is always on; choosing another swaps it for the next run.
// "Built-in rules" runs the same agent maths with no AI model at all.
function renderModelPick() {
  const saved = store.get('drishti-model');
  const opts = [...state.models, { id: 'rules', label: 'Built-in rules (no AI)' }];
  $('#modelPick').innerHTML = opts.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  $('#modelPick').value = opts.some(m => m.id === saved) ? saved : opts[0].id;
}
$('#modelPick').onchange = () => {
  store.set('drishti-model', $('#modelPick').value);
  const label = $('#modelPick').selectedOptions[0]?.textContent;
  watchLine(`Model swapped to <b>${esc(label)}</b>. The next run thinks with it.`);
  log(`Model swapped to ${label}`);
};

// ---------------------------------------------------------------------------
// ① DATA COMING IN: one tile per source, hover to peek at the rows
// ---------------------------------------------------------------------------
// icon name per ad channel (any other channel, e.g. Amazon or Blinkit, gets the chart icon)
const ICONS = { Facebook: 'facebook', Instagram: 'instagram', Meta: 'infinity', Google: 'google', JioHotstar: 'tv' };

// The list of sources for the loaded data. Each has a name (used to route
// "fed back" updates to the right tile), an icon and a one-line summary.
function sourceList() {
  const d = state.data; if (!d) return [];
  const last = [...new Set(d.clean.map(r => r.date))].sort().slice(-1)[0];
  const channels = [...new Set(d.clean.map(r => r.channel))];
  const list = channels.map(ch => {
    const today = d.clean.filter(r => r.channel === ch && r.date === last);
    const ads = new Set(d.clean.filter(r => r.channel === ch).map(r => r.ad));
    return { key: ch, icon: ICONS[ch] || 'chart', name: ch === 'JioHotstar' ? 'JioHotstar · TV' : ch + ' Ads',
      sub: `${ads.size} ad${ads.size > 1 ? 's' : ''} · ${inr(today.reduce((s, r) => s + r.spend, 0))}/day`, on: true };
  });
  list.push({ key: 'Shopify', icon: 'bag', name: `${d.ordersFrom || 'Shopify'} orders`, on: d.cleanOrders.length > 0,
    sub: d.cleanOrders.length ? `${Math.round(d.cleanOrders.filter(o => o.date === last).reduce((s, o) => s + o.orders, 0)).toLocaleString('en-IN')} orders yesterday` : 'not connected · ROAS estimated' });
  list.push({ key: 'Competitors', icon: 'search', name: 'Competitor ads', on: d.cleanComp.length > 0,
    sub: d.cleanComp.length ? `${new Set(d.cleanComp.map(c => c.competitor)).size} rivals · Ad Library` : 'not connected' });
  list.push({ key: 'News', icon: 'news', name: 'Live news', on: true, sub: 'Google News · read each run' });
  list.push({ key: 'Calendar', icon: 'calendar', name: 'Sale calendar', on: true, sub: nextEvent() });
  return list;
}

function nextEvent() {
  const now = Date.now();
  const e = EVENTS.map(x => ({ ...x, in: Math.round((new Date(x.date + 'T00:00:00Z') - now) / 864e5) })).find(x => x.in >= 0);
  return e ? `${e.name} in ${e.in} days` : 'festive dates';
}

function renderSources() {
  const list = sourceList();
  $('#srcCount').textContent = `${list.filter(s => s.on).length} live sources`;
  $('#sources').innerHTML = list.map(s => {
    const upd = (state.updates[s.key] || [])[0];
    // the small summary sits after the live line so CSS can show it only when there is no live line
    return `<div class="src ${s.on ? '' : 'off'}" id="src-${s.key.replace(/\W/g, '')}" data-tip="src" data-key="${esc(s.key)}" tabindex="0">
      <span class="ic">${ic(s.icon)}</span><b>${esc(s.name)}</b>
      <span class="live" data-live="${esc(s.key)}"></span><small>${esc(s.sub)}</small>
      ${upd ? `<span class="upd">↺ ${esc(upd)}</span>` : ''}<span class="stream"></span></div>`;
  }).join('');
  tick();
}

// ---------------------------------------------------------------------------
// LIVE COUNTERS: every tile counts up all the time, at the pace of the latest day
// in the data (views, clicks, spend, orders "today so far"). When an agent pauses
// or holds something, that channel's pace drops, so you can watch the fix land.
// ---------------------------------------------------------------------------
const nIN = n => Math.floor(n).toLocaleString('en-IN');

// Share of today gone by in India (0 → midnight, 1 → just before the next midnight)
function dayShare() {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return (ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds()) / 86400;
}

// Per-tile totals for one whole day, from the latest day in the data (the pace of the counters)
function dayTotals(key) {
  const d = state.data; if (!d) return null;
  const last = [...new Set(d.clean.map(r => r.date))].sort().slice(-1)[0];
  if (key === 'Shopify') {
    const o = d.cleanOrders.filter(x => x.date === last);
    return o.length ? { orders: o.reduce((s, x) => s + x.orders, 0), revenue: o.reduce((s, x) => s + x.revenue, 0) } : null;
  }
  const rows = d.clean.filter(r => r.channel === key && r.date === last);
  if (!rows.length) return null;
  const t = rows.reduce((s, r) => ({ spend: s.spend + r.spend, views: s.views + r.impressions, clicks: s.clicks + r.clicks }), { spend: 0, views: 0, clicks: 0 });
  // Paused / held ads stop spending: scale the whole tile down by the money the agents cut
  const keep = t.spend ? Math.max(0, 1 - (state.paceCut[key] || 0) / t.spend) : 1;
  return { spend: t.spend * keep, views: t.views * keep, clicks: t.clicks * keep };
}

// Running counts per tile. They start at "today so far" and then only ever go UP,
// by the tile's pace × the seconds since the last tick, with a little randomness so
// they move like real traffic. A paused ad slows the pace; it never takes counts away.
const counts = {};
function grow(key, t) {
  const now = Date.now();
  const c = counts[key];
  if (!c) { counts[key] = { at: now, v: Object.fromEntries(Object.entries(t).map(([k, x]) => [k, x * dayShare()])) }; return counts[key].v; }
  const secs = Math.min(5, (now - c.at) / 1000);
  c.at = now;
  for (const k of Object.keys(t)) c.v[k] += (t[k] / 86400) * secs * (0.6 + Math.random() * 0.8);
  return c.v;
}
function liveText(key) {
  const now = Date.now();
  if (key === 'News') return `<i></i>checked ${Math.floor((now / 1000) % 45)}s ago · next in ${45 - Math.floor((now / 1000) % 45)}s`;
  if (key === 'Competitors') return state.data?.cleanComp.length ? `<i></i>Ad Library scanned ${Math.floor((now / 1000) % 60)}s ago` : '';
  if (key === 'Calendar') {
    const e = EVENTS.map(x => ({ ...x, t: new Date(x.date + 'T00:00:00+05:30') - now })).find(x => x.t > 0);
    if (!e) return '';
    const sec = Math.floor(e.t / 1000);
    return `<i></i>${Math.floor(sec / 86400)}d ${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} to ${esc(e.name)}`;
  }
  const t = dayTotals(key); if (!t) return '';
  const v = grow(key, t);
  if (key === 'Shopify') return `<i></i><b>${nIN(v.orders)}</b> orders · <b>₹${nIN(v.revenue)}</b> today`;
  // views · clicks · ₹ spent, all "today so far"
  return `<i></i><span title="views today"><b>${nIN(v.views)}</b> views</span> · <span title="clicks today"><b>${nIN(v.clicks)}</b> clicks</span> · <span title="spent today"><b>₹${nIN(v.spend)}</b></span>`;
}

function tick() {
  $$('.src .live').forEach(el => {
    const html = liveText(el.dataset.live);
    if (html !== el.innerHTML) el.innerHTML = html;
  });
}
setInterval(tick, 1000);

// ---------------------------------------------------------------------------
// ② is always on: between full runs the Orchestrator keeps watching the streams.
// One line under the agent strip shows what it just looked at.
// ---------------------------------------------------------------------------
let rowsSeen = 0;
function watchLine(html) {
  const el = $('#watch');
  el.innerHTML = `<i class="live-dot"></i><span>${html}</span>`;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function watchBeat() {
  if (state.running || !state.data) return;
  const ads = sourceList().filter(s => s.on && dayTotals(s.key) && s.key !== 'Shopify');
  if (!ads.length) return;
  const s = ads[Math.floor(Math.random() * ads.length)];
  const fresh = 20 + Math.floor(Math.random() * 180);
  rowsSeen += fresh;
  const model = $('#modelPick').selectedOptions[0]?.textContent || 'rules';
  const nRules = state.rules.length;
  watchLine(`<b>Watching</b> · read +${fresh} new rows from ${esc(s.name)} · ${nRules} rule${nRules === 1 ? '' : 's'} checked · nothing urgent · <span class="m">${esc(cut(model, 34))}</span>`);
}
setInterval(watchBeat, 3200);

// ---------------------------------------------------------------------------
// The top bar slides away when you scroll down and comes back when you scroll up.
// ---------------------------------------------------------------------------
let lastY = scrollY;
addEventListener('scroll', () => {
  const y = scrollY;
  if (Math.abs(y - lastY) < 6) return;          // ignore tiny jiggles
  $('.bar').classList.toggle('hide', y > lastY && y > 60);
  lastY = y;
}, { passive: true });

// Data streaming in: dots move along each source tile while the loop reads it.
function setFlowing(on) { $$('.src:not(.off)').forEach(el => el.classList.toggle('flowing', on)); }

// ---------------------------------------------------------------------------
// The loop's stage: lights the boxes up one after another.
//   step n is "active" (glowing), steps before it are "done" (stay lit),
//   steps after it are "dim" (not reached yet).
//   n = 0 means idle: before any run only box ① is lit (the data is ready);
//   after a run every box stays lit as done.
// The progress bar and the 4-step strip above the boxes follow the same steps.
// ---------------------------------------------------------------------------
// each step's box (③ and ④ are drawn as a "shell" behind a header, so both get the class)
const BOXES = [['#q1'], ['#q2'], ['#q3', '.s-right'], ['#q4', '.s-left']];
const STEP_BUSY = ['reading data…', 'thinking…', 'recommending…', 'acting…'];

function stage(n, label) {
  const finished = n === 0 && state.result;
  BOXES.forEach((sels, i) => {
    const step = i + 1;
    let cls;
    if (finished) cls = 'done';                              // after a run: everything lit
    else if (n === 0) cls = step === 1 ? 'done' : 'dim';     // before a run: only the data is ready
    else cls = step < n ? 'done' : step === n ? 'active' : 'dim';
    for (const s of sels) {
      $(s).classList.remove('active', 'done', 'dim');
      $(s).classList.add(cls);
    }
    const li = $(`.steps li[data-step="${step}"]`);
    li.classList.remove('active', 'done');
    if (cls !== 'dim') li.classList.add(cls);
    li.querySelector('small').textContent = stepNote(step, cls, finished);
  });
  // progress bar: a quarter per step; inside step ④, playActions() moves it along per action
  setProgress(finished ? 100 : n === 0 ? 0 : (n - 1) * 25 + 10);
  $('#pbar').classList.toggle('running', state.running);
  $('#flow12').classList.toggle('on', n === 1 || n === 2);
  $('#flow23').classList.toggle('on', n === 3);
  $('#hub').classList.toggle('running', state.running);
  if (label) $('#hubIn').innerHTML = label;
}

// the small status line under each step name, e.g. "thinking…" or "5 found"
function stepNote(step, cls, finished) {
  if (cls === 'active') return STEP_BUSY[step - 1];
  if (cls === 'dim') return 'waiting';
  const r = state.result;
  if (step === 1) return `${sourceList().filter(s => s.on).length} sources`;
  if (step === 2) return `${$$('.agent-node.done, .agent-node.alert').length || AGENTS.length} agents done`;
  if (step === 3) return r ? `${r.actions.length} found` : 'done';
  if (step === 4 && r) {
    const done = r.actions.filter(a => a.state === 'done').length, ask = r.actions.filter(a => a.state === 'waiting').length;
    return `${done} done${ask ? ` · ${ask} need you` : ''}`;
  }
  return 'done';
}

function setProgress(pct) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  $('#pbarFill').style.width = pct + '%';
  $('#pbar').setAttribute('aria-valuenow', String(pct));
}

// ---------------------------------------------------------------------------
// ② AGENTS AT WORK (streamed)
// ---------------------------------------------------------------------------
function renderStrip() {
  $('#agentStrip').innerHTML = AGENTS.map(a =>
    `<div class="agent-node" id="node-${a.id}" style="--c:var(--${a.id})" data-tip="agent" data-id="${a.id}" tabindex="0"><div class="dot">${ic(a.icon)}</div><b>${a.name}</b><span class="role">${a.role}</span></div>`).join('');
  $('#agentBar').style.width = '0';
}
renderStrip();

function setNode(id, status) {
  const n = $('#node-' + id); if (!n) return;
  n.classList.remove('working', 'done', 'alert');
  n.classList.add(status);
  // the thin bar under the agents fills up as each one finishes
  const finished = $$('.agent-node.done, .agent-node.alert').length;
  $('#agentBar').style.width = (finished / AGENTS.length) * 100 + '%';
}

function addFeed(html, cls, agentId) {
  const feed = $('#feed');
  const div = document.createElement('div');
  div.className = 'ev ' + (cls || '');
  div.style.setProperty('--c', `var(--${agentId || 'ORC'})`);
  div.innerHTML = html;
  // the line is cut to one line on screen; clicking it opens the full text in the detail panel
  div.dataset.tip = 'ev';
  div.dataset.agent = agentId || 'ORC';
  div.dataset.full = div.querySelector('.txt')?.textContent || '';
  div.tabIndex = 0;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return div;
}

// Events arrive faster than people can read, so show them at a readable pace.
const PACE = { thought: 650, working: 500, done: 750, alert: 750 };

async function showEvent(e) {
  if (e.type === 'start') {
    // If the picked model was busy the backend falls back to another one; say so.
    const picked = $('#modelPick').selectedOptions[0]?.textContent;
    if (picked && !picked.startsWith(e.engine) && !(e.engine === 'Built-in rules' && $('#modelPick').value === 'rules')) {
      addFeed(`<span class="tag">model</span><span class="txt">Thinking with ${esc(e.engine)}.</span>`, 'thought', 'ORC');
    }
    addFeed(`<span class="tag">RUN</span><span class="txt">Loop ${state.loop} · <b>${esc(e.brand)}</b> · ${e.period.days} days · ${inr(e.totals.spend)} spend</span>`, '', 'ORC');
    stage(2, '<b>Step 2</b><small>thinking…</small>');
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
  if (!state.data?.rows?.length) { openSheet('#ownData'); return setStatus('Load some data first.', 'err'); }
  state.running = true; state.loop++;
  state.agentLog = {}; state.mail = {}; state.wa = {};
  // A fresh id per run, so WhatsApp button taps land on the right run's actions
  state.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  clearInterval(state.waPoll);
  const btn = $('#runBtn');
  btn.disabled = true; btn.classList.remove('idle'); btn.innerHTML = 'Agent running…';
  state.result = null;   // so the boxes start from step ① again
  $('#feed').innerHTML = '';
  renderStrip();
  $('#rows').innerHTML = '';
  $('#actCount').textContent = ''; $('#statusPill').textContent = ''; $('#statusPill').className = 'pill';

  watchLine(`<b>Full check running</b> · loop ${state.loop} · ${esc($('#modelPick').selectedOptions[0]?.textContent || '')}`);
  // ① Data comes in first
  stage(1, '<b>Step 1</b><small>reading data…</small>');
  setFlowing(true);
  await wait(900);

  const queue = []; let finished = false;
  // Reader: pulls lines off the network stream into a queue
  const reader = (async () => {
    try {
      const body = { brand: state.data.brand, category: state.data.category, rows: state.data.rows, orders: state.data.orders,
        competitors: state.data.competitors || [], breakevenRoas: Number($('#breakeven').value) || 2,
        rules: state.rules, model: $('#modelPick').value || undefined };
      // Backend known to be unreachable → go straight to the on-device run
      if (state.offline) return await runHere(body, queue);
      // Give the server 10 seconds to start answering; after that, run here instead
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let res;
      try {
        res = await fetch(API + '/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
        });
      } catch {
        state.offline = true; renderModelPick();
        return await runHere(body, queue);
      } finally { clearTimeout(timer); }
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Server error ' + res.status); }
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) queue.push(JSON.parse(line)); }
      }
    } catch (e) { queue.push({ type: 'error', message: e.message + ' Check your connection and try again.' }); }
    finally { finished = true; }
  })();
  // Player: shows queued events at a human pace
  while (!finished || queue.length) {
    if (queue.length) await showEvent(queue.shift()); else await sleep(60);
  }
  await reader;
  setFlowing(false);
  state.running = false;
  btn.disabled = false; btn.innerHTML = `${ic('loop')}Run again`;
  hubIdle();
  watchLine('<b>Back to watching</b> · the next full check re-reads everything the agents just changed');
}
$('#runBtn').onclick = run;

// Fallback: when the server can't be reached, run the same agents in this browser.
// It uses the built-in rules engine (AI keys only live on the server), so the loop
// still completes with real numbers instead of hanging on "reading…".
async function runHere(body, queue) {
  queue.push({ type: 'thought', text: 'Server not reachable from this network, so the agents are running right here in your browser (built-in rules engine).' });
  const { runDrishti } = await import('./lib/agent.js');
  await runDrishti({ ...body, model: 'rules' }, e => queue.push(e));
}
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
    <div class="who"><span class="tag">${esc(agentName(a.agent))}</span><span class="lbl">${a.rule ? 'your rule' : ''}</span><span class="money" style="margin-left:auto">${money(a)}</span></div>
    <p class="obs">${esc(a.observed || a.detail)}</p>
    <p class="rec">${esc(a.recommend || a.title)}</p></div>`;
}

// The action card changes as the agent works: pending → executing → done (or waiting → approved / rejected)
function actCard(a) {
  const st = a.state || 'pending';
  const who = `<div class="who"><span class="tag" style="--c:var(--${a.agent})">${esc(agentName(a.agent))}</span><span class="lbl">${{ executing: 'agent working', done: 'action taken', waiting: 'needs you', rejected: 'not done', undone: 'rolled back', pending: '' }[st] || ''}</span></div>`;
  // Report status lines (email, then WhatsApp). When email services are down the email line
  // becomes a link that opens the report in the visitor's own email app.
  const line = (m, icon) => !m ? '' : m.href
    ? `<a class="mail" href="${esc(m.href)}" title="${esc(m.text)}">${ic(icon)} ${esc(m.text)}</a>`
    : `<span class="mail ${m.ok ? 'sent' : ''}" title="${esc(m.text)}">${ic(icon)} ${esc(m.text)}</span>`;
  const mail = line(state.mail[a.id], 'mail') + line(state.wa[a.id], 'chat');
  if (st === 'pending') return `<div class="card-a pending">…</div>`;
  if (st === 'executing') return `<div class="card-a executing" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('zap')} ${esc(a.execute || a.title)}</div></div>`;
  if (st === 'waiting') return `<div class="card-a waiting" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('clock')} ${esc(a.title)}</div>
    <div class="foot">${a.held ? '<span class="badge hold">On hold</span>' : '<span class="badge wait">Your call</span>'}<button class="mini yes" data-act="approve" data-id="${a.id}">Approve</button>${a.held ? '' : `<button class="mini" data-act="hold" data-id="${a.id}">Hold</button>`}<button class="mini" data-act="reject" data-id="${a.id}">Reject</button></div></div>`;
  if (st === 'done') return `<div class="card-a done" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('check')} ${esc(a.feedback || a.title)}</div>
    <div class="foot"><span class="badge auto">${a.tier === 'auto' ? (a.rule ? 'Auto · your rule' : 'Auto') : 'Approved'}${a.sentTo ? ' · sent to ' + esc(a.sentTo) : ''}</span>${a.tier === 'auto' ? `<button class="mini" data-act="undo" data-id="${a.id}">Undo</button>` : ''}${mail}</div></div>`;
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
  if (!state.running && state.result) $('.steps li[data-step="4"] small').textContent = stepNote(4, 'done', true);
}

// The choreography: recommendation appears → thread draws → agent acts → data flows back
async function playActions(r) {
  $('#statusPill').textContent = r.ahi.after.status;
  $('#statusPill').className = 'pill ' + statusClass(r.ahi.after.status);
  $('#rows').innerHTML = r.actions.length ? '' : '<div class="row empty-row"><div class="empty">Nothing to do.</div><div></div><div class="empty">No leaks found in this data.</div></div>';
  stage(3, '<b>Step 3</b><small>recommending…</small>');
  for (const a of r.actions) log(`${agentName(a.agent)} observed: ${a.observed || a.detail}`);

  for (const a of r.actions) {
    a.state = undefined;
    $('#rows').insertAdjacentHTML('beforeend', rowHTML(a));
    const row = $('#row-' + a.id);
    row.scrollIntoView({ block: 'nearest', behavior: FAST ? 'auto' : 'smooth' });
    await wait(650);
    if (r.actions.indexOf(a) === 0) stage(4, '<b>Step 4</b><small>acting…</small>');
    // inside step ④ the progress bar moves on with every action
    setProgress(75 + (25 * r.actions.indexOf(a)) / r.actions.length);
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
  // One report for everything the agents did on their own this run (plus what waits for you)
  await sendReport(r.actions.filter(a => a.state === 'done'), r.actions.filter(a => a.state === 'waiting'));
}

// After an action, the changed data goes back into ① (the next run reads it)
async function feedBack(a, line) {
  const text = line || a.feedback || a.title;
  // Moves that stop spending slow that channel's live counter in ① (undo puts it back)
  if (['pause', 'hold', 'rule', 'cohort', 'migrate', 'shift'].includes(a.kind) && a.impact && a.channel) {
    state.paceCut[a.channel] = Math.max(0, (state.paceCut[a.channel] || 0) + (a.state === 'undone' ? -1 : 1) * a.impact);
  }
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

// Approve / Hold / Reject (big moves) and Undo (small ones).
// `from` is 'whatsapp' when the tap came from the WhatsApp buttons, so we don't message back twice.
async function decide(id, act, from) {
  const a = state.result.actions.find(x => x.id === id); if (!a) return;
  const via = from === 'whatsapp' ? ' on WhatsApp' : '';
  if (act === 'hold') {
    a.held = true; updateRow(a);
    log(`You put "${a.title}" on hold${via}`);
    if (!from) whatsappNote(`⏸ On hold (set on the site): ${a.title}`);
    return;
  }
  if (act === 'approve') {
    log(`You approved "${a.title}"${via}`);
    a.state = 'executing'; updateRow(a, true);
    await wait(900);
    a.state = 'done'; updateRow(a);
    log(`${agentName(a.agent)} done: ${a.feedback || a.title}`);
    feedBack(a);
    if (sendsTo('email')) emailReport([a], []);
    if (!from) whatsappNote(`✅ Approved on the site: ${a.feedback || a.title}`);
  } else if (act === 'reject') {
    a.state = 'rejected'; updateRow(a);
    log(`You rejected "${a.title}"${via}`);
    if (!from) whatsappNote(`❌ Rejected on the site: ${a.title}`);
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
// Action report: by email (default) and/or on WhatsApp, whichever are switched on in the sidebar.
// ---------------------------------------------------------------------------
function sendReport(done, waiting) {
  return Promise.all([sendsTo('email') && emailReport(done, waiting), sendsTo('whatsapp') && whatsappReport(done, waiting)]);
}

// WhatsApp: one crisp summary, then Approve / Hold / Reject buttons for each action that needs you.
// The taps come back through our server; the page checks for them every few seconds.
const WA_WHY = {
  'not-configured': 'WhatsApp is not set up on the server yet',
  'window-closed': 'send "hi" to the Drishti WhatsApp number once, then run again',
  'number-not-verified': 'this number is not on the WhatsApp test list yet',
  'token-expired': 'WhatsApp access has expired on the server',
};
async function whatsappReport(done, waiting) {
  const to = $('#phone').value.replace(/\D/g, '');
  if (!done.length && !waiting.length) return;
  const mark = status => { for (const a of done) { state.wa[a.id] = status; updateRow(a); } };
  if (to.length < 10) return mark({ ok: false, text: 'add your WhatsApp number (with country code) to get reports' });
  if (state.offline) return mark({ ok: false, text: 'WhatsApp needs our server, which this network cannot reach' });
  mark({ ok: false, text: 'sending to WhatsApp…' });
  const r = state.result;
  let j = {};
  try {
    const res = await fetch(API + '/api/whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        to, brand: r.brand, runId: state.runId,
        health: `${r.ahi.before.value} → ${r.ahi.after.value}`,
        done: done.map(a => a.feedback || a.title), doneCount: done.length,
        waiting: waiting.map(a => ({ id: a.id, agent: agentName(a.agent), title: a.recommend || a.title, impact: a.impact })),
      }),
    });
    j = await res.json();
  } catch { j = { reason: 'WhatsApp service unreachable' }; }
  const status = j.sent ? { ok: true, text: 'report sent on WhatsApp' } : { ok: false, text: WA_WHY[j.reason] || j.error || j.reason || 'WhatsApp not sent' };
  mark(status);
  log(status.ok ? `Action report sent on WhatsApp${j.buttons ? ` with ${j.buttons} approval button${j.buttons === 1 ? '' : 's'}` : ''}` : `WhatsApp: ${status.text}`);
  if (j.sent && j.buttons && j.store) pollWhatsapp();
}

// Short one-line WhatsApp message (decisions made on the site); silent if WhatsApp isn't in use
function whatsappNote(note) {
  const to = $('#phone').value.replace(/\D/g, '');
  if (!sendsTo('whatsapp') || to.length < 10 || state.offline) return;
  fetch(API + '/api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, note }) }).catch(() => {});
}

// Every 4 seconds (for up to 30 minutes), ask the server whether any WhatsApp button was tapped
function pollWhatsapp() {
  clearInterval(state.waPoll);
  const run = state.runId, until = Date.now() + 30 * 60 * 1000;
  state.waPoll = setInterval(async () => {
    const open = state.result?.actions.filter(a => a.state === 'waiting') || [];
    if (run !== state.runId || !open.length || Date.now() > until) return clearInterval(state.waPoll);
    try {
      const { decisions = {} } = await (await fetch(`${API}/api/whatsapp?run=${run}`)).json();
      for (const a of open) {
        const d = decisions[a.id];
        if (d === 'approve' || d === 'reject') decide(a.id, d, 'whatsapp');
        else if (d === 'hold' && !a.held) decide(a.id, 'hold', 'whatsapp');
      }
    } catch {}
  }, 4000);
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
  const subject = `Drishti AI · ${done.length} action${done.length === 1 ? '' : 's'} taken for ${r.brand}`;
  // The report as [label, text] pairs; every email route below uses the same list
  const lines = [
    ['Brand', r.brand + (sample ? ' (sample brand, fictional data)' : '')],
    ['Health score', `${r.ahi.before.value} → ${r.ahi.after.value} (${r.ahi.after.status})`],
  ];
  done.forEach((a, i) => lines.push([`Action ${i + 1} · ${agentName(a.agent)}`, `DONE: ${a.feedback || a.title}\nWhy: ${a.observed || a.detail}`]));
  waiting.forEach((a, i) => lines.push([`Waiting for you ${i + 1}`, `${a.recommend || a.title}\nWhy: ${a.observed || a.detail}`]));
  lines.push(['Time', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST']);

  // Try each route in turn; the first one that works wins
  const status = await emailViaServer(to, subject, lines) || await emailViaFormSubmit(to, subject, lines) || {
    // Last resort: a link that opens the visitor's own email app with the report already written
    ok: false, text: 'email service is down: open the report in your email app',
    href: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.map(([k, v]) => `${k}\n${v}`).join('\n\n'))}`,
  };
  mark(done, status);
  log(status.ok ? `Action report emailed to ${to}` : `Email: ${status.text}`);
}

// Route 1: our own backend (Gmail). Returns a status, or null if it can't send.
async function emailViaServer(to, subject, lines) {
  if (state.offline) return null;
  try {
    const res = await fetch(API + '/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, lines }), signal: AbortSignal.timeout(10000) });
    const j = await res.json();
    return j.sent ? { ok: true, text: `report emailed to ${to}` } : null;
  } catch { return null; }
}

// Route 2: FormSubmit (free, no account). The first email to a new address asks it
// to click "Activate" once. Returns a status, or null if the service is down.
async function emailViaFormSubmit(to, subject, lines) {
  const body = { _subject: subject, _template: 'table', _captcha: 'false' };
  for (const [k, v] of lines) body[k] = v;
  try {
    const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json();
    if (String(j.success) === 'true') return { ok: true, text: `report emailed to ${to}` };
    if (/activat/i.test(j.message || '')) return { ok: false, text: `one-time step: open the "Activate" email sent to ${to}, then reports arrive` };
    return null;
  } catch { return null; }
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
  const storm = r.shock?.external ? `<div class="storm">${ic('storm')}<span><b>Storm Mode:</b> the whole market moved, so every budget move needs you.</span></div>` : '';
  const broken = r.signal.trackingBreaks.length ? `<div class="storm">${ic('wrench')}<span><b>Tracking alert:</b> ${esc(r.signal.trackingBreaks.map(b => b.channel).join(', '))} under-reported sales; its budget is frozen.</span></div>` : '';
  $('#results').hidden = false;
  $('#results').innerHTML = `
    <div data-tip="ahi"><div class="gauge">${gauge(after.value, after.status)}<div class="val">${after.value}</div><div class="glbl">Agent Health Index · was ${before.value}</div></div></div>
    <div data-tip="roas"><small>True ROAS</small><b class="n">${r.impact.trueRoasNow} → ${r.impact.trueRoasProjected}</b> <span class="up">+${roasUp}%</span></div>
    <div data-tip="tired"><small>Spend on tired ads</small><b class="n">${r.impact.fatiguedPctNow}% → 0%</b></div>
    <div data-tip="freed"><small>Spend freed / day</small><b class="n">${inr(r.impact.freedPerDay)}</b></div>
    <div class="head"><span class="hl">${esc(r.briefing.headline)}</span>${storm}${broken}<small>If every move is approved · <a href="#details">See the reasoning</a></small></div>`;
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
      if (!d.cleanOrders.length) return `<h4>${ic('bag')} Shopify orders</h4><p>Not connected. Without real orders Drishti estimates true revenue (platforms usually over-claim ~1.6×). Upload an orders CSV under “Use your own data”.</p>`;
      const rows = d.cleanOrders.filter(o => o.date === last);
      return `<h4>${ic('bag')} Shopify orders · what really sold</h4><p>Orders tagged by UTM source. This is how Drishti checks what the ad platforms claim.</p>
        <div class="k">Latest pull · ${esc(last)}</div>${glimpseRows(rows, [['Source', o => o.channel], ['Orders', o => Math.round(o.orders).toLocaleString('en-IN'), 'n'], ['Revenue', o => inr(o.revenue), 'n']])}${fedBlock(key)}`;
    }
    if (key === 'Competitors') {
      if (!d.cleanComp.length) return `<h4>${ic('search')} Competitor ads</h4><p>Not connected. Upload a competitor CSV (Meta Ad Library export) to let the Cohort agent compare.</p>`;
      const rows = d.cleanComp.filter(c => c.date === last);
      return `<h4>${ic('search')} Competitor ads · Meta Ad Library</h4><p>What rival brands run, and how well people engage with it.</p>
        <div class="k">Latest pull · ${esc(last)}</div>${glimpseRows(rows.length ? rows : d.cleanComp.slice(-3), [['Brand', c => c.competitor], ['Where', c => c.channel], ['Campaign', c => cut(c.campaign, 26)], ['Engage', c => (c.rate * 100).toFixed(1) + '%', 'n']])}${fedBlock(key)}`;
    }
    if (key === 'News') {
      const h = state.result?.shock?.headlines || [];
      return `<h4>${ic('news')} Live news · Google News</h4><p>Read at the start of every run, so the Orchestrator can tell a market shock (outage, CPM war, budget cuts) from a problem in our ads.</p>
        ${h.length ? `<div class="k">Headlines read on the last run</div><ul>${h.slice(0, 4).map(x => `<li>${esc(cut(x.title, 90))}</li>`).join('')}</ul>` : '<div class="k">Headlines appear here after a run</div>'}`;
    }
    if (key === 'Calendar') {
      const now = Date.now();
      const up = EVENTS.map(x => ({ ...x, in: Math.round((new Date(x.date + 'T00:00:00Z') - now) / 864e5) })).filter(x => x.in >= -3).slice(0, 4);
      return `<h4>${ic('calendar')} India sale calendar</h4><p>Festivals push CPMs up. The Budget agent paces spend around them, and the shock filter won’t blame an ad for a festival dip.</p>
        ${glimpseRows(up, [['Event', e => e.name], ['Date', e => e.date], ['In', e => (e.in >= 0 ? e.in + ' days' : 'just passed'), 'n']])}${fedBlock(key)}`;
    }
    // An ad channel: show the latest rows streaming in
    const rows = d.clean.filter(r => r.channel === key && r.date === last).sort((x, y) => y.spend - x.spend);
    const tot = rows.reduce((s, r) => ({ spend: s.spend + r.spend, clicks: s.clicks + r.clicks, rev: s.rev + r.platform_revenue }), { spend: 0, clicks: 0, rev: 0 });
    return `<h4>${ic(ICONS[key] || 'chart')} ${esc(key)} · ${rows.length} rows a day</h4>
      <p>Per ad × region: spend, impressions, reach, clicks, conversions and the revenue ${esc(key)} <i>claims</i>.</p>
      <div class="k">Latest pull · ${esc(last)} · top ${Math.min(4, rows.length)} of ${rows.length}</div>
      ${glimpseRows(rows.slice(0, 4), [['Ad', r => cut(r.ad, 24)], ['Region', r => cut(r.region, 12)], ['Spend', r => inr(r.spend), 'n'], ['Clicks', r => r.clicks.toLocaleString('en-IN'), 'n'], ['Claimed', r => inr(r.platform_revenue), 'n']])}
      <p style="color:var(--muted)">Day total: ${inr(tot.spend)} spend · ${tot.clicks.toLocaleString('en-IN')} clicks · ${inr(tot.rev)} claimed sales</p>
      <p style="color:var(--muted)">The live line counts today’s views, clicks and spend so far, at that day’s pace. Paused ads slow it down. On a connected account it refreshes from the API every hour.</p>${fedBlock(key)}`;
  },
  agent(el) {
    const a = agent(el.dataset.id);
    const said = state.agentLog[a.id] || [];
    return `<h4>${ic(a.icon)} ${esc(a.name)} · ${esc(a.role)}</h4><p>${esc(a.job)}</p><div class="k">Reads</div><p>${esc(a.reads)}</p>
      <div class="k">${said.length ? 'On this run' : 'Status'}</div>${said.length ? `<ul>${said.slice(-3).map(t => `<li>${esc(cut(t, 220))}</li>`).join('')}</ul>` : '<p>Waiting for Run.</p>'}`;
  },
  rec(el) {
    const a = state.result?.actions.find(x => x.id === Number(el.dataset.id)); if (!a) return '';
    // The card itself shows one short line each; the full observation and advice live here.
    return `<h4>${ic(agent(a.agent).icon)} ${esc(agentName(a.agent))} · recommendation</h4><p><b>${esc(a.recommend || a.title)}</b>${money(a) ? ` <span class="money">${money(a)}</span>` : ''}</p>
      <div class="k">What it saw</div><p>${esc(a.observed || '')}</p><p>${esc(a.detail)}</p>
      <div class="k">Why ${a.tier === 'auto' ? 'it acts on its own' : 'it asks you'}</div>
      <p>${a.tier === 'auto' ? (a.rule ? 'This is your standing rule, so it runs without asking.' : 'Small move (under ₹5,000/day or a budget shift under 10%), so it runs and can be undone.') : 'Big move, or the data/market needs a human eye, so it waits for Approve.'}</p>`;
  },
  act(el) {
    const a = state.result?.actions.find(x => x.id === Number(el.dataset.id)); if (!a) return '';
    const sample = state.data?.source === 'Sample';
    return `<h4>${ic('zap')} What the agent does</h4><p>${esc(a.execute || a.title)}</p>
      <div class="k">On a connected account</div><p>${esc(apiCall(a))}${sample ? ' <i>(sample brand: applied to the sample data)</i>' : ''}</p>
      <div class="k">Fed back into ①</div><p class="new">↺ ${esc(a.feedback || a.title)}</p>
      ${state.mail[a.id] ? `<div class="k">Email report</div><p>${state.mail[a.id].href ? `<a href="${esc(state.mail[a.id].href)}">${esc(state.mail[a.id].text)}</a>` : esc(state.mail[a.id].text)}</p>` : ''}
      ${state.wa[a.id] ? `<div class="k">WhatsApp report</div><p>${esc(state.wa[a.id].text)}</p>` : ''}`;
  },
  ahi() {
    const r = state.result; if (!r) return '';
    return `<h4>${ic('gauge')} Agent Health Index</h4><p>One score for how healthy the ad account is, graded on TRUE revenue. Weighted geometric mean, so one weak area can’t hide behind strong ones.</p>
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
  rule() {
    return `<h4>Your standing rules</h4><p>Orders the agents follow on their own, then email you a report. If tracking is broken or the market is in shock, they ask first.</p>
      <ul>${state.rules.map(r => `<li>${esc(ruleText(r))}</li>`).join('') || '<li>None set</li>'}</ul><p style="color:var(--muted)">Press “Add / edit rules” to add more.</p>`;
  },
  model() {
    return `<h4>The model the agents think with</h4><p>It is always on: the Orchestrator uses it to decide which agent to call and to explain each step. Pick another model to swap it for the next run; if it is busy, Drishti falls back to the next one.</p>
      <p>“Built-in rules” runs the same agent maths with no AI model, so every number can be traced to a formula.</p>`;
  },
  watch() {
    return `<h4>Always watching</h4><p>Between full checks the Orchestrator keeps reading the streams in ① and your rules. A full check (Run) re-reads everything, diagnoses, recommends and acts.</p><p style="color:var(--muted)">${nIN(rowsSeen)} rows read since you opened this page.</p>`;
  },
  email() { return `<h4>${ic('chat')} Get the action reports yourself</h4><p><b>Email (on by default):</b> type your address and every run emails you what the agents did.</p><p><b>WhatsApp (switch it on):</b> type your number with the country code. After each run you get one short summary, and every action that needs you arrives with <b>Approve</b>, <b>Hold</b> and <b>Reject</b> buttons. Tap one and the card here updates within seconds.</p><p>With both switched on, every report goes to both.</p><p>After each run, one email lists every action taken and what waits for your approval. Each approval sends its own report.</p><p style="color:var(--muted)">If you get a one-time “Activate” email, click it and run the loop again. If email services are down, the card shows a link that opens the report in your own email app.</p>`; },
  // one line of the agents' feed, in full
  ev(el) {
    const a = agent(el.dataset.agent);
    return `<h4>${ic(a.icon || 'compass')} ${esc(a.name || 'Orchestrator')}</h4><p>${esc(el.dataset.full)}</p>
      ${a.job ? `<div class="k">What this agent does</div><p>${esc(a.job)}</p>` : ''}`;
  },
  roas() {
    const r = state.result; if (!r) return '';
    return `<h4>${ic('chart')} True ROAS</h4><p>Revenue per rupee of ad spend, counted from real orders, not what the ad platforms claim.</p>
      <p><b>${r.impact.trueRoasNow} → ${r.impact.trueRoasProjected}</b> if every move is approved.</p>
      ${glimpseRows(r.signal.perChannel, [['Channel', c => c.channel], ['Claimed', c => c.platformRoas, 'n'], ['True', c => c.trueRoas, 'n'], ['Over-claim', c => c.overclaim + '×', 'n']])}`;
  },
  tired() {
    const r = state.result; if (!r) return '';
    const tired = r.fatigue.ads.filter(a => a.status === 'fatigued');
    return `<h4>${ic('flame')} Spend on tired ads</h4><p>${r.impact.fatiguedPctNow}% of spend was going to ads people have stopped responding to. The Fatigue agent pauses them and Creative drafts replacements.</p>
      ${tired.length ? glimpseRows(tired, [['Ad', a => cut(a.ad, 26)], ['Score', a => a.score, 'n'], ['CTR', a => `${a.ctrBase}% → ${a.ctrNow}%`, 'n']]) : ''}`;
  },
  freed() {
    const r = state.result; if (!r) return '';
    return `<h4>${ic('scale')} Spend freed per day</h4><p><b>${inr(r.impact.freedPerDay)}</b> a day stops going to leaks (tired ads, losing regions, held campaigns) and is moved to what works.</p>
      <ul>${r.actions.filter(a => a.impact).slice(0, 6).map(a => `<li>${esc(cut(a.recommend || a.title, 90))} · <b>${money(a)}</b></li>`).join('')}</ul>`;
  },
  'brand-glowveda'() { return `<h4>Glowveda</h4><p>Shreya’s skincare brand · ₹1.5 Cr/month on Facebook, Instagram, Google and JioHotstar TV. Fictional sample data.</p>`; },
  'brand-crunchkart'() { return `<h4>Crunchkart</h4><p>Aarush’s snacks brand · ₹9 L/month on Facebook, Instagram and Google. Fictional sample data.</p>`; },
  'brand-shyamlal'() { return `<h4>Shyamlal Masale</h4><p>Mr. Shyamlal’s Indore spices brand, moving from TV to digital · ₹40 L/month on Facebook, Instagram, Google and JioHotstar TV. Fictional sample data.</p>`; },
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
    rule: a.ruleType === 'cap' ? `${a.channel} API → daily budget lowered to your cap`
      : a.ruleType === 'roas' ? `${a.channel} Marketing API → campaign status = PAUSED (“on hold”)`
      : `${a.channel} API → ad status = PAUSED`,
  }[a.kind] || a.title;
}

// DETAIL PANEL: clicking (or pressing Enter on) anything with data-tip="name" opens
// the sliding panel on the right with TIPS[name]. The cards themselves stay short.
function openDetail(el) {
  const html = TIPS[el.dataset.tip]?.(el);
  if (!html) return;
  $('#drawerBody').innerHTML = html;
  // the panel title comes from the card's own heading (moved up into the panel header)
  const h = $('#drawerBody h4');
  $('#drawerTitle').textContent = h ? h.textContent.trim() : 'Details';
  h?.remove();
  openSheet('#drawer');
  // keep the recommendation + its action highlighted while their detail is open
  el.closest('.row')?.classList.add('hl');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  // buttons, fields and links inside a card do their own job (Approve, Undo, typing…)
  const ctl = e.target.closest('button, input, select, textarea, a, label');
  if (ctl && ctl !== el && el.contains(ctl)) return;
  openDetail(el);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-tip][tabindex]')) { e.preventDefault(); openDetail(e.target); }
});

// SIDEBAR: highlight the section you are looking at
function syncSideNav() {
  let on = '#loop';
  for (const id of ['#results', '#details', '#askCard']) {
    const el = $(id);
    if (el && !el.closest('[hidden]') && !el.hidden && el.getBoundingClientRect().top < innerHeight * 0.4) on = id;
  }
  $$('.side-nav a[href^="#"]').forEach(a => a.classList.toggle('on', a.getAttribute('href') === on));
}
addEventListener('scroll', syncSideNav, { passive: true });

// ---------------------------------------------------------------------------
// Details below the fold
// ---------------------------------------------------------------------------
function renderDetails(r) {
  $('#details').hidden = false;

  $('#briefCard').innerHTML = `<h3>Briefing for the marketing manager</h3>
    <p><b>${esc(r.briefing.headline)}</b></p>
    <p style="color:var(--muted)">For the owner: ${esc(r.briefing.owner_note)}</p>
    <details><summary class="hint">Full briefing</summary><p>${esc(r.briefing.briefing)}</p></details>
    <p class="hint">Reasoning engine: ${esc(r.engine)} · Data ${esc(r.period.from)} → ${esc(r.period.to)}</p>`;

  // Claimed vs true ROAS per channel (the measurement trap)
  const max = Math.max(...r.signal.perChannel.map(c => c.platformRoas), 1);
  $('#roasCard').innerHTML = `<h3>Platform-claimed vs true ROAS</h3>
    <div class="legend"><i style="background:var(--line-strong)"></i>Platform says<i style="background:var(--orange)"></i>Shopify orders say</div>
    <div class="bars">${r.signal.perChannel.map(c => `<div class="row"><b>${esc(c.channel)}</b><div><div class="track">
      <div class="claimed" style="width:${(c.platformRoas / max) * 100}%"></div><div class="true" style="width:${(c.trueRoas / max) * 100}%"></div></div>
      <div class="nums">${c.platformRoas} claimed · ${c.trueRoas} true · over-claims ${c.overclaim}×</div></div></div>`).join('')}</div>
    <p class="hint">Data trust ${r.signal.trustScore}/100${r.signal.issues.length ? ' · ' + esc(r.signal.issues.join('; ')) : ''}</p>`;

  // Shock filter: 5 checks + live headlines
  const s = r.shock || { checks: [], headlines: [] };
  $('#shockCard').innerHTML = `<h3>Is it us or the world? ${s.external ? '<span class="pill s-amber">Market shock</span>' : '<span class="pill s-green">Inside the account</span>'}</h3>
    <ul class="checks">${s.checks.map(c => `<li><b>${esc(c.name)}</b>${esc(c.result)}</li>`).join('')}</ul>
    ${s.headlines?.length ? `<div class="section-label">Live headlines read this run</div><ul class="news">${s.headlines.slice(0, 3).map(h => `<li><a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.title)}</a></li>`).join('')}</ul>` : ''}`;

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
new ResizeObserver(fitLoop).observe($('.bar'));
$('#ownBtn').addEventListener('click', fitLoop);

// ---------------------------------------------------------------------------
// ABOUT + AGENTS panels (short on purpose: one idea per line)
// ---------------------------------------------------------------------------
$('#aboutBody').innerHTML = `
  <p class="about-lead">Brands lose a big share of their ad money to tired ads, over-claimed results and wrong-channel spend. <b>Drishti AI</b> watches every rupee and fixes the leaks for them.</p>
  <ol class="about-steps">
    <li><div><b>Data in</b><span>Ad channels, real orders, competitor ads, news and the sale calendar.</span></div></li>
    <li><div><b>Agents think</b><span>Six AI agents check trust, fatigue, creatives, audiences and budget.</span></div></li>
    <li><div><b>Recommend</b><span>Each finding becomes one clear fix, with the money it saves.</span></div></li>
    <li><div><b>Act &amp; report</b><span>Small fixes run on their own, big ones wait for you, and every action is emailed.</span></div></li>
  </ol>
  <div class="facts"><div><b>6</b><small>AI agents</small></div><div><b>20+</b><small>data partners</small></div><div><b>4</b><small>step loop</small></div></div>
  <div class="about-k">Built-in guardrails</div>
  <ul class="guard">
    <li><span data-icon="shield"></span>If tracking breaks or the market is in shock, nothing runs without you.</li>
    <li><span data-icon="undo"></span>Every automatic fix can be undone in one click.</li>
    <li><span data-icon="sliders"></span>Your standing rules come first.</li>
  </ul>
  <div class="team-card"><span data-icon="phoenix"></span><div><b>Team Phoenix</b><small>Abhikalp 2026 · Case 5</small></div></div>`;

$('#agentsBody').innerHTML = `<div class="agent-list">${AGENTS.map(a => `
  <div class="agent-card" style="--c:var(--${a.id})"><span class="av" data-icon="${a.icon}"></span>
    <div><b>${esc(a.name)}</b><span class="role">${esc(a.role)}</span><p>${esc(a.job)}</p></div></div>`).join('')}</div>
  <p class="hint">On the agent screen, click any agent to see what it said on the last run.</p>`;
fillIcons();

// Start with the sample brand loaded so Run works straight away.
// A link ending in ?run starts the agents immediately (handy for sharing a live demo).
loadSample();
hubIdle();
setTimeout(watchBeat, 500); // ② starts watching straight away
if (new URLSearchParams(location.search).has('run')) setTimeout(run, 300);
