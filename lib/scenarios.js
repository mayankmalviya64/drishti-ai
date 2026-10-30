// lib/scenarios.js — "what if…" conditions you can drop onto a brand's data.
// Used in two places:
//   • the Conditions picker (the agents then run on the changed data)
//   • the What-if panel (runs the agents once per condition and compares)
//
// Every scenario is hypothetical. It changes the LAST few days of the data:
//   cpm  → ad prices (×1.5 = 50% dearer auctions)
//   ctr  → how often people click
//   cvr  → how often a click turns into a sale (real demand)
//   track → the platform under-reports sales (a tracking break; real orders don't change)
// `external: true` tells the Orchestrator's shock filter that the world changed,
// so big spend moves wait for a human (Storm Mode).

export const SCENARIOS = {
  normal: { label: 'Normal conditions', group: 'Base', note: 'The data as it is.' },

  // ---- data problems ----
  pixel: { label: 'Google tracking breaks', group: 'Data problems', twists: { pixelBreak: true },
    note: 'Google stops reporting most sales on the last day, though real orders keep coming.' },
  shock: { label: 'Ad auction spike (CPM war)', group: 'Data problems', twists: { marketShock: true },
    note: 'Ad prices jump on every channel for 2 days.' },

  // ---- market events (all brands, each brand feels them differently) ----
  covid: { label: 'COVID-like outbreak, lockdown fears', group: 'Market events', days: 5, external: true,
    headline: 'New virus outbreak: states weigh lockdowns, shoppers stock up at home',
    effects: {
      all: [{ cpm: 0.8, ctr: 1.15 }],                 // many brands pause ads, people scroll more at home
      glowveda: [{ cvr: 0.7 }],                       // skincare is put off
      crunchkart: [{ cvr: 1.3 }],                     // pantry snacks get stocked
      shyamlal: [{ cvr: 1.4 }],                       // home cooking jumps
    },
    note: 'Ads get cheaper as brands pull back; people shop from home. Hurts skincare, lifts snacks and spices.' },
  tariff: { label: 'US tariff hike on Indian goods', group: 'Market events', days: 4, external: true,
    headline: 'US raises tariffs on Indian goods; exporters turn to the home market',
    effects: {
      all: [{ cpm: 1.2 }],                            // exporters pour ad money into India
      glowveda: [{ cvr: 0.88 }],                      // imported actives cost more, prices go up
      crunchkart: [{ cvr: 0.95 }],
      shyamlal: [{ cvr: 0.9 }],                       // spice exporters dump stock at home with discounts
    },
    note: 'Exporters bring their ad budgets home, so auctions get dearer and rivals discount.' },
  indiaEu: { label: 'India–EU trade deal signed (good news)', group: 'Market events', days: 4,
    headline: 'India and EU sign free trade agreement; tariffs cut on cosmetics inputs and food',
    effects: {
      all: [{ ctr: 1.05 }],
      glowveda: [{ cvr: 1.2 }],                       // cheaper EU actives → price cut
      crunchkart: [{ cvr: 1.06 }],
      shyamlal: [{ cvr: 1.12 }],                      // export demand lifts the brand's standing
    },
    note: 'Cheaper inputs and better sentiment: sales rise without any extra ad spend.' },
  wcFinal: { label: 'India in the cricket World Cup final', group: 'Market events', days: 2,
    headline: 'India reach the World Cup final; record OTT viewership expected',
    effects: {
      all: [{ cpm: 1.15 }],
      allTv: [{ match: { channel: 'JioHotstar' }, cpm: 1.8 / 1.15, ctr: 1.3 }],
      shyamlal: [{ match: { channel: 'JioHotstar' }, cvr: 1.2 }],
    },
    note: 'TV slots during the match cost much more, but far more people are watching.' },

  // ---- one event per brand ----
  heatwave: { label: 'Heatwave across North India', group: 'Brand events', brands: ['glowveda'], days: 5,
    headline: 'Severe heatwave grips North India; temperatures cross 47°C',
    effects: { glowveda: [
      { match: { campaign: /SPF|Sunscreen/ }, cvr: 1.5, ctr: 1.2 },
      { match: { region: /Delhi|UP/ }, cvr: 1.15 },
    ] },
    note: 'Sunscreen demand jumps, mostly in Delhi NCR and UP & Bihar.' },
  qcomm: { label: 'Quick-commerce price war (Blinkit / Zepto)', group: 'Brand events', brands: ['crunchkart'], days: 5,
    headline: 'Quick-commerce apps slash snack prices in a festive discount war',
    effects: { crunchkart: [{ cvr: 0.72 }, { match: { channel: 'Google' }, cpm: 1.3 }] },
    note: 'Shoppers buy the same snacks cheaper on quick-commerce apps, so D2C sales drop.' },
  flood: { label: 'Floods in Madhya Pradesh', group: 'Brand events', brands: ['shyamlal'], days: 4,
    headline: 'Heavy floods in Madhya Pradesh; roads to Indore and Bhopal cut off',
    effects: { shyamlal: [{ match: { region: /Indore|Bhopal/ }, cvr: 0.4 }] },
    note: 'Deliveries to Indore and Bhopal stop, so ads there keep spending without sales.' },
};

