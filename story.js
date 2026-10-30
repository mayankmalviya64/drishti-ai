/* =====================================================================
   story.js — the explanatory parts of the page
   (hero ticker, decision loop, four failures, data pipelines,
    agents, connectors, AHI calculator, theme switch, nav highlight)
   Colours use CSS variables (var(--teal) etc.) so light/dark both work.
   ===================================================================== */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- Theme switch: light by default, 🌙 turns dark on ---------- */
const themeBtn = $('themeBtn');
function paintThemeBtn(){
  const dark = document.documentElement.dataset.theme === 'dark';
  themeBtn.textContent = dark ? '☀️' : '🌙';
  themeBtn.title = themeBtn.ariaLabel = dark ? 'Switch to light mode' : 'Switch to dark mode';
}
themeBtn.onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('drishti-theme', dark ? 'dark' : 'light'); } catch (e) {}
  paintThemeBtn();
};
paintThemeBtn();

/* ---------- Nav: highlight the section you are reading ---------- */
const navLinks = [...document.querySelectorAll('#navLinks a')];
const navObs = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#'+e.target.id));
}), {rootMargin:'-45% 0px -50% 0px'});
navLinks.forEach(a => { const sec = document.querySelector(a.getAttribute('href')); if (sec) navObs.observe(sec); });

/* ---------- Hero ticker: sample lines of what the agents do ---------- */
const TICKER = [
  ['P1','Shopify vs Meta reconciliation: Meta over-claims 46% of sales. Using true ROAS 2.8×, not 4.1×.'],
  ['P2','Meta ad #3 will tire in ~2 days (frequency 2.4, CTR −18% vs its own baseline). Replacement requested.'],
  ['P3','Hindi + Tamil variants built from the top winner. Brand-kit and ASCI checks passed. A/B launched.'],
  ['P4','"Broad match on Display" earns 0.35×. Step 1 of 3: lowering bids.'],
  ['P5','Next ₹1 L earns ₹2.2 L on Google vs ₹1.8 L on Meta. Shifted 4% (under the 10% cap, auto).'],
  ['Orch','CPM spike on Meta checked: competitor auction pressure, not fatigue. Creatives kept.'],
  ['P5','Inventory: Vitamin C serum out of stock in ~30h. Its ads will pause at 0.'],
  ['Orch','IPL final on Sunday. +20% budget boost sent to Shreya for approval.'],
  ['P1','Data Trust gate open. Reconciliation gap 2.5%, data lag 1 hour.']
];
let tickIdx = 0;
function heroTick(){
  const box = $('heroTicker'), [a, txt] = TICKER[tickIdx++ % TICKER.length];
  const d = new Date(), time = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  box.insertAdjacentHTML('afterbegin', `<div class="line"><span class="dim">${time}</span> <b>${a}</b>${esc(txt)}</div>`);
  while (box.children.length > 5) box.lastElementChild.remove();
}
for (let i=0;i<3;i++) heroTick();
setInterval(heroTick, 2600);

/* ---------- 1. The decision loop: Today vs With Drishti ---------- */
// hours = how long the step takes; leak = does the dying ad keep spending during it?
const LOOP = {
  today: [
    {s:'See',        h:24,  leak:true,  how:'4 dashboards pulled into a sheet each morning; data a day old'},
    {s:'Detect',     h:24,  leak:true,  how:'Scanning charts by eye; fatigue caught after the decline'},
    {s:'Diagnose',   h:12,  leak:true,  how:'Guesswork: the ad, a competitor, tracking or the season?'},
    {s:'Create',     h:48,  leak:true,  how:'Brief → designer → translator → review; regional often skipped'},
    {s:'Approve',    h:8,   leak:true,  how:'Founder approves over WhatsApp; big and small in one queue'},
    {s:'Act',        h:12,  leak:true,  how:'Manual pausing inside each platform, in batches'},
    {s:'Reallocate', h:168, leak:false, how:'Weekly budget per platform; no cross-channel view'}
  ],
  drishti: [
    {s:'See',        h:1,    leak:true,  how:'Hourly view on true (order-data) revenue'},
    {s:'Detect',     h:1,    leak:true,  how:'Fatigue score flags it as it starts, or predicts it'},
    {s:'Diagnose',   h:0.25, leak:true,  how:'Agent checks the 4 possible causes before acting'},
    {s:'Act',        h:0.5,  leak:true,  how:'Graduated action at once: the dying ad is throttled'},
    {s:'Create',     h:6,    leak:false, how:'On-brand and regional variants in hours (runs in parallel)'},
    {s:'Approve',    h:0,    leak:false, how:'Small moves run inside guardrails; only big ones reach a human'},
    {s:'Reallocate', h:24,   leak:false, how:'Daily marginal-ROAS shifts across platforms, with caps'}
  ]
};
const PER_HOUR = 40000/24;                                   // one dying ad spending ₹40,000 a day
let loopMode = 'today', loopAnim = null;
const fmtH = h => h===0 ? 'instant' : h<1 ? Math.round(h*60)+' min' : h>=48 ? (h/24).toFixed(h%24?1:0)+' days' : h+' h';
const rupees = n => '₹'+Math.round(n).toLocaleString('en-IN');

