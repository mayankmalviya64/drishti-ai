// pitch.js — the presenter page (pitch.html).
// Same agents, same maths as the live app, told three ways:
//   • Story            → 5 full-screen scenes: the leak → agents at work → decisions → fresh ads → result
//   • 3-brand scorecard → what the case asks for (rows) × the three sample brands (columns)
//   • One ad's journey → follow the worst ad: spotted → diagnosed → replaced → approved → measured
//
// The agents run right here in the browser on the built-in rules engine (no server, no AI key),
// so the page works on any network and the numbers are the same every time.
// Keys: ← → (or Space) move, 1 2 3 pick a brand, S C J pick a view.

import { BRANDS, makeSample } from './lib/sample.js';
import { runDrishti } from './lib/agent.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ₹ in Indian style: ₹2.3 L, ₹1.10 Cr
function inr(n) {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}
// "Glow in 7 days · Video (EN)" → "Glow in 7 days"
const short = ad => String(ad).split(' · ')[0];
const pct = (a, b) => Math.round((100 * (b - a)) / a);

// The six agents, same names and colours as the live app
const AGENTS = {
  P1: { icon: '📡', name: 'Signal', role: 'Can we trust the numbers?' },
  ORC: { icon: '🧭', name: 'Orchestrator', role: 'Is it the market or us?' },
  P2: { icon: '🔥', name: 'Fatigue', role: 'Which ads are worn out?' },
  P3: { icon: '🎨', name: 'Creative', role: 'Write the replacement' },
  P4: { icon: '🎯', name: 'Cohort', role: 'Which cities lose money?' },
  P5: { icon: '⚖️', name: 'Budget', role: 'Where should ₹1 go next?' },
};

// One line from each persona in the deck, shown under the brand's leak
const QUOTES = {
  glowveda: ['Shreya, performance marketing manager', 'Fix the small stuff yourself; ask me before anything big.'],
  crunchkart: ['Aarush, founder', 'I can’t sit in Ads Manager all day; I have a factory to run.'],
  shyamlal: ['Mr. Shyamlal, owner', 'Everyone says digital. Show me what one rupee brings back.'],
};
const KEYS = Object.keys(BRANDS); // ['glowveda', 'crunchkart', 'shyamlal']

// ---------------------------------------------------------------------------
// State: which view, which brand, which step. Kept in the link (#story-glowveda-2)
// so a page reload during the pitch lands on the same screen.
// ---------------------------------------------------------------------------
const [m0, b0, s0] = location.hash.slice(1).split('-');
const state = {
  mode: ['story', 'score', 'journey'].includes(m0) ? m0 : 'story',
  brand: KEYS.includes(b0) ? b0 : 'glowveda',
  step: Math.max(0, Number(s0) || 0),
  results: {},  // brand key → the agents' result
  samples: {},  // brand key → the sample data (for the CTR chart)
  approved: {}, // brand key → Set of approved action ids
  timers: [],   // animation timers, cleared on every redraw
};
const STORY = [sceneLeak, sceneAgents, sceneDecide, sceneCreative, sceneResult];
const JOURNEY = ['Spotted', 'Diagnosed', 'Replaced', 'Your OK', 'Measured'];

// Run the agents once for each brand (takes well under a second in total).
async function runAll() {
  for (const key of KEYS) {
    const s = makeSample(key);
    state.samples[key] = s;
    await runDrishti({ brand: s.brand, category: s.category, rows: s.rows, orders: s.orders,
      competitors: s.competitors, model: 'rules' }, e => { if (e.type === 'result') state.results[key] = e; });
    state.approved[key] = new Set();
  }
}

// Small helpers to read each brand's result
const R = () => state.results[state.brand];
const B = () => BRANDS[state.brand];
const worstAd = r => [...r.fatigue.ads].sort((x, y) => y.score - x.score)[0];
const asks = r => r.actions.filter(a => a.tier === 'approval');
const autos = r => r.actions.filter(a => a.tier === 'auto');
function moneyLine(a) {
  if (!a.impact) return '';
  return a.kind === 'budget' || a.kind === 'migrate' ? '+' + inr(a.impact) + ' revenue/day' : inr(a.impact) + '/day saved';
}

