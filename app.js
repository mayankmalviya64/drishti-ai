// app.js — the live Drishti AI app in the browser.
// The page is one loop, read clockwise:
//   ① Data coming in   → every source (ad channels, Shopify, competitors, news, calendar)
//   ② Agents at work   → the AI Orchestrator streams each agent's reasoning from /api/run
//   ③ Observed → Recommended → what each agent saw, and what it suggests
//   ④ Action taken     → the agent carries it out (small moves) or waits for Approve (big ones),
//                         an action report is emailed, and the changed data flows back into ①.
// Hovering anything shows what is flowing through it (one shared hover card, see TIPS).
import { makeSample, toCSV, BRANDS } from './lib/sample.js';
import { cleanRows, cleanOrders, cleanCompetitors, EVENTS } from './lib/analyze.js';
import { RULE_TYPES, DEFAULT_RULES, cleanRule, ruleText } from './lib/rules.js';
import { SCENARIOS, scenariosFor, applyScenario, scenarioContext, useCustom, cleanDraft, draftLocally } from './lib/scenarios.js';

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
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
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
  tg: {},            // action id → Telegram status text
  loop: 0,           // how many times the loop has run
  rules: [],         // your standing rules, e.g. [{ type: 'flat', a: 2 }]
  models: [],        // AI models the backend can use (for the picker in ②)
  paceCut: {},       // channel → ₹/day the agents stopped spending (slows that tile's live counter)
};

// ---------------------------------------------------------------------------
// SAME DATA ON EVERY DEVICE: these saved items (runs per brand, audit log, custom
// conditions, AI usage log, rules, team, report settings) are also kept on our server.
// Opening the site anywhere loads the newest copy first; every change is sent back
// 2 seconds later. Coming back to the tab picks up changes made on another device.
// ---------------------------------------------------------------------------
const SYNC_KEYS = ['drishti-saved-runs', 'drishti-custom', 'drishti-ai-runs', 'drishti-ai-lastrun', 'drishti-ai-use',
  'drishti-rules', 'drishti-team', 'drishti-mgr-limit', 'drishti-channels', 'drishti-email', 'drishti-director-added'];
const SYNC_AT = 'drishti-sync-at'; // when this browser's copy was last saved / loaded

// Safe localStorage (some browsers block it). Saving a synced item also queues a send to the server.
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} if (SYNC_KEYS.includes(k)) pushSync(); },
};

let pushTimer = null;
function pushSync(now = false) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const keys = {};
    for (const k of SYNC_KEYS) { const v = store.get(k); if (v !== null) keys[k] = v; }
    const savedAt = Date.now();
    try { localStorage.setItem(SYNC_AT, String(savedAt)); } catch {}
    fetch(API + '/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ savedAt, keys }) }).catch(() => {});
  }, now ? 0 : 2000);
}

// Load the server's copy if it is newer than this browser's. Returns true if it changed anything.
async function pullSync(ms = 3000) {
  try {
    const j = await (await fetch(API + '/api/state', { signal: AbortSignal.timeout(ms), cache: 'no-store' })).json();
    if (!j.keys) return false;
    // First sync in this browser: keep what it already has (e.g. today's runs), take only
    // what is missing from the server, then send the combined copy back
    if (!localStorage.getItem(SYNC_AT)) {
      for (const [k, v] of Object.entries(j.keys)) if (SYNC_KEYS.includes(k) && localStorage.getItem(k) === null) localStorage.setItem(k, v);
      localStorage.setItem(SYNC_AT, String(j.savedAt || 1));
      pushSync(true);
      return true;
    }
    if ((j.savedAt || 0) <= Number(localStorage.getItem(SYNC_AT) || 0)) return false;
    for (const [k, v] of Object.entries(j.keys)) if (SYNC_KEYS.includes(k)) localStorage.setItem(k, v);
    localStorage.setItem(SYNC_AT, String(j.savedAt));
    return true;
  } catch { return false; }
}
// Before anything else reads the saved data (waits at most 3 seconds if the server is slow)
await pullSync();

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
const SHEETS = ['#rulesPanel', '#ownData', '#aboutPanel', '#agentsPanel', '#drawer', '#whatIf', '#teamPanel', '#customCond'];
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
  $('#whatIfBtn').setAttribute('aria-expanded', String(sel === '#whatIf'));
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
  resetLoop();
}

// Summarise loaded data in one line, e.g. "490 rows · 14 days · Facebook, Google · Shopify orders ✓"
function describe(d) {
  const dates = [...new Set(d.clean.map(r => r.date))];
  const ch = [...new Set(d.clean.map(r => r.channel))];
  return `<b>${esc(d.brand)}</b> · ${d.rows.length} rows · ${dates.length} days · ${esc(ch.join(', '))} · ${d.orders?.length ? `${esc(d.ordersFrom || 'Shopify')} orders ✓` : '<span style="color:var(--amber)">no orders file (ROAS estimated)</span>'}${d.competitors?.length ? ' · competitor ads ✓' : ''}` +
    (d.connected?.length ? `<br><small>Connected: ${esc(d.connected.join(' · '))}</small>` : '');
}

// A brand's sample data under one condition (normal, or a what-if event)
function sampleFor(brand, scenarioKey = 'normal') {
  const s = makeSample(brand, { twists: SCENARIOS[scenarioKey]?.twists || {} });
  return applyScenario({ ...s, source: 'Sample' }, scenarioKey, brand);
}
function loadSample() {
  const brand = $('input[name=brand]:checked').value;
  fillScenarios(brand);
  setData({ ...sampleFor(brand, $('#scenario').value), brandKey: brand, scenario: $('#scenario').value });
}

// The Conditions picker: "Normal conditions" first, then the what-if events that fit this brand
function fillScenarios(brand) {
  const pick = $('#scenario'), was = pick.value || 'normal';
  useCustom(brand, customDrafts[brand]); // this brand's own condition, if you made one
  const list = scenariosFor(brand), groups = [...new Set(list.map(x => x.group))];
  pick.innerHTML = groups.map(g => g === 'Base'
    ? list.filter(x => x.group === g).map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('')
    : `<optgroup label="${esc(g)}">${list.filter(x => x.group === g).map(x => `<option value="${x.key}">${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
  // Last option: write your own condition (opens the Custom condition panel)
  pick.insertAdjacentHTML('beforeend', `<option value="__new">✎ Custom condition (type your own)…</option>`);
  pick.value = list.some(x => x.key === was) ? was : 'normal';
  pick.dataset.was = pick.value; // to go back to, if the custom panel is opened and closed
  pick.title = SCENARIOS[pick.value].note;
  pick.closest('.cond').classList.toggle('active', pick.value !== 'normal');
}

// Picking another brand or condition: keep this one's run as it is, then show the other one
// exactly as you left it, or (first visit) ask you to start the agents on it.
$$('input[name=brand], #scenario').forEach(el => el.onchange = () => {
  // "Custom condition…" is not a condition yet: keep the current one and open the panel
  if (el.value === '__new') { el.value = el.dataset.was || 'normal'; return openCustom(); }
  saveView(); loadSample(); if (!restoreView()) askToStart();
});

// ---------------------------------------------------------------------------
// ONE RUN PER BRAND (and condition), kept even when the page is closed.
// Leaving Glowveda for Crunchkart and coming back shows Glowveda's run, decisions
// and reports just as they were; Telegram taps made meanwhile are picked up again.
// Each run is also saved in this browser (localStorage) for a day, so closing the
// tab and opening the site again brings back the same run, cards and activity log.
// ---------------------------------------------------------------------------
const SAVED = 'drishti-saved-runs', KEEP_MS = 24 * 60 * 60 * 1000;
const views = (() => {
  try {
    const saved = JSON.parse(store.get(SAVED) || '{}');
    // Drop runs older than a day
    for (const k of Object.keys(saved.views || {})) if (Date.now() - (saved.views[k].savedAt || 0) > KEEP_MS) delete saved.views[k];
    return saved.views || {};
  } catch { return {}; }
})();
// Write every brand's run (and the activity log) to this browser's storage.
// Sample data is left out: it is rebuilt exactly the same from the brand name.
function persistViews() {
  const slim = Object.fromEntries(Object.entries(views).map(([k, v]) => [k, { ...v, data: v.data?.source === 'Sample' ? null : v.data }]));
  store.set(SAVED, JSON.stringify({ current: viewKey(state.data), views: slim, audit: state.audit.slice(0, 120) }));
}
const viewKey = d => (d?.source === 'Sample' ? `${d.brandKey}|${d.scenario || 'normal'}` : null);
function saveView() {
  const k = viewKey(state.data);
  if (!k || !state.result || state.running) return;
  views[k] = {
    savedAt: Date.now(), runAt: state.runAt,
    data: state.data, result: state.result, runId: state.runId, loop: state.loop,
    agentLog: state.agentLog, mail: state.mail, tg: state.tg, updates: state.updates, paceCut: state.paceCut,
    html: { feed: $('#feed').innerHTML, rows: $('#rows').innerHTML, strip: $('#agentStrip').innerHTML, bar: $('#agentBar').style.width,
      pill: $('#statusPill').textContent, pillClass: $('#statusPill').className, results: $('#results').innerHTML, ask: $('#askAnswer').textContent },
  };
  persistViews();
}
function restoreView(reopened = false) {
  const v = views[viewKey(state.data)];
  if (!v) return false;
  v.data ||= state.data; // sample data, freshly rebuilt by loadSample()
  Object.assign(state, { runAt: v.runAt || v.savedAt, data: v.data, result: v.result, runId: v.runId, loop: v.loop, agentLog: v.agentLog,
    mail: v.mail, tg: v.tg, updates: v.updates, paceCut: v.paceCut });
  $('#startPrompt')?.remove();
  renderSources();
  setStatus(describe(state.data));
  $('#feed').innerHTML = v.html.feed;
  $('#rows').innerHTML = v.html.rows;
  $$('#rows [data-act]').forEach(b => b.onclick = () => decide(Number(b.dataset.id), b.dataset.act)); // re-attach the buttons
  $('#agentStrip').innerHTML = v.html.strip; $('#agentBar').style.width = v.html.bar;
  $('#statusPill').textContent = v.html.pill; $('#statusPill').className = v.html.pillClass;
  $('#results').innerHTML = v.html.results; $('#results').hidden = false;
  state.restoring = true; renderDetails(state.result); state.restoring = false; $('#details').hidden = false;
  $('#askAnswer').textContent = v.html.ask;
  countActions(); hubIdle(); runLabel();
  // Still waiting for decisions (or undo-able)? Listen for Telegram taps again
  if (sendsTo('telegram') && state.result.actions.some(a => a.state === 'waiting' || a.state === 'done')) pollTelegram();
  log(reopened ? `Site reopened: ${state.data.brand}'s run is back as you left it; Telegram decisions made meanwhile are being added.`
    : `Back to ${state.data.brand}: everything is as you left it.`);
  return true;
}
// Save when the tab is hidden or closed (e.g. you switch to Telegram or shut the browser)
addEventListener('pagehide', saveView);
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { saveView(); return pushSync(true); } // leaving the tab: save and send now
  if (!state.running && await pullSync(4000)) location.reload(); // another device saved something newer
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveView(); });

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

