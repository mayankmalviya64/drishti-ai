// scripts/check.mjs — quick console check of the agent maths on the sample brands.
import { makeSample } from '../lib/sample.js';
import { analyze, buildActions, scoreAgents } from '../lib/analyze.js';
for (const [b, tw] of [['glowveda', {}], ['crunchkart', {}], ['glowveda', { pixelBreak: true }], ['glowveda', { marketShock: true }]]) {
  const s = makeSample(b, { twists: tw }); const a = analyze(s.rows, s.orders, { brand: s.brand });
  const acts = buildActions(a, [{ ad: 'x', variants: [1, 2] }], { external: !!tw.marketShock }); const sc = scoreAgents(a, acts, a.creative.adsToReplace.length);
  console.log('==', b, JSON.stringify(tw), 'trust', a.signal.trustScore);
  console.log(' ch', a.signal.perChannel.map(c => `${c.channel} plat${c.platformRoas} true${c.trueRoas} spend/d${Math.round(c.spend7 / 7)}`).join(' | '));
  console.log(' fat', a.fatigue.ads.map(x => `${x.ad.slice(0, 16)}:${x.score}/${x.status}/d${x.daysToFatigue}`).join(' | '), 'pct', a.fatigue.pctSpendFatigued);
  console.log(' losing', a.cohort.losing.map(c => `${c.channel}-${c.region}:${c.trueRoas} ${c.action} ₹${c.dailySpend}`).join(' | '), 'pct', a.cohort.pctSpendLosing);
  console.log(' bud', a.budget.shifts.map(s => `${s.channel} ${s.changePct}% m${s.marginalRoas}`).join(' | '), a.budget.blendedTrueRoas, '->', a.budget.projectedTrueRoas, 'eff', a.budget.efficiencyBefore, a.budget.efficiencyAfter);
  console.log(' actions\n   ' + acts.map(x => `${x.agent}[${x.tier}] ${x.title} ₹${x.impact}`).join('\n   '));
  console.log(' AHI', JSON.stringify(sc));
}
