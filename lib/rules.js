// lib/rules.js — the standing rules a marketer can set ("if X happens, do Y on your own").
// Used in two places:
//   • the browser (app.js) draws the rule editor from RULE_TYPES
//   • the server (analyze.js) checks every rule against the data with checkRules()
// The "flat revenue → hold" rule keeps its own, more careful check in analyze.js
// (flatlineCheck); every other rule type is checked here.

const sum = (list, f) => list.reduce((s, x) => s + (f ? f(x) : x), 0);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');

// Each rule type: a sentence with {a} / {b} blanks the user fills in,
// the agent that enforces it, and the limits for each blank.
export const RULE_TYPES = {
  flat: { text: 'Hold a campaign if revenue is flat for {a} days', agent: 'P5',
    a: { def: 2, min: 1, max: 7, step: 1 } },
  roas: { text: 'Hold a campaign if true ROAS stays below {a} for {b} days', agent: 'P5',
    a: { def: 1.2, min: 0.1, max: 10, step: 0.1 }, b: { def: 3, min: 1, max: 14, step: 1 } },
  cpa: { text: 'Pause an ad if cost per sale is above ₹{a} for {b} days', agent: 'P4',
    a: { def: 800, min: 10, max: 100000, step: 10 }, b: { def: 3, min: 1, max: 14, step: 1 } },
  freq: { text: 'Pause an ad once people have seen it more than {a} times a week', agent: 'P2',
    a: { def: 4, min: 1, max: 30, step: 0.5 } },
  ctr: { text: 'Pause an ad if its click rate drops below {a}% for {b} days', agent: 'P2',
    a: { def: 0.6, min: 0.05, max: 20, step: 0.05 }, b: { def: 3, min: 1, max: 14, step: 1 } },
  cap: { text: 'Never let one channel spend more than ₹{a} a day', agent: 'P5',
    a: { def: 60000, min: 100, max: 10000000, step: 1000 } },
};

// The rule everyone starts with (same as the old single "Your rule").
export const DEFAULT_RULES = [{ type: 'flat', a: 2 }];

// Make a rule safe to use: known type, numbers inside their limits.
export function cleanRule(r = {}) {
  const t = RULE_TYPES[r.type];
  if (!t) return null;
  const fix = (v, spec) => (spec ? Math.min(spec.max, Math.max(spec.min, Number(v) || spec.def)) : undefined);
  return { type: r.type, a: fix(r.a, t.a), b: fix(r.b, t.b) };
}

// The rule as one readable sentence, e.g. "Pause an ad if cost per sale is above ₹800 for 3 days"
export function ruleText(r) {
  const t = RULE_TYPES[r.type];
  return t ? t.text.replace('{a}', Number(r.a).toLocaleString('en-IN')).replace('{b}', r.b) : '';
}