function drawLoop(){
  const steps = LOOP[loopMode], cx=260, cy=220, R=165, svg=$('loopSvg');
  const pos = i => { const a = -Math.PI/2 + i*2*Math.PI/steps.length; return [cx+R*Math.cos(a), cy+R*Math.sin(a)]; };
  const leakH = steps.filter(x=>x.leak).reduce((a,x)=>a+x.h,0);
  const colr = loopMode==='today' ? 'var(--red)' : 'var(--teal)';
  let s = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" style="stroke:var(--line)" stroke-width="10"/>
           <circle id="loopArc" cx="${cx}" cy="${cy}" r="${R}" fill="none" style="stroke:${colr}" stroke-width="10" stroke-linecap="round"
             stroke-dasharray="0 ${2*Math.PI*R}" transform="rotate(-90 ${cx} ${cy})" opacity=".35"/>`;
  steps.forEach((st,i)=>{ const [x,y]=pos(i);
    s += `<g id="ln${i}"><circle cx="${x}" cy="${y}" r="38" style="fill:var(--card);stroke:var(--line)" stroke-width="2"/>
      <text x="${x}" y="${y-2}" text-anchor="middle" font-weight="600">${st.s}</text>
      <text x="${x}" y="${y+14}" text-anchor="middle" class="sub">${fmtH(st.h)}</text></g>`; });
  s += `<text x="${cx}" y="${cy-30}" text-anchor="middle" class="sub">${loopMode==='today'?'Today, with people':'With Drishti AI'}</text>
        <text x="${cx}" y="${cy+4}" text-anchor="middle" style="font-size:30px;font-weight:700;fill:${colr}">${fmtH(Math.round(leakH*100)/100)}</text>
        <text x="${cx}" y="${cy+26}" text-anchor="middle" class="sub">from "ad starts dying"</text>
        <text x="${cx}" y="${cy+42}" text-anchor="middle" class="sub">to "ad stops spending"</text>
        <circle id="loopDot" r="9" style="fill:${colr}"/>`;
  svg.innerHTML = s;
  $('loopSteps').innerHTML = steps.map((st,i)=>`<div id="ls${i}"><b>${st.s}</b><span class="muted">${st.how}</span><span style="text-align:right">${fmtH(st.h)}${st.leak?'':' <span class="dim tiny">✓</span>'}</span></div>`).join('');
  runLoop(steps, pos, leakH);
}
function runLoop(steps, pos, leakH){
  cancelAnimationFrame(loopAnim);
  // each step's animation time grows with the square root of its hours, so long steps still feel long
  const dur = steps.map(st => 350 + 260*Math.sqrt(st.h));
  const total = dur.reduce((a,b)=>a+b,0), t0 = performance.now(), R=165, C=2*Math.PI*R;
  const frame = now => {
    const el = Math.min(now - t0, total);
    let acc = 0, i = 0; while (i < steps.length-1 && acc + dur[i] < el){ acc += dur[i]; i++; }
    const f = Math.min(1, (el-acc)/dur[i]);
    const [x0,y0] = pos(i), [x1,y1] = pos((i+1)%steps.length);
    // move the dot along the circle between node i and node i+1
    const a0 = Math.atan2(y0-220, x0-260), a1 = Math.atan2(y1-220, x1-260) + (i===steps.length-1 ? 0 : 0);
    let da = a1 - a0; if (da < 0) da += 2*Math.PI;
    const a = a0 + da*f, dot = $('loopDot');
    if (!dot) return;
    dot.setAttribute('cx', 260 + R*Math.cos(a)); dot.setAttribute('cy', 220 + R*Math.sin(a));
    $('loopArc').setAttribute('stroke-dasharray', `${C*((i+f)/steps.length)} ${C}`);
    // rupees burned so far = hours of "leaking" steps already passed
    let hrs = 0; for (let k=0;k<i;k++) if (steps[k].leak) hrs += steps[k].h;
    if (steps[i].leak) hrs += steps[i].h*f;
    $('loopBurn').textContent = rupees(hrs*PER_HOUR);
    $('loopBurn').style.color = loopMode==='today' ? 'var(--red)' : 'var(--teal)';
    steps.forEach((_,k)=>{ const row=$('ls'+k); if (row) row.classList.toggle('cur', k===i); const n=$('ln'+k); if (n) n.firstElementChild.style.stroke = k<=i ? (loopMode==='today'?'var(--red)':'var(--teal)') : 'var(--line)'; });
    if (el < total) loopAnim = requestAnimationFrame(frame);
    else $('loopNote').textContent = loopMode==='today'
      ? `≈ ${rupees(leakH*PER_HOUR)} burned on one ad, and the budget itself only moves once a week. Multiply by every ad in the account.`
      : `≈ ${rupees(leakH*PER_HOUR)} burned: the ad is throttled within about 3 hours while its replacement is built in parallel.`;
  };
  loopAnim = requestAnimationFrame(frame);
}
function setLoop(m){ loopMode = m; $('loopToday').classList.toggle('on', m==='today'); $('loopDrishti').classList.toggle('on', m==='drishti');
  $('loopNote').textContent = 'Illustration: one fatigued ad spending ₹40,000 a day. Time is counted until the ad stops spending.'; drawLoop(); }
$('loopToday').onclick = () => setLoop('today');
$('loopDrishti').onclick = () => setLoop('drishti');
$('loopReplay').onclick = () => drawLoop();
// start the loop animation when it scrolls into view
new IntersectionObserver((en, ob)=>{ if (en[0].isIntersecting){ drawLoop(); ob.disconnect(); } }, {threshold:.3}).observe($('loopSvg'));

/* ---------- Four failures: tiny explanatory drawings ---------- */
(function failures(){
  // 1 Latency: auctions tick constantly, people look twice a day
  let s = `<text x="0" y="14">Auctions & results</text>`;
  for (let x=0;x<260;x+=4) s += `<line x1="${x}" x2="${x}" y1="22" y2="${34+((x*7)%9)}" style="stroke:var(--teal)" stroke-width="1.4"/>`;
  s += `<text x="0" y="66">People checking</text><line x1="0" x2="260" y1="88" y2="88" style="stroke:var(--line)" stroke-width="2"/>`;
  [[70,'9 am'],[200,'6 pm']].forEach(([x,l])=>{ s += `<circle cx="${x}" cy="88" r="7" style="fill:var(--red)"/><text x="${x-12}" y="106">${l}</text>`; });
  $('failLatency').innerHTML = s;
  // 2 Fragmentation: three walled gardens, nobody above
  s = `<rect x="4" y="6" width="252" height="26" rx="6" fill="none" style="stroke:var(--red)" stroke-dasharray="4 4"/><text x="70" y="23" style="fill:var(--red)">Nobody optimises across ?</text>`;
  ['Meta','Google','OTT'].forEach((n,i)=>{ const x = 6 + i*86;
    s += `<rect x="${x}" y="44" width="78" height="60" rx="8" style="fill:var(--card2);stroke:var(--line)"/><text x="${x+39}" y="68" text-anchor="middle" style="fill:var(--text);font-weight:600">${n}</text><text x="${x+39}" y="86" text-anchor="middle">its own AI</text><text x="${x+39}" y="99" text-anchor="middle">"spend more here"</text>`; });
  $('failSilo').innerHTML = s;
  // 3 Creative decay: CTR slides slowly; noticed days later
  const pts = []; for (let x=10;x<=250;x+=6){ const y = x<70 ? 24 : 24 + Math.pow((x-70)/180,1.3)*60; pts.push([x,y]); }
  s = `<polygon points="80,${pts.find(p=>p[0]>=82)[1]} ${pts.filter(p=>p[0]>=82&&p[0]<=208).map(p=>p.join(',')).join(' ')} 208,100 82,100" style="fill:var(--red)" opacity=".15"/>`;
  s += `<polyline fill="none" style="stroke:var(--amber)" stroke-width="2.5" points="${pts.map(p=>p.join(',')).join(' ')}"/>`;
  s += `<line x1="82" x2="82" y1="10" y2="100" style="stroke:var(--teal)" stroke-dasharray="3 3"/><text x="86" y="14" style="fill:var(--teal)">fatigue starts</text>`;
  s += `<line x1="208" x2="208" y1="10" y2="100" style="stroke:var(--red)" stroke-dasharray="3 3"/><text x="150" y="108" style="fill:var(--red)">noticed (days later)</text><text x="112" y="92">money burned</text><text x="0" y="20">CTR</text>`;
  $('failDecay').innerHTML = s;
  // 4 Measurement: platforms claim far more sales than the store recorded (2.3x gap [5])
  const bars = [['Meta',62,'var(--blue)'],['Google',41,'var(--amber)'],['OTT',9,'var(--purple)']]; let x = 10;
  s = `<text x="0" y="12">Sales claimed by platforms (₹112 L)</text>`;
  bars.forEach(([n,v,c])=>{ const w = v*2.1; s += `<rect x="${x}" y="18" width="${w}" height="26" style="fill:${c}"/><text x="${x+4}" y="35" style="fill:#fff;font-weight:600">${n}</text>`; x += w; });
  s += `<text x="0" y="66">Real paid orders in the store (₹49 L)</text><rect x="10" y="72" width="${48.7*2.1}" height="26" style="fill:var(--teal)"/><text x="${14+48.7*2.1}" y="90" style="fill:var(--text);font-weight:600">2.3× gap</text>`;
  $('failMeasure').innerHTML = s;
})();

/* ---------- 2. Data pipelines → recommendations ---------- */
const SOURCES = [
  {k:'meta', icon:'📘', name:'Meta Ads', feeds:'P1, P2, P4, P5', refresh:'Hourly', desc:'Spend, impressions, frequency, CTR, CPM and conversions for every ad.',
   sample:{source:'meta_ads_insights', ad_id:'23851…07', ad_name:'Glow serum – reel 3', date_hour:'2026-10-23T14:00', spend:2140, impressions:61200, frequency:2.4, ctr:0.0091, cpm:34.9, platform_purchases:31, platform_revenue:8780}},
  {k:'google', icon:'🔎', name:'Google Ads', feeds:'P1, P4, P5', refresh:'Hourly', desc:'Search, YouTube and Performance Max: spend, clicks, conversions, search terms.',
   sample:{source:'google_ads', campaign:'Brand + Generic – Search', hour:'14', cost_micros:1310000000, clicks:612, conversions:24.5, conversion_value:5780, top_search_term:'vitamin c serum for oily skin'}},
  {k:'ott', icon:'📺', name:'OTT console', feeds:'P1, P5', refresh:'Daily', desc:'Impressions, completion rate and spend from the streaming ad console (e.g. JioHotstar).',
   sample:{source:'ott_daily_export', date:'2026-10-22', line_item:'CTV – Hindi GEC – prime time', impressions:410000, completion_rate:0.82, spend:51000}},
  {k:'shopify', icon:'🛒', name:'Shopify orders', feeds:'P1 (ground truth)', refresh:'Near real-time', desc:'Orders, revenue, new vs repeat customers, and the UTM source of each order.',
   sample:{source:'shopify_webhook:orders/create', order_id:'#48213', total:899, customer:'new', utm_source:'facebook', utm_campaign:'glow_reels_oct', city:'Nagpur', created_at:'2026-10-23T14:07:12+05:30'}},
  {k:'razorpay', icon:'💳', name:'Razorpay payments', feeds:'P1', refresh:'Near real-time', desc:'Successful payments, refunds, COD vs prepaid. Turns "orders" into money actually kept.',
   sample:{source:'razorpay_webhook:payment.captured', payment_id:'pay_N8…', order_ref:'#48213', amount:89900, method:'upi', cod:false, refund_status:null}},
  {k:'ga4', icon:'📈', name:'GA4', feeds:'P1, P2', refresh:'Hourly', desc:'Sessions, landing-page behaviour and UTM paths: was it the ad or the page?',
   sample:{source:'ga4_data_api', landing_page:'/products/vitamin-c-serum', sessions:1840, engagement_rate:0.41, add_to_cart_rate:0.062, avg_page_load_mobile_s:4.8}},
  {k:'creative', icon:'🎨', name:'Creative library', feeds:'P3', refresh:'On change', desc:'Assets, brand kit (fonts, colours) and approved claims, so new variants stay on-brand.',
   sample:{source:'brand_kit', fonts:['Poppins'], colours:['#F26B3A','#FFF4EC'], approved_claims:['Dermatologically tested','Vitamin C 10%'], banned_words:['cure','guaranteed'], languages:['hi','ta','te','mr','bn']}},
  {k:'inventory', icon:'📦', name:'Inventory', feeds:'P5', refresh:'Hourly', desc:'Stock per product, so ads never pay for clicks on something you cannot ship.',
   sample:{source:'inventory_levels', sku:'VC-SERUM-30', on_hand:212, daily_run_rate:170, hours_to_stockout:30}},
  {k:'events', icon:'🗓', name:'Events, news & Ad Library', feeds:'Orchestrator, P2, P5', refresh:'Daily / on event', desc:'Sales, IPL matches, festivals, elections, breaking news and competitor ads: the "is it us or the world?" inputs.',
   sample:{source:'calendar+news+ad_library', upcoming:[{event:'IPL final',start:'2026-10-26T19:30',affects:['meta','ott']}], news_alert:null, competitor_new_ads_7d:14}}
];
// Each recommendation needs a set of pipelines. Numbers are for the example brand (Glowkart, ₹1.5 Cr/month).
const INSIGHTS = [
  {needs:['meta'], who:'What one platform tells you', txt:'Meta reports a 4.1× ROAS. On its own, every platform grades its own homework.'},
  {needs:['meta','google','ott'], who:'Unified spend view', txt:'Together the platforms claim ₹6.1 Cr of sales from ₹1.5 Cr of spend. Real? Nobody can tell yet: there is no ground truth.'},
  {needs:['meta','google','shopify'], who:'P1 Signal Agent', txt:'True ROAS from store orders: Meta 2.8× (it claims 4.1×), Google 3.4× (it claims 4.4×). Meta over-claims by 46%, so budget is flowing to the wrong place.'},
  {needs:['shopify','razorpay'], who:'P1 Signal Agent', txt:'Cash-on-delivery orders from Tier-3 towns are returned 31% of the time. True revenue per order is ₹220 lower than Shopify shows.'},
  {needs:['meta','shopify','razorpay'], who:'P4 Cohort Optimizer', txt:'"Women 35-44, Tier-3, Reels" looks fine in Meta but earns 0.35× after returns. Graduated cut frees about ₹4 lakh a month.'},
  {needs:['meta','creative'], who:'P2 Fatigue Sentinel → P3 Creative Studio', txt:'Meta ad #3 will tire in about 2 days (frequency 2.4, CTR −18% vs its own start). Hindi and Tamil variants are briefed from the top winner now.'},
  {needs:['meta','ga4'], who:'P2 root-cause check', txt:'CTR is healthy but conversion fell 22%: the serum page takes 4.8 s on mobile. Fix the page, not the ad.'},
  {needs:['google','inventory'], who:'P5 Budget Allocator', txt:'Vitamin C serum runs out in about 30 hours. Its search ads pause at zero stock and about ₹38,000 a day moves to the next bestseller.'},
  {needs:['meta','events'], who:'Orchestrator shock filter', txt:'Meta CPM is up 30% this week while CTR is flat: a competitor launched 14 new ads. Auction pressure, not fatigue, so the creatives stay.'},
  {needs:['meta','ott','events'], who:'P5 moment trigger', txt:'IPL final on Sunday: pre-approve a 6-hour shift of 12% budget toward OTT and Meta, plus an optional +20% boost.'},
  {needs:['meta','google','ott','shopify'], who:'P5 Budget Allocator', txt:'On true revenue, the next ₹1 lakh earns ₹2.2 L on Google, ₹1.8 L on Meta and ₹1.2 L on OTT. Shift 4% a day toward Google, inside the caps.'},
  {needs:SOURCES.map(s=>s.k), who:'Strategic recommendation', txt:'Run on true ROAS, the brand can reach 3.75× (+25%) on the same ₹1.5 Cr, about ₹1.1 Cr more revenue a month, and halve the spend on tired ads. Every move is logged and reversible.'}
];
const connected = new Set(['meta']);                 // start with just one platform connected
function renderPipes(){
  $('srcChips').innerHTML = SOURCES.map(s=>`<button data-k="${s.k}" class="${connected.has(s.k)?'on':''}">${s.icon} ${s.name}${connected.has(s.k)?' ✓':''}</button>`).join('');
  // the flow diagram
  const H = 430, hub = {x:420,y:150,w:190,h:130}, ag = {x:660,y:110,w:150,h:210}, out = {x:850,y:150,w:140,h:130};
  const unlocked = INSIGHTS.filter(i=>i.needs.every(n=>connected.has(n))).length;
  let s = '';
  SOURCES.forEach((src,i)=>{
    const y = 22 + i*45, on = connected.has(src.k);
    const path = `M200 ${y+17} C 310 ${y+17}, 320 ${hub.y+hub.h/2}, ${hub.x} ${hub.y+hub.h/2}`;
    s += `<path d="${path}" fill="none" class="${on?'flow':''}" style="stroke:${on?'var(--teal)':'var(--line)'}" stroke-width="${on?2.5:1.5}" ${on?'':'stroke-dasharray="2 6"'}/>`;
    s += `<g data-k="${src.k}" style="cursor:pointer"><rect x="10" y="${y}" width="190" height="34" rx="9" style="fill:${on?'var(--teal-d)':'var(--card2)'};stroke:${on?'var(--teal)':'var(--line)'}"/>
          <text x="22" y="${y+22}" style="font-size:15px;fill:var(--text)">${src.icon} ${src.name}</text></g>`;
  });
  const pathOn = connected.size>0;
  const link = (x1,x2) => `<path d="M${x1} 215 L${x2} 215" fill="none" class="${pathOn?'flow':''}" style="stroke:${pathOn?'var(--teal)':'var(--line)'}" stroke-width="3"/>`;
  s += link(hub.x+hub.w, ag.x) + link(ag.x+ag.w, out.x);
  s += `<rect x="${hub.x}" y="${hub.y}" width="${hub.w}" height="${hub.h}" rx="14" style="fill:var(--card);stroke:var(--teal)" stroke-width="2"/>
        <text x="${hub.x+hub.w/2}" y="${hub.y+30}" text-anchor="middle" style="font-size:16px;font-weight:700;fill:var(--text)">Unified data layer</text>
        <text x="${hub.x+hub.w/2}" y="${hub.y+54}" text-anchor="middle" style="font-size:13px;fill:var(--muted)">one table, refreshed hourly</text>
        <text x="${hub.x+hub.w/2}" y="${hub.y+76}" text-anchor="middle" style="font-size:13px;fill:var(--muted)">true ROAS = store orders</text>
        <rect x="${hub.x+18}" y="${hub.y+90}" width="${hub.w-36}" height="26" rx="13" style="fill:${connected.has('shopify')?'var(--green-bg)':'var(--amber-bg)'}"/>
        <text x="${hub.x+hub.w/2}" y="${hub.y+108}" text-anchor="middle" style="font-size:12px;font-weight:600;fill:${connected.has('shopify')?'var(--green)':'var(--amber)'}">P1 gate: ${connected.has('shopify')?'ground truth ✓':'no ground truth'}</text>`;
  s += `<rect x="${ag.x}" y="${ag.y}" width="${ag.w}" height="${ag.h}" rx="14" style="fill:var(--orch-bg);stroke:var(--orch-line)" stroke-width="2"/>
        <text x="${ag.x+ag.w/2}" y="${ag.y+28}" text-anchor="middle" style="font-size:16px;font-weight:700;fill:var(--text)">Drishti agents</text>`;
  ['Orchestrator','P2 Fatigue','P3 Creative','P4 Cohorts','P5 Budget'].forEach((n,i)=>{
    s += `<text x="${ag.x+ag.w/2}" y="${ag.y+60+i*30}" text-anchor="middle" style="font-size:14px;fill:var(--muted)">${n}</text>`; });
  s += `<rect x="${out.x}" y="${out.y}" width="${out.w}" height="${out.h}" rx="14" style="fill:var(--card);stroke:var(--line)" stroke-width="2"/>
        <text x="${out.x+out.w/2}" y="${out.y+44}" text-anchor="middle" style="font-size:38px;font-weight:700;fill:var(--teal)">${unlocked}</text>
        <text x="${out.x+out.w/2}" y="${out.y+72}" text-anchor="middle" style="font-size:13px;fill:var(--muted)">recommendations</text>
        <text x="${out.x+out.w/2}" y="${out.y+92}" text-anchor="middle" style="font-size:13px;fill:var(--muted)">& actions unlocked</text>
        <text x="${out.x+out.w/2}" y="${out.y+112}" text-anchor="middle" style="font-size:12px;fill:var(--dim)">of ${INSIGHTS.length}</text>`;
  $('pipeSvg').innerHTML = s;
  // recommendations list: unlocked first, then locked with what they still need
  const name = k => SOURCES.find(s=>s.k===k).name;
  const sorted = [...INSIGHTS].sort((a,b)=> (b.needs.every(n=>connected.has(n))) - (a.needs.every(n=>connected.has(n))));
  $('insights').innerHTML = sorted.map(i=>{
    const ok = i.needs.every(n=>connected.has(n)), miss = i.needs.filter(n=>!connected.has(n));
    return `<div class="insight ${ok?'unlocked':'locked'}"><div class="who">${ok?'✓ ':'🔒 '}${i.who}</div>
      <div class="small">${ok ? i.txt : 'Connect <b>'+miss.map(name).join(' + ')+'</b> to unlock this.'}</div></div>`;
  }).join('');
  $('coverMeter').style.width = (100*connected.size/SOURCES.length)+'%';
  $('unlockCount').textContent = `${connected.size} of ${SOURCES.length} pipelines connected · example brand: Glowkart, ₹1.5 Cr/month`;
}
function showPayload(k){
  const s = SOURCES.find(x=>x.k===k);
  $('payloadName').textContent = s.icon+' '+s.name;
  $('payloadDesc').innerHTML = `${esc(s.desc)}<br><span class="tag">feeds ${s.feeds}</span><span class="tag">${s.refresh}</span>`;
  $('payload').textContent = JSON.stringify(s.sample, null, 2);
}
function toggleSrc(k){ connected.has(k) ? connected.delete(k) : connected.add(k); renderPipes(); showPayload(k); }
$('srcChips').addEventListener('click', e=>{ const b=e.target.closest('button'); if (b) toggleSrc(b.dataset.k); });
$('pipeSvg').addEventListener('click', e=>{ const g=e.target.closest('g[data-k]'); if (g) toggleSrc(g.dataset.k); });
$('srcAll').onclick = () => { SOURCES.forEach(s=>connected.add(s.k)); renderPipes(); };
$('srcNone').onclick = () => { connected.clear(); renderPipes(); };
renderPipes(); showPayload('meta');

/* ---------- 3. Agents ---------- */
const AGENT_INFO = {
  P1:{ name:'P1 Signal Agent (Data Trust gate)', owns:'"Our scoreboard is late and lies"', goal:'Foundation for both goals',
       f:[['Unified data layer (platforms + Shopify, GA4 and payment orders, hourly)','Data freshness lag (hours)'],['Incrementality tests (holdout / geo tests that correct reported ROAS)','% of spend with a calibration under 90 days old'],['Tracking monitor (broken pixels, Conversions API gaps, duplicates)','Gap between platform conversions and real orders']],
       counter:'Cost of holdout tests as % of spend', hand:'Cleans the data for every other agent. If its score drops below 60, all automatic actions pause.'},
  P2:{ name:'P2 Fatigue Sentinel', owns:'"We notice the ad died after it already cost us"', goal:'Fatigue waste −50%',
       f:[['Fatigue score (frequency, CTR vs the ad\'s own baseline, CPM rise, hook rate)','Detection lag (hours)'],['Predictive fatigue ("days until fatigue")','% of spend on fatigued creatives (case goal −50%)'],['Root-cause check (fatigue vs competitor, tracking or season)','Alert precision']],
       counter:'Still-winning ads retired early', hand:'Spots a dying ad → asks P3 for a replacement.'},
  P3:{ name:'P3 Creative Studio', owns:'"Even when we notice, the new ad takes days"', goal:'Fatigue waste −50%',
       f:[['Modular variants (swap hook, headline, CTA or background inside the brand kit)','Refresh time, from flag to new ad live'],['Regional versions (Hindi, Tamil, Telugu, Marathi, Bengali, native-speaker review)','% of regional spend on local-language creative'],['Brief from winners + auto A/B launch after brand and ASCI checks','New-ad win rate vs the ad it replaced']],
       counter:'Ad rejection rate', hand:'Its new ads flow to P5, which funds the winners.'},
  P4:{ name:'P4 Cohort Optimizer', owns:'"Money leaks quietly inside good averages"', goal:'ROAS +25%',
       f:[['Cohort diagnosis (audience, placement, region, device, time of day)','% of spend in below-break-even cohorts'],['Graduated action (lower bid → narrow targeting → pause, respecting the learning phase)','Time to action (hours)'],['Winner scaling','% of freed budget redeployed within 24h']],
       counter:'Learning-phase resets caused by our changes', hand:'Frees budget from losing cohorts → hands it to P5.'},
  P5:{ name:'P5 Budget Allocator', owns:'"Money can\'t move to where it earns most"', goal:'ROAS +25%',
       f:[['Marginal allocation across platforms on diminishing-returns curves','True blended ROAS (case goal +25%)'],['Intraday pacing with moment triggers (IPL, Diwali sales, stockouts)','Reallocation lag (hours)'],['Response curves refreshed weekly with open-source MMM (Meridian / Robyn)','Forecast accuracy (MAPE)']],
       counter:'Daily spend volatility and minimum-floor breaches', hand:'Moves each next rupee to the best marginal return, across platforms.'},
  Orch:{ name:'Orchestrator', owns:'Keeps the whole team pulling in one direction', goal:'Both goals',
       f:[['External-shock filter: five checks for "is it us or the world?"','Market shocks tagged correctly'],['Agent Health Index and severity ladder','AHI 0–100 with Green / Amber / Red levels'],['Escalation: self-fix → diagnose → human → kill switch','Time to human on Red 2 (under 1 hour)']],
       counter:'False escalations to people', hand:'Coordinates every agent and decides when a human must step in.'}
};
let curAgent = 'P2';
function renderAgents(){
  $('agentCards').innerHTML = ['P2','P3','P4','P5'].map(k=>{ const a = AGENT_INFO[k];
    return `<button class="agent-card ${k===curAgent?'on':''}" data-a="${k}"><b>${a.name}</b><span class="muted small">${a.owns}</span><div class="kpi">Goal: ${a.goal}</div><div class="arrow">↳ ${a.hand}</div></button>`; }).join('');
  const a = AGENT_INFO[curAgent];
  $('agentDetail').innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">${a.name}</h3><span class="pill Green">${a.goal}</span></div>
    <p class="muted small" style="margin:4px 0 10px">Owns: ${a.owns}. ${a.hand}</p>
    <div class="scroll-x"><table class="t"><tr><th>What it does</th><th>How it is measured</th></tr>${a.f.map(x=>`<tr><td>${x[0]}</td><td class="teal">${x[1]}</td></tr>`).join('')}
    <tr><td class="muted">Counter-metric (stops it gaming its own KPI)</td><td style="color:var(--amber)">${a.counter}</td></tr></table></div>`;
}
$('agentCards').addEventListener('click', e=>{ const b=e.target.closest('[data-a]'); if (b){ curAgent=b.dataset.a; renderAgents(); } });
document.querySelector('.arch .orch').onclick = () => { curAgent='Orch'; renderAgents(); };
document.querySelector('.arch .gate').onclick = () => { curAgent='P1'; renderAgents(); };
document.querySelectorAll('.arch .orch, .arch .gate').forEach(el=>el.style.cursor='pointer');
renderAgents();