// Email / Telegram switches for action reports. Each one turns on or off by itself:
// Email is on by default, Telegram is optional, and with both on every report goes to both.
const sendsTo = via => $(`.via [data-via="${via}"]`).getAttribute('aria-checked') === 'true';
function setChannels(on) {
  $$('.via [role=switch]').forEach(b => {
    b.setAttribute('aria-checked', String(on.includes(b.dataset.via)));
    b.closest('.via-row').classList.toggle('off', !on.includes(b.dataset.via)); // greys out a channel that is off
  });
  store.set('drishti-channels', on.join(','));
}
$$('.via [role=switch]').forEach(b => b.onclick = () => {
  const on = $$('.via [role=switch]').filter(x => (x === b) !== (x.getAttribute('aria-checked') === 'true')).map(x => x.dataset.via);
  setChannels(on);
});
setChannels((store.get('drishti-channels') ?? 'email').split(',').filter(Boolean));

// ---------------------------------------------------------------------------
// TELEGRAM TEAM: reports can go to several people, each with a role.
//   Director    → decides every move AND can undo any action the agents already took (Mayank, on by default)
//   Intern      → gets every report, for information only (no buttons)
//   Manager     → can Approve / Hold / Reject moves up to a ₹/day limit you set
//   Sr Manager  → can decide every move, any size
// Each person also has a brand: "All brands", or only one brand's reports.
// Adding someone: pick role + brand, then send them the invite link. When they press
// Start in the Drishti bot, our server spots the one-time code and hands back their chat id.
// The team is remembered on this device only (localStorage "drishti-team").
// ---------------------------------------------------------------------------
const TG_BOT = 'drishti_phoenix_bot';
const ROLES = {
  director:  { label: 'Director',   can: 'Decides every move and can undo any action, from Telegram too' },
  intern:    { label: 'Intern',     can: 'Gets reports only' },
  manager:   { label: 'Manager',    can: 'Decides moves up to the limit below' },
  srmanager: { label: 'Sr Manager', can: 'Decides every move' },
};
const ALL_BRANDS = 'all';
// Team Phoenix: the only people who can be invited (each invite is for one of these names)
const TEAM_NAMES = ['Mayank', 'Arsh', 'Ashish', 'Anurag', 'Biswa'];
// Mayank is on every visitor's team by default, as Director, so every run reports to him.
// (chat = his Telegram chat with the bot; a chat id is not a secret, it only works through our bot)
const DIRECTOR = { chat: '907556204', name: 'Mayank', role: 'director', brand: 'all', phone: '919009601598' };
const brandNames = () => [...new Set([...Object.values(BRANDS).map(b => b.name), state.data?.brand].filter(Boolean))];

function loadTeam() {
  let team = [];
  try { const t = JSON.parse(store.get('drishti-team') || 'null'); if (Array.isArray(t)) team = t; } catch {}
  // Older visits linked just one chat ("drishti-tg"); that person becomes the first Sr Manager
  if (!team.length) try { const one = JSON.parse(store.get('drishti-tg') || 'null'); if (one?.chat) team = [{ ...one, role: 'srmanager', brand: ALL_BRANDS }]; } catch {}
  // Mayank is the Director: whoever is linked as Mayank gets that role…
  for (const m of team) if (m.name === 'Mayank' || m.tgName === 'Mayank') Object.assign(m, { name: 'Mayank', role: 'director' });
  // …and if he isn't on this device's team yet, add him (once; removing him later is respected)
  if (DIRECTOR.chat && !store.get('drishti-director-added')) {
    if (!team.some(m => m.chat === DIRECTOR.chat)) team.unshift({ ...DIRECTOR });
    store.set('drishti-director-added', '1');
  }
  // the Director first in the list
  return team.sort((a, b) => (b.role === 'director') - (a.role === 'director'));
}
state.team = loadTeam();
state.invites = [];  // invite links sent out but not yet accepted: { code, role, brand, until }
const saveTeam = () => { store.set('drishti-team', JSON.stringify(state.team)); showTg(); renderTeam(); };
const managerLimit = () => Math.max(0, Number(store.get('drishti-mgr-limit')) || 25000);

// Who gets this brand's reports, and can this person decide this action?
const teamFor = brand => state.team.filter(m => m.brand === ALL_BRANDS || m.brand === brand);
function canDecide(m, a) {
  if (m.role === 'director' || m.role === 'srmanager') return true;
  if (m.role === 'manager') return (Number(a.impact) || 0) <= managerLimit();
  return false; // intern: inform only
}
// Short label for whoever CAN decide an action, shown to the people who can't
const whoDecides = a => ((Number(a.impact) || 0) <= managerLimit() ? 'Manager, Sr Manager or Director' : 'Sr Manager or Director');
const roleLabel = m => ROLES[m.role]?.label || 'Intern';

// Sidebar line: one person's number/name, or "3 people"
function showTg() {
  const t = state.team;
  $('#tgText').textContent = !t.length ? 'Add people on Telegram'
    : t.length === 1 ? `${t[0].phone ? prettyPhone(t[0].phone) : t[0].name} · ${roleLabel(t[0])}` : `${t.length} people on Telegram`;
  $('#tgLink').title = t.length ? t.map(m => `${m.name} · ${roleLabel(m)}`).join('\n') : 'Invite yourself or your team to the Drishti bot';
  $('#tgLink').classList.toggle('linked', t.length > 0);
}
// "+919009601598" → "+91 90096 01598"
function prettyPhone(p) {
  const d = String(p).replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : '+' + d;
}
// After linking, the bot offers a "Share my number" button; listen for it for 2 minutes
function waitForPhone(chat) {
  const until = Date.now() + 2 * 60 * 1000;
  const poll = setInterval(async () => {
    if (Date.now() > until) return clearInterval(poll);
    try {
      const j = await (await fetch(`${API}/api/telegram?phone=${chat}`)).json();
      if (!j.phone) return;
      clearInterval(poll);
      const m = state.team.find(x => x.chat === chat);
      if (m) { m.phone = j.phone; saveTeam(); }
    } catch {}
  }, 3000);
}

// The team panel: everyone linked (role + brand editable), invites waiting, and "Invite someone"
function renderTeam() {
  const brandOpts = sel => [`<option value="${ALL_BRANDS}"${sel === ALL_BRANDS ? ' selected' : ''}>All brands</option>`,
    ...brandNames().map(b => `<option${b === sel ? ' selected' : ''}>${esc(b)}</option>`)].join('');
  const roleOpts = sel => Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${r.label}</option>`).join('');
  $('#teamList').innerHTML = state.team.length
    ? state.team.map((m, i) => `<li><span class="tm-name"><b>${esc(m.name)}</b>${m.phone || m.tgName ? `<small>${esc(m.phone ? prettyPhone(m.phone) : `Telegram: ${m.tgName}`)}</small>` : ''}</span>
        <select class="field small" data-i="${i}" data-k="role" aria-label="Role of ${esc(m.name)}">${roleOpts(m.role)}</select>
        <select class="field small" data-i="${i}" data-k="brand" aria-label="Brand for ${esc(m.name)}">${brandOpts(m.brand)}</select>
        <button class="mini" type="button" data-del="${i}" aria-label="Remove ${esc(m.name)}">✕</button></li>`).join('')
    : '<li class="none">No one yet. Invite Arsh, Ashish, Anurag or Biswa below.</li>';
  $$('#teamList select').forEach(s => s.onchange = () => { state.team[Number(s.dataset.i)][s.dataset.k] = s.value; saveTeam(); });
  $$('#teamList [data-del]').forEach(b => b.onclick = () => { state.team.splice(Number(b.dataset.del), 1); saveTeam(); });
  // Invites still waiting for the person to press Start
  $('#inviteList').innerHTML = state.invites.map(v => {
    const url = `https://t.me/${TG_BOT}?start=${v.code}`;
    return `<li><span class="tm-name"><b>${esc(v.name)} · ${ROLES[v.role].label}</b><small>${esc(v.brand === ALL_BRANDS ? 'All brands' : v.brand)} · waiting for Start</small></span>
      <input class="field small" readonly value="${url}" aria-label="Invite link" onclick="this.select()">
      <button class="btn ghost small" type="button" data-copy="${url}">Copy</button>
      <a class="btn ghost small" href="${url}" target="_blank" rel="noopener">Open</a></li>`;
  }).join('');
  $$('#inviteList [data-copy]').forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; }));
  if (!$('#invRole').options.length) $('#invRole').innerHTML = roleOpts('srmanager');
  const taken = new Set([...state.team, ...state.invites].map(m => m.name));
  const free = TEAM_NAMES.filter(n => !taken.has(n));
  $('#invName').innerHTML = free.length ? free.map(n => `<option>${n}</option>`).join('') : '<option value="">Everyone is on the team</option>';
  $('#invite').disabled = !free.length;
  const keep = $('#invBrand').value || ALL_BRANDS;
  $('#invBrand').innerHTML = brandOpts(keep);
  $('#roleHelp').innerHTML = Object.values(ROLES).map(r => `<li><b>${r.label}:</b> ${esc(r.can)}</li>`).join('');
}

// One invite = one one-time code. We keep checking every code that is still waiting (10 minutes each).
function invite() {
  if (!$('#invName').value) return;
  // Mayank is always the Director
  const v = { code: Math.random().toString(36).slice(2, 10), name: $('#invName').value, role: $('#invName').value === 'Mayank' ? 'director' : $('#invRole').value, brand: $('#invBrand').value, until: Date.now() + 10 * 60 * 1000 };
  state.invites.push(v);
  renderTeam();
  clearInterval(state.tgLinkPoll);
  state.tgLinkPoll = setInterval(async () => {
    state.invites = state.invites.filter(x => Date.now() < x.until);
    if (!state.invites.length) { clearInterval(state.tgLinkPoll); return renderTeam(); }
    for (const x of [...state.invites]) {
      try {
        const j = await (await fetch(`${API}/api/telegram?link=${x.code}`)).json();
        if (!j.linked) continue;
        state.invites = state.invites.filter(y => y !== x);
        // Same Telegram chat linked again → update their role instead of adding them twice
        // Same Telegram chat linked again → update that entry instead of adding them twice.
        // An older entry with the same team name (e.g. a fresh phone) is replaced too.
        state.team = state.team.filter(m => m.chat === j.chat || m.name !== x.name);
        const old = state.team.find(m => m.chat === j.chat);
        const entry = { name: x.name, tgName: j.name, role: x.role, brand: x.brand };
        if (old) Object.assign(old, entry); else state.team.push({ chat: j.chat, ...entry });
        saveTeam();
        log(`Telegram linked for ${x.name} as ${ROLES[x.role].label}`);
        const m = state.team.find(y => y.chat === j.chat);
        const what = m.role === 'director' ? 'You can approve, hold or reject every move, and undo any action the agents took (tap ↩ Undo).'
          : m.role === 'srmanager' ? 'You can approve, hold or reject every move.'
          : m.role === 'manager' ? `You can approve, hold or reject moves up to ${inr(managerLimit())}/day. Bigger ones go to a Sr Manager.`
          : 'You will get every report for your information.';
        sendTgNote(m.chat, `👋 You are on the Drishti team as ${ROLES[m.role].label} for ${m.brand === ALL_BRANDS ? 'all brands' : m.brand}. ${what}`);
        waitForPhone(j.chat);
      } catch {}
    }
  }, 3000);
}

