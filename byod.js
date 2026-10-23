/* =====================================================================
   byod.js — "Try it on your numbers" (bring your own data)
   1. You type or paste channels, cohorts and ads.
   2. Drishti reconciles platform claims with your store revenue,
      scores ad fatigue, finds losing cohorts, proposes a guarded
      budget shift and writes an action plan with autonomy tiers.
   3. "Send to playground" loads your channels into the simulator.
   Nothing leaves the browser. A draft is kept in localStorage.
   ===================================================================== */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const inr = n => window.DrishtiSim ? window.DrishtiSim.inr(n) : '₹'+Math.round(n);
const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
// "₹1,50,000" or "12%" → 150000 / 12. Anything unreadable → 0.
const num = v => { const n = parseFloat(String(v ?? '').replace(/[₹,\s%x×]/g,'')); return isFinite(n) ? n : 0; };
const CURVE = 0.65;            // same diminishing-returns curve as the playground
const MAX_CH = 6;              // the playground has colours for up to 6 channels

// ---------- Table definitions: column key, header, input type ----------
const TYPES = [['social','Social (Meta, Snap)'],['search','Search (Google, Bing)'],['video','Video / OTT / CTV'],['marketplace','Marketplace (Amazon, Flipkart)']];
const COLS = {
  ch: [['name','Channel','text'],['type','Type','type'],['spend','Spend ₹','num'],['rev','Platform-reported revenue ₹','num']],
  co: [['cohort','Cohort','text'],['channel','Channel','text'],['spend','Spend ₹','num'],['rev','Platform revenue ₹','num']],
  ad: [['ad','Ad','text'],['channel','Channel','text'],['spend','Spend 7d ₹','num'],['freq','Frequency','num'],['ctr','CTR now %','num'],['ctr0','CTR first 3 days %','num'],['cpm','CPM change %','num'],['days','Days live','num']]
};
// CSV header names we understand for each column (so exported files map automatically)
const ALIASES = {
  name:['name','channel','platform'], type:['type','channel_type'], spend:['spend','spend_7d','cost','amount_spent'], rev:['platform_revenue','revenue','conversion_value','purchase_value'],
  cohort:['cohort','audience','segment'], channel:['channel','platform'], ad:['ad','ad_name','creative'], freq:['frequency','freq'],
  ctr:['ctr_now','ctr'], ctr0:['ctr_first3days','ctr_baseline','ctr0'], cpm:['cpm_change_pct','cpm_change','cpm'], days:['days_live','age_days','days']
};
const EXAMPLE = {
  brand:'Glowkart (example)', store:43700000, margin:50,
  ch:[{name:'Meta',type:'social',spend:8250000,rev:33800000},{name:'Google',type:'search',spend:5250000,rev:23100000},{name:'OTT',type:'video',spend:1500000,rev:3900000}],
  co:[{cohort:'Women 25-34, Metro, Feed',channel:'Meta',spend:3000000,rev:14000000},{cohort:'Women 35-44, Tier-3, Reels',channel:'Meta',spend:1650000,rev:1000000},
      {cohort:'Brand search',channel:'Google',spend:1200000,rev:9600000},{cohort:'Broad match, Display network',channel:'Google',spend:900000,rev:1100000},
      {cohort:'CTV prime time, Hindi',channel:'OTT',spend:900000,rev:2900000},{cohort:'Late-night regional CTV',channel:'OTT',spend:300000,rev:300000}],
  ad:[{ad:'Glow serum – reel 1',channel:'Meta',spend:420000,freq:1.6,ctr:1.4,ctr0:1.5,cpm:4,days:6},
      {ad:'Glow serum – reel 3',channel:'Meta',spend:380000,freq:2.6,ctr:0.95,ctr0:1.45,cpm:22,days:19},
      {ad:'Diwali carousel',channel:'Meta',spend:260000,freq:2.2,ctr:1.1,ctr0:1.3,cpm:12,days:12},
      {ad:'Static – Hindi offer',channel:'Meta',spend:4200,freq:3.1,ctr:0.6,ctr0:1.2,cpm:30,days:25},
      {ad:'Sunscreen reel (new launch)',channel:'Meta',spend:150000,freq:2.0,ctr:1.25,ctr0:1.3,cpm:28,days:9},
      {ad:'YouTube bumper 6s',channel:'Google',spend:180000,freq:1.9,ctr:0.5,ctr0:0.55,cpm:6,days:10},
      {ad:'Search RSA – brand',channel:'Google',spend:300000,freq:1.0,ctr:6.1,ctr0:6.0,cpm:2,days:30},
      {ad:'CTV 20s – Hindi',channel:'OTT',spend:120000,freq:2.8,ctr:0.3,ctr0:0.32,cpm:5,days:14}]
};
let D = JSON.parse(JSON.stringify(EXAMPLE));          // the data currently in the tables
try { const saved = JSON.parse(localStorage.getItem('drishti-byod')); if (saved && saved.ch) D = saved; } catch (e) {}
const save = () => { try { localStorage.setItem('drishti-byod', JSON.stringify(D)); } catch (e) {} };