/* ---------- 6. Connectors ---------- */
const CONNECTORS = [
  ['Meta Marketing API','Ad platform','Spend, impressions, frequency, CTR, CPM, conversions per ad; writes back budgets, bids and pauses','OAuth (system-user token, ads_read → ads_management)','Hourly','P1, P2, P4, P5','Native API, Airbyte or Fivetran'],
  ['Google Ads API','Ad platform','Search, YouTube and Performance Max: spend, clicks, conversions, search terms; writes back budgets and bids','OAuth 2.0 + developer token','Hourly','P1, P4, P5','Native API, Airbyte or Fivetran'],
  ['OTT ad console (e.g. JioHotstar)','Ad platform','Impressions, completion rate, spend per line item','Scheduled report export (CSV / email / cloud bucket), or partner API where offered','Daily','P1, P5','File loader'],
  ['Amazon Ads API (optional)','Ad platform','Sponsored Products spend, sales and ACoS for marketplace sellers','OAuth (Login with Amazon)','Hourly','P1, P5','Native API or Airbyte'],
  ['Shopify Admin API','Store (ground truth)','Orders, revenue, new vs repeat customers, UTM source; inventory levels','Custom app access token; orders/create webhooks','Near real-time','P1, P5','Webhooks + GraphQL'],
  ['WooCommerce / custom store','Store (ground truth)','Same order data for non-Shopify stores','REST API keys, or a read-only database replica','Near real-time','P1','REST or database connector'],
  ['Razorpay (payment gateway)','Payments','Payments captured, refunds, COD vs prepaid, so revenue means money kept','API key + payment.captured / refund webhooks','Near real-time','P1','Webhooks'],
  ['GA4 (Data API + BigQuery export)','Web analytics','Sessions, landing-page behaviour, UTM paths, page speed','Service account','Hourly (intraday export)','P1, P2','BigQuery export'],
  ['Creative library + brand kit','Creative','Assets, fonts, colours, approved claims and banned words (Google Drive, Figma or a DAM)','OAuth','On change','P3','Drive / Figma API'],
  ['Inventory / ERP','Operations','Stock and run-rate per SKU (Shopify, Unicommerce or ERP)','API key','Hourly','P5','API or Airbyte'],
  ['Events calendar + news','Context','Sales, IPL schedule, festivals, elections; breaking-news scan (e.g. RSS, GDELT)','Public feeds / calendar share','Daily, plus on event','Orchestrator, P5','Scheduled fetch'],
  ['Meta Ad Library API + status pages','Context','Competitor ad launches; platform status and API error rates','Access token / public status pages','Daily / every 5 min','Orchestrator, P2','Scheduled fetch'],
  ['Slack + Telegram (outbound)','Action channel','Approval inbox with Approve / Edit / Reject buttons, plain-language briefings, incident pages','Slack app (interactive messages); Telegram Bot API','Instant','Orchestrator','Native apps']
];
$('connGrid').innerHTML = CONNECTORS.map(c=>`<div class="card conn"><div class="top"><h3 style="margin:0">${c[0]}</h3><span class="tag">${c[1]}</span></div>
  <div class="small">${c[2]}</div>
  <div class="kv">Auth: <b>${c[3]}</b></div><div class="kv">Refresh: <b>${c[4]}</b> · Feeds: <b>${c[5]}</b></div><div class="kv">How: <b>${c[6]}</b></div></div>`).join('');

