// lib/analyze.js
// The "maths" of the five Drishti agents. Pure functions, no AI, no network.
// The AI Orchestrator (lib/agent.js) calls these as tools, reads the results,
// and decides what to say and do. Keeping the maths here means every number the
// jury sees can be traced to a formula, not to an AI guess.
//
// Input:  rows   = ad export rows   {date, channel, campaign, ad, region, spend, impressions, reach?, clicks, conversions, platform_revenue}
//         orders = Shopify orders   {date, channel, orders, revenue}   (optional but recommended)

const sum = (list, f) => list.reduce((s, x) => s + (f ? f(x) : x), 0);
const mean = list => (list.length ? sum(list) / list.length : 0);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const DAY = 24 * 3600e3;

// ---------------------------------------------------------------------------
// Cleaning: accept messy column names from real exports
// ---------------------------------------------------------------------------

// Map many possible header spellings (Meta, Google, Shopify exports) to ours.
const ALIASES = {
  date: ['date', 'day', 'reporting starts', 'reporting_starts', 'date_start'],
  channel: ['channel', 'platform', 'source', 'utm_source', 'publisher platform'],
  campaign: ['campaign', 'campaign name', 'campaign_name'],
  ad: ['ad', 'ad name', 'ad_name', 'creative', 'ad group', 'ad_group'],
  region: ['region', 'city', 'geo', 'state', 'audience', 'cohort'],
  spend: ['spend', 'amount spent (inr)', 'amount spent', 'cost', 'amount_spent'],
  impressions: ['impressions', 'impr.', 'impr'],
  reach: ['reach'],
  clicks: ['clicks', 'link clicks', 'clicks (all)'],
  conversions: ['conversions', 'purchases', 'results', 'conv.'],
  platform_revenue: ['platform_revenue', 'purchase conversion value', 'conv. value', 'conversion value', 'revenue', 'purchases conversion value'],
  orders: ['orders', 'order count', 'total orders'],
};