$('#tgLink').onclick = () => { renderTeam(); openSheet('#teamPanel'); };
$('#invite').onclick = invite;
$('#mgrLimit').value = managerLimit();
$('#mgrLimit').onchange = e => { store.set('drishti-mgr-limit', String(Math.max(0, Number(e.target.value) || 0))); e.target.value = managerLimit(); };
showTg();

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
  // Visitors who never touched the old single default rule get the new set of defaults.
  const untouchedOldDefault = Array.isArray(saved) && saved.length === 1 && saved[0].type === 'flat' && Number(saved[0].a) === 2;
  const list = Array.isArray(saved) && !untouchedOldDefault ? saved : oldDays && !saved ? [{ type: 'flat', a: Number(oldDays) }] : DEFAULT_RULES;
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

// ---------------------------------------------------------------------------
// CUSTOM CONDITION: you describe a situation in plain words. The server reads
// today's news about it and the AI drafts a scenario for this brand (data changes,
// rivals and their strategy, suggested responses). "Use this condition" puts it in
// the Conditions picker; the agents then run on it within your rules and approvals.
// One draft per brand, kept in this browser.
// ---------------------------------------------------------------------------
const CUSTOM = 'drishti-custom';
const customDrafts = (() => { try { return JSON.parse(store.get(CUSTOM) || '{}'); } catch { return {}; } })();
let pendingDraft = null; // the draft on screen, not yet used

// Ideas to click, so the box is never a blank page
const CC_IDEAS = {
  glowveda: ['A rival launches a cheaper vitamin C serum with big Instagram influencer push', 'Monsoon arrives early in Mumbai and Bengaluru'],
  crunchkart: ['Blinkit and Zepto run a 50% off snacks sale this week', 'A new protein-snack brand floods Instagram reels in Pune'],
  shyamlal: ['Everest and MDH cut prices on garam masala before Diwali', 'Heavy rains in Indore and Bhopal stop deliveries for a few days'],
};

// What the drafter knows about the brand on screen (its product info, channels, regions, rivals)
function brandInfo() {
  const d = state.data, b = BRANDS[d.brandKey] || {};
  const uniq = list => [...new Set(list.filter(Boolean))];
  return { name: d.brand, category: d.category, who: b.who || '', aov: b.aov, dailySpend: b.dailySpend,
    channels: uniq(d.clean.map(r => r.channel)), regions: uniq(d.clean.map(r => r.region)),
    campaigns: uniq(d.clean.map(r => r.campaign)).slice(0, 14), rivals: uniq(d.cleanComp.map(c => c.competitor)) };
}

function openCustom() {
  const d = state.data;
  if (d?.source !== 'Sample') { setStatus('Custom conditions work on the sample brands for now. Pick Glowveda, Crunchkart or Shyamlal Masale.'); return; }
  $('#ccBrand').textContent = d.brand;
  const mine = customDrafts[d.brandKey];
  $('#ccText').value = mine?.text || '';
  $('#ccEg').innerHTML = (CC_IDEAS[d.brandKey] || []).map(t => `<button type="button">${esc(t)}</button>`).join('');
  $$('#ccEg button').forEach(b => b.onclick = () => { $('#ccText').value = b.textContent; $('#ccText').focus(); });
  pendingDraft = mine || null;
  $('#ccOut').innerHTML = mine ? showDraft(mine, true) : '';
  wireDraft();
  openSheet('#customCond');
  setTimeout(() => $('#ccText').focus(), 350);
}

// The draft as a card: headline, effects on the data, rivals, suggested moves, news read
function showDraft(dr, inUse = false) {
  const pct = (v, word) => v === 1 ? '' : `<span class="${(word === 'ad prices' ? v < 1 : v > 1) ? 'up' : 'down'}">${word} ${v > 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%</span>`;
  const where = e => [e.channel, e.region, e.campaign && `“${e.campaign}” ads`].filter(Boolean).join(' · ') || 'All ads';
  return `<div class="cc-draft">
    <h4>${esc(dr.label)}</h4>
    <p class="hl">${esc(dr.headline)}</p>
    <p class="hint">${esc(dr.note)} Lasts the last ${dr.days} day${dr.days === 1 ? '' : 's'} of data. ${dr.external ? '<b>Market-wide shock: Storm Mode will hold big moves for your approval.</b>' : 'Not a market-wide shock: agents act on what the data shows, inside your rules.'}</p>
    <h5>What changes in the data</h5>
    <ul>${dr.effects.map(e => `<li><b>${esc(where(e))}</b>: ${[pct(e.cpm, 'ad prices'), pct(e.ctr, 'clicks'), pct(e.cvr, 'sales per click')].filter(Boolean).join(', ') || 'no change'}${e.why ? ` <small>(${esc(e.why)})</small>` : ''}</li>`).join('')}</ul>
    ${dr.rivals.length ? `<h5>Competitors and their strategy</h5>
    <ul>${dr.rivals.map(r => `<li><b>${esc(r.name)}</b> on ${esc(r.channel)}: ${esc(r.strategy)} <small>(their ads: “${esc(r.campaign)}”, ${Math.round(r.engagement * 1000) / 10}% click rate)</small></li>`).join('')}</ul>` : ''}
    ${dr.moves.length ? `<h5>First read: how we could respond</h5><ul>${dr.moves.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
    <p class="hint">The agents decide the actual moves when they run, using your rules and approval limits.</p>` : ''}
    <h5>Today's news read</h5>
    ${dr.news.length ? `<ul>${dr.news.map(n => `<li>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}${n.source ? ` <small>· ${esc(n.source)}</small>` : ''}</li>`).join('')}</ul>`
      : '<p class="hint">No matching headlines found, so this is treated as hypothetical.</p>'}
    <p class="hint">Drafted by ${esc(dr.by === 'keywords' ? 'keyword reading (AI not reachable)' : dr.by)} · ${new Date(dr.madeAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
    <div class="cc-actions">
      ${inUse ? `<button type="button" class="btn" data-cc="use">${ic('play')}Run the agents on it</button><button type="button" class="mini" data-cc="clear">Remove this condition</button>`
        : `<button type="button" class="btn" data-cc="use">${ic('play')}Use this condition</button>`}
    </div>
  </div>`;
}
function wireDraft() {
  $$('#ccOut [data-cc]').forEach(b => b.onclick = () => (b.dataset.cc === 'use' ? useDraft() : clearDraft()));
  fillIcons();
}

// Draft button: ask the server (news + AI); if it is unreachable, read the words in the browser
$('#ccForm').onsubmit = async ev => {
  ev.preventDefault();
  const text = $('#ccText').value.trim();
  if (text.length < 8) { $('#ccOut').innerHTML = '<p class="hint">Write a sentence or two about the situation.</p>'; return; }
  const btn = $('#ccDraft'), info = brandInfo();
  btn.disabled = true;
  $('#ccOut').innerHTML = '<p class="hint"><span class="typing">Reading today\'s news and drafting the scenario</span></p>';
  let draft = null, why = '';
  if (!state.offline) {
    try {
      const res = await fetch(API + '/api/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ text, brand: info, model: $('#modelPick').value || undefined }) });
      const j = await res.json();
      if (j.draft) { draft = cleanDraft(j.draft, info); if (j.usage) trackAI(j.usage, 'ask'); }
      else why = j.error || '';
    } catch (e) { why = 'server not reachable'; }
  } else why = 'server not reachable';
  if (!draft) draft = draftLocally(text, info); // no news in the browser, but still a usable draft
  pendingDraft = draft;
  $('#ccOut').innerHTML = (why ? `<p class="hint">${esc(why)}: drafted from your words instead.</p>` : '') + showDraft(draft);
  wireDraft();
  btn.disabled = false;
};

// Put the draft in the Conditions picker, load it and offer to start the agents
function useDraft() {
  if (!pendingDraft || state.running) return;
  const key = state.data.brandKey;
  saveView();                               // keep the run you are leaving
  customDrafts[key] = pendingDraft;
  store.set(CUSTOM, JSON.stringify(customDrafts));
  delete views[`${key}|custom`]; persistViews(); // an older custom run no longer matches
  log(`Custom condition for ${state.data.brand}: “${pendingDraft.label}”`);
  fillScenarios(key);
  $('#scenario').value = 'custom';
  loadSample(); closeSheets(); askToStart();
}
function clearDraft() {
  const key = state.data.brandKey;
  delete customDrafts[key]; store.set(CUSTOM, JSON.stringify(customDrafts));
  delete views[`${key}|custom`]; persistViews();
  pendingDraft = null; $('#ccOut').innerHTML = '';
  if ($('#scenario').value === 'custom') { $('#scenario').value = 'normal'; loadSample(); if (!restoreView()) askToStart(); }
  else fillScenarios(key);
}

// ---------------------------------------------------------------------------
// WHAT-IF SCENARIOS: run the agents once per condition (in this browser, with the
// built-in rules engine, so no AI tokens) and compare what they would do.
// ---------------------------------------------------------------------------
$('#whatIfBtn').onclick = () => {
  if (isOpen('#whatIf')) return closeSheets();
  $('#wiBrand').textContent = state.data?.brand || 'this brand';
  openSheet('#whatIf');
};
async function runWhatIf() {
  const btn = $('#wiRun'), d = state.data;
  if (!d?.rows?.length) return;
  btn.disabled = true; btn.textContent = 'Running every scenario…';
  $('#wiAskWrap').hidden = true; $('#wiAnswer').textContent = '';
  const { runDrishti } = await import('./lib/agent.js');
  const sample = d.source === 'Sample';
  // Your own data: only the market events can be applied (data-problem twists need the sample generator)
  const list = scenariosFor(sample ? d.brandKey : null).filter(x => sample || !x.twists);
  const out = [];
  for (const sc of list) {
    $('#wiTable').innerHTML = `<p class="hint">Running: ${esc(sc.label)} (${out.length + 1} of ${list.length})…</p>`;
    const data = sample ? sampleFor(d.brandKey, sc.key) : applyScenario(d, sc.key, null);
    let r = null;
    await runDrishti({ brand: d.brand, category: d.category, rows: data.rows, orders: data.orders, competitors: data.competitors || [],
      breakevenRoas: Number($('#breakeven').value) || 2, rules: state.rules, model: 'rules', scenario: scenarioContext(sc.key) },
      e => { if (e.type === 'result') r = e; });
    if (!r) continue;
    const auto = r.actions.filter(a => a.tier === 'auto'), ask = r.actions.filter(a => a.tier === 'approval');
    const top = [...r.actions].sort((a, b) => (b.impact || 0) - (a.impact || 0))[0];
    // Remember each action as "title + whether it ran or waits", to spot what changes vs normal
    const moves = r.actions.map(a => ({ title: a.title, tier: a.tier }));
    out.push({ moves, key: sc.key, label: sc.label, note: sc.note, health: r.ahi.after.value, healthBefore: r.ahi.before.value,
      roasNow: r.impact.trueRoasNow, roasNext: r.impact.trueRoasProjected, freed: r.impact.freedPerDay, extra: r.impact.extraRevenuePerDay,
      auto: auto.length, ask: ask.length, storm: !!r.shock?.external, top: top ? top.title : '—' });
  }
  state.whatIf = { brand: d.brand, rows: out };
  const base = out.find(x => x.key === 'normal') || out[0];
  // What the agents do differently from normal: new moves, and moves that now wait for approval
  // Same move with different numbers ("seen 5.2×" vs "seen 5.6×") counts as the same move
  const same = t => t.replace(/[₹+\-−]?[\d.,]+[%×]?/g, '#');
  const baseMoves = new Map(base.moves.map(m => [same(m.title), m.tier]));
  for (const x of out) {
    const fresh = x.moves.filter(m => !baseMoves.has(same(m.title))).map(m => m.title);
    const nowAsk = x.moves.filter(m => baseMoves.get(same(m.title)) === 'auto' && m.tier === 'approval').length;
    const dropped = base.moves.filter(m => !x.moves.some(y => same(y.title) === same(m.title))).length;
    x.diff = x.key === 'normal' ? `Biggest move: ${x.top}`
      : [fresh.length && `New: ${fresh.slice(0, 2).join('; ')}${fresh.length > 2 ? ` (+${fresh.length - 2} more)` : ''}`,
         nowAsk && `${nowAsk} move${nowAsk === 1 ? '' : 's'} now wait for your OK`,
         dropped && `${dropped} normal move${dropped === 1 ? '' : 's'} no longer needed`].filter(Boolean).join(' · ') || 'Same moves as normal';
  }
  for (const x of out) delete x.moves; // keep the table data small for "Ask the agent"
  const delta = (v, b) => { const x = Math.round((v - b) * 100) / 100; return !b || !x ? '' : `<small class="${x > 0 ? 'up' : 'down'}">${x > 0 ? '+' : ''}${x}</small>`; };
  $('#wiTable').innerHTML = `<table>
    <tr><th>Condition</th><th>True ROAS today</th><th>Health after fixes</th><th>Done now · need you</th><th>What the agents do differently</th><th></th></tr>
    ${out.map(x => `<tr class="${x.key === 'normal' ? 'base' : ''}">
      <td><b>${esc(x.label)}</b>${x.storm ? ' <span class="badge wait">Storm Mode</span>' : ''}<br><small>${esc(x.note)}</small></td>
      <td>${x.roasNow} ${x.key === 'normal' ? '' : delta(x.roasNow, base.roasNow)}<br><small>→ ${x.roasNext} after</small></td>
      <td>${x.health} <small>(was ${x.healthBefore})</small></td>
      <td>${x.auto} · ${x.ask}</td>
      <td><small>${esc(cut(x.diff, 220))}</small></td>
      <td><button type="button" class="mini" data-load="${x.key}" ${sample ? '' : 'hidden'}>Load</button></td></tr>`).join('')}
  </table>
  <p class="hint">“Load” switches the live loop to that condition, so you can run it for real (with reports).</p>`;
  $$('#wiTable [data-load]').forEach(b => b.onclick = () => {
    $('#scenario').value = b.dataset.load; loadSample(); closeSheets(); askToStart();
  });
  $('#wiAskWrap').hidden = false;
  btn.disabled = false; btn.innerHTML = `${ic('loop')}Run all scenarios again`;
}
$('#wiRun').onclick = runWhatIf;

// Ask the agent about the comparison (this one uses AI tokens)
$('#wiAskForm').onsubmit = async ev => {
  ev.preventDefault();
  const out = $('#wiAnswer'), q = $('#wiAsk').value.trim();
  if (!q || !state.whatIf) return;
  if (state.offline) { out.textContent = 'Questions need our server, which this network cannot reach right now.'; return; }
  out.innerHTML = '<span class="typing">Thinking</span>';
  try {
    const res = await fetch(API + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ question: q, context: { brand: state.whatIf.brand, whatIfScenarios: state.whatIf.rows,
        note: 'Each row is the same brand under a hypothetical condition. roasNow = true ROAS before fixes, roasNext = after the agents act, health = agent health index after fixes, auto/ask = actions done on their own / waiting for approval, storm = Storm Mode (big moves wait for a human).' } }) });
    const j = await res.json();
    out.textContent = j.answer || j.error || 'No answer came back. Please try again.';
    trackAI(j.usage, 'ask');
  } catch (e) { out.textContent = e.name === 'TimeoutError' ? 'The AI took too long. Please try again.' : 'Could not reach the Orchestrator. ' + e.message; }
};
loadRules();
renderRules();