// ---------- Draw the editable tables ----------
function renderTable(key){
  const cols = COLS[key], tbl = $({ch:'tCh',co:'tCo',ad:'tAd'}[key]);
  const cell = (row,i,[k,,t]) => t==='type'
    ? `<select data-t="${key}" data-i="${i}" data-k="${k}">${TYPES.map(([v,l])=>`<option value="${v}" ${row[k]===v?'selected':''}>${l}</option>`).join('')}</select>`
    : `<input data-t="${key}" data-i="${i}" data-k="${k}" value="${esc(row[k])}" ${t==='num'?'inputmode="decimal"':''}>`;
  tbl.innerHTML = `<tr>${cols.map(c=>`<th>${c[1]}</th>`).join('')}<th></th></tr>` +
    D[key].map((row,i)=>`<tr>${cols.map(c=>`<td>${cell(row,i,c)}</td>`).join('')}<td><button class="x" data-del="${key}" data-i="${i}" title="Remove row">✕</button></td></tr>`).join('');
}
function renderAll(){
  $('bBrand').value = D.brand || ''; $('bStore').value = D.store || ''; $('bMargin').value = D.margin ?? 50;
  ['ch','co','ad'].forEach(renderTable);
}
// typing in a cell updates the data (numbers are parsed when the analysis runs)
document.querySelector('#yourdata').addEventListener('input', e=>{
  const el = e.target;
  if (el.dataset.t){ D[el.dataset.t][+el.dataset.i][el.dataset.k] = el.value; save(); }
  if (el.id==='bBrand') D.brand = el.value; if (el.id==='bStore') D.store = el.value; if (el.id==='bMargin') D.margin = el.value;
  if (['bBrand','bStore','bMargin'].includes(el.id)) save();
});
document.querySelector('#yourdata').addEventListener('change', e=>{ const el=e.target; if (el.tagName==='SELECT' && el.dataset.t){ D[el.dataset.t][+el.dataset.i][el.dataset.k] = el.value; save(); } });
document.querySelector('#yourdata').addEventListener('click', e=>{
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del){ D[b.dataset.del].splice(+b.dataset.i,1); renderTable(b.dataset.del); save(); }
  if (b.dataset.csv){ const box = $('csv-'+b.dataset.csv); box.hidden = !box.hidden; }
  if (b.dataset.apply) applyCsv(b.dataset.apply);
  if (b.dataset.tpl) downloadTemplate(b.dataset.tpl);
});
const blank = key => Object.fromEntries(COLS[key].map(([k,,t])=>[k, t==='type'?'social':'']));
$('addCh').onclick = () => { if (D.ch.length>=MAX_CH){ $('bMsg').textContent = `Up to ${MAX_CH} channels.`; return; } D.ch.push(blank('ch')); renderTable('ch'); save(); };
$('addCo').onclick = () => { D.co.push(blank('co')); renderTable('co'); save(); };
$('addAd').onclick = () => { D.ad.push(blank('ad')); renderTable('ad'); save(); };
$('bExample').onclick = () => { D = JSON.parse(JSON.stringify(EXAMPLE)); renderAll(); save(); run(); };
$('bClear').onclick = () => { D = {brand:'My brand', store:'', margin:50, ch:[blank('ch'),blank('ch')], co:[], ad:[]}; renderAll(); save(); $('bOut').innerHTML=''; $('bSend').disabled = true; $('bMsg').textContent=''; };