// ---------------------------------------------------------------------------
// The one line each agent found, written for a jury to read in two seconds
// ---------------------------------------------------------------------------
function findings(r) {
  const ch = [...r.signal.perChannel].sort((x, y) => (y.platformRoas - y.trueRoas) - (x.platformRoas - x.trueRoas))[0];
  const w = worstAd(r);
  const v = r.variants[0];
  const moves = r.actions.filter(a => a.kind === 'migrate').length;
  const lose = r.cohort.losing[0];
  const sh = r.budget.shifts;
  const up = [...sh].sort((x, y) => y.changePct - x.changePct)[0];
  const down = [...sh].sort((x, y) => x.changePct - y.changePct)[0];
  return {
    P1: `${ch.channel} claims ROAS <b>${ch.platformRoas}</b>; real orders say <b>${ch.trueRoas}</b>. Trust ${r.signal.trustScore}/100, safe to act.`,
    ORC: r.shock.external ? `<b>Market shock.</b> Storm Mode on: every move asks you first.`
      : `<b>No market shock.</b> The leak is inside the account, so agents may act.`,
    P2: `“${esc(short(w.ad))}” is worn out: CTR <b>−${w.ctrDropPct}%</b>, each person saw it ${w.frequency}×.`,
    P3: v ? `Wrote <b>${v.variants.length}</b> fresh ads in ${v.variants.map(x => x.language).join(', ')}; all checked against ASCI rules.${moves ? ` Moves ${moves} TV-style video${moves > 1 ? 's' : ''} to JioHotstar.` : ''}`
      : 'No ad needs replacing today.',
    P4: lose ? `<b>${r.cohort.pctSpendLosing}%</b> of spend sits in losing pockets. Worst: ${lose.channel} · ${lose.region} returns ${lose.trueRoas} per ₹1.`
      : 'No city or audience is below break-even.',
    P5: `${up.channel} <b>+${up.changePct}%</b>, ${down.channel} <b>${down.changePct}%</b> → <b>+${inr(r.budget.extraRevenuePerDay)}/day</b> on the same spend.`,
  };
}

// ---------------------------------------------------------------------------
// STORY · scene 1 — the leak
// ---------------------------------------------------------------------------
function sceneLeak(r) {
  const sh = r.budget.shifts.map(s => s.marginalRoas);
  const [who, quote] = QUOTES[state.brand];
  return `
  <div class="kicker">${esc(B().who)}</div>
  <h1>${esc(r.brand)} spends <em>${inr(B().dailySpend * 30)}</em> a month on ads.<br>Part of it is leaking, and the dashboards hide it.</h1>
  <div class="versus">
    <div class="card claim fake"><div class="num">${r.impact.platformRoas}</div><div class="what">ROAS the platforms report</div><div class="from">Each platform claims the same sale as its own</div></div>
    <div class="vs">vs</div>
    <div class="card claim real"><div class="num">${r.impact.trueRoasNow}</div><div class="what">ROAS on real orders</div><div class="from">What actually sold on the brand’s own store</div></div>
  </div>
  <div class="leaks">
    <div class="card leak"><div class="big">${r.fatigue.pctSpendFatigued}%</div><div><b>of spend on worn-out ads</b><span>People have stopped clicking, the money keeps going</span></div></div>
    <div class="card leak"><div class="big">${r.cohort.pctSpendLosing}%</div><div><b>in cities that lose money</b><span>Hidden inside channel averages that look fine</span></div></div>
    <div class="card leak"><div class="big">${(Math.max(...sh) / Math.min(...sh)).toFixed(1)}×</div><div><b>gap in what the next ₹1 earns</b><span>Best channel ${Math.max(...sh)} vs worst ${Math.min(...sh)}, yet budgets sit in platform silos</span></div></div>
  </div>
  <p class="persona">“${esc(quote)}” — ${esc(who)}</p>`;
}