// Ask the backend which AI engine is on (Groq / Gemini / rules)
// and which models it can switch between (for the picker in ②).
// If the backend doesn't answer within 8 seconds (server down, or a network that
// blocks vercel.app), mark it offline so runs happen right here in the browser.
// A miss is NOT final: while offline it checks again every 15 seconds, and as soon as
// the server answers, AI, email and Telegram switch back on by themselves.
let recheck = null;
function checkServer(ms = 12000) {
  return fetch(API + '/api/health', { signal: AbortSignal.timeout(ms) }).then(r => r.json()).then(h => {
    state.engine = h.engine;
    state.models = h.models || [];
    if (state.offline) log('Server reachable again: AI, email and Telegram are back on.');
    state.offline = false; clearInterval(recheck); recheck = null;
    renderModelPick();
    return true;
  }).catch(() => {
    state.offline = true; renderModelPick();
    recheck ||= setInterval(() => checkServer(), 15000);
    return false;
  });
}
checkServer();

// The model picker: the default model is always on; choosing another swaps it for the next run.
// "Built-in rules" runs the same agent maths with no AI model at all.
function renderModelPick() {
  const saved = store.get('drishti-model');
  // "Auto" (the default) lets the server try the model that has used the fewest tokens so far,
  // skipping any model that is about to hit its limit
  const opts = [{ id: '', label: 'Auto · fewest tokens first' }, ...state.models, { id: 'rules', label: 'Built-in rules (no AI)' }];
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
    trackAI(e.ai, 'run');
    const nAuto = e.actions.filter(a => a.tier === 'auto').length, nAsk = e.actions.filter(a => a.tier === 'approval').length;
    const prev = lastAiRun(); // (trackAI above already saved this run if it used AI)
    const used = e.ai?.tokens ? ` · used ${kTok(e.ai.tokens)} AI tokens` : prev ? ` · last AI run used ${kTok(prev.tokens)} tokens` : '';
    addFeed(`<span class="tag">Done</span><span class="txt">Finished${e.seconds >= 1 ? ` in ${e.seconds}s` : ''}. ${e.actions.length} recommendations: ${nAuto} carried out now, ${nAsk} wait for you${used} ↓</span>`, 'final', 'P5');
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
  $('#startPrompt')?.remove();   // the "Start the agent for …" card, if showing
  state.agentLog = {}; state.mail = {}; state.tg = {};
  // A fresh id per run, so Telegram button taps land on the right run's actions
  state.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.runAt = Date.now(); // the hourly countdown starts from here (next check = this + 1 hour)
  state.stopTgPoll?.();
  const btn = $('#runBtn');
  btn.disabled = true; btn.classList.remove('idle'); btn.innerHTML = 'Agent running…';
  // No switching brand or twist mid-run (the results would belong to the old data)
  $$('input[name=brand], #scenario').forEach(el => el.disabled = true);
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

  const queue = []; let finished = false, gotResult = false;
  // Reader: pulls lines off the network stream into a queue
  const reader = (async () => {
    let body; // what the agents get (also reused by the in-browser safety net below)
    try {
      body = { brand: state.data.brand, category: state.data.category, rows: state.data.rows, orders: state.data.orders,
        competitors: state.data.competitors || [], breakevenRoas: Number($('#breakeven').value) || 2,
        rules: state.rules, model: $('#modelPick').value || undefined,
        scenario: state.data.source === 'Sample' ? scenarioContext(state.data.scenario) : null };
      // Backend known to be unreachable → go straight to the on-device run
      // Marked offline earlier? Try the server once more before running here
      if (state.offline && !(await checkServer(5000))) return await runHere(body, queue);
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
        recheck ||= setInterval(() => checkServer(), 15000); // keep trying in the background
        return await runHere(body, queue);
      } finally { clearTimeout(timer); }
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Server error ' + res.status); }
      const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      // Watchdog: if the server goes quiet for 25 seconds mid-run, stop waiting and finish here
      let stall;
      const quiet = () => new Promise((_, no) => { clearTimeout(stall); stall = setTimeout(() => no(new Error('stalled')), 25000); });
      try {
        for (;;) {
          const { value, done } = await Promise.race([rd.read(), quiet()]);
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            const ev = JSON.parse(line);
            if (ev.type === 'error') throw new Error(ev.message); // handled below: finish in the browser
            if (ev.type === 'result') gotResult = true;
            queue.push(ev);
          }
        }
      } finally { clearTimeout(stall); rd.cancel().catch(() => {}); }
      if (!gotResult) throw new Error('the server stopped before the agents finished');
    } catch (e) {
      // SAFETY NET: whatever went wrong on the server, finish the run right here so the
      // screen never ends up empty. Reports (email / Telegram) still go out after it.
      if (!gotResult) {
        queue.push({ type: 'thought', text: 'The server hit a snag, so the agents are finishing right here in your browser (built-in rules engine, same maths).' });
        try { const { runDrishti } = await import('./lib/agent.js'); await runDrishti({ ...body, model: 'rules' }, ev => queue.push(ev)); }
        catch (e2) { queue.push({ type: 'error', message: e2.message + ' Check your connection and try again.' }); }
      }
    }
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
  $$('input[name=brand], #scenario').forEach(el => el.disabled = false);
  hubIdle();
  watchLine('<b>Back to watching</b> · the next full check re-reads everything the agents just changed');
  saveView();
}
$('#runBtn').onclick = run;

// What ② and ③/④ look like before any run (saved once, so we can go back to it)
const EMPTY = { feed: $('#feed').innerHTML, rows: $('#rows').innerHTML };

// New data (another brand, a twist, your own file) means the last run's results
// belong to different numbers. Clear them and ask for a fresh run on the new data.
function resetLoop() {
  state.runAt = null; // a brand that hasn't run yet has no countdown
  if (!state.result) return runLabel();
  state.result = null; state.loop = 0;
  state.agentLog = {}; state.mail = {}; state.tg = {};
  state.stopTgPoll?.();
  $('#feed').innerHTML = EMPTY.feed;
  $('#rows').innerHTML = EMPTY.rows;
  $('#actCount').textContent = ''; $('#statusPill').textContent = ''; $('#statusPill').className = 'pill';
  $('#results').hidden = true; $('#details').hidden = true;
  $('#askAnswer').textContent = '';
  renderStrip();
  hubIdle();
  runLabel();
  log(`Switched to ${state.data.brand}. Press Run to start the agents on it.`);
}

// One line about the data, using the SAME counts as the tiles in ① Data in:
// ad channels = the ad tiles, live sources = the number in ①'s header, orders = real
// orders added up (not the number of order records), and today's live count from the Shopify tile.
function dataSummary(d) {
  const channels = new Set(d.clean.map(r => r.channel)).size;
  const sources = sourceList().filter(s => s.on).length;
  const days = new Set(d.clean.map(r => r.date)).size;
  const totalOrders = Math.round(d.cleanOrders.reduce((s, o) => s + o.orders, 0));
  const today = counts.Shopify ? Math.floor(counts.Shopify.v.orders) : null;
  return `${d.clean.length.toLocaleString('en-IN')} ad rows from ${channels} ad channel${channels === 1 ? '' : 's'} (${sources} live sources in all)` +
    (totalOrders ? `, ${totalOrders.toLocaleString('en-IN')} ${esc(d.ordersFrom || 'Shopify')} orders over ${days} days${today != null ? ` (${nIN(today)} so far today)` : ''}.` : ', no orders file.');
}