// The scenarios that fit one brand (brand-only events are hidden for the others).
// Your own uploaded data gets every general scenario.
export function scenariosFor(brandKey) {
  return Object.entries(SCENARIOS)
    .filter(([, s]) => !s.brands || s.brands.includes(brandKey))
    .map(([key, s]) => ({ key, ...s }));
}

// Does one effect apply to this row?
function matches(row, m = {}) {
  if (m.channel && row.channel !== m.channel) return false;
  if (m.region && !m.region.test(row.region || '')) return false;
  if (m.campaign && !m.campaign.test(row.campaign || '')) return false;
  return true;
}

// Apply a scenario's effects to a brand's data and return a NEW data object.
// (Scenarios that use `twists` are built into the sample itself, see makeSample.)
export function applyScenario(data, key, brandKey) {
  const s = SCENARIOS[key];
  if (!s || !s.effects) return data;
  const effects = [...(s.effects.all || []), ...(s.effects.allTv || []), ...(s.effects[brandKey] || s.effects.other || [])];
  const dates = [...new Set(data.rows.map(r => r.date))].sort();
  const hit = new Set(dates.slice(-(s.days || 3)));
  const convBefore = {}, convAfter = {}; // per date|channel, to move Shopify orders the same way

  const rows = data.rows.map(r => {
    if (!hit.has(r.date)) return r;
    let cpm = 1, ctr = 1, cvr = 1;
    for (const e of effects) if (matches(r, e.match)) { cpm *= e.cpm || 1; ctr *= e.ctr || 1; cvr *= e.cvr || 1; }
    // Spend stays the same (the budget is fixed); dearer ads buy fewer impressions.
    const reach = 1 / cpm, clicks = reach * ctr, sales = clicks * cvr;
    const k = r.date + '|' + r.channel;
    convBefore[k] = (convBefore[k] || 0) + Number(r.conversions || 0);
    const out = { ...r,
      impressions: Math.round(r.impressions * reach), reach: Math.round((r.reach || 0) * reach),
      clicks: Math.round(r.clicks * clicks), conversions: Math.round(r.conversions * sales),
      platform_revenue: Math.round(r.platform_revenue * sales) };
    convAfter[k] = (convAfter[k] || 0) + out.conversions;
    return out;
  });
  // Real orders follow real demand
  const orders = (data.orders || []).map(o => {
    const k = o.date + '|' + o.channel;
    if (!convBefore[k]) return o;
    const f = convAfter[k] / convBefore[k];
    return { ...o, orders: Math.round(o.orders * f), revenue: Math.round(o.revenue * f) };
  });
  // Rivals named in your own condition: their ads show up in the competitor feed on those days
  const competitors = [...(data.competitors || [])];
  for (const r of s.rivals || []) for (const date of hit)
    competitors.push({ date, competitor: r.name, channel: r.channel, campaign: r.campaign, impressions: 200000, engagement_rate: Math.round(r.engagement * 10000) / 100 });
  return { ...data, rows, orders, competitors };
}