// ---------------------------------------------------------------------------
// STORY · scene 2 — agents at work (they light up one by one)
// ---------------------------------------------------------------------------
function sceneAgents(r) {
  const f = findings(r);
  const chans = Object.keys(B().channels);
  const icons = { Facebook: '📘', Instagram: '📸', Google: '🔎', JioHotstar: '📺' };
  const srcs = [...chans.map(c => [icons[c] || '📊', c + ' Ads', 'spend · clicks']),
    ['🛒', 'Store orders', 'what really sold'], ['🕵️', 'Competitor ads', 'Ad Library'], ['📰', 'News + sale calendar', 'market check']];
  return `
  <div class="kicker">Every hour, without anyone opening a dashboard</div>
  <h1>Every source comes in. <em>Five agents and an Orchestrator</em> each answer one question.</h1>
  <div class="work">
    <div class="sources">${srcs.map(([i, n, s], k) => `<div class="card src" style="--d:${k * .3}s">${i} ${esc(n)}<small>${s}</small></div>`).join('')}</div>
    <div class="agents">${Object.entries(AGENTS).map(([id, a]) => `
      <div class="card ag" data-ag="${id}" style="--c:var(--${id})">
        <div class="ic">${a.icon}</div>
        <div class="nm"><b>${a.name}</b><span>${a.role}</span></div>
        <div class="find">${f[id]}</div>
      </div>`).join('')}</div>
  </div>`;
}
// After the scene is drawn: light the agents in the order the Orchestrator calls them
function animateAgents() {
  document.querySelectorAll('.ag').forEach((el, i) => state.timers.push(setTimeout(() => el.classList.add('lit'), 350 + i * 650)));
}

