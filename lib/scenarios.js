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
  return { ...data, rows, orders };
}

// What the Orchestrator's shock filter is told about the scenario (sent with each run)
export function scenarioContext(key) {
  const s = SCENARIOS[key];
  if (!s || key === 'normal' || !s.headline) return null;
  return { key, label: s.label, headline: s.headline, external: !!s.external };
}