/* ---------- 7. AHI calculator (geometric vs plain average) ---------- */
const AHI_W = {P2:.30, P3:.20, P4:.25, P5:.25};
const ahiVals = {P1:88, P2:81, P3:64, P4:77, P5:74};          // Shreya's brand example from the master document
$('ahiSliders').innerHTML = Object.keys(ahiVals).map(k=>`<div class="slider"><span>${k==='P1'?'P1 (gate)':k} ${k==='P1'?'':'<span class="dim tiny">w '+AHI_W[k]+'</span>'}</span>
  <input type="range" min="0" max="100" value="${ahiVals[k]}" data-k="${k}" aria-label="${k} score"><b id="v${k}">${ahiVals[k]}</b></div>`).join('');
function calcAHI(){
  const g = ahiVals.P1 >= 60 ? 1 : 0;
  const geo = g * Object.entries(AHI_W).reduce((p,[k,w])=>p*Math.pow(Math.max(ahiVals[k],1),w),1);
  const avg = Object.entries(AHI_W).reduce((s,[k,w])=>s+w*ahiVals[k],0);
  const sc = ['P2','P3','P4','P5'].map(k=>ahiVals[k]);
  let lvl = ['Green','Green: every agent 70+'];
  if (!g) lvl = ['Red','Red 3 Halt: Data Trust gate closed'];
  else if (sc.filter(x=>x<50).length>=2) lvl = ['Red','Red 2 Critical'];
  else if (sc.some(x=>x<50)) lvl = ['Red','Red 1 Alert'];
  else if (sc.some(x=>x<70)) lvl = ['Amber','Amber: '+['P2','P3','P4','P5'].filter(k=>ahiVals[k]<70).join(', ')+' self-fixing'];
  $('ahiGeo').textContent = Math.round(geo); $('ahiAvg').textContent = Math.round(avg);
  $('ahiStatus').innerHTML = `<span class="pill ${lvl[0]}">${lvl[1]}</span>`;
  const gap = avg - geo;
  $('ahiExplain').textContent = !g ? 'P1 is below 60: the data cannot be trusted, so the AHI is 0 and every automatic action pauses, however good the other agents look.'
    : gap > 4 ? `The plain average hides ${Math.round(gap)} points of trouble. The geometric mean punishes the weak agent, so it cannot hide behind the strong ones.`
    : 'Try dragging P3 down to 20: the plain average still looks fine (about 66), but the AHI drops to about 59.';
}
$('ahiSliders').addEventListener('input', e=>{ const k=e.target.dataset.k; if (!k) return; ahiVals[k] = +e.target.value; $('v'+k).textContent = e.target.value; calcAHI(); });
calcAHI();
})();
