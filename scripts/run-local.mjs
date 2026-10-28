// scripts/run-local.mjs — run the full agent loop in the terminal (rules or AI engine).
import { makeSample } from '../lib/sample.js';
import { POST } from '../api/run.js';
const s = makeSample(process.argv[2] || 'glowveda', { twists: { pixelBreak: process.argv.includes('pixel'), marketShock: process.argv.includes('shock') } });
const res = await POST(new Request('http://x/api/run', { method: 'POST', body: JSON.stringify({ brand: s.brand, category: s.category, rows: s.rows, orders: s.orders, competitors: s.competitors }) }));
const text = await res.text();
for (const line of text.trim().split('\n')) {
  const e = JSON.parse(line);
  if (e.type === 'result') console.log('RESULT', e.engine, e.seconds + 's', JSON.stringify({ briefing: e.briefing, impact: e.impact, ahi: e.ahi, actions: e.actions.length, variants: e.variants }, null, 0).slice(0, 1500));
  else console.log(e.type, e.agent || '', e.status || '', (e.text || e.engine || e.message || '').slice(0, 220));
}