function pick(obj, key) {
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.trim().toLowerCase()] = obj[k];
  for (const name of ALIASES[key] || [key]) if (lower[name] !== undefined && lower[name] !== '') return lower[name];
  return undefined;
}
const num = v => {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[₹,\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// "facebook", "IG", "Meta Ads" → "Meta"; "youtube" → "Google"; "hotstar" → "JioHotstar"
export function normChannel(c) {
  const s = String(c || 'Unknown').trim().toLowerCase();
  if (/meta|facebook|instagram|^fb|^ig/.test(s)) return 'Meta';
  if (/google|youtube|adwords|pmax|gads/.test(s)) return 'Google';
  if (/hotstar|jio|ott|ctv/.test(s)) return 'JioHotstar';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Dates like 2026-10-14, 14/10/2026 or "Oct 14, 2026" → "2026-10-14"
function normDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // Indian day/month order
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function cleanRows(rawRows = []) {
  return rawRows.map(r => ({
    date: normDate(pick(r, 'date')),
    channel: normChannel(pick(r, 'channel')),
    campaign: String(pick(r, 'campaign') || 'Campaign'),
    ad: String(pick(r, 'ad') || pick(r, 'campaign') || 'Ad'),
    region: String(pick(r, 'region') || 'All'),
    spend: num(pick(r, 'spend')),
    impressions: num(pick(r, 'impressions')),
    reach: num(pick(r, 'reach')),
    clicks: num(pick(r, 'clicks')),
    conversions: num(pick(r, 'conversions')),
    platform_revenue: num(pick(r, 'platform_revenue')),
  })).filter(r => r.date && r.spend >= 0);
}

export function cleanOrders(rawOrders = []) {
  return rawOrders.map(o => ({
    date: normDate(pick(o, 'date')),
    channel: normChannel(pick(o, 'channel')),
    orders: num(pick(o, 'orders')),
    revenue: num(pick(o, 'revenue')),
  })).filter(o => o.date);
}

// ---------------------------------------------------------------------------
// Festive / sale calendar used by the Budget Allocator for pacing and by the
// shock filter ("is a known event behind this?"). Dates for 2026–27 in India.
// ---------------------------------------------------------------------------
export const EVENTS = [
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali' },
  { date: '2026-11-27', name: 'Black Friday sales' },
  { date: '2026-12-25', name: 'Christmas & year-end sales' },
  { date: '2027-01-26', name: 'Republic Day sales' },
  { date: '2027-02-14', name: "Valentine's Day" },
  { date: '2027-03-22', name: 'Holi' },
  { date: '2027-03-26', name: 'IPL 2027 season start (expected)' },
];

// ---------------------------------------------------------------------------
// P1 · Signal Agent: can we trust the numbers?
// ---------------------------------------------------------------------------
function signalAgent(rows, orders, dates, today) {
  const last = dates[dates.length - 1];
  const last7 = new Set(dates.slice(-7));
  const channels = [...new Set(rows.map(r => r.channel))];
  const hasOrders = orders.length > 0;

  const perChannel = channels.map(ch => {
    const r7 = rows.filter(r => r.channel === ch && last7.has(r.date));
    const spend = sum(r7, r => r.spend);
    const platRev = sum(r7, r => r.platform_revenue);
    const o7 = orders.filter(o => o.channel === ch && last7.has(o.date));
    // Without order data we fall back to the industry gap: platform ROAS is often
    // far above measured ROAS (deck ref [5]); 1.6x is a conservative assumption.
    const trueRev = hasOrders ? sum(o7, o => o.revenue) : platRev / 1.6;
    return {
      channel: ch, spend7: Math.round(spend), platformRevenue7: Math.round(platRev), trueRevenue7: Math.round(trueRev),
      platformRoas: spend ? round(platRev / spend) : 0,
      trueRoas: spend ? round(trueRev / spend) : 0,
      overclaim: trueRev ? round(platRev / trueRev) : 1,
    };
  });

  // Tracking break: yesterday's reported conversions per ₹ fell below 35% of the
  // previous 6-day average while spend continued → likely a broken pixel / CAPI.
  const breaks = [];
  for (const ch of channels) {
    const daily = dates.slice(-7).map(d => {
      const r = rows.filter(x => x.channel === ch && x.date === d);
      const s = sum(r, x => x.spend);
      return { d, spend: s, rate: s ? sum(r, x => x.conversions) / s : 0 };
    });
    const lastDay = daily[daily.length - 1];
    const prior = mean(daily.slice(0, -1).map(x => x.rate));
    if (lastDay && lastDay.spend > 0 && prior > 0 && lastDay.rate < 0.35 * prior) {
      const ordersLast = orders.filter(o => o.channel === ch && o.date === lastDay.d);
      breaks.push({ channel: ch, date: lastDay.d, drop: round(1 - lastDay.rate / prior), ordersStillFlowing: sum(ordersLast, o => o.orders) > 0 });
    }
  }

  const lagDays = Math.max(0, Math.round((today - new Date(last + 'T00:00:00Z')) / DAY));
  const avgOverclaim = mean(perChannel.map(c => c.overclaim));
  let trust = 100;
  const issues = [];
  if (!hasOrders) { trust -= 25; issues.push('No Shopify/order data: true ROAS is estimated'); }
  if (lagDays > 7) { trust -= 30; issues.push(`Data is ${lagDays} days old`); }
  else if (lagDays > 2) { trust -= 15; issues.push(`Data is ${lagDays} days old`); }
  for (const b of breaks) { trust -= 35; issues.push(`${b.channel} tracking dropped ${Math.round(b.drop * 100)}% on ${b.date}`); }
  if (avgOverclaim > 2.5) { trust -= 10; issues.push('Platforms over-claim by more than 2.5x'); }
  trust = clamp(Math.round(trust), 0, 100);

  return {
    agent: 'P1', name: 'Signal Agent', trustScore: trust, gateOpen: trust >= 60,
    freshnessLagDays: lagDays, hasOrders, perChannel, trackingBreaks: breaks, issues,
  };
}

// ---------------------------------------------------------------------------
// P2 · Fatigue Sentinel: which ads are wearing out?
// ---------------------------------------------------------------------------
function slope(ys) {
  // least-squares slope per day
  const n = ys.length; if (n < 2) return 0;
  const xs = ys.map((_, i) => i), mx = mean(xs), my = mean(ys);
  const num_ = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const den = sum(xs.map(x => (x - mx) ** 2));
  return den ? num_ / den : 0;
}

function fatigueSentinel(rows, dates, signal, shockCpm) {
  const ads = [...new Set(rows.map(r => r.channel + '||' + r.ad))];
  const last3 = new Set(dates.slice(-3));
  const spend3 = sum(rows.filter(r => last3.has(r.date)), r => r.spend);
  const brokenChannels = new Set(signal.trackingBreaks.map(b => b.channel));

  const list = ads.map(key => {
    const [channel, ad] = key.split('||');
    const daily = dates.map(d => {
      const r = rows.filter(x => x.channel === channel && x.ad === ad && x.date === d);
      const spend = sum(r, x => x.spend), impr = sum(r, x => x.impressions), reach = sum(r, x => x.reach);
      return { d, spend, impr, ctr: impr ? sum(r, x => x.clicks) / impr : 0, cpm: impr ? (spend / impr) * 1000 : 0, freq: reach ? impr / reach : 0, rev: sum(r, x => x.platform_revenue) };
    }).filter(x => x.spend > 0);
    // Search ads match a typed query, so they don't "wear out" like visual creatives.
    const isSearch = /search/i.test(ad + ' ' + channel);
    if (daily.length < 5 || isSearch) return null;
    const base = daily.slice(0, 3), recent = daily.slice(-3);
    const baseCtr = mean(base.map(x => x.ctr)), recentCtr = mean(recent.map(x => x.ctr));
    const baseCpm = mean(base.map(x => x.cpm)), recentCpm = mean(recent.map(x => x.cpm));
    const freq = mean(recent.map(x => x.freq));
    const ctrDrop = baseCtr ? Math.max(0, 1 - recentCtr / baseCtr) : 0;
    const cpmRise = baseCpm ? Math.max(0, recentCpm / baseCpm - 1) : 0;
    // Fatigue score 0–100: CTR vs the ad's own baseline matters most, then
    // frequency (Meta prospecting declines past ~2.5/week, ref [4]), then CPM rise.
    const freqPart = freq ? clamp((freq - 1.5) / 2.5, 0, 1) : clamp(ctrDrop / 0.5, 0, 1);
    const score = Math.round(100 * clamp(0.55 * clamp(ctrDrop / 0.5, 0, 1) + 0.25 * freqPart + 0.20 * clamp(cpmRise / 0.4, 0, 1), 0, 1));
    // Days until fatigue: extend the last-7-day CTR trend to the point where CTR is 40% below baseline.
    const s = slope(daily.slice(-7).map(x => x.ctr));
    const threshold = baseCtr * 0.6;
    const daysToFatigue = score >= 60 ? 0 : s < 0 ? Math.max(1, Math.round((recentCtr - threshold) / -s)) : null;
    // Root-cause check: don't blame the creative for a tracking break or a market shock.
    let cause = 'creative fatigue';
    if (brokenChannels.has(channel)) cause = 'tracking break (not the ad)';
    else if (shockCpm && ctrDrop < 0.25) cause = 'market-wide auction spike (not the ad)';
    const lastSpend = recent[recent.length - 1].spend;
    const spendLast3 = sum(recent, x => x.spend);
    return {
      channel, ad, score, status: score >= 60 ? 'fatigued' : score >= 40 ? 'at risk' : 'healthy',
      ctrBase: round(baseCtr * 100), ctrNow: round(recentCtr * 100), ctrDropPct: Math.round(ctrDrop * 100),
      cpmRisePct: Math.round(cpmRise * 100), frequency: freq ? round(freq, 1) : null,
      daysToFatigue, cause, dailySpend: Math.round(lastSpend), spendLast3: Math.round(spendLast3),
      platformRoas: round(sum(recent, x => x.rev) / (spendLast3 || 1)),
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  const fatigued = list.filter(a => a.status === 'fatigued' && a.cause === 'creative fatigue');
  const pctSpendFatigued = spend3 ? round((100 * sum(fatigued, a => a.spendLast3)) / spend3, 1) : 0;
  return { agent: 'P2', name: 'Fatigue Sentinel', ads: list, fatiguedCount: fatigued.length, atRiskCount: list.filter(a => a.status === 'at risk').length, pctSpendFatigued };
}

// ---------------------------------------------------------------------------
// P4 · Cohort Optimizer: which city / audience pockets lose money?
// ---------------------------------------------------------------------------
function cohortOptimizer(rows, dates, signal, breakeven) {
  const last7 = new Set(dates.slice(-7));
  const r7 = rows.filter(r => last7.has(r.date));
  const total = sum(r7, r => r.spend);
  const overclaim = Object.fromEntries(signal.perChannel.map(c => [c.channel, c.overclaim || 1]));
  const keys = [...new Set(r7.map(r => r.channel + '||' + r.region))];
  const cohorts = keys.map(k => {
    const [channel, region] = k.split('||');
    const r = r7.filter(x => x.channel === channel && x.region === region);
    const spend = sum(r, x => x.spend), plat = sum(r, x => x.platform_revenue);
    const trueRoas = spend ? plat / overclaim[channel] / spend : 0; // calibrate to true revenue
    const ratio = trueRoas / breakeven;
    // Graduated action: lower bid → narrow targeting → pause (respecting learning phase)
    let action = null;
    if (ratio < 0.5) action = 'pause';
    else if (ratio < 0.8) action = 'narrow targeting, −40% budget';
    else if (ratio < 1) action = 'lower bid 15%';
    else if (ratio > 1.5) action = 'scale up';
    return { channel, region, spend7: Math.round(spend), dailySpend: Math.round(spend / 7), trueRoas: round(trueRoas), action };
  }).filter(c => c.spend7 >= total * 0.01).sort((a, b) => a.trueRoas - b.trueRoas);
  const losing = cohorts.filter(c => c.trueRoas < breakeven);
  const winners = cohorts.filter(c => c.action === 'scale up');
  return {
    agent: 'P4', name: 'Cohort Optimizer', breakevenRoas: breakeven, cohorts, losing, winners,
    pctSpendLosing: total ? round((100 * sum(losing, c => c.spend7)) / total, 1) : 0,
  };
}

// ---------------------------------------------------------------------------
// P5 · Budget Allocator: move the next rupee to where it earns most
// ---------------------------------------------------------------------------
// Each channel gets a diminishing-returns curve: revenue = a × spend^b, b = 0.6
// (a starter curve; in production it is refreshed weekly by an open-source MMM).
// The marginal ROAS of a channel is b × revenue ÷ spend. Money moves in 1% steps
// from the lowest marginal ROAS to the highest, capped at ±20% per channel.
function budgetAllocator(signal, today, storm) {
  const B = 0.6;
  const ch = signal.perChannel.filter(c => c.spend7 > 0).map(c => {
    const S = c.spend7 / 7, R = c.trueRevenue7 / 7;
    return { channel: c.channel, S, R, a: R / Math.pow(S, B), now: S };
  });
  const total = sum(ch, c => c.S);
  const cap = storm ? 0.10 : 0.20; // Storm Mode: tighter caps
  const marginal = c => (B * c.a * Math.pow(c.now, B)) / c.now;
  for (let step = 0; step < 60 && ch.length > 1; step++) {
    const sorted = [...ch].sort((x, y) => marginal(x) - marginal(y));
    const lo = sorted.find(c => c.now > c.S * (1 - cap) + 1);
    const hi = [...sorted].reverse().find(c => c.now < c.S * (1 + cap) - 1);
    if (!lo || !hi || lo === hi || marginal(hi) <= marginal(lo) * 1.03) break;
    const move = Math.min(total * 0.01, lo.now - lo.S * (1 - cap), hi.S * (1 + cap) - hi.now);
    lo.now -= move; hi.now += move;
  }
  const revNow = sum(ch, c => c.R);
  const revNew = sum(ch, c => c.a * Math.pow(c.now, B));
  const shifts = ch.map(c => ({
    channel: c.channel, dailyNow: Math.round(c.S), dailyNew: Math.round(c.now),
    changePct: Math.round((100 * (c.now - c.S)) / c.S), trueRoas: round(c.R / c.S), marginalRoas: round((B * c.R) / c.S),
  }));
  const margs = shifts.map(s => s.marginalRoas).filter(Boolean);
  const spreadBefore = margs.length > 1 ? Math.max(...margs) / Math.min(...margs) - 1 : 0;
  const margsAfter = ch.map(c => marginal(c));
  const spreadAfter = margsAfter.length > 1 ? Math.max(...margsAfter) / Math.min(...margsAfter) - 1 : 0;
  // Budget efficiency = revenue today ÷ revenue at the best possible split of the
  // same total (for power curves the optimum spends in proportion to a^(1/(1−b))).
  const k = ch.map(c => Math.pow(c.a, 1 / (1 - B)));
  const revOpt = sum(ch.map((c, i) => c.a * Math.pow((total * k[i]) / sum(k), B)));
  const upcoming = EVENTS.map(e => ({ ...e, inDays: Math.round((new Date(e.date + 'T00:00:00Z') - today) / DAY) }))
    .filter(e => e.inDays >= 0 && e.inDays <= 21);
  return {
    agent: 'P5', name: 'Budget Allocator', dailyBudget: Math.round(total), shifts,
    blendedTrueRoas: round(revNow / total), projectedTrueRoas: round(revNew / total),
    extraRevenuePerDay: Math.round(revNew - revNow), spreadBefore: round(spreadBefore), spreadAfter: round(spreadAfter),
    efficiencyBefore: revOpt ? round((100 * revNow) / revOpt, 1) : 100, efficiencyAfter: revOpt ? round((100 * revNew) / revOpt, 1) : 100,
    upcomingEvents: upcoming, storm,
  };
}

// ---------------------------------------------------------------------------
// Market-shock check from the data itself (news is added by lib/news.js)
// ---------------------------------------------------------------------------
function auctionCheck(rows, dates) {
  // Did CPMs spike account-wide (on most channels at once) in the last 2 days?
  const channels = [...new Set(rows.map(r => r.channel))];
  const cpm = (ch, ds) => {
    const r = rows.filter(x => x.channel === ch && ds.includes(x.date));
    const i = sum(r, x => x.impressions); return i ? (sum(r, x => x.spend) / i) * 1000 : 0;
  };
  const rises = channels.map(ch => {
    const before = cpm(ch, dates.slice(-7, -2)), after = cpm(ch, dates.slice(-2));
    return { channel: ch, risePct: before ? Math.round((after / before - 1) * 100) : 0 };
  });
  const spiking = rises.filter(r => r.risePct >= 25);
  return { rises, accountWideSpike: channels.length > 1 ? spiking.length >= Math.ceil(channels.length * 0.6) : spiking.length === 1 };
}

// ---------------------------------------------------------------------------
// Agent Health Index (AHI), following the deck:
//   KPI score S = 100 × (x − b) ÷ (t − b), capped 0–100
//   AHI = G × P2^0.30 × P3^0.20 × P4^0.25 × P5^0.25 (weighted geometric mean)
//   G = 1 if the P1 data-trust score ≥ 60, else 0
// ---------------------------------------------------------------------------
export const kpiScore = (x, b, t) => Math.round(100 * clamp((x - b) / (t - b), 0, 1));

export function ahi(scores, gateOpen) {
  const w = { P2: 0.30, P3: 0.20, P4: 0.25, P5: 0.25 };
  const g = gateOpen ? 1 : 0;
  const value = Math.round(g * Object.entries(w).reduce((p, [k, v]) => p * Math.pow(Math.max(1, scores[k]), v), 1));
  const vals = Object.values(scores);
  let status = 'Green · Healthy';
  if (!gateOpen) status = 'Red 3 · Halt (data broken)';
  else if (vals.filter(v => v < 50).length >= 2) status = 'Red 2 · Critical';
  else if (vals.some(v => v < 50)) status = 'Red 1 · Alert';
  else if (vals.some(v => v < 70)) status = 'Amber · Watch';
  return { value, status, scores };
}

// ---------------------------------------------------------------------------
// Run every agent's maths once. The AI layer reads from this.
// ---------------------------------------------------------------------------
export function analyze(rawRows, rawOrders, opts = {}) {
  const rows = cleanRows(rawRows);
  const orders = cleanOrders(rawOrders);
  if (!rows.length) throw new Error('No usable rows. Check that the file has date, channel and spend columns.');
  const today = opts.today ? new Date(opts.today) : new Date();
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const breakeven = opts.breakevenRoas || 2.0;

  const signal = signalAgent(rows, orders, dates, today);
  const auction = auctionCheck(rows, dates);
  const fatigue = fatigueSentinel(rows, dates, signal, auction.accountWideSpike);
  const cohort = cohortOptimizer(rows, dates, signal, breakeven);
  const budget = budgetAllocator(signal, today, auction.accountWideSpike);

  // P3 · Creative Studio needs: ads to replace + where local-language copy is missing.
  const toReplace = fatigue.ads.filter(a => a.cause === 'creative fatigue' && (a.status === 'fatigued' || (a.daysToFatigue && a.daysToFatigue <= 4)));
  const langTag = /\((HI|TA|TE|MR|BN|KN|ML|GU|PA)\)|hindi|tamil|telugu|marathi|bengali|kannada/i;
  const metros = /mumbai|delhi|bengaluru|bangalore|pune|hyderabad|all/i;
  const regional = rows.filter(r => !metros.test(r.region));
  const regionalSpend = sum(regional, r => r.spend);
  const localSpend = sum(regional.filter(r => langTag.test(r.ad)), r => r.spend);
  const creativeNeeds = {
    agent: 'P3', name: 'Creative Studio',
    adsToReplace: toReplace.map(a => ({ channel: a.channel, ad: a.ad, ctrDropPct: a.ctrDropPct, score: a.score })),
    regions: [...new Set(rows.map(r => r.region))],
    pctRegionalSpendLocalLanguage: regionalSpend ? Math.round((100 * localSpend) / regionalSpend) : 100,
  };

  return {
    brand: opts.brand || 'Your brand', category: opts.category || 'consumer brand',
    period: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
    totals: { spend: Math.round(sum(rows, r => r.spend)), rows: rows.length, channels: [...new Set(rows.map(r => r.channel))] },
    signal, fatigue, creative: creativeNeeds, cohort, budget, auction,
  };
}

// ---------------------------------------------------------------------------
// Turn analysis + creative output into concrete actions with tiered autonomy:
// small moves auto-execute; big ones go to the approval inbox.
//   auto  = budget shift under 10%, or pausing something that spends under ₹5,000/day
//   ask   = everything bigger, or ANY spend change while the data gate is shut / Storm Mode is on
// ---------------------------------------------------------------------------
export function buildActions(a, variants = [], shock = { external: false }) {
  const actions = [];
  const locked = !a.signal.gateOpen; // Red 3: data broken → nothing runs on its own
  const storm = shock.external || a.budget.storm;
  const tier = small => (locked || !small ? 'approval' : 'auto');
  let id = 0;

  for (const b of a.signal.trackingBreaks) {
    actions.push({ id: ++id, agent: 'P1', tier: 'approval', kind: 'tracking',
      title: `Fix ${b.channel} tracking before trusting its numbers`,
      detail: `Reported conversions fell ${Math.round(b.drop * 100)}% on ${b.date}${b.ordersStillFlowing ? ' while Shopify orders kept flowing' : ''}. Likely a pixel / Conversions API break. ${b.channel} decisions are frozen until fixed.`,
      impact: 0 });
  }
  for (const ad of a.fatigue.ads.filter(x => x.status === 'fatigued' && x.cause === 'creative fatigue')) {
    const v = variants.find(x => x.ad === ad.ad);
    actions.push({ id: ++id, agent: 'P2', tier: tier(ad.dailySpend < 5000), kind: 'pause',
      title: `Pause "${ad.ad}" and swap in ${v ? v.variants.length + ' fresh variants' : 'a fresh variant'}`,
      detail: `Fatigue score ${ad.score}/100: CTR down ${ad.ctrDropPct}% vs its own baseline${ad.frequency ? `, frequency ${ad.frequency}` : ''}, CPM up ${ad.cpmRisePct}%.`,
      impact: ad.dailySpend });
  }
  for (const ad of a.fatigue.ads.filter(x => x.status === 'at risk' && x.daysToFatigue && x.daysToFatigue <= 4 && x.cause === 'creative fatigue')) {
    actions.push({ id: ++id, agent: 'P3', tier: 'auto', kind: 'prep',
      title: `Queue a replacement for "${ad.ad}" (fatigues in ~${ad.daysToFatigue} days)`,
      detail: `Score ${ad.score}/100 and falling. Variants are drafted and A/B-ready, so there is no gap when it tires.`, impact: 0 });
  }
  for (const c of a.cohort.losing.slice(0, 4)) {
    const cut = c.action === 'pause' ? c.dailySpend : c.action.includes('40') ? c.dailySpend * 0.4 : c.dailySpend * 0.15;
    actions.push({ id: ++id, agent: 'P4', tier: tier(cut < 5000), kind: 'cohort',
      title: `${c.channel} · ${c.region}: ${c.action}`,
      detail: `True ROAS ${c.trueRoas} vs break-even ${a.cohort.breakevenRoas}. Frees about ₹${Math.round(cut).toLocaleString('en-IN')}/day.`,
      impact: Math.round(cut) });
  }
  const moves = a.budget.shifts.filter(s => Math.abs(s.changePct) >= 2);
  if (moves.length > 1 && !a.signal.trackingBreaks.length) {
    const biggest = Math.max(...moves.map(m => Math.abs(m.changePct)));
    const text = moves.map(m => `${m.channel} ${m.changePct > 0 ? '+' : ''}${m.changePct}%`).join(', ');
    actions.push({ id: ++id, agent: 'P5', tier: storm ? 'approval' : tier(biggest < 10), kind: 'budget',
      title: `Rebalance daily budget: ${text}`,
      detail: `Money moves to the best marginal true ROAS (${moves.map(m => `${m.channel} ${m.marginalRoas}`).join(' · ')}). Expected +₹${a.budget.extraRevenuePerDay.toLocaleString('en-IN')} revenue/day on the same spend.${storm ? ' Storm Mode: caps tightened to ±10%.' : ''}`,
      impact: a.budget.extraRevenuePerDay });
  }
  for (const e of a.budget.upcomingEvents.slice(0, 1)) {
    actions.push({ id: ++id, agent: 'P5', tier: 'approval', kind: 'pacing',
      title: `Pace for ${e.name} (in ${e.inDays} days): hold 15% budget reserve`,
      detail: `Demand and CPMs rise around ${e.name}. Holding a reserve lets Drishti pour money into whichever channel peaks first.`, impact: 0 });
  }
  return actions;
}

// Agent scores before and after the actions, for the AHI gauge.
export function scoreAgents(a, actions, variantsReady) {
  const fatiguedSpendAfter = 0; // fatigued ads are paused/replaced
  // Losing cohorts that got an action shrink to ~30% of their spend; the rest stay as they are.
  const acted = new Set(actions.filter(x => x.kind === 'cohort').map(x => x.title.split(':')[0]));
  const total7 = sum(a.cohort.cohorts, c => c.spend7) || 1;
  const losingAfter = (100 * sum(a.cohort.losing, c => (acted.has(`${c.channel} · ${c.region}`) ? 0.3 : 1) * c.spend7)) / total7;
  const need = a.creative.adsToReplace.length;
  const p3 = (ready, regional) => Math.round(0.54 * ready + 0.30 * kpiScore(regional, 0, 60) + 0.16 * 100);
  const before = {
    P2: kpiScore(a.fatigue.pctSpendFatigued, 20, 10),
    P3: p3(need ? 0 : 100, a.creative.pctRegionalSpendLocalLanguage),
    P4: kpiScore(a.cohort.pctSpendLosing, 25, 5),
    P5: kpiScore(a.budget.efficiencyBefore, 80, 98),
  };
  const after = {
    P2: kpiScore(fatiguedSpendAfter, 20, 10),
    P3: p3(need ? Math.round((100 * Math.min(variantsReady, need)) / need) : 100, Math.max(a.creative.pctRegionalSpendLocalLanguage, variantsReady ? 60 : 0)),
    P4: kpiScore(losingAfter, 25, 5),
    P5: kpiScore(a.budget.efficiencyAfter, 80, 98),
  };
  return { before: ahi(before, a.signal.gateOpen), after: ahi(after, a.signal.gateOpen) };
}