// What the Orchestrator's shock filter is told about the scenario (sent with each run)
export function scenarioContext(key) {
  const s = SCENARIOS[key];
  if (!s || key === 'normal' || !s.headline) return null;
  return { key, label: s.label, headline: s.headline, external: !!s.external,
    // only for your own condition: the news it was drafted from and the rivals in it
    news: (s.news || []).slice(0, 3).map(n => ({ title: n.title, source: n.source })),
    rivals: (s.rivals || []).map(r => `${r.name}: ${r.strategy}`).slice(0, 3) };
}

// ---------------------------------------------------------------------------
// YOUR OWN CONDITION ("Custom condition…" in the picker)
// You describe a situation in plain words. The server reads today's news about it
// and the AI drafts a scenario: what changes in the ad data, which rivals are
// involved and what they are doing. The draft is then run like any other condition,
// so your rules, Storm Mode and the approval limits still decide what happens.
// ---------------------------------------------------------------------------

// Safe ranges: however wild a draft is, the data can only move this much
// (cpm ×2.5 = ads 2.5× dearer; cvr ×0.3 = sales drop to 30% of normal).
export const DRAFT_LIMITS = { cpm: [0.5, 2.5], ctr: [0.5, 2], cvr: [0.3, 2], days: [1, 7], engagement: [0.005, 0.12] };
const clampTo = (v, [lo, hi], dflt = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const text = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Tidy up a draft (from the AI or from the keyword fallback) so it is always safe to apply.
// brand = { name, channels:[...], regions:[...], campaigns:[...] } of the data on screen.
export function cleanDraft(raw = {}, brand = {}) {
  const channels = brand.channels || [], regions = brand.regions || [];
  // Only keep a channel/region the brand really has; anything else means "everywhere"
  const pickFrom = (v, list) => list.find(x => x.toLowerCase() === String(v || '').toLowerCase()) || '';
  const effects = (Array.isArray(raw.effects) ? raw.effects : []).slice(0, 4).map(e => ({
    channel: pickFrom(e.channel, channels), region: pickFrom(e.region, regions), campaign: text(e.campaign, 40),
    cpm: clampTo(e.cpm, DRAFT_LIMITS.cpm), ctr: clampTo(e.ctr, DRAFT_LIMITS.ctr), cvr: clampTo(e.cvr, DRAFT_LIMITS.cvr), why: text(e.why, 140),
  }));
  const rivals = (Array.isArray(raw.rivals) ? raw.rivals : []).slice(0, 3).map(r => ({
    name: text(r.name, 40) || 'A rival brand', strategy: text(r.strategy, 200),
    channel: pickFrom(r.channel, channels) || channels[0] || 'Instagram',
    // The rival's campaign shares a theme with one of ours, so the Cohort agent can compare them
    campaign: text(r.campaign, 60) || (brand.campaigns || [])[0] || 'Brand',
    engagement: clampTo(r.engagement, DRAFT_LIMITS.engagement, 0.04),
  }));
  return {
    text: text(raw.text, 500), by: raw.by || 'AI',
    label: text(raw.label, 60) || 'Your own condition',
    headline: text(raw.headline, 160) || text(raw.text, 160),
    note: text(raw.note, 240), days: Math.round(clampTo(raw.days, DRAFT_LIMITS.days, 3)),
    external: !!raw.external, effects: effects.length ? effects : [{ channel: '', region: '', campaign: '', cpm: 1, ctr: 1, cvr: 1, why: 'No clear effect on ads' }],
    rivals, moves: (Array.isArray(raw.moves) ? raw.moves : []).slice(0, 4).map(m => text(m, 200)).filter(Boolean),
    news: (Array.isArray(raw.news) ? raw.news : []).slice(0, 5).map(n => ({ title: text(n.title, 200), source: text(n.source, 40), link: String(n.link || '').slice(0, 1200) })),
    madeAt: raw.madeAt || Date.now(),
  };
}

// Put one brand's draft into the picker as the "custom" condition (or take it out).
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function useCustom(brandKey, draft) {
  if (!draft) { delete SCENARIOS.custom; return; }
  SCENARIOS.custom = {
    label: draft.label, group: 'Your own', brands: [brandKey], days: draft.days, external: draft.external,
    headline: draft.headline, note: draft.note || draft.text, rivals: draft.rivals, news: draft.news, moves: draft.moves,
    // Same shape as the built-in events above, so applyScenario treats it the same way
    effects: { [brandKey]: draft.effects.map(e => ({
      match: { ...(e.channel && { channel: e.channel }), ...(e.region && { region: new RegExp(escRe(e.region), 'i') }),
        ...(e.campaign && { campaign: new RegExp(escRe(e.campaign), 'i') }) },
      cpm: e.cpm, ctr: e.ctr, cvr: e.cvr })) },
  };
}

// No AI (or no server)? A simple keyword reading of what you typed, so the feature still works.
const KEYWORDS = [
  // rival moves first: "X cuts prices before Diwali" is about the rival, not the festival
  { re: /price war|price cut|cuts? prices?|discount|% off|undercut|cheaper|slash|launch|new product|copy|floods? (instagram|reels|feeds)/i, fx: { cpm: 1.1, cvr: 0.8 }, external: false, why: 'A rival pulls buyers away with a better offer' },
  { re: /lockdown|covid|virus|pandemic|outbreak/i, fx: { cpm: 0.8, ctr: 1.1, cvr: 0.85 }, external: true, why: 'People stay home; many brands pause ads' },
  { re: /\bwar\b|strike|bandh|curfew|riot|protest|election/i, fx: { cpm: 1.2, cvr: 0.85 }, external: true, why: 'News dominates feeds and shoppers hold back' },
  { re: /flood|cyclone|earthquake|landslide|heavy rain/i, fx: { cvr: 0.55 }, external: false, why: 'Deliveries and shopping stop where it hits' },
  { re: /diwali|festival|wedding|holi|eid|sale\b|big billion|cricket|ipl|world cup/i, fx: { cpm: 1.25, ctr: 1.15, cvr: 1.15 }, external: false, why: 'More shoppers, but dearer ad slots' },
  { re: /tariff|gst|tax|inflation|price hike|costlier/i, fx: { cvr: 0.9 }, external: false, why: 'Prices go up, so fewer clicks turn into orders' },
  { re: /viral|influencer|trend|boom|demand|heatwave|summer/i, fx: { ctr: 1.2, cvr: 1.2 }, external: false, why: 'More people want the product right now' },
];
const COMMON = new Set(['Diwali', 'Holi', 'Eid', 'Monsoon', 'Blinkit', 'Zepto', 'A', 'An', 'The', 'If', 'What', 'When', 'Our', 'We', 'India', 'Indian', 'Next', 'This', 'That', 'Big', 'New', 'And', 'In', 'On', 'For']);
export function draftLocally(input, brand = {}, news = []) {
  const t = String(input || '');
  const hit = KEYWORDS.find(k => k.re.test(t)) || { fx: { cpm: 1.1, cvr: 0.9 }, external: false, why: 'A general dip in how well ads sell' };
  const region = (brand.regions || []).find(r => t.toLowerCase().includes(r.toLowerCase().split(/[ &]/)[0]));
  const channel = (brand.channels || []).find(c => t.toLowerCase().includes(c.toLowerCase()));
  // Capitalised words that are not our brand, a channel or a region are probably rival names
  const known = new Set([...(brand.channels || []), ...(brand.regions || []), ...String(brand.name || '').split(' ')].map(s => s.toLowerCase()));
  const names = [...new Set((t.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).filter(w => !COMMON.has(w) && !known.has(w.toLowerCase())))];
  const theme = String((brand.campaigns || [])[0] || 'Brand').split('·')[0].trim();
  return cleanDraft({
    text: t, by: 'keywords', label: t.split(/\s+/).length > 7 ? t.split(/\s+/).slice(0, 7).join(' ') + '…' : t, // first few words headline: t, days: 4, external: hit.external,
    note: `${hit.why}${region ? `, mainly in ${region}` : ''}. Read from your words (the AI drafter was not reachable).`,
    effects: [{ ...hit.fx, region, channel, why: hit.why }],
    rivals: hit.re?.source.includes('price war') || /rival|competitor/i.test(t)
      ? names.slice(0, 2).map(n => ({ name: n, strategy: t, channel: channel || (brand.channels || [])[0], campaign: `${theme} · ${n} push`, engagement: 0.05 })) : [],
    moves: ['Watch true ROAS by channel daily until this passes', 'Keep big budget shifts behind your approval while it lasts'],
    news,
  }, brand);
}