// After a brand / twist switch: a clear prompt in ② that starts the agents on the new data.
// Nothing runs (and no email or Telegram goes out) until you press it.
function askToStart() {
  if (state.running) return;
  const d = state.data, sc = d.scenario && d.scenario !== 'normal' ? SCENARIOS[d.scenario] : null;
  $('#startPrompt')?.remove();
  $('#loop').insertAdjacentHTML('beforeend', `<div class="start-prompt" id="startPrompt" role="dialog" aria-label="Start the agent">
    <p class="sp-k">Now on</p>
    <h3>${esc(d.brand)}</h3>
    <p>${dataSummary(d)} ${sc ? '' : 'The agents have not checked this brand yet.'}</p>
    ${sc ? `<p class="sp-sc"><b>${esc(sc.label)}</b> (hypothetical)<br>${esc(sc.note)}</p>` : ''}
    ${sc?.rivals?.length ? `<p class="sp-rv">Rivals: ${sc.rivals.map(r => `<b>${esc(r.name)}</b>`).join(', ')}. Your rules and approvals still apply.</p>` : ''}
    <button type="button" class="btn" id="startHere">${ic('play')}Start the agent for ${esc(d.brand)}</button>
  </div>`);
  $('#startHere').onclick = run;
  $('#startHere').focus({ preventScroll: true });
  stage(0, `<b>${esc(d.brand.split(' ')[0])}</b><small>press Start</small>`);
  $('#loop').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// The Run button says which brand it will run on, e.g. "Run for Crunchkart"
function runLabel() {
  const btn = $('#runBtn');
  if (state.running || !btn) return;
  const name = state.data?.brand || '';
  btn.innerHTML = state.result ? `${ic('loop')}Run again` : `${ic('play')}Run ${name ? `for ${esc(name)}` : 'the agent'}`;
  fillIcons();
  btn.classList.toggle('idle', !state.result);
}

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
  // Report status lines (email, then Telegram). When email services are down the email line
  // becomes a link that opens the report in the visitor's own email app.
  const line = (m, icon) => !m ? '' : m.href
    ? `<a class="mail" href="${esc(m.href)}" title="${esc(m.text)}">${ic(icon)} ${esc(m.text)}</a>`
    : `<span class="mail ${m.ok ? 'sent' : ''}" title="${esc(m.text)}">${ic(icon)} ${esc(m.text)}</span>`;
  const mail = line(state.mail[a.id], 'mail') + line(state.tg[a.id], 'send');
  if (st === 'pending') return `<div class="card-a pending">…</div>`;
  if (st === 'executing') return `<div class="card-a executing" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('zap')} ${esc(a.execute || a.title)}</div></div>`;
  if (st === 'waiting') return `<div class="card-a waiting" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('clock')} ${esc(a.title)}</div>
    <div class="foot">${a.held ? `<span class="badge hold">On hold${a.decidedBy ? ` · ${esc(a.decidedBy)}` : ''}</span>` : '<span class="badge wait">Your call</span>'}<button class="mini yes" data-act="approve" data-id="${a.id}">Approve</button>${a.held ? '' : `<button class="mini" data-act="hold" data-id="${a.id}">Hold</button>`}<button class="mini" data-act="reject" data-id="${a.id}">Reject</button></div></div>`;
  if (st === 'done') return `<div class="card-a done" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${ic('check')} ${esc(a.feedback || a.title)}</div>
    <div class="foot"><span class="badge auto">${a.tier === 'auto' ? (a.rule ? 'Auto · your rule' : 'Auto') : `Approved${a.decidedBy ? ` by ${esc(a.decidedBy)}` : ''}`}${a.sentTo ? ' · sent to ' + esc(a.sentTo) : ''}</span>${a.tier === 'auto' ? `<button class="mini" data-act="undo" data-id="${a.id}">Undo</button>` : ''}${mail}</div></div>`;
  return `<div class="card-a ${st}" data-tip="act" data-id="${a.id}" tabindex="0">${who}<div class="doing">${st === 'rejected' ? '✕ Rejected: nothing changed' : '↩ Rolled back: ' + esc(a.title)}</div>
    <div class="foot"><span class="badge off">${st === 'rejected' ? `Rejected by ${esc(a.decidedBy || 'you')}` : `Undone by ${esc(a.decidedBy || 'you')}`}${a.decidedAt ? ` · ${esc(a.decidedAt)}` : ''}${a.sentTo ? ' · sent to ' + esc(a.sentTo) : ''}</span>${mail}</div></div>`;
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
// `from` is 'telegram' when the tap came from the Telegram buttons, so we don't message back twice.
// `by` = who tapped on Telegram ({ chat, name, role }); the rest of the team is told who decided.
async function decide(id, act, from, by) {
  const a = state.result.actions.find(x => x.id === id); if (!a) return;
  const who = by ? `${by.name}${by.role ? ` (${by.role})` : ''}` : '';
  const actor = who || 'You'; // the log line names the Telegram teammate who decided
  // Who decided, shown on the card, in the details panel and in the email report
  a.decidedBy = who || 'you, on the website';
  // The real moment of the tap (a Telegram tap may have happened while this page was closed)
  const tapped = new Date(by?.at || Date.now());
  a.decidedAt = tapped.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  // Taps from more than a minute ago say when they happened: "… on Telegram at 12:30 pm"
  const via = from === 'telegram' ? ` on Telegram${Date.now() - tapped > 60000 ? ` at ${a.decidedAt}` : ''}` : '';
  // Tell everyone else on the team what was decided on Telegram and by whom
  const tellTeam = text => { if (from === 'telegram' && who) telegramNote(`${text} by ${who}: ${a.title}`, by.chat); };
  if (act === 'hold') {
    a.held = true; updateRow(a);
    log(`${actor} put "${a.title}" on hold${via}`);
    if (!from) telegramNote(`⏸ On hold (set on the site): ${a.title}`);
    tellTeam('⏸ Put on hold');
    saveView();
    return;
  }
  if (act === 'approve') {
    log(`${actor} approved "${a.title}"${via}`);
    a.state = 'executing'; updateRow(a, true);
    await wait(900);
    a.state = 'done'; updateRow(a);
    log(`${agentName(a.agent)} done: ${a.feedback || a.title}`);
    feedBack(a);
    if (sendsTo('email')) emailReport([a], []);
    if (!from) telegramNote(`✅ Approved on the site: ${a.feedback || a.title}`);
    tellTeam('✅ Approved');
  } else if (act === 'reject') {
    a.state = 'rejected'; updateRow(a);
    log(`${actor} rejected "${a.title}"${via}`);
    if (!from) telegramNote(`❌ Rejected on the site: ${a.title}`);
    tellTeam('❌ Rejected');
  } else if (act === 'undo') {
    a.state = 'undone'; updateRow(a);
    log(`${actor} rolled back "${a.title}"${via}`);
    feedBack(a, `restored: ${a.title}`);
    if (!from) telegramNote(`↩ Undone on the site: ${a.title}`);
    tellTeam('↩ Undone');
  }
  renderResults(state.result); // the goal tiles move as actions get done
  saveView();
  // Post the decision to the approvals channel (Slack / Discord), if set up
  try {
    const res = await fetch(API + '/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook: $('#webhook').value.trim() || undefined, action: a, decision: act, brand: state.result.brand }) });
    const j = await res.json();
    if (j.sent) { a.sentTo = j.to; log(`Posted to ${j.to}`); updateRow(a); }
  } catch {}
}

// ---------------------------------------------------------------------------
// Action report: by email (default) and/or on Telegram, whichever are switched on in the sidebar.
// ---------------------------------------------------------------------------
function sendReport(done, waiting) {
  return Promise.all([sendsTo('email') && emailReport(done, waiting), sendsTo('telegram') && telegramReport(done, waiting)]);
}

// Telegram: every team member for this brand gets one crisp summary. Actions their role may
// decide come with Approve / Hold / Reject buttons; the rest are listed for information.
// The taps come back through our server; the page checks for them every few seconds.
const TG_WHY = {
  'not-configured': 'Telegram is not set up on the server yet',
  'not-linked': 'add people in the Telegram team panel first',
  'blocked': 'the Drishti bot was stopped in Telegram; invite them again',
};
async function telegramReport(done, waiting) {
  if (!done.length && !waiting.length) return;
  const all = [...done, ...waiting];
  const mark = status => { for (const a of all) { state.tg[a.id] = status; updateRow(a); } };
  const r = state.result, people = teamFor(r.brand);
  if (!people.length) return mark({ ok: false, text: state.team.length ? `no one on the Telegram team covers ${r.brand}` : TG_WHY['not-linked'] });
  if (state.offline) return mark({ ok: false, text: 'Telegram needs our server, which this network cannot reach' });
  mark({ ok: false, text: 'sending to Telegram…' });
  // One message set per person, all at the same time
  const results = await Promise.all(people.map(async m => {
    try {
      const res = await fetch(API + '/api/telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          chat: m.chat, name: m.name, brand: r.brand, runId: state.runId, role: roleLabel(m), undo: m.role === 'director',
          health: `${r.ahi.before.value} → ${r.ahi.after.value}`,
          done: done.map(a => ({ id: a.id, title: a.feedback || a.title })), doneCount: done.length,
          waiting: waiting.map(a => ({ id: a.id, agent: agentName(a.agent), title: a.recommend || a.title, impact: a.impact, act: canDecide(m, a), who: whoDecides(a) })),
        }),
      });
      return { m, j: await res.json() };
    } catch { return { m, j: { reason: 'Telegram service unreachable' } }; }
  }));
  const ok = results.filter(x => x.j.sent), bad = results.filter(x => !x.j.sent);
  for (const x of bad) log(`Telegram to ${x.m.name}: ${TG_WHY[x.j.reason] || x.j.error || x.j.reason || 'not sent'}`);
  if (ok.length) log(`Action report sent on Telegram to ${ok.map(x => `${x.m.name} (${roleLabel(x.m)})`).join(', ')}`);
  // Each action's line says how many got it, and warns when nobody on Telegram may decide it
  for (const a of all) {
    const deciders = ok.filter(x => canDecide(x.m, a)).length;
    state.tg[a.id] = !ok.length ? { ok: false, text: TG_WHY[bad[0]?.j.reason] || bad[0]?.j.error || bad[0]?.j.reason || 'Telegram not sent' }
      : { ok: true, text: `sent on Telegram to ${ok.length} ${ok.length === 1 ? 'person' : 'people'}`
          + (a.state === 'waiting' ? (deciders ? `, ${deciders} can decide` : `; no one there can decide it (needs a ${whoDecides(a)}), so decide here`) : '') };
    updateRow(a);
  }
  if (ok.some(x => x.j.buttons)) pollTelegram();
}