// ---------- CSV: paste to fill a table, or download an empty template ----------
function parseCsv(text){
  // small CSV reader: handles quoted values with commas inside ("1,50,000")
  return text.trim().split(/\r?\n/).filter(l=>l.trim()).map(line=>{
    const out = []; let cur = '', q = false;
    for (const ch of line){ if (ch==='"') q = !q; else if ((ch===',' || ch==='\t') && !q){ out.push(cur.trim()); cur=''; } else cur += ch; }
    out.push(cur.trim()); return out;
  });
}
function applyCsv(key){
  const rows = parseCsv(document.querySelector(`#csv-${key} textarea`).value);
  if (!rows.length){ $('bMsg').textContent = 'The CSV box is empty.'; return; }
  const cols = COLS[key];
  // if the first row is a header, map columns by name; otherwise use the template order
  const head = rows[0].map(h=>h.toLowerCase().replace(/[^a-z0-9_]/g,''));
  const isHeader = head.some(h => Object.values(ALIASES).flat().includes(h));
  let order = cols.map((c,i)=>i);
  if (isHeader){ order = cols.map(([k])=>head.findIndex(h=>(ALIASES[k]||[k]).includes(h))); rows.shift(); }
  const typeOf = v => { v = String(v||'').toLowerCase(); return TYPES.find(([t])=>v.startsWith(t.slice(0,4)))?.[0] || (/(google|bing|search)/.test(v)?'search':/(ott|ctv|video|youtube|hotstar)/.test(v)?'video':/(amazon|flipkart|market)/.test(v)?'marketplace':'social'); };
  const parsed = rows.map(r => Object.fromEntries(cols.map(([k,,t],i)=>[k, order[i]>=0 ? (t==='type' ? typeOf(r[order[i]]) : r[order[i]] ?? '') : (t==='type'?'social':'')])));
  if (key==='ch'){
    parsed.forEach(p => { if (!p.type || p.type==='social') p.type = typeOf(p.type && p.type!=='social' ? p.type : p.name); });
    if (parsed.length>MAX_CH) $('bMsg').textContent = `Only the first ${MAX_CH} channels were kept.`;
    D.ch = parsed.slice(0,MAX_CH);
  } else D[key] = parsed;
  renderTable(key); save(); document.querySelector(`#csv-${key}`).hidden = true;
}
function downloadTemplate(key){
  const head = { ch:'name,type,spend,platform_revenue', co:'cohort,channel,spend,platform_revenue', ad:'ad,channel,spend_7d,frequency,ctr_now,ctr_first3days,cpm_change_pct,days_live' }[key];
  const rows = EXAMPLE[key].map(r => COLS[key].map(([k])=>`"${r[k]}"`).join(','));
  const blob = new Blob([head+'\n'+rows.join('\n')+'\n'], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `drishti-${{ch:'channels',co:'cohorts',ad:'ads'}[key]}-template.csv`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

// ---------- Fatigue score for one ad (0 = fresh, 1 = exhausted) ----------
// Inputs: weekly frequency (Meta prospecting declines past ~2.5 [4]), CTR vs the ad's own start, CPM rise.
function fatigue(a){
  const freq = num(a.freq), ctr = num(a.ctr), ctr0 = num(a.ctr0), cpm = num(a.cpm), days = Math.max(1, num(a.days));
  const ctrDrop = ctr0>0 ? Math.max(0, (ctr0-ctr)/ctr0) : 0;
  const score = 0.35*clamp((freq-1.5)/2, 0, 1) + 0.45*clamp(ctrDrop/0.4, 0, 1) + 0.2*clamp(cpm/30, 0, 1);
  // root-cause check: costs up but people still click → auction pressure, not a tired ad
  const auction = cpm>=20 && ctrDrop<0.1;
  const status = auction ? 'Auction' : score>=0.55 ? 'Fatigued' : score>=0.3 ? 'Watch' : 'Fresh';
  const perDay = score/days, left = perDay>0 ? (0.55-score)/perDay : Infinity;
  return { score, ctrDrop, status, daysLeft: status==='Fatigued' ? 0 : left };
}

// ---------- The analysis ----------
let lastParams = null;
function run(){
  const msgs = [];
  const store = num(D.store), margin = clamp(num(D.margin) || 50, 1, 100), breakeven = 100/margin;
  const ch = D.ch.map(c=>({...c, spend:num(c.spend), rev:num(c.rev), name:String(c.name||'').trim()})).filter(c=>c.name && c.spend>0);
  if (!ch.length){ $('bMsg').textContent = 'Add at least one channel with a name and spend.'; $('bOut').innerHTML=''; $('bSend').disabled = true; return; }
  const spend = ch.reduce((s,c)=>s+c.spend,0), claimed = ch.reduce((s,c)=>s+c.rev,0);
  // 1) reconcile: one correction factor k = store revenue ÷ what the platforms claim
  let k = 1;
  if (store>0 && claimed>0) k = store/claimed;
  else msgs.push('No store revenue entered, so platform numbers are used as-is (they are typically inflated, about 2.3× on average [5]).');
  if (k>1.05) msgs.push('Your store shows more revenue than the platforms claim. That usually means tracking is losing conversions: P1 would check the pixel and Conversions API first.');
  if (ch.some(c=>c.rev<=0)) msgs.push('Some channels have no platform revenue, so their ROAS is treated as 0.');
  ch.forEach(c=>{ c.repRoas = c.rev/c.spend; c.trueRoas = c.repRoas*k; c.share = c.spend/spend; c.marg = CURVE*c.trueRoas; });

  // 2) guarded budget shift: equalise marginal ROAS, but never more than ±50% of a channel's budget in one month, min 3%
  let tgt = ch.map(c=>c.share*Math.pow(Math.max(c.trueRoas,0.01), 1/(1-CURVE)));
  const norm = a => { const s=a.reduce((x,y)=>x+y,0); return a.map(x=>x/s); };
  tgt = norm(tgt);
  for (let it=0; it<6; it++) tgt = norm(tgt.map((t,i)=>clamp(t, Math.max(0.03, ch[i].share*0.5), ch[i].share*1.5)));
  ch.forEach((c,i)=>{ c.tgt = tgt[i]; c.delta = tgt[i]-c.share; });
  const revAt = shares => ch.reduce((s,c,i)=> s + c.trueRoas*c.spend*Math.pow(Math.max(shares[i],1e-9)/c.share, CURVE), 0);
  const revNow = revAt(ch.map(c=>c.share)), revShift = revAt(tgt) - revNow;
  const avgMarg = ch.reduce((s,c)=>s+c.marg*c.share,0);
  ch.forEach(c=>{ c.verdict = c.trueRoas < breakeven ? ['Red','Below break-even'] : c.marg > avgMarg*1.1 ? ['Green','Scale'] : c.marg < avgMarg*0.9 ? ['Amber','Trim'] : ['Green','Hold']; });

  // 3) cohorts below break-even (true ROAS) → graduated action; freed money earns the channel's marginal ROAS
  const chByName = Object.fromEntries(ch.map(c=>[c.name.toLowerCase(), c]));
  const co = D.co.map(r=>({...r, spend:num(r.spend), rev:num(r.rev)})).filter(r=>r.cohort && r.spend>0);
  const unknown = new Set();
  co.forEach(r=>{ r.trueRoas = r.rev/r.spend*k; r.ch = chByName[String(r.channel||'').toLowerCase().trim()]; if (!r.ch) unknown.add(r.channel||'(blank)');
    r.losing = r.trueRoas < breakeven; r.gain = r.losing && r.ch ? Math.max(0, r.spend*(r.ch.marg - r.trueRoas)) : 0; });
  const losing = co.filter(r=>r.losing), cohortGain = losing.reduce((s,r)=>s+r.gain,0), freed = losing.reduce((s,r)=>s+r.spend,0);

  // 4) creative fatigue
  const ads = D.ad.filter(a=>a.ad && num(a.spend)>0).map(a=>({...a, spend7:num(a.spend), f:fatigue(a)}));
  ads.forEach(a=>{ if (!chByName[String(a.channel||'').toLowerCase().trim()]) unknown.add(a.channel||'(blank)'); });
  const tiredMonthly = ads.filter(a=>a.f.status==='Fatigued').reduce((s,a)=>s+a.spend7,0)*30/7;
  const adSpendMonthly = ads.reduce((s,a)=>s+a.spend7,0)*30/7;
  if (unknown.size) msgs.push(`These channel names in cohorts/ads don't match the channel table: ${[...unknown].join(', ')}. Their scores still show, but their budget impact is skipped.`);

  // 5) the action plan, each with its autonomy tier (auto = within guardrails, ask = needs a human)
  const plan = [];
  const totalShift = ch.reduce((s,c)=>s+Math.max(0,c.delta),0);
  const days = Math.max(1, Math.ceil(totalShift/0.10));
  ch.filter(c=>Math.abs(c.delta)>=0.01).sort((a,b)=>b.delta-a.delta).forEach(c=>{
    plan.push({tier: totalShift>0.25 ? 'ask':'auto', agent:'P5', txt:`${c.delta>0?'Move':'Take'} ${Math.abs(c.delta*100).toFixed(0)} points of budget ${c.delta>0?'into':'out of'} ${c.name} (${(c.share*100).toFixed(0)}% → ${(c.tgt*100).toFixed(0)}%), in daily steps of at most 10%${days>1?` over ${days} days`:''}.`, imp:''});
  });
  if (plan.length) plan[0].imp = `+${inr(revShift)}/month`;
  losing.forEach(r=>{
    const big = r.ch && r.spend > 0.1*r.ch.spend;
    plan.push({tier: big?'ask':'auto', agent:'P4', txt:`Cohort "${r.cohort}" (${r.channel}) earns ${r.trueRoas.toFixed(2)}× true ROAS, below your ${breakeven.toFixed(2)}× break-even. Graduated action: lower bids → narrow targeting → pause${big?' (the pause step needs approval: over 10% of the channel)':''}.`, imp: r.gain>0 ? `+${inr(r.gain)}/month` : ''});
  });
  ads.forEach(a=>{
    const f = a.f;
    if (f.status==='Fatigued') plan.push({tier: a.spend7<5000 ? 'auto':'ask', agent:'P2 → P3', txt:`"${a.ad}" is fatigued (score ${f.score.toFixed(2)}, CTR −${(f.ctrDrop*100).toFixed(0)}% vs its start). ${a.spend7<5000?'Pause now (under ₹5,000 spent, auto)':'Pause and swap in a fresh variant'}; P3 builds Hindi + English replacements from the top winner.`, imp:`${inr(a.spend7*30/7)}/month off tired creative`});
    else if (f.status==='Watch') plan.push({tier:'auto', agent:'P2 → P3', txt:`"${a.ad}" is starting to tire (score ${f.score.toFixed(2)}). Predicted fatigued in about ${isFinite(f.daysLeft)?Math.max(1,Math.round(f.daysLeft)):'30+'} day(s): brief the replacement now so it is ready in time.`, imp:''});
    else if (f.status==='Auction') plan.push({tier:'auto', agent:'Orchestrator', txt:`"${a.ad}": CPM up ${num(a.cpm)}% but CTR holding. Auction pressure, not fatigue: keep the creative and let P5 rebalance.`, imp:'avoids a wrong fix'});
  });
  if (k<0.85 && store>0){ const top = [...ch].sort((a,b)=>b.spend-a.spend)[0]; plan.push({tier:'auto', agent:'P1', txt:`Platforms over-claim by ${((1/k-1)*100).toFixed(0)}%. Start a 2-week geo holdout on ${top.name} to get its own correction factor (this analysis uses one factor for all channels).`, imp:''}); }

  // 6) headline numbers
  const trueRev = revNow, trueRoas = trueRev/spend, projRoas = (trueRev + revShift + cohortGain)/spend;
  const k3 = (v,l,cls='') => `<div class="card tile"><b class="${cls}">${v}</b><span>${l}</span></div>`;
  let html = `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Drishti's read of ${esc(D.brand||'your brand')}</h3><span class="muted small">${inr(spend)} spend in 30 days · break-even ROAS ${breakeven.toFixed(2)}×</span></div>
    ${msgs.map(m=>`<p class="warn" style="margin:8px 0 0">⚠ ${esc(m)}</p>`).join('')}
    <div class="result-kpis" style="margin-top:14px">
      ${k3((claimed/spend).toFixed(2)+'×','ROAS the platforms claim','grey')}
      ${k3(trueRoas.toFixed(2)+'×','True ROAS (store orders)','teal')}
      ${k3(store>0&&claimed>0 ? ((1/k-1)*100).toFixed(0)+'%' : 'n/a','Platform over-claim')}
      ${k3(inr(tiredMonthly),'Monthly spend on fatigued ads'+(adSpendMonthly?` (${(tiredMonthly/adSpendMonthly*100).toFixed(0)}% of ad spend listed)`:''))}
      ${k3(projRoas.toFixed(2)+'×',`Projected true ROAS (${projRoas>=trueRoas?'+':''}${((projRoas/trueRoas-1)*100).toFixed(0)}%)`,'teal')}
      ${k3(inr(revShift+cohortGain),'Extra revenue a month, same spend','teal')}
    </div></div>`;

  // channel table + split bars
  const COLS_C = ['#60a5fa','#fbbf24','#c084fc','#f472b6','#34d399','#fb923c'];
  const split = key => `<div style="display:flex;height:22px;border-radius:6px;overflow:hidden;margin:4px 0 10px">${ch.map((c,i)=>`<span style="min-width:0;width:${c[key]*100}%;background:${COLS_C[i]};font-size:.72rem;color:#0b0d12;font-weight:600;padding-left:5px;white-space:nowrap;overflow:hidden">${c[key]>0.08?esc(c.name)+' '+Math.round(c[key]*100)+'%':''}</span>`).join('')}</div>`;
  html += `<div class="grid g2" style="margin-top:16px"><div class="card"><h3>1 · True ROAS by channel <span class="muted small">(P1 + P5)</span></h3><div class="scroll-x"><table class="t">
    <tr><th>Channel</th><th>Claimed</th><th>True</th><th>Next ₹1 earns</th><th>Verdict</th></tr>
    ${ch.map(c=>`<tr><td>${esc(c.name)}</td><td class="muted">${c.repRoas.toFixed(2)}×</td><td><b>${c.trueRoas.toFixed(2)}×</b></td><td>₹${c.marg.toFixed(2)}</td><td><span class="pill ${c.verdict[0]}">${c.verdict[1]}</span></td></tr>`).join('')}</table></div>
    <p class="muted tiny">True = claimed × ${k.toFixed(2)} (store revenue ÷ platform claims). "Next ₹1 earns" uses a diminishing-returns curve (revenue ∝ spend<sup>0.65</sup>); in production it comes from MMM (Meridian / Robyn).</p></div>
    <div class="card"><h3>2 · Recommended budget split</h3><div class="small muted">Today</div>${split('share')}<div class="small muted">Drishti's target (moves capped at ±50% of a channel per month, min 3%)</div>${split('tgt')}
    <p class="small">Same total spend, about <b class="teal">${inr(revShift)}</b> more true revenue a month, reached in ${days} daily step(s) of at most 10%.</p></div></div>`;

  // ads + cohorts
  const badge = s => ({Fatigued:'Red', Watch:'Amber', Fresh:'Green', Auction:'Amber'})[s];
  html += `<div class="grid g2" style="margin-top:16px"><div class="card"><h3>3 · Creative fatigue <span class="muted small">(P2)</span></h3>${ads.length ? `<div class="scroll-x"><table class="t">
    <tr><th>Ad</th><th>Score</th><th>Status</th><th>Fatigued in</th></tr>
    ${ads.sort((a,b)=>b.f.score-a.f.score).map(a=>`<tr><td>${esc(a.ad)}<div class="tiny dim">${esc(a.channel)} · ${inr(a.spend7)} in 7d</div></td><td>${a.f.score.toFixed(2)}</td><td><span class="pill ${badge(a.f.status)}">${a.f.status==='Auction'?'Auction pressure':a.f.status}</span></td><td>${a.f.status==='Fatigued'?'now':a.f.status==='Auction'?'n/a':isFinite(a.f.daysLeft)&&a.f.daysLeft<30?'~'+Math.max(1,Math.round(a.f.daysLeft))+' days':'30+ days'}</td></tr>`).join('')}</table></div>
    <p class="muted tiny">Score = 35% frequency (from 1.5 to 3.5) + 45% CTR drop vs the ad's own first 3 days (40% = max) + 20% CPM rise (30% = max). Fatigued ≥ 0.55, Watch ≥ 0.30. A CPM rise with CTR holding counts as auction pressure, not fatigue.</p>` : '<p class="empty">Add ads to score them.</p>'}</div>
    <div class="card"><h3>4 · Cohorts below break-even <span class="muted small">(P4)</span></h3>${co.length ? `<div class="scroll-x"><table class="t">
    <tr><th>Cohort</th><th>True ROAS</th><th></th></tr>
    ${co.sort((a,b)=>a.trueRoas-b.trueRoas).map(r=>`<tr><td>${esc(r.cohort)}<div class="tiny dim">${esc(r.channel)} · ${inr(r.spend)}</div></td><td><b>${r.trueRoas.toFixed(2)}×</b></td><td>${r.losing?'<span class="pill Red">below break-even</span>':'<span class="pill Green">OK</span>'}</td></tr>`).join('')}</table></div>
    <p class="small">${losing.length ? `${inr(freed)} a month sits in losing cohorts. Redeployed, it adds about <b class="teal">${inr(cohortGain)}</b> a month.` : 'No cohort is below break-even.'}</p>` : '<p class="empty">Optional: add cohorts (audience, placement, region) to find hidden losers.</p>'}</div></div>`;

  // action plan
  html += `<div class="card" style="margin-top:16px"><h3>5 · Action plan</h3><p class="muted small" style="margin-top:0"><span class="act-tier auto">AUTO</span> runs by itself inside the guardrails · <span class="act-tier ask">ASK</span> goes to your approval inbox on Slack or WhatsApp · everything is logged and can be rolled back.</p>
    ${plan.length ? `<div class="scroll-x"><table class="t"><tr><th>Tier</th><th>Agent</th><th>Action</th><th>Impact</th></tr>${plan.map(p=>`<tr><td><span class="act-tier ${p.tier}">${p.tier.toUpperCase()}</span></td><td class="muted">${p.agent}</td><td>${esc(p.txt)}</td><td class="teal" style="white-space:nowrap">${p.imp}</td></tr>`).join('')}</table></div>` : '<p class="empty">Nothing to change: your account already looks balanced.</p>'}
    <p class="muted tiny">Estimates use your 30-day numbers and a standard response curve. In production the same steps run on live hourly data and are proven with a 50/50 holdout.</p></div>`;
  $('bOut').innerHTML = html;

  // parameters for the playground: each channel's true ROAS and current budget share
  lastParams = { brand:String(D.brand||'My brand').replace(/\s*\(example\)/i,'')+' · your data', month:spend,
    ch: ch.slice(0,MAX_CH).map(c=>({name:c.name, type:c.type==='marketplace'?'search':(c.type||'social'), roas:clamp(c.trueRoas||0.3, 0.3, 10), share:Math.max(c.share, 0.02)})) };
  const s = lastParams.ch.reduce((a,c)=>a+c.share,0); lastParams.ch.forEach(c=>c.share/=s);
  $('bSend').disabled = false; $('bMsg').textContent = '';
}
$('bRun').onclick = run;
$('bSend').onclick = () => { if (lastParams && window.DrishtiSim) window.DrishtiSim.loadCustom(lastParams); };

renderAll();
run();
})();