// ---------------------------------------------------------------------------
// Check every non-"flat" rule against the cleaned ad rows.
//   overclaim: channel → how much the platform over-reports revenue (from the Signal agent)
//   skip:      ads / campaigns another agent is already acting on (no double actions)
// Returns one "hit" per thing a rule wants changed.
// ---------------------------------------------------------------------------
export function checkRules(rows, dates, overclaim, rules = [], skip = { ads: new Set(), campaigns: new Set() }) {
  const hits = [];
  const seen = new Set(); // one action per ad / campaign / channel, even if two rules match it
  const heldCampaigns = new Set(skip.campaigns); // an ad inside a campaign that is on hold needs no action of its own
  rules.map(cleanRule).filter(r => r && r.type !== 'flat').forEach(rule => {
    const days = rule.b || 7;
    const recent = new Set(dates.slice(-days));
    const inRecent = rows.filter(r => recent.has(r.date));
    const trueRev = r => r.platform_revenue / (overclaim[r.channel] || 1);
    const push = (key, hit) => { if (!seen.has(key)) { seen.add(key); hits.push({ rule, ruleText: ruleText(rule), ...hit }); } };

    // Group the recent rows by campaign or by ad
    const group = by => {
      const map = new Map();
      for (const r of inRecent) {
        const k = r.channel + '||' + (by === 'ad' ? r.ad : r.campaign);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      }
      return map;
    };
    // True when every one of the last `days` days passes the test (the rule needs it "for N days")
    const everyDay = (list, test) => [...recent].every(d => { const day = list.filter(r => r.date === d); return day.length && test(day); });

    if (rule.type === 'roas') {
      for (const [k, list] of group('campaign')) {
        const [channel, campaign] = k.split('||');
        if (skip.campaigns.has(k) || /search/i.test(campaign)) continue;
        if (!everyDay(list, day => sum(day, trueRev) / (sum(day, r => r.spend) || 1) < rule.a)) continue;
        const spend = sum(list, r => r.spend), roas = round(sum(list, trueRev) / (spend || 1));
        heldCampaigns.add(k);
        push('c:' + k, { kind: 'rule', level: 'campaign', channel, campaign, trueRoas: roas, impact: Math.round(spend / days),
          title: `Put "${campaign}" on hold: true ROAS under ${rule.a} for ${days} days`,
          observed: `"${campaign}" on ${channel} earned only ₹${roas} per ₹1 for ${days} days in a row (your floor is ${rule.a}).`,
          recommend: `Hold it, as your rule says, and move its ${inr(spend / days)}/day to better campaigns.`,
          execute: `Setting "${campaign}" to ON HOLD on ${channel}`,
          feedback: `${channel}: "${campaign}" on hold · spend ₹0/day` });
      }
    }

    if (rule.type === 'cpa') {
      for (const [k, list] of group('ad')) {
        const [channel, ad] = k.split('||');
        if (skip.ads.has(k) || heldCampaigns.has(channel + '||' + list[0].campaign)) continue;
        if (!everyDay(list, day => sum(day, r => r.spend) / (sum(day, r => r.conversions) || 0.5) > rule.a)) continue;
        const spend = sum(list, r => r.spend), cpa = spend / (sum(list, r => r.conversions) || 0.5);
        push('a:' + k, { kind: 'rule', level: 'ad', channel, ad, trueRoas: round(sum(list, trueRev) / (spend || 1)), impact: Math.round(spend / days),
          title: `Pause "${ad}": each sale costs ${inr(cpa)}`,
          observed: `"${ad}" on ${channel} paid ${inr(cpa)} per sale for ${days} days (your limit is ${inr(rule.a)}).`,
          recommend: `Pause it. Your cost-per-sale rule fired.`,
          execute: `Pausing "${ad}" on ${channel}`,
          feedback: `${channel}: "${ad}" paused · cost per sale back under ${inr(rule.a)}` });
      }
    }

    if (rule.type === 'freq') {
      // Frequency = how many times the average person saw the ad (last 7 days, per region, averaged)
      for (const [k, list] of group('ad')) {
        const [channel, ad] = k.split('||');
        // search ads show only when someone searches, so "seen too often" doesn't apply to them
        if (skip.ads.has(k) || heldCampaigns.has(channel + '||' + list[0].campaign) || /search/i.test(list[0].campaign + ' ' + ad) || !sum(list, r => r.reach)) continue;
        const byRegion = new Map();
        for (const r of list) {
          const x = byRegion.get(r.region) || { imp: 0, reach: 0 };
          x.imp += r.impressions; x.reach = Math.max(x.reach, r.reach); byRegion.set(r.region, x);
        }
        // reach for a whole week is roughly the biggest day × 2.5 (people overlap across days)
        const freqs = [...byRegion.values()].filter(x => x.reach).map(x => x.imp / (x.reach * 2.5));
        const freq = round(freqs.reduce((a, b) => a + b, 0) / (freqs.length || 1), 1);
        if (freq <= rule.a) continue;
        const spend = sum(list, r => r.spend);
        push('a:' + k, { kind: 'rule', level: 'ad', channel, ad, trueRoas: round(sum(list, trueRev) / (spend || 1)), impact: Math.round(spend / days),
          title: `Pause "${ad}": seen ${freq}× a week`,
          observed: `People saw "${ad}" on ${channel} about ${freq} times this week (your limit is ${rule.a}).`,
          recommend: `Pause it before it annoys people. Your frequency rule fired.`,
          execute: `Pausing "${ad}" on ${channel}`,
          feedback: `${channel}: "${ad}" paused · frequency capped at ${rule.a}` });
      }
    }

    if (rule.type === 'ctr') {
      for (const [k, list] of group('ad')) {
        const [channel, ad] = k.split('||');
        if (skip.ads.has(k) || heldCampaigns.has(channel + '||' + list[0].campaign)) continue;
        if (!everyDay(list, day => (100 * sum(day, r => r.clicks)) / (sum(day, r => r.impressions) || 1) < rule.a)) continue;
        const ctr = round((100 * sum(list, r => r.clicks)) / (sum(list, r => r.impressions) || 1));
        const spend = sum(list, r => r.spend);
        push('a:' + k, { kind: 'rule', level: 'ad', channel, ad, trueRoas: round(sum(list, trueRev) / (spend || 1)), impact: Math.round(spend / days),
          title: `Pause "${ad}": click rate ${ctr}%`,
          observed: `"${ad}" on ${channel} got clicks from only ${ctr}% of views for ${days} days (your floor is ${rule.a}%).`,
          recommend: `Pause it. Your click-rate rule fired.`,
          execute: `Pausing "${ad}" on ${channel}`,
          feedback: `${channel}: "${ad}" paused` });
      }
    }

    if (rule.type === 'cap') {
      const last = dates[dates.length - 1];
      const channels = [...new Set(rows.map(r => r.channel))];
      for (const channel of channels) {
        const spend = sum(rows.filter(r => r.channel === channel && r.date === last), r => r.spend);
        if (spend <= rule.a) continue;
        push('ch:' + channel, { kind: 'rule', level: 'channel', channel, trueRoas: null, impact: Math.round(spend - rule.a),
          title: `Cap ${channel} at ${inr(rule.a)}/day`,
          observed: `${channel} spent ${inr(spend)} yesterday, above your ${inr(rule.a)}/day ceiling.`,
          recommend: `Lower its daily budget to ${inr(rule.a)}, as your rule says.`,
          execute: `Setting ${channel} daily budget to ${inr(rule.a)}`,
          feedback: `${channel}: daily budget ${inr(rule.a)} (was ${inr(spend)})` });
      }
    }
  });
  return hits;
}