// Short one-line Telegram message to one chat
function sendTgNote(chat, note) {
  fetch(API + '/api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat, note }) }).catch(() => {});
}
// The same line to everyone on this brand's Telegram team (except `skip`, e.g. the person who tapped)
function telegramNote(note, skip) {
  if (!sendsTo('telegram') || state.offline || !state.result) return;
  for (const m of teamFor(state.result.brand)) if (m.chat !== skip) sendTgNote(m.chat, note);
}

// Every 4 seconds (for up to 30 minutes), ask the server whether any Telegram button was tapped.
// We tell the server who may decide, and double-check each tap against that person's role here too.
// The tick comes from a tiny background worker: browsers slow normal timers down to once a
// minute when this tab is in the background (e.g. while you are in Telegram), but not a worker's.
const ticker = (() => {
  try { return new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1200)'], { type: 'text/javascript' }))); }
  catch { return null; }
})();
function every1s(fn) {
  if (!ticker) { const t = setInterval(fn, 1200); return () => clearInterval(t); }
  const h = () => fn(); ticker.addEventListener('message', h);
  return () => ticker.removeEventListener('message', h);
}

function pollTelegram() {
  state.stopTgPoll?.();
  const run = state.runId, until = Date.now() + 30 * 60 * 1000;
  let busy = false; // never two checks at once (each tap must be handled exactly once)
  const stop = () => { state.stopTgPoll?.(); state.stopTgPoll = null; };
  state.stopTgPoll = every1s(async () => {
    if (busy) return;
    const open = state.result?.actions.filter(a => a.state === 'waiting') || [];
    const undoable = state.result?.actions.filter(a => a.state === 'done') || []; // the Director may undo these
    if (run !== state.runId || (!open.length && !undoable.length) || Date.now() > until) return stop();
    const people = teamFor(state.result.brand);
    const deciders = people.filter(m => m.role !== 'intern').map(m => m.chat);
    const directors = people.filter(m => m.role === 'director').map(m => m.chat);
    const names = Object.fromEntries(people.map(m => [m.chat, `${m.name} (${roleLabel(m)})`])); // "Mayank (Director)"
    const held = open.filter(a => a.held).map(a => a.id);
    busy = true;
    try {
      const { decisions = {}, undos = {} } = await (await fetch(`${API}/api/telegram?run=${run}&open=${open.map(a => a.id).join(',')}&team=${deciders.join(',')}&done=${undoable.map(a => a.id).join(',')}&directors=${directors.join(',')}&held=${held.join(',')}&names=${encodeURIComponent(JSON.stringify(names))}`)).json();
      // ↩ Undo taps from the Director
      for (const a of undoable) {
        const u = undos[a.id]; if (!u) continue;
        const m = state.team.find(x => x.chat === u.by);
        if (m?.role !== 'director') continue;
        decide(a.id, 'undo', 'telegram', { chat: m.chat, name: m.name, role: roleLabel(m), at: u.at });
      }
      for (const a of open) {
        const d = typeof decisions[a.id] === 'string' ? { act: decisions[a.id] } : decisions[a.id];
        if (!d) continue;
        const m = state.team.find(x => x.chat === d.by);
        if (m && !canDecide(m, a)) {   // e.g. a Manager tapping a move above their limit
          if (!a.refused?.[m.chat]) { (a.refused ||= {})[m.chat] = 1; sendTgNote(m.chat, `🔒 "${a.title}" needs a ${whoDecides(a)}. Your tap was not applied.`); }
          continue;
        }
        const by = m ? { chat: m.chat, name: m.name, role: roleLabel(m), at: d.at } : d.name ? { chat: d.by, name: d.name, at: d.at } : null;
        if (d.act === 'approve' || d.act === 'reject') decide(a.id, d.act, 'telegram', by);
        else if (d.act === 'hold' && !a.held) decide(a.id, 'hold', 'telegram', by);
      }
    } catch {}
    busy = false;
  });
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
  done.forEach((a, i) => lines.push([`Action ${i + 1} · ${agentName(a.agent)}`, `DONE: ${a.feedback || a.title}\nWhy: ${a.observed || a.detail}${a.decidedBy ? `\nApproved by: ${a.decidedBy}${a.decidedAt ? ` at ${a.decidedAt}` : ''}` : ''}`]));
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
    <div class="head"><span class="hl">${esc(r.briefing.headline)}</span>${storm}${broken}<small>If every move is approved · <a href="#details">See the reasoning</a></small></div>
    <div class="kpis" aria-label="Case goals">${kpiTiles(r)}</div>`;
}

// ---------------------------------------------------------------------------
// THE FIVE CASE GOALS, measured on this run's data. Each tile shows now → after,
// and clicking it opens the side panel with the exact calculation and reasoning.
// "Done so far" counts only actions already carried out; "if all approved" also
// counts the moves still waiting for you.
// ---------------------------------------------------------------------------
const sumOf = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0);
const pct1 = n => `${Math.round(n * 10) / 10}%`;
const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'); // a real minus sign, e.g. −50
const live = (a, all) => (all ? a.state !== 'rejected' && a.state !== 'undone' : a.state === 'done');
function kpiMath(r) {
  const acts = r.actions || [];
  // 1) Data freshness: how old the newest row is, versus a check every hour
  const lagDays = r.signal?.freshnessLagDays ?? 0;
  // 2) Spend on fatigued ads (last 3 days). An ad stops counting once its "pause + swap" action is done.
  const fat = (r.fatigue?.ads || []).filter(x => x.status === 'fatigued' && x.cause === 'creative fatigue');
  const fatNow = r.fatigue?.pctSpendFatigued || 0;
  const spend3 = fatNow ? (sumOf(fat, x => x.spendLast3) * 100) / fatNow : 0; // total 3-day spend, worked back from the share
  const pauseOf = ad => acts.find(a => a.kind === 'pause' && a.title.includes(`"${ad.ad}"`));
  const fatLeft = all => (spend3 ? (100 * sumOf(fat.filter(ad => !(pauseOf(ad) && live(pauseOf(ad), all))), x => x.spendLast3)) / spend3 : 0);
  // 3) Creative refresh: fatigued ads that already have replacement drafts, and how long the run took
  const drafted = (r.variants || []).filter(v => v.variants?.length);
  // 4) Spend below break-even (last 7 days). Each cohort action removes its cut (₹/day × 7).
  const losing = r.cohort?.losing || [], belowNow = r.cohort?.pctSpendLosing || 0;
  const spend7 = belowNow ? (sumOf(losing, c => c.spend7) * 100) / belowNow : 0;
  const cutOf = c => acts.find(a => a.kind === 'cohort' && a.title.startsWith(`${c.channel} · ${c.region}`));
  const belowLeft = all => (spend7 ? (100 * Math.max(0, sumOf(losing, c => c.spend7) - sumOf(losing, c => (cutOf(c) && live(cutOf(c), all) ? cutOf(c).impact * 7 : 0)))) / spend7 : 0);
  // 5) True blended ROAS: Shopify-calibrated ROAS now vs projected if every move is approved
  const roasNow = r.impact.trueRoasNow, roasAfter = r.impact.trueRoasProjected;
  const change = (now, after) => (now ? Math.round(((after - now) / now) * 100) : 0);
  return { lagDays, fat, fatNow, spend3, pauseOf, fatDone: fatLeft(false), fatAll: fatLeft(true), drafted,
    losing, belowNow, spend7, cutOf, belowDone: belowLeft(false), belowAll: belowLeft(true),
    roasNow, roasAfter, roasUp: change(roasNow, roasAfter), fatChange: change(fatNow, fatLeft(true)), change };
}
function kpiTiles(r) {
  const k = kpiMath(r);
  const met = ok => `<span class="goal ${ok ? 'met' : 'miss'}">${ok ? 'Goal met' : 'Below goal'}</span>`;
  const tile = (key, cls, label, big, sub, goal, ok) =>
    `<button type="button" class="kpi ${cls}" data-tip="kpi-${key}"><span class="kl">${label}</span><b class="kn">${big}</b><span class="ks">${sub}</span><span class="kg">Goal: ${goal} ${met(ok)}</span></button>`;
  return [
    tile('fresh', 'k1', 'Data freshness lag ↓', k.lagDays ? `${k.lagDays} d → 1 h` : '1 h', k.lagDays ? 'newest data now → hourly checks' : 'data re-read every hourly check', 'lower', true),
    tile('fatigue', 'k2', 'Spend on fatigued ads', k.fatNow ? `${signed(k.fatChange)}%` : '0%', `${pct1(k.fatNow)} → ${pct1(k.fatAll)} of spend`, '−50%', !k.fatNow || k.fatChange <= -50),
    tile('creative', 'k3', 'Creative refresh time ↓', k.drafted.length ? `${r.seconds ?? '<1'} s` : '—', k.drafted.length ? `flag → ${k.drafted.length} replacement set${k.drafted.length > 1 ? 's' : ''} drafted` : 'no ad needed a refresh', 'lower', true),
    tile('below', 'k4', '% spend below breakeven ↓', `${pct1(k.belowNow)} → ${pct1(k.belowAll)}`, `break-even true ROAS ${r.cohort?.breakevenRoas ?? '—'}`, 'lower', k.belowAll <= k.belowNow),
    tile('roas', 'k5', 'True blended ROAS', `${signed(k.roasUp)}%`, `${k.roasNow} → ${k.roasAfter}`, '+25%', k.roasUp >= 25),
  ].join('');
}

// ---------------------------------------------------------------------------
// Hover cards. Each element with data-tip="name" gets its card from TIPS[name].
// ---------------------------------------------------------------------------
const glimpseRows = (list, cols) => `<table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${list.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ''}">${esc(c[1](r))}</td>`).join('')}</tr>`).join('')}</table>`;
const fedBlock = key => (state.updates[key]?.length ? `<div class="k">Fed back after actions</div><ul>${state.updates[key].slice(0, 4).map(u => `<li class="new">↺ ${esc(u)}</li>`).join('')}</ul>` : '');

// ---------------------------------------------------------------------------
// AI USAGE: every run and every question reports the tokens it used. We keep a
// running total for today on this device, plus what Groq says is left of its free tier.
// ---------------------------------------------------------------------------
const kTok = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
function aiToday() {
  const today = new Date().toDateString();
  let u = null; try { u = JSON.parse(store.get('drishti-ai-use') || 'null'); } catch {}
  return u && u.day === today ? u : { day: today, tokens: 0, runs: 0, asks: 0, lastRun: 0, limits: null };
}
// Usage log: one line per run (newest first, last 40), kept in this browser.
// The last run that really used AI is kept too, so a check that finished on the
// built-in rules shows that run's real number instead of "0 tokens".
const RUN_LOG = 'drishti-ai-runs', LAST_AI = 'drishti-ai-lastrun';
const TYPICAL_RUN = 11000; // measured: one full run ≈ 11k tokens (used only before any AI run is recorded)
const runLog = () => { try { return JSON.parse(store.get(RUN_LOG) || '[]'); } catch { return []; } };
const lastAiRun = () => { try { return JSON.parse(store.get(LAST_AI) || 'null'); } catch { return null; } };
const clock = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function logRun(ai) {
  const d = state.data || {}, sc = d.scenario && d.scenario !== 'normal' ? SCENARIOS[d.scenario]?.label : '';
  const entry = { at: Date.now(), brand: d.brand || '', condition: sc || '', tokens: ai?.tokens || 0, calls: ai?.calls || 0,
    models: Object.keys(ai?.byModel || {}).map(m => m.split(' · ').pop()) };
  store.set(RUN_LOG, JSON.stringify([entry, ...runLog()].slice(0, 40)));
  if (entry.tokens) store.set(LAST_AI, JSON.stringify(entry));
}
function trackAI(ai, kind) {
  const u = aiToday();
  const tokens = ai?.tokens || 0;
  if (kind === 'run') logRun(ai);
  if (kind === 'run') { u.runs++; u.lastRun = tokens; } else u.asks++;
  u.tokens += tokens;
  const last = ai?.last || ai; // a run sends { tokens, calls, last: {limits…} }; a question sends the limits directly
  if (last?.requestsLeftToday != null) u.limits = { provider: last.provider, model: last.model, left: last.requestsLeftToday, perDay: last.requestsPerDay, tpm: last.tokensPerMinute, tpmLeft: last.tokensLeftThisMinute };
  store.set('drishti-ai-use', JSON.stringify(u));
  renderAI();
}
function renderAI() {
  const u = aiToday(), L = u.limits;
  $('#aiUseBody').innerHTML = !u.runs && !u.asks ? 'No AI calls yet today'
    : `<b>${kTok(u.tokens || lastAiRun()?.tokens || TYPICAL_RUN)}</b> tokens ${u.tokens ? 'today' : 'on the last AI run'} <small>(${u.runs} run${u.runs === 1 ? '' : 's'}${u.asks ? ` · ${u.asks} question${u.asks === 1 ? '' : 's'}` : ''})</small>` +
      `<br><small>Last run: ${lastRunText(u)}</small>` +
      (L ? `<br><small>${esc(L.provider)} free tier: <b>${nIN(L.left)}</b> of ${nIN(L.perDay)} requests left today</small>` : '');
}
// "Last run" text: this run's tokens, or the last AI run's real number (never 0)
function lastRunText(u) {
  const last = lastAiRun(), model = last?.models?.length ? ` · ${esc(last.models.join(', '))}` : '';
  if (u.lastRun) return `${kTok(u.lastRun)} tokens${model}`;
  return last ? `${kTok(last.tokens)} tokens${model} (last AI run, ${clock(last.at)})` : `≈${kTok(TYPICAL_RUN)} tokens per run`;
}
renderAI();

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
      ${state.tg[a.id] ? `<div class="k">Telegram report</div><p>${esc(state.tg[a.id].text)}</p>` : ''}
      ${a.decidedBy ? `<div class="k">Decided by</div><p>${esc(a.decidedBy)}${a.decidedAt ? ` at ${esc(a.decidedAt)}` : ''}</p>` : ''}`;
  },
  ahi() {
    const r = state.result; if (!r) return '';
    const A = r.ahi;
    return `<h4>${ic('gauge')} Agent Health Index</h4>
      <p>One score (0–100) for how healthy the ad account is, graded on TRUE revenue. <b>${A.before.value} → ${A.after.value}</b> · ${esc(A.after.status)}</p>
      <div class="k">Calculation</div>
      <p><code>AHI = G × P2^0.30 × P3^0.20 × P4^0.25 × P5^0.25</code><br>
      A weighted geometric mean, so one weak area can’t hide behind strong ones. G = 1 if the data can be trusted (Signal score ≥ 60), else 0.</p>
      <p>Now: ${ahiSum(A.before, r)}<br>After the actions: ${ahiSum(A.after, r)}</p>
      <div class="k">Category scores and their ranges</div>
      ${ahiTable(r)}
      <div class="k">Score bands</div>
      <ul><li><b style="color:var(--green)">70–100</b> healthy · <b style="color:var(--amber)">50–69</b> watch · <b style="color:var(--red)">0–49</b> alert (for each category)</li>
        <li>Overall status: <b>Green</b> all ≥ 70 · <b>Amber</b> any 50–69 · <b>Red 1</b> one below 50 · <b>Red 2</b> two or more below 50 · <b>Red 3</b> data gate shut (score forced to 0)</li></ul>`;
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
  tokens() {
    const u = aiToday(), L = u.limits;
    return `<h4>${ic('sparkles')} AI usage</h4>
      <p><b>Yes, every run uses tokens</b>, not only “Ask the agent”. In a run the Orchestrator reasons between agent calls and the Creative Studio writes new ads, so one run is usually several AI calls. Each question to “Ask the agent” is one more call. The What-if panel and the “Built-in rules” model use no tokens at all.</p>
      <div class="k">Today on this device</div><p>${u.tokens ? `${nIN(u.tokens)} tokens · ` : ''}${u.runs} run(s)${u.asks ? ` · ${u.asks} question(s)` : ''} · last AI run ${lastRunText(u)}</p>
      ${L ? `<div class="k">${esc(L.provider)} · ${esc(L.model)}</div><p>${nIN(L.left)} of ${nIN(L.perDay)} requests left today${L.tpm ? `; ${nIN(L.tpmLeft)} of ${nIN(L.tpm)} tokens left this minute` : ''}. The free tier also caps tokens per day per model and is shared by everyone using this site.</p>` : ''}
      <p style="color:var(--muted)">When a model runs out, Drishti switches to the next model, and if all are out, to the built-in rules engine, so the demo never stops. Limits reset daily.</p>`;
  },
  watch() {
    return `<h4>Always watching</h4><p>Between full checks the Orchestrator keeps reading the streams in ① and your rules. A full check (Run) re-reads everything, diagnoses, recommends and acts.</p><p style="color:var(--muted)">${nIN(rowsSeen)} rows read since you opened this page.</p>`;
  },
  email() { return `<h4>${ic('chat')} Get the action reports yourself</h4><p><b>Email (on by default):</b> type your address and every run emails you what the agents did.</p><p><b>Telegram (switch it on):</b> click the Telegram line to open your <b>Telegram team</b>. Invite yourself and your colleagues, each with a role and a brand. <b>Interns</b> get reports only. <b>Managers</b> get Approve, Hold and Reject buttons for moves up to their ₹/day limit. <b>Sr Managers</b> get buttons for every move. Tap one and the card here updates within seconds, and the rest of the team is told who decided.</p><p>With both switched on, every report goes to both.</p><p>After each run, one email lists every action taken and what waits for your approval. Each approval sends its own report.</p><p style="color:var(--muted)">If you get a one-time “Activate” email, click it and run the loop again. If email services are down, the card shows a link that opens the report in your own email app.</p>`; },
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

// HEALTH SCORE helpers, shared by the health-score panel and the "How the score is built" card.
const AHI_W = { P2: 0.30, P3: 0.20, P4: 0.25, P5: 0.25 };
const band = v => (v >= 70 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)');
// "1 × 45^0.30 × 60^0.20 × 72^0.25 × 88^0.25 = 64"
// (a score of 0 counts as 1 in the product, otherwise one zero would wipe out everything)
const ahiSum = (x, r) => `${r.signal.gateOpen ? 1 : 0} × ${Object.keys(AHI_W).map(k => `${Math.max(1, x.scores[k])}^${AHI_W[k].toFixed(2)}`).join(' × ')} = <b>${x.value}</b>`;
function ahiTable(r) {
  const A = r.ahi, E = A.explain || {}, pc = v => (v == null ? '—' : `${v}%`);
  // How the raw number maps to the score, e.g. "20% → 0 · 10% → 100"
  const range = e => (!e ? '0–100' : e.parts ? 'see the parts below' : `${e.b}${e.unit} → 0 · ${e.t}${e.unit} → 100`);
  const cell = (val, score) => `${val} → <b style="color:${band(score)}">${score}</b>`;
  const rows = Object.keys(AHI_W).map(k => {
    const e = E[k];
    const raw = side => (!e ? '' : e.parts ? '' : pc(e[side]));
    return `<tr><td>${agentName(k)}<br><small>${esc(e?.kpi || '')}</small></td><td class="num">${AHI_W[k] * 100}%</td><td>${range(e)}</td>
      <td class="num">${e && !e.parts ? cell(raw('before'), A.before.scores[k]) : `<b style="color:${band(A.before.scores[k])}">${A.before.scores[k]}</b>`}</td>
      <td class="num">${e && !e.parts ? cell(raw('after'), A.after.scores[k]) : `<b style="color:${band(A.after.scores[k])}">${A.after.scores[k]}</b>`}</td></tr>`;
  }).join('');
  const p3 = E.P3?.parts;
  return `<table><tr><th>Category</th><th>Weight</th><th>Range (value → score)</th><th>Before</th><th>After</th></tr>${rows}
    <tr><td>Signal (data gate G)<br><small>data trust score</small></td><td>gate</td><td>needs ≥ 60, else AHI = 0</td><td colspan="2" class="num">${r.signal.trustScore}/100 → ${r.signal.gateOpen ? 'open' : 'SHUT'}</td></tr></table>
    ${p3 ? `<p class="hint">Creative Studio score = 0.54 × replacements ready (${p3.readyBefore}% → ${p3.readyAfter}%) + 0.30 × local-language score (${p3.regionalBefore}% → ${p3.regionalAfter}% of regional spend; 0% scores 0, 60% scores 100) + 0.16 × 100 (brand & ASCI check).</p>` : ''}`;
}

// AI TOKENS card, last in Reasoning: what this run used per model, today's total on this
// device, and the order the server tries models in (fewest tokens per call first;
// a model about to hit its limit is moved to the end).
function renderTokens(r) {
  const card = $('#tokenCard');
  const ai = r.ai || {}, u = aiToday(), byModel = Object.entries(ai.byModel || {});
  card.innerHTML = `<h3>AI tokens</h3>
    ${ai.tokens ? `<p><b>${kTok(ai.tokens)}</b> tokens on this run · ${ai.calls} AI call${ai.calls === 1 ? '' : 's'}${byModel.length ? ` on <b>${esc(byModel.map(([m]) => m.split(' · ').pop()).join(', '))}</b>` : ''} ${u.tokens ? ` · <b>${kTok(u.tokens)}</b> today on this device` : ''}</p>`
      // This check finished on the built-in agent maths (AI models were resting): show the last AI run's real number
      : (() => { const last = lastAiRun(); return `<p><b>${kTok(last?.tokens || TYPICAL_RUN)}</b> tokens ${last ? `on the last AI run (${clock(last.at)}${last.brand ? ` · ${esc(last.brand)}` : ''} · ${last.calls} AI call${last.calls === 1 ? '' : 's'}${last.models?.length ? ` on <b>${esc(last.models.join(', '))}</b>` : ''})` : 'per run (typical)'} ${u.tokens ? ` · <b>${kTok(u.tokens)}</b> today on this device` : ''}</p>
        <p class="hint">This check finished on the agents' built-in maths while the AI models rested, so it added no new tokens.</p>`; })()}
    ${usageLog()}
    ${byModel.length ? `<table><tr><th>Model</th><th>Calls</th><th>Tokens</th></tr>${byModel.map(([m, x]) => `<tr><td>${esc(m)}</td><td class="num">${x.calls}</td><td class="num">${nIN(x.tokens)}</td></tr>`).join('')}</table>` : ''}
    ${ai.board?.length ? `<div class="k">Which model goes first next time</div>
      <table><tr><th>#</th><th>Model</th><th>Avg tokens / call</th><th>Status</th></tr>${ai.board.map((b, i) => `<tr><td class="num">${i + 1}</td><td>${esc(b.provider)} · ${esc(b.model)}</td><td class="num">${b.calls ? nIN(b.avgTokens) : 'not used yet'}</td><td>${b.skip ? `<span style="color:var(--amber)">skipped: ${esc(b.skip)}</span>` : 'ready'}</td></tr>`).join('')}</table>
      <p class="hint">The model with the fewest tokens per call so far is tried first. Any model close to its daily or per-minute limit is skipped and the next one takes over.</p>` : ''}`;
}

// Usage log: every run on this device, newest first (shown under the AI tokens line)
function usageLog() {
  const list = runLog().slice(0, 12);
  if (!list.length) return '';
  return `<div class="k">Usage log · each run</div>
    <table class="usage-log"><tr><th>Time</th><th>Brand</th><th>Tokens</th><th>AI calls</th><th>Models</th></tr>${list.map(x => `<tr>
      <td>${clock(x.at)}${new Date(x.at).toDateString() === new Date().toDateString() ? '' : ` <small>${new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small>`}</td>
      <td>${esc(x.brand)}${x.condition ? `<br><small>${esc(x.condition)}</small>` : ''}</td>
      <td class="num">${x.tokens ? nIN(x.tokens) : '<small>built-in maths</small>'}</td>
      <td class="num">${x.calls || '–'}</td>
      <td><small>${esc(x.models.join(', ') || 'agent formulas')}</small></td></tr>`).join('')}</table>`;
}

// Side-panel calculations for the five case-goal tiles (see kpiMath above)
const stateWord = a => (!a ? 'no action' : a.state === 'done' ? 'done' : a.state === 'waiting' ? (a.held ? 'on hold' : 'waiting for you') : a.state);
const ifAll = '<p class="hint">“If all approved” counts every move still waiting for you; “done so far” counts only what has actually been carried out.</p>';
Object.assign(TIPS, {
  'kpi-fresh'() {
    const r = state.result, k = kpiMath(r);
    return `<h4>Data freshness lag</h4>
      <p>How old the newest numbers are when the agents decide. Lower is better.</p>
      <div class="k">Calculation</div>
      <p>Today − date of the newest row = <b>${k.lagDays} day${k.lagDays === 1 ? '' : 's'}</b> (data runs ${esc(r.period?.from || '')} to ${esc(r.period?.to || '')}).</p>
      <div class="k">With Drishti</div>
      <p>The agents re-read every connected source on each hourly check, so the lag drops to <b>about 1 hour</b> once live connectors are on. With sample or uploaded files, the lag is the age of the file.</p>
      ${r.signal?.issues?.length ? `<div class="k">Signal Agent notes</div><ul>${r.signal.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  },
  'kpi-fatigue'() {
    const r = state.result, k = kpiMath(r);
    return `<h4>Spend on fatigued ads</h4>
      <p>Share of the last 3 days' spend that went to ads whose fatigue score is 60 or more (CTR well below the ad's own baseline, high frequency, rising CPM). Goal: cut it by half.</p>
      <div class="k">Calculation</div>
      <p>Spend on fatigued ads ÷ all spend (3 days) = ${inr(sumOf(k.fat, x => x.spendLast3))} ÷ ${inr(k.spend3)} = <b>${pct1(k.fatNow)}</b>.<br>
      An ad stops counting once its “pause and swap in fresh variants” action is carried out.</p>
      <p>Done so far: <b>${pct1(k.fatDone)}</b> · If all approved: <b>${pct1(k.fatAll)}</b> → change <b>${signed(k.fatChange)}%</b> vs the −50% goal.</p>
      ${k.fat.length ? `<table><tr><th>Ad</th><th>Score</th><th>CTR drop</th><th>3-day spend</th><th>Action</th></tr>${k.fat.map(ad => `<tr><td>${esc(ad.ad)} <small>${esc(ad.channel)}</small></td><td class="num">${ad.score}</td><td class="num">${ad.ctrDropPct}%</td><td class="num">${inr(ad.spendLast3)}</td><td>${stateWord(k.pauseOf(ad))}</td></tr>`).join('')}</table>` : '<p>No ad is fatigued on this data.</p>'}
      ${ifAll}`;
  },
  'kpi-creative'() {
    const r = state.result, k = kpiMath(r);
    return `<h4>Creative refresh time</h4>
      <p>Time from “this ad is tired” to “a replacement is ready”. Lower is better.</p>
      <div class="k">Calculation</div>
      <p>Fatigue Sentinel flags the ad and Creative Studio drafts replacements in the same run, so flag → draft = the run time: <b>${r.seconds ?? '<1'} s</b> for <b>${k.drafted.length}</b> ad${k.drafted.length === 1 ? '' : 's'}.</p>
      <p>Going live still needs the brand & ASCI check (done automatically) and, for big moves, your approval. Without agents this step needs a new brief and a design round.</p>
      ${k.drafted.length ? `<div class="k">Drafts ready</div><ul>${k.drafted.map(v => `<li><b>${esc(v.ad)}</b> (${esc(v.channel)}): ${v.variants.map(x => `${esc(x.language)}${x.check?.pass ? ' ✓' : ' ✗'}`).join(', ')}</li>`).join('')}</ul>` : '<p>No fatigued ad needed a replacement on this data.</p>'}`;
  },
  'kpi-below'() {
    const r = state.result, k = kpiMath(r);
    return `<h4>% spend below breakeven</h4>
      <p>Share of the last 7 days' spend in channel × region pockets whose <b>true</b> ROAS (platform revenue corrected by real orders) is under break-even ${r.cohort?.breakevenRoas}. Lower is better.</p>
      <div class="k">Calculation</div>
      <p>Spend in losing pockets ÷ all spend (7 days) = ${inr(sumOf(k.losing, c => c.spend7))} ÷ ${inr(k.spend7)} = <b>${pct1(k.belowNow)}</b>.<br>
      Each pocket action removes its cut × 7 days (pause = all of it, narrow = 40%, lower bid = 15%).</p>
      <p>Done so far: <b>${pct1(k.belowDone)}</b> · If all approved: <b>${pct1(k.belowAll)}</b></p>
      ${k.losing.length ? `<table><tr><th>Pocket</th><th>True ROAS</th><th>7-day spend</th><th>Fix</th><th>Status</th></tr>${k.losing.map(c => `<tr><td>${esc(c.channel)} · ${esc(c.region)}</td><td class="num">${c.trueRoas}</td><td class="num">${inr(c.spend7)}</td><td>${esc(c.action || '')}</td><td>${stateWord(k.cutOf(c))}</td></tr>`).join('')}</table>` : '<p>No pocket is below break-even.</p>'}
      ${ifAll}`;
  },
  'kpi-roas'() {
    const r = state.result, k = kpiMath(r), im = r.impact;
    return `<h4>True blended ROAS</h4>
      <p>Revenue per ₹1 of ad spend, using real orders instead of what the ad platforms claim. Goal: +25%.</p>
      <div class="k">Calculation</div>
      <p>Platforms claim ROAS <b>${im.platformRoas}</b>; Shopify orders say <b>${k.roasNow}</b> (true ROAS now).</p>
      <p>Projected = (true ROAS × daily budget + extra revenue from moves) ÷ daily budget.<br>
      Extra revenue = ${inr(im.extraRevenuePerDay)}/day (money freed from weak ads and pockets, ${inr(im.freedPerDay)}/day, moved to channels at the average true ROAS, plus the budget shift).</p>
      <p><b>${k.roasNow} → ${k.roasAfter}</b> = <b>${signed(k.roasUp)}%</b> vs the +25% goal${k.roasUp < 25 ? ' (honest result on this data: below the goal)' : ''}.</p>
      <p class="hint">Assumes every waiting move is approved.</p>`;
  },
});

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
  renderTokens(r);

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

  $('#ahiCard').innerHTML = `<h3>How the score is built</h3>
    <p>Each KPI is scored 0–100 against its range (the value that scores 0 → the value that scores 100), then rolled up as a weighted geometric mean, so one weak agent can't hide behind strong ones.</p>
    <p><code>AHI = G × P2^.30 × P3^.20 × P4^.25 × P5^.25</code> = ${ahiSum(r.ahi.after, r)}</p>
    ${ahiTable(r)}`;

  const chips = ['Why is true ROAS lower than what Meta shows?', 'Which action matters most and why?', 'Explain this to a business owner in two lines', 'What would you do before Diwali?'];
  $('#askChips').innerHTML = chips.map(c => `<button type="button">${esc(c)}</button>`).join('');
  $$('#askChips button').forEach(b => b.onclick = () => { $('#askInput').value = b.textContent; ask(); });
  if (!state.restoring) log(`Run finished · ${r.engine}`);
}

// Ask a follow-up question about this run.
// Every path ends with a visible message, so the box never just stays silent.
async function ask(ev) {
  ev?.preventDefault();
  const out = $('#askAnswer'), btn = $('#askForm button');
  const q = $('#askInput').value.trim();
  if (!q) { $('#askInput').focus(); return; }
  if (state.running) { out.textContent = 'The agents are still running. Ask again once the run finishes.'; return; }
  if (!state.result) { out.textContent = 'Press Run first. The agent answers questions about its latest run.'; return; }
  if (state.offline) { out.textContent = 'Questions need our server, which this network cannot reach right now. Try another network or mobile data.'; return; }
  const r = state.result;
  out.innerHTML = '<span class="typing">Thinking</span>';
  btn.disabled = true;
  try {
    const context = { brand: r.brand, briefing: r.briefing, impact: r.impact, ahi: r.ahi,
      actions: r.actions.map(({ agent, title, detail, tier, state: s, held }) => ({ agent, title, detail, tier, decision: held && s === 'waiting' ? 'on hold' : s })),
      channels: r.signal?.perChannel, fatigue: r.fatigue?.ads?.slice(0, 5), losingCohorts: r.cohort?.losing?.slice(0, 5),
      budget: { shifts: r.budget?.shifts, upcomingEvents: r.budget?.upcomingEvents }, shock: { external: r.shock?.external, checks: r.shock?.checks },
      reportsSentTo: [sendsTo('email') && 'email', sendsTo('telegram') && 'Telegram'].filter(Boolean) };
    const res = await fetch(API + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, context, model: $('#modelPick').value || undefined }), signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    out.textContent = j.answer || j.error || 'No answer came back. Please try again.';
    trackAI(j.usage, 'ask');
  } catch (e) {
    out.textContent = e.name === 'TimeoutError' ? 'The AI took too long to answer. Please try again in a moment.' : 'Could not reach the Orchestrator. ' + e.message;
  } finally { btn.disabled = false; }
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
// Opening the site again: bring back the brand you were last on, with its saved run and log
(() => {
  let saved = {}; try { saved = JSON.parse(store.get(SAVED) || '{}'); } catch {}
  if (saved.audit?.length) { state.audit = saved.audit; log('Site opened again. Earlier activity is kept below.'); }
  const [brand, scenario] = (saved.current || '').split('|');
  if (!views[saved.current] || !$(`input[name=brand][value="${brand}"]`)) return;
  $(`input[name=brand][value="${brand}"]`).checked = true;
  loadSample(); $('#scenario').value = scenario; loadSample();
  restoreView(true);
})();
setTimeout(watchBeat, 500); // ② starts watching straight away

// ---------------------------------------------------------------------------
// HOURLY LOOP: each brand is checked again one hour after its last run started.
// Run at 12:05 → the next check is at 1:05, so at 1:00 the clock shows 05:00.
// When it reaches zero the agents run again by themselves. A brand that was due
// while the page was closed (or while you were on another brand) runs as soon as
// it is back on screen.
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;
const clockTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function tickNextCheck() {
  const el = $('#nextCheck'), text = $('#nextCheckText');
  if (state.running) { text.textContent = 'Checking now…'; el.classList.add('due'); return; }
  el.classList.remove('due');
  if (!state.runAt || !state.result) { text.textContent = 'Auto check · not started'; el.title = 'Run the agent once; after that it checks this brand again every hour.'; return; }
  const next = state.runAt + HOUR, left = next - Date.now();
  if (left <= 0) { log(`Hourly check: ${state.data.brand} is due (last run ${clockTime(state.runAt)}), running again.`); run(); return; }
  const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
  text.innerHTML = `Next check in <b>${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}</b>`;
  el.title = `Drishti re-checks ${state.data.brand} every hour. Last run ${clockTime(state.runAt)} · next ${clockTime(next)}.`;
}
setInterval(tickNextCheck, 1000);
tickNextCheck();
if (new URLSearchParams(location.search).has('run')) setTimeout(run, 300);