// ---------------------------------------------------------------------------
// STORY · scene 3 — decisions: small ones done, big ones wait for you
// ---------------------------------------------------------------------------
// Health score moves from "before" to "after" as actions are carried out,
// in proportion to the money each one is worth.
function health(r) {
  const done = new Set([...autos(r).map(a => a.id), ...state.approved[state.brand]]);
  const w = a => Math.max(a.impact || 0, 1000);
  const total = r.actions.reduce((s, a) => s + w(a), 0);
  const got = r.actions.filter(a => done.has(a.id)).reduce((s, a) => s + w(a), 0);
  return Math.round(r.ahi.before.value + (r.ahi.after.value - r.ahi.before.value) * (got / total));
}
function actCard(a, withButton) {
  return `<div class="card act" style="--c:var(--${a.agent})">
    <div class="t">${esc(a.title)}<small>${esc(a.observed || '')}</small></div>
    ${a.impact ? `<div class="rs">${moneyLine(a)}</div>` : ''}
    ${withButton ? `<button class="btn go" data-approve="${a.id}">Approve</button>` : ''}
  </div>`;
}
function sceneDecide(r) {
  const ok = state.approved[state.brand];
  const done = [...autos(r), ...asks(r).filter(a => ok.has(a.id))];
  const wait = asks(r).filter(a => !ok.has(a.id)).sort((x, y) => (y.impact || 0) - (x.impact || 0));
  const h = health(r);
  return `
  <div class="kicker">Small fixes run on their own. Big moves wait for a human.</div>
  <h1>It doesn’t just report. <em>It acts</em>, inside guardrails you set.</h1>
  <div class="card health">
    <div><b>Health score</b><br><small>was ${r.ahi.before.value} · goes to ${r.ahi.after.value} when all are done</small></div>
    <div class="meter"><i style="--w:${h}%"></i></div>
    <div class="num" style="color:${h >= 75 ? 'var(--green)' : h >= 45 ? 'var(--amber)' : 'var(--red)'}">${h}</div>
  </div>
  <div class="cols">
    <div class="col"><h3>✅ Done on its own <span>${done.length} action${done.length === 1 ? '' : 's'} · each emailed to you</span></h3>
      ${done.map(a => actCard(a, false)).join('') || '<p class="more">Nothing small enough to do alone yet.</p>'}</div>
    <div class="col"><h3>✋ Waiting for your OK <span>${wait.length} left</span>
      ${wait.length > 1 ? '<button class="btn ghost" data-approve="all" style="margin-left:auto">Approve all</button>' : ''}</h3>
      ${wait.slice(0, 3).map(a => actCard(a, true)).join('') || '<p class="more">All approved. The next loop checks that each fix worked.</p>'}
      ${wait.length > 3 ? `<div class="more">+ ${wait.length - 3} smaller moves</div>` : ''}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// STORY · scene 4 — fresh ads in local languages, and the right channel for each ad
// ---------------------------------------------------------------------------
function adCards(v) {
  return v.variants.map(x => `<div class="card adc">
      <div class="lang">${esc(x.language)}</div>
      <div class="hook">${esc(x.hook)}</div>
      <div class="head">${esc(x.headline)}</div>
      <div class="foot"><span class="cta">${esc(x.cta)}</span>
        <span class="${x.check?.pass ? 'ok' : 'bad'}">${x.check?.pass ? '✓ ASCI check passed' : '⚠ ' + esc(x.check?.note)}</span></div>
    </div>`).join('');
}
function sceneCreative(r) {
  const v = r.variants[0];
  const fit = r.actions.filter(a => a.kind === 'migrate' || a.kind === 'shift').slice(0, 2);
  return `
  <div class="kicker">The pause never leaves a gap</div>
  <h1>Before the tired ad stops, <em>its replacement is ready</em>, in the languages its buyers speak.</h1>
  ${v ? `<p class="lede">Replacing “${esc(short(v.ad))}” on ${esc(v.channel)}. Languages come from the cities where it was losing money.</p>
  <div class="ads">${adCards(v)}</div>` : '<p class="lede">No ad is worn out right now.</p>'}
  ${fit.map(a => `<div class="card fit" style="border-left:4px solid var(--${a.agent})"><span class="arrow">⇄</span><div><b>${esc(a.title)}</b><br><span style="color:var(--muted);font-size:13px">${esc(a.observed)}</span></div></div>`).join('')}`;
}

// ---------------------------------------------------------------------------
// STORY · scene 5 — the result, against the two goals in the case
// ---------------------------------------------------------------------------
function sceneResult(r) {
  const lift = pct(r.impact.trueRoasNow, r.impact.trueRoasProjected);
  return `
  <div class="kicker">One loop · ${esc(r.brand)}</div>
  <h1>Same spend. <em>More real sales.</em> And it checks its own work every hour.</h1>
  <div class="kpis">
    <div class="card kpi"><div class="lbl">True ROAS</div><div class="num"><s>${r.impact.trueRoasNow}</s>${r.impact.trueRoasProjected}</div>
      <div class="goal ${lift >= 25 ? 'met' : 'near'}">+${lift}% · case goal +25% ${lift >= 25 ? '✓' : ''}</div></div>
    <div class="card kpi"><div class="lbl">Spend on worn-out ads</div><div class="num"><s>${r.impact.fatiguedPctNow}%</s>0%</div>
      <div class="goal met">once the swap is approved · goal −50% ✓</div></div>
    <div class="card kpi"><div class="lbl">Money stopped leaking</div><div class="num">${inr(r.impact.freedPerDay)}</div>
      <div class="goal" style="color:var(--muted)">a day · ≈ ${inr(r.impact.freedPerDay * 30)} a month</div></div>
    <div class="card kpi"><div class="lbl">Health score</div><div class="num"><s>${r.ahi.before.value}</s>${r.ahi.after.value}</div>
      <div class="goal" style="color:var(--muted)">${esc(r.ahi.after.status)}</div></div>
  </div>
  <div class="kicker" style="margin-top:4px">Same agents, three different brands</div>
  <div class="trio">${KEYS.map(k => {
    const x = state.results[k];
    return `<div class="card mini ${k === state.brand ? 'on' : ''}" data-brand="${k}"><b>${esc(x.brand)}</b>
      <span>True ROAS ${x.impact.trueRoasNow} → ${x.impact.trueRoasProjected} (+${pct(x.impact.trueRoasNow, x.impact.trueRoasProjected)}%)</span>
      <span>Health ${x.ahi.before.value} → ${x.ahi.after.value} · ${inr(x.impact.freedPerDay)}/day freed</span></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// SCORECARD — what the case asks for × the three brands
// ---------------------------------------------------------------------------
const SCORE_ROWS = [
  ['True ROAS, live', 'Case: real-time ROAS', 'ask', r => `claims <s>${r.impact.platformRoas}</s> → real <b>${r.impact.trueRoasNow}</b>`],
  ['Creative fatigue', 'Case: fatigued spend −50%', 'ask', r => { const w = worstAd(r); return `“${esc(short(w.ad))}” CTR <b>−${w.ctrDropPct}%</b> → paused`; }],
  ['Fresh regional ads', 'Creative Studio', '', r => r.variants[0] ? `<b>${r.variants[0].variants.length}</b> drafts · ${r.variants[0].variants.map(x => x.language).join(', ')} · ASCI ✓` : '—'],
  ['Losing cities', 'Cohort agent', '', r => r.cohort.losing[0] ? `<b>${r.cohort.losing.length}</b> pockets trimmed · worst ${esc(r.cohort.losing[0].region)} ${r.cohort.losing[0].trueRoas}` : 'none'],
  ['Cross-channel budget', 'Case: move budgets', 'ask', r => r.budget.shifts.filter(s => s.changePct).map(s => `${s.channel} ${s.changePct > 0 ? '+' : ''}${s.changePct}%`).join(' · ')],
  ['Market or us?', 'Orchestrator', '', r => r.shock.external ? '<b>Shock</b> → asks first' : 'No shock → <b>safe to act</b>'],
  ['You stay in control', 'Guardrails', '', r => `<b>${autos(r).length}</b> done alone<span class="tag auto">auto</span> · <b>${asks(r).length}</b> wait<span class="tag ask">your OK</span>`],
];
function sceneScore() {
  const res = KEYS.map(k => state.results[k]);
  const cells = (fn, cls = '') => res.map((r, c) => `<div class="cell ${cls}" data-c="${c}">${fn(r)}</div>`).join('');
  return `
  <div class="score-top">
    <div><div class="kicker">Three brands · one run each · same agents</div>
    <h1>Everything the case asks for, <em>proven three times</em>.</h1></div>
    <button class="btn go" id="replay">▶ Run all 3 brands</button>
  </div>
  <div class="grid3">
    <div class="hd corner"></div>
    ${res.map((r, c) => `<div class="hd" data-c="${c}"><b>${esc(r.brand)}</b><span>${esc(BRANDS[KEYS[c]].who.split(' · ').slice(1).join(' · '))}</span></div>`).join('')}
    ${SCORE_ROWS.map(([name, sub, kind, fn]) => `<div class="rh"><b>${name}</b><span class="${kind}">${sub}</span></div>${cells(fn)}`).join('')}
    <div class="rh total"><b>Outcome</b><span class="ask">Case: ROAS +25%</span></div>
    ${cells(r => `ROAS <b>+${pct(r.impact.trueRoasNow, r.impact.trueRoasProjected)}%</b> · health <b>${r.ahi.before.value}→${r.ahi.after.value}</b><br>${inr(r.impact.freedPerDay)}/day stops leaking`, 'total')}
  </div>`;
}
// Fill the grid row by row, left to right, like the agents working through each brand
function animateScore() {
  const cells = [...document.querySelectorAll('.grid3 .cell')];
  cells.forEach(el => el.classList.remove('in'));
  cells.forEach((el, i) => state.timers.push(setTimeout(() => el.classList.add('in'), 200 + i * 140)));
}

// ---------------------------------------------------------------------------
// ONE AD'S JOURNEY — follow the worst ad through the loop
// ---------------------------------------------------------------------------
// Daily CTR of one ad, from the sample export, as a small line chart (SVG)
function ctrChart(ad) {
  const byDay = {};
  for (const row of state.samples[state.brand].rows.filter(x => x.ad === ad)) {
    const d = (byDay[row.date] ||= { c: 0, i: 0 });
    d.c += row.clicks; d.i += row.impressions;
  }
  const pts = Object.keys(byDay).sort().map(k => (100 * byDay[k].c) / byDay[k].i);
  const W = 520, H = 170, pad = 26;
  const max = Math.max(...pts) * 1.1, min = 0;
  const x = i => pad + (i * (W - pad * 2)) / (pts.length - 1);
  const y = v => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const base = (pts[0] + pts[1] + pts[2]) / 3;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily click rate for ${esc(ad)}, falling over 14 days">
    <path class="ar" d="${line}L${x(pts.length - 1)},${H - pad}L${x(0)},${H - pad}Z"/>
    <line class="bl" x1="${pad}" x2="${W - pad}" y1="${y(base)}" y2="${y(base)}"/>
    <text x="${W - pad}" y="${y(base) - 6}" text-anchor="end">its own first days: ${base.toFixed(2)}%</text>
    <path class="ln" d="${line}"/>
    <text x="${pad}" y="${H - 6}">14 days ago</text><text x="${W - pad}" y="${H - 6}" text-anchor="end">yesterday: ${pts.at(-1).toFixed(2)}%</text>
  </svg>`;
}
function sceneJourney(r) {
  const w = worstAd(r);
  const v = r.variants.find(x => x.ad === w.ad) || r.variants[0];
  const act = r.actions.find(a => a.kind === 'pause' && a.title.includes(short(w.ad))) || asks(r)[0];
  const approved = state.approved[state.brand].has(act.id);
  const ev = r.budget.upcomingEvents[0];
  const st = state.step;
  const steps = JOURNEY.map((name, i) => `<button class="stp ${i === st ? 'on' : i < st ? 'done' : ''}" data-step="${i}">
      <div class="n">${i < st ? '✓' : i + 1}</div><b>${name}</b><span>${['Fatigue agent', 'Orchestrator', 'Creative Studio', 'You', 'Next loop'][i]}</span></button>`).join('');
  let body = '';
  if (st === 0) body = `
    <div class="card">${ctrChart(w.ad)}</div>
    <div class="facts">
      <div class="card fact"><div class="num" style="color:var(--P2)">${w.score}/100</div><span>fatigue score</span></div>
      <div class="card fact"><div class="num">−${w.ctrDropPct}%</div><span>click rate vs its own first days</span></div>
      <div class="card fact"><div class="num">${w.frequency}×</div><span>times each person saw it</span></div>
      <div class="card fact"><div class="num">${inr(w.dailySpend)}</div><span>still spent on it every day</span></div>
    </div>`;
  if (st === 1) body = `
    <div><p class="lede" style="margin-bottom:12px">A falling ad has four possible causes. Fixing the wrong one wastes money, so the Orchestrator rules them out first.</p>
    <ul class="checks">
      <li><i>✓</i>Tracking is fine: data trust ${r.signal.trustScore}/100</li>
      <li><i>✓</i>${r.shock.external ? 'Market shock found, so it asks first' : 'No market shock: ad prices steady, no outage'}</li>
      <li><i>✓</i>${ev ? `${esc(ev.name)} is ${ev.inDays} days away: budget is paced for it` : 'No festival or sale nearby'}</li>
      <li class="hit"><i>✗</i>The ad itself: ${esc(w.cause)}. People have seen it too often.</li>
    </ul></div>
    <div class="card">${ctrChart(w.ad)}</div>`;
  if (st === 2) body = v ? `<div class="ads" style="grid-column:1/-1">${adCards(v)}</div>` : '<p class="lede">No replacement needed.</p>';
  if (st === 3) body = `
    <div><p class="lede" style="margin-bottom:12px">Pausing an ad that spends ${inr(w.dailySpend)} a day is a big move, so Drishti asks. Small fixes (a 15% bid cut in one city) it does alone and emails you.</p>
    ${actCard(act, !approved).replace('class="card act"', 'class="card act" style="--c:var(--P2)"')}
    ${approved ? '<p class="ok" style="font-size:15px">✓ Approved. Paused, 3 new ads live, report emailed.</p>' : ''}</div>
    <div class="card"><b>Why it’s safe to approve</b><ul style="margin:8px 0 0;padding-left:18px;color:var(--muted)">
      <li>The replacement ads are already written and checked</li><li>Every action has an Undo and an audit log</li>
      <li>If health drops after the change, the next loop rolls it back</li></ul></div>`;
  if (st === 4) body = `
    <div class="facts" style="grid-column:1/-1;grid-template-columns:repeat(4,1fr)">
      <div class="card fact"><div class="num" style="color:var(--green)">${inr(w.dailySpend)}</div><span>a day no longer spent on a dead ad</span></div>
      <div class="card fact"><div class="num"><s style="color:var(--muted);font-size:.6em">${r.impact.fatiguedPctNow}%</s> 0%</div><span>of spend on worn-out ads</span></div>
      <div class="card fact"><div class="num"><s style="color:var(--muted);font-size:.6em">${r.ahi.before.value}</s> ${r.ahi.after.value}</div><span>health score, all fixes done</span></div>
      <div class="card fact"><div class="num">1 hr</div><span>until the next loop checks the new ads are working</span></div>
    </div>
    <p class="lede" style="grid-column:1/-1">The new numbers flow back in as data, and the loop starts again. Today this takes a team two to three days: notice, brief a designer, translate, get approval, pause by hand.</p>`;
  return `
  <div class="kicker">${esc(r.brand)} · ${esc(w.channel)}</div>
  <h1>One ad’s journey: <em>“${esc(short(w.ad))}”</em> from spotted to fixed.</h1>
  <div class="steps">${steps}</div>
  <div class="panel">${body}</div>`;
}

// ---------------------------------------------------------------------------
// Drawing + controls
// ---------------------------------------------------------------------------
function draw() {
  state.timers.forEach(clearTimeout); state.timers = [];
  const r = R();
  const max = state.mode === 'story' ? STORY.length : JOURNEY.length;
  state.step = Math.min(state.step, max - 1);
  let html;
  if (state.mode === 'story') html = STORY[state.step](r);
  else if (state.mode === 'score') html = sceneScore();
  else html = sceneJourney(r);
  $('#stage').innerHTML = `<section class="scene">${html}</section>`;

  // the brand switch is not needed on the scorecard (it shows all three)
  $('#brands').style.visibility = state.mode === 'score' ? 'hidden' : '';
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  document.querySelectorAll('#brands button').forEach(b => b.classList.toggle('on', b.dataset.brand === state.brand));
  // progress dots (story and journey only)
  $('#dock').hidden = state.mode === 'score';
  $('#dots').innerHTML = Array.from({ length: max }, (_, i) => `<button class="${i === state.step ? 'on' : ''}" data-dot="${i}" aria-label="Step ${i + 1}"></button>`).join('');

  if (state.mode === 'story' && state.step === 1) animateAgents();
  if (state.mode === 'score') animateScore();
  history.replaceState(null, '', `#${state.mode}-${state.brand}-${state.step}`);
}

function go(delta) {
  const max = state.mode === 'story' ? STORY.length : JOURNEY.length;
  state.step = Math.max(0, Math.min(max - 1, state.step + delta));
  draw();
}

// One click handler for the whole page (buttons are redrawn often)
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-brand]');
  if (!t) return;
  if (t.dataset.mode) { state.mode = t.dataset.mode; state.step = 0; draw(); }
  else if (t.dataset.brand) { state.brand = t.dataset.brand; draw(); }
  else if (t.dataset.dot) { state.step = Number(t.dataset.dot); draw(); }
  else if (t.dataset.step) { state.step = Number(t.dataset.step); draw(); }
  else if (t.dataset.approve) {
    const ok = state.approved[state.brand];
    if (t.dataset.approve === 'all') asks(R()).forEach(a => ok.add(a.id)); else ok.add(Number(t.dataset.approve));
    draw();
  }
  else if (t.id === 'replay') animateScore();
  else if (t.id === 'prev') go(-1);
  else if (t.id === 'next') go(1);
});

// Presenter keys
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright' || k === ' ' || k === 'pagedown') { e.preventDefault(); go(1); }
  else if (k === 'arrowleft' || k === 'pageup') { e.preventDefault(); go(-1); }
  else if (['1', '2', '3'].includes(k)) { state.brand = KEYS[Number(k) - 1]; draw(); }
  else if (k === 's' || k === 'c' || k === 'j') { state.mode = { s: 'story', c: 'score', j: 'journey' }[k]; state.step = 0; draw(); }
});

// Theme toggle (light by default, remembered with the same key as the live app)
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('drishti-theme', dark ? 'dark' : 'light'); } catch (e) {}
  syncThemeBtn();
};
syncThemeBtn();

// Brand buttons come from the sample list, with their key number
$('#brands').innerHTML = KEYS.map((k, i) => `<button data-brand="${k}" title="Key ${i + 1}"><kbd>${i + 1}</kbd>${esc(BRANDS[k].name)}</button>`).join('');

$('#stage').innerHTML = '<section class="scene"><p class="lede">Running the agents on three brands…</p></section>';
runAll().then(draw);
