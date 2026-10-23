/* =====================================================================
   sim.js — the Drishti AI playground (everything runs in the browser)

   Idea: one market, two identical halves of the same brand.
     - "Human team" half (control, C): people check dashboards once a day.
     - "Drishti" half (D): five agents + an Orchestrator act every hour.
   Both halves see the SAME market and the SAME random noise, so any gap
   between them comes only from the agents (a 50/50 holdout test).

   You can inject disruptions (pandemic, IPL, tracking break...) at any
   moment. Drishti detects them, runs its checks, acts on small moves by
   itself and asks you (the approval inbox) before big moves.

   The whole file is wrapped in a function so its variable names do not
   clash with the other scripts on the page.
   ===================================================================== */
(() => {

// ---------- Fixed model settings ----------
const CURVE = 0.65;                                   // diminishing returns: revenue grows like spend^0.65
const POCKET = 0.20, POCKET_ROAS = 0.35;              // 20% of each channel's spend sits in a losing cohort earning 0.35x
const WIN_FACTOR = (1 - POCKET*POCKET_ROAS) / (1 - POCKET); // other cohorts earn a bit more, so the average stays the same
const END_HOUR = 168;                                 // one simulated week
const COL = ['#60a5fa','#fbbf24','#c084fc','#f472b6','#34d399','#fb923c']; // one colour per channel
const COHORT_BY_TYPE = {                              // the "losing cohort" P4 finds, by channel type
  social:'Women 35-44, Tier-3 towns, Reels', search:'Broad match on the Display network', video:'Late-night regional CTV slots'
};
const AGENTS = ['Orch','P1','P2','P3','P4','P5'];

// ---------- Example brands (the "Your data" section can add a custom one) ----------
// Each channel: name, type (social / search / video), true ROAS at its starting budget, starting budget share.
const BRANDS = {
  glow:  { brand:'Glowkart (personal care)', month:15000000, ch:[
           {name:'Meta',type:'social',roas:2.8,share:.55},{name:'Google',type:'search',roas:3.4,share:.35},{name:'OTT',type:'video',roas:1.8,share:.10}] },
  mandi: { brand:'Masala Mandi (spices)', month:6000000, ch:[
           {name:'Meta',type:'social',roas:2.4,share:.45},{name:'Google',type:'search',roas:3.0,share:.35},{name:'OTT',type:'video',roas:2.2,share:.20}] },
  snack: { brand:'Snackwala (snacks, SME)', month:900000, ch:[
           {name:'Meta',type:'social',roas:2.6,share:.70},{name:'Google',type:'search',roas:3.2,share:.30}] }
};

// ---------- Disruptions you can inject (dur = how many hours it lasts) ----------
const EVENTS = {
  pandemic: { icon:'🦠', name:'Pandemic lockdown',  sub:'Demand crashes; people move to streaming and search', dur:96 },
  shock:    { icon:'📰', name:'Market shock',       sub:'Breaking news: demand −35% for a day', dur:24 },
  ipl:      { icon:'🏏', name:'IPL final night',    sub:'Social + OTT demand +50% for 6 hours', dur:6 },
  diwali:   { icon:'🪔', name:'Diwali sale',        sub:'Demand +60% on every channel for 24h', dur:24 },
  tracking: { icon:'🔌', name:'Tracking break',     sub:'Pixel / Conversions API stops reporting', dur:24 },
  fatigue:  { icon:'🎨', name:'Fatigue wave',       sub:'Every ad wears out 2.5× faster', dur:72 },
  stockout: { icon:'📦', name:'Hero SKU stockout',  sub:'Best-seller out of stock for 24h', dur:24 },
  cpm:      { icon:'⚔️', name:'Competitor CPM war', sub:'Social auction prices +40% for 48h', dur:48 },
  outage:   { icon:'🛑', name:'Platform outage',    sub:'The social platform is down for 6h', dur:6 }
};
// One line per disruption for its report card: what made the difference.
const LESSON = {
  pandemic:'The human team waited a day, then cut every channel equally. Drishti tagged the shock within 2 hours, leaned into OTT and search, and refreshed creatives for the new mood.',
  shock:'The shock filter proved it was the market, not the agents, so Drishti protected budget instead of "fixing" ads that were fine.',
  ipl:'The moment lasted 6 hours, less than the gap between two human reviews. Only an hourly agent can catch it.',
  diwali:'Intraday pacing moved money to where the sale demand was during the day, not at the next morning review.',
  tracking:'The human team read broken tracking as weak ads and cut a healthy channel. Drishti closed the Data Trust gate and froze instead.',
  fatigue:'Earlier fatigue flags and faster modular variants shrank both the detection lag and the replacement lag.',
  stockout:'The inventory feed let Drishti pause ads for the missing product within an hour. The human team noticed at the next review.',
  cpm:'Drishti saw it was auction pressure, not tired ads, so it moved money instead of replacing creatives that still worked.',
  outage:'The status-page check confirmed a platform outage, and the budget moved to channels that were still live.'
};
// Scripted weeks (the original demo scenarios are kept here)
const PRESETS = {
  free:     { name:'Free play (inject your own)', events:[] },
  fatigue:  { name:'Fatigue wave from hour 30',   events:[{kind:'fatigue', from:30, to:168}] },
  tracking: { name:'Tracking break at hour 48',   events:[{kind:'tracking',from:48, to:72}] },
  shock:    { name:'Market shock at hour 48',     events:[{kind:'shock',   from:48, to:72}] },
  ipl:      { name:'IPL final at hour 60',        events:[{kind:'ipl',     from:60, to:66}] },
  pandemic: { name:'Pandemic from hour 40',       events:[{kind:'pandemic',from:40, to:136}] }
};
// How many hours Drishti needs to detect each disruption (calendar events are known in advance, so 0)
const DETECT_LAG = { pandemic:2, shock:2, ipl:0, diwali:0, tracking:99, fatigue:6, stockout:1, cpm:3, outage:1 };

// ---------- Small helpers ----------
const $ = id => document.getElementById(id);
function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const clamp = (x,a,b) => Math.max(a, Math.min(b, x));
const sum = a => a.reduce((x,y)=>x+y,0);
const last = (a,n) => a.slice(-n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function inr(n){ const s = n<0?'−':''; n=Math.abs(n); return s+(n>=1e7 ? '₹'+(n/1e7).toFixed(2)+' Cr' : n>=1e5 ? '₹'+(n/1e5).toFixed(1)+' L' : '₹'+Math.round(n).toLocaleString('en-IN')); }
const hh = t => `D${Math.floor(t/24)+1} ${String(t%24).padStart(2,'0')}:00`;
// Creative freshness: 1.0 while new, then declines. "Fatigued" means freshness below 0.8.
function freshness(ad){ return ad.age < ad.L0 ? 1 : Math.max(0.4, 1 - (ad.age - ad.L0)/160); }

// ---------- Simulation state ----------
let S, P, timer = null, playing = false, brandKey = 'glow', presetKey = 'free', askId = 0;
const BASE_S = () => P.month/720;                     // hourly budget (30-day month)
const N = () => P.ch.length;                          // number of channels
const baseShares = () => P.ch.map(c=>c.share);
// index of the first channel of a type (falls back to channel 0)
const idxOf = type => { const i = P.ch.findIndex(c=>c.type===type); return i<0 ? 0 : i; };

function newHalf(proto){
  // deep copy so both halves start with identical ads
  return { share:baseShares(), l:P.ch.map(()=>POCKET), cap:1, boost:1, spendMult:1,
    stockPaused:false, newCreative:false, pandCreativeAt:null,
    ads: proto.map(ch => ch.map(a => ({...a}))), spendH:[], revH:[], fatH:[], netH:[] };
}
function reset(){
  P = BRANDS[brandKey];
  const r = rng(7);
  const proto = P.ch.map(()=>[0,1,2].map(()=>({age:r()*50, L0:50+r()*40, due:null, flagged:false, below:null, flaggedAt:null})));
  S = { t:0, r:rng(42), C:newHalf(proto), D:newHalf(proto), log:[], hist:[], events:[], queue:[], jobs:[],
        lagSamples:[], refreshSamples:[], diag:P.ch.map(()=>null), lastLogShare:baseShares(),
        storm:false, redState:[false,false,false,false,false,false], killed:false, fastP3:false,
        trackOn:false, gateOpen:true, inbox:[], reports:[], waiting:false, silent:true,
        cum:{revC:0,revD:0,fatC:0,fatD:0,netC:0,netD:0},
        bau:{restoreAt:null, pandReviews:0, cpmLogged:false} };
  PRESETS[presetKey].events.forEach(e => S.events.push({...e, id:Math.random(), seenD:false, reported:false, announced:false}));
  thinkQ = []; $('console').innerHTML = '';
  log('Orch',`Week started for ${P.brand}. Both halves begin with identical budgets and ads.`);
  for (let i=0;i<24;i++) tick(true);                  // pre-run day 1 so the dashboard has numbers straight away
  S.silent = false;
  think('Orch',[['OBSERVE',`Connected: ${P.ch.map(c=>c.name).join(', ')} + store orders. Day 1 baseline learned.`],
                ['LOG','Watching every hour. Inject a disruption above whenever you like.']]);
  render();
}
function log(who, text){ S.log.unshift({t:S.t, who, text}); if (S.log.length>120) S.log.pop(); }

// ---------- The world at a given hour (same for both halves) ----------
function envAt(t){
  const e = { M:1, d:P.ch.map(()=>1), ageSpeed:1, tracking:null, shock:false, pandemic:false, stock:false, cpm:false, outage:-1, kinds:[] };
  for (const ev of S.events){
    if (t < ev.from || t >= ev.to) continue;
    e.kinds.push(ev.kind);
    const h = t - ev.from;
    switch (ev.kind){
      case 'shock':    e.M *= 0.65; e.shock = true; break;
      case 'pandemic': // deep fall for a day, then partial recovery; streaming and search hold up better
        e.M *= h<24 ? 0.55 : 0.55 + 0.15*Math.min(1,(h-24)/48); e.shock = true; e.pandemic = true;
        P.ch.forEach((c,i)=>{ e.d[i] *= c.type==='video' ? 1.3 : c.type==='search' ? 1.1 : 0.9; }); break;
      case 'ipl':      P.ch.forEach((c,i)=>{ if (c.type!=='search') e.d[i] *= 1.5; }); break;
      case 'diwali':   e.M *= 1.6; break;
      case 'tracking': e.tracking = ev; break;
      case 'fatigue':  e.ageSpeed = 2.5; break;
      case 'stockout': e.stock = true; break;
      case 'cpm':      e.d[idxOf('social')] *= 0.72; e.cpm = true; break;   // 40% dearer auctions = ~28% less return per rupee
      case 'outage':   e.outage = idxOf('social'); e.d[e.outage] = 0; break;
    }
  }
  return e;
}

// ---------- Money model for one half in one hour ----------
function econ(H, env, noise, diur){
  let spend=0, rev=0, fat=0;
  for (let c=0;c<N();c++){
    const s0 = BASE_S()*P.ch[c].share;
    let s = BASE_S()*H.share[c]*H.spendMult;
    if (env.outage===c) s = 0;                                             // platform down: nothing is delivered or charged
    const f = sum(H.ads[c].map(freshness))/H.ads[c].length;                // average freshness of the channel's ads
    const fatFrac = H.ads[c].filter(a=>freshness(a)<0.8).length/H.ads[c].length;
    const cohort = (1-H.l[c])*WIN_FACTOR + H.l[c]*POCKET_ROAS;              // fewer losing cohorts = more revenue
    let r = P.ch[c].roas*s0*Math.pow(s/s0, CURVE) * env.d[c]*env.M*noise[c]*diur * f * cohort;
    if (env.stock && !H.stockPaused) r *= 0.65;                            // 35% of spend promotes a product nobody can buy
    if (env.pandemic && !H.newCreative) r *= 0.85;                         // old "visit us" creatives don't fit a lockdown
    rev += r; spend += s; fat += s*fatFrac;
  }
  H.spendH.push(spend); H.revH.push(rev); H.fatH.push(fat); H.netH.push(rev-spend);
}

// ---------- One simulated hour ----------
function tick(silent){
  const t = S.t, env = envAt(t), {C,D} = S;
  const noise = P.ch.map(()=> 1 + 0.04*(S.r()+S.r()+S.r()-1.5));        // shared random wobble
  const diur = 1 + 0.15*Math.sin((t%24-14)/24*2*Math.PI);                 // evening peak

  // announce scripted events when they start (so the log shows them)
  for (const ev of S.events) if (!ev.announced && t>=ev.from){ ev.announced = true; if (!ev.injected) log('World',`${EVENTS[ev.kind].icon} ${EVENTS[ev.kind].name} begins.`); }

  // 1) finish any ad replacements that are due, then age every ad
  for (const [H,isD] of [[C,false],[D,true]]) for (let c=0;c<N();c++) for (const ad of H.ads[c]){
    if (ad.due!==null && t>=ad.due){
      if (isD){ S.refreshSamples.push(t-ad.flaggedAt); log('P3',`${P.ch[c].name}: new ad live (${t-ad.flaggedAt}h after the fatigue flag). Brand-kit and ASCI checks passed.`); }
      Object.assign(ad,{age:0, L0:50+S.r()*40, due:null, flagged:false, below:null, flaggedAt:null});
    }
    ad.age += env.ageSpeed;
    if (freshness(ad)<0.92 && ad.below===null) ad.below=t;
  }

  // 2) the Data Trust gate (P1): tracking breaks at event start, P1 detects after 2h and fixes it after 8h
  const tr = env.tracking;
  S.trackOn = !!(tr && t < tr.from+8);
  S.gateOpen = !(tr && t>=tr.from+2 && t<tr.from+8);
  if (tr && t===tr.from+2 && !S.killed){
    log('P1','Reconciliation gap: platform conversions are 38% below backend orders. Data Trust gate CLOSED. All automatic actions paused.');
    think('P1',[['OBSERVE','Platform-reported conversions are 38% below Shopify + Razorpay orders for 2 hours.'],
                ['CHECK','Real orders are normal, so sales did not actually fall.'],
                ['DIAGNOSE','Tracking break (pixel / Conversions API), not weak ads.'],
                ['ALERT','Data Trust gate CLOSED: every automatic action paused so nobody optimises on bad numbers.'],
                ['ACT','Re-sending the missed Conversions API events from the order log.']]);
  }
  if (tr && t===tr.from+8 && !S.killed){
    log('P1','Conversions API events re-sent and reconciled (gap back to 2.5%). Gate OPEN, agents resume.');
    think('P1',[['ACT','Events reconciled, gap back to 2.5%. Data Trust gate OPEN, agents resume.']]);
  }

  // 3) the human team (control half)
  humanTeam(env, t);

  // 4) Drishti agents (only when the gate is open and the kill switch is off)
  if (!S.killed && S.gateOpen) drishtiAgents(env, t);

  // 5) compute money for both halves
  C.spendMult = C.cap; D.spendMult = D.cap*D.boost;
  econ(C, env, noise, diur); econ(D, env, noise, diur);
  const cu = S.cum;
  cu.revC+=C.revH.at(-1); cu.revD+=D.revH.at(-1); cu.fatC+=C.fatH.at(-1); cu.fatD+=D.fatH.at(-1); cu.netC+=C.netH.at(-1); cu.netD+=D.netH.at(-1);
  const w=24, rc=sum(last(C.revH,w))/Math.max(1,sum(last(C.spendH,w))), rd=sum(last(D.revH,w))/Math.max(1,sum(last(D.spendH,w)));
  S.hist.push({t, rc, rd});

  // 6) approvals nobody answered in time fall back to their safe default
  for (const it of [...S.inbox]) if (t >= it.expires){ S.inbox = S.inbox.filter(x=>x!==it); it.fallback('expired'); }

  S.t++;
  makeReports(false);
  if (!silent) render();
}

// ---------- The human team: one dashboard review a day at 10:00 ----------
function humanTeam(env, t){
  const C = S.C, b = S.bau, soc = idxOf('social');
  if (!env.stock) C.stockPaused = false;
  if (b.restoreAt!==null && t>=b.restoreAt){ C.share = baseShares(); b.restoreAt = null; log('BAU',`${P.ch[soc].name} budget restored after two days.`); }
  if (C.pandCreativeAt!==null && t>=C.pandCreativeAt){ C.newCreative = true; C.pandCreativeAt = null; log('BAU','New "safe at home" ads finally live.'); }
  if (!(t>0 && t%24===10)) return;                                        // the rest only happens at the daily review

  let n=0; for (let c=0;c<N();c++) for (const ad of C.ads[c]) if (freshness(ad)<0.8 && ad.due===null){ ad.due=t+48; n++; }
  if (n) log('BAU',`Daily review: ${n} dead ad(s) spotted. Designer briefed, new ads ready in about 48 hours.`);
  if (env.tracking && b.restoreAt===null){
    // misreads the tracking bug as weak ads: cuts the social channel by 30% and moves it elsewhere
    const cut = C.share[soc]*0.3, others = sum(C.share)-C.share[soc];
    C.share = C.share.map((s,i)=> i===soc ? s-cut : s + (others>0 ? cut*s/others : 0)); b.restoreAt = t+48;
    log('BAU',`${P.ch[soc].name} looks weak in the dashboard, so budget is cut by 30%. (It was a tracking bug, not weak ads.)`);
  }
  if (env.stock && !C.stockPaused){ C.stockPaused = true; log('BAU','Daily review: the best-seller is out of stock. Its ads are paused (they ran unchecked until now).'); }
  if (env.pandemic){
    b.pandReviews++;
    if (b.pandReviews===1) log('BAU','Sales are down sharply. The team decides to "wait and see" before changing anything.');
    if (b.pandReviews===2){ C.cap = 0.6; C.pandCreativeAt = t+72; log('BAU','Panic cut: every channel slashed 40%, with no reweighting. Designer briefed for "safe at home" ads (about 3 days).'); }
  } else if (b.pandReviews>0){ b.pandReviews = 0; C.cap = 1; log('BAU','Lockdown eased. Budgets restored.'); }
  if (env.cpm && !b.cpmLogged){ b.cpmLogged = true; log('BAU',`${P.ch[soc].name} costs are up, so the team assumes the ads are tired and briefs the designer. Budget stays where it is.`); }
}

// ---------- Drishti: the Orchestrator and five agents ----------
function drishtiAgents(env, t){
  orchestrator(env, t);
  creativeAgents(env, t);
  cohortAgent(t);
  budgetAgent(env, t);
  routineThoughts(env, t);
}

// The Orchestrator detects disruptions (after a detection lag) and responds
function orchestrator(env, t){
  const D = S.D;
  for (const ev of S.events){
    if (ev.seenD || t < ev.from) continue;
    if (t >= ev.to){ ev.seenD = true; continue; }                          // it ended while Drishti was frozen
    if (t < ev.from + DETECT_LAG[ev.kind]) continue;
    ev.seenD = true;
    if (RESPOND[ev.kind]) RESPOND[ev.kind](ev, env, t);
  }
  // switch modes off once the cause is gone
  if (!env.shock && S.storm){ S.storm = false; D.cap = 1; log('Orch','Market recovered. Storm Mode off, normal caps restored.'); think('Orch',[['OBSERVE','Demand back within the normal band for 2 checks.'],['ACT','Storm Mode OFF. Normal caps restored.']]); }
  if (D.boost!==1 && !env.kinds.some(k=>k==='ipl'||k==='diwali')){ D.boost = 1; log('P5','Moment over: budget boost returned to plan.'); }
  if (!env.stock && D.stockPaused){ D.stockPaused = false; log('P5','Best-seller back in stock: its ads resume automatically.'); think('P5',[['ACT','Inventory > 0 again: hero SKU ads resumed.']]); }
  if (S.fastP3 && env.ageSpeed===1){ S.fastP3 = false; log('Orch','Fatigue wave over. P3 back to its normal 10-hour variants.'); }
}

// What the Orchestrator does for each disruption: think out loud, act on small moves, ask for big ones
const RESPOND = {
  shock(ev, env){
    const pct = Math.round((1-env.M)*100);
    think('Orch',[['OBSERVE',`True revenue down ${pct}% in 2 hours on every channel at once.`],
      ['CHECK','1/5 Control group: the untouched holdout fell by the same amount ✓'],
      ['CHECK','2/5 Breadth: all channels and agents dipped together ✓'],
      ['CHECK','3/5 Auction: CPMs moved account-wide, not on one ad ✓'],
      ['CHECK','4/5 Status: platform status pages and API error rates are normal ✓'],
      ['CHECK','5/5 News scan: a breaking national news event matches the timing ✓'],
      ['DIAGNOSE','Verdict: MARKET SHOCK, not an agent failure. Agents are not penalised (scores are lift vs control).'],
      ['DECIDE','Protect budget instead of chasing volume: cap spend at 85%, freeze scale-ups.'],
      ['ACT','Storm Mode ON. Plain-language briefing sent to Shreya on Slack.']]);
    S.storm = true; S.D.cap = Math.min(S.D.cap, 0.85);
    log('Orch','MARKET SHOCK tagged (5 of 5 checks). Storm Mode on: spend capped at 85%, no scale-ups.');
  },
  pandemic(ev, env, t){
    const D = S.D, vid = P.ch.filter(c=>c.type!=='social').map(c=>c.name).join(' and ') || 'other channels';
    think('Orch',[['OBSERVE',`Demand down ~${Math.round((1-env.M)*100)}% everywhere; ${vid} holding up better than social.`],
      ['CHECK','1/5 Control group fell by the same amount ✓'],
      ['CHECK','2/5 Breadth: every channel hit, but unevenly ✓'],
      ['CHECK','3/5 Auction: CPMs falling as advertisers pull out ✓'],
      ['CHECK','4/5 Platform status normal ✓'],
      ['CHECK','5/5 News: national lockdown announced ✓'],
      ['DIAGNOSE','MARKET SHOCK with a lasting change in behaviour, not a one-day dip. "Visit our store" creatives no longer fit.'],
      ['ACT','Storm Mode ON: spend capped at 85% while waiting for Shreya.'],
      ['DECIDE',`Pandemic playbook ready: total spend to 70%, P5 leans into ${vid}, P3 rushes "safe home delivery" creatives.`],
      ['ASK','The playbook changes the total budget by more than 10%, so it needs approval. Safe default in 3h: stay in Storm Mode.']]);
    S.storm = true; D.cap = Math.min(D.cap, 0.85);
    log('Orch','MARKET SHOCK + behaviour shift (lockdown). Storm Mode on at 85%. Pandemic playbook sent for approval.');
    ask({ title:'🦠 Run the pandemic playbook?', agent:'Orchestrator',
      detail:`Cut total spend to 70% of plan (saves about ${inr(BASE_S()*24*0.15)}/day of low-return spend), lean into ${vid}, and rush "safe home delivery" creatives in Hindi, English and Marathi (live in 8h instead of 16h).`,
      expires:t+3,
      approve(){ D.cap = 0.7; D.pandCreativeAt = S.t+8; log('Orch','Pandemic playbook running: spend at 70%, creatives rushed.');
        think('Orch',[['ACT','Playbook running: total spend capped at 70%.'],['ACT','P3 briefed: 6 "safe home delivery" variants, ready in 8h.']]); },
      fallback(why){ D.pandCreativeAt = S.t+16; log('Orch',`${why==='expired'?'No reply in 3h':'Shreya rejected the playbook'}: safe default kept (Storm Mode at 85%). P3 builds new creatives on its normal queue (16h).`);
        think('Orch',[['LOG','Playbook not approved. Staying in Storm Mode at 85%; P3 refresh on the normal queue.']]); } });
  },
  ipl(ev, env, t){
    const names = P.ch.filter(c=>c.type!=='search').map(c=>c.name).join(' + ');
    think('P5',[['OBSERVE','Calendar trigger: IPL final starts now (pre-loaded event).'],
      ['CHECK',`${names} conversion rates up ~50% in the first minutes; search flat.`],
      ['DECIDE',`Marginal ROAS on ${names} now beats search: shift budget toward them, 4% per hour (inside the 10% cap).`],
      ['ACT','Auto-shift started.'],
      ['ASK','A +20% total budget boost for the 6-hour window would capture more of the spike. That is over the cap, so asking Shreya (expires in 1h).']]);
    ask({ title:'🏏 Boost total budget +20% for the IPL final?', agent:'P5 Budget Allocator',
      detail:`About ${inr(BASE_S()*0.2*6)} extra over 6 hours, pointed at ${names}, where the next rupee earns most tonight.`,
      expires:t+1,
      approve(){ S.D.boost = 1.2; log('P5','IPL boost approved: +20% budget until the final ends.'); think('P5',[['ACT','Budget +20% live for the IPL window.']]); },
      fallback(why){ log('P5',`${why==='expired'?'No reply in time':'Boost rejected'}: no boost. Budget shifts inside the cap continue.`); } });
  },
  diwali(ev, env, t){
    think('P5',[['OBSERVE','Calendar trigger: Diwali sale day starts (pre-loaded event).'],
      ['CHECK','Demand up ~60% across channels; stock levels healthy for the top 10 SKUs ✓'],
      ['DECIDE','Intraday pacing on: follow the demand peaks hour by hour.'],
      ['ASK','Raising the day budget by 30% would capture more sale demand. That is over the cap, so asking Shreya (expires in 2h).']]);
    ask({ title:'🪔 Raise the Diwali-day budget by 30%?', agent:'P5 Budget Allocator',
      detail:`About ${inr(BASE_S()*0.3*24)} extra over 24 hours. At today's demand the marginal ROAS stays above break-even.`,
      expires:t+2,
      approve(){ S.D.boost = 1.3; log('P5','Diwali boost approved: +30% for the sale day.'); think('P5',[['ACT','Budget +30% live for the sale.']]); },
      fallback(why){ log('P5',`${why==='expired'?'No reply in time':'Boost rejected'}: pacing within the normal budget.`); } });
  },
  stockout(){
    think('P5',[['OBSERVE','Inventory feed: hero SKU stock = 0.'],
      ['CHECK','35% of current ad spend points at this product. Those clicks cannot convert.'],
      ['DECIDE','Pause its ads and send that budget to in-stock bestsellers. A safety pause is a small move.'],
      ['ACT','Paused ads for the out-of-stock SKU on every channel; budget redirected.'],
      ['LOG','Will resume automatically when stock returns.']]);
    S.D.stockPaused = true;
    log('P5','Hero SKU out of stock (inventory feed). Its ads paused within the hour; budget moved to in-stock bestsellers.');
  },
  cpm(){
    const soc = P.ch[idxOf('social')].name;
    think('Orch',[['OBSERVE',`${soc} CPM up 40% in 3 hours, but CTR and hook rate are unchanged.`],
      ['CHECK','Control group shows the same CPM rise, so our changes did not cause it ✓'],
      ['CHECK',`Breadth: only ${soc}; other channels normal.`],
      ['CHECK','Ad Library scan: a competitor launched 14 new ads yesterday ✓'],
      ['DIAGNOSE','Auction pressure, NOT creative fatigue. Replacing ads would be the wrong fix.'],
      ['DECIDE','Tell P2 not to retire creatives on this signal; let P5 move money to cheaper channels.'],
      ['ACT','P2 hold set. P5 rebalancing by marginal ROAS.']]);
    log('Orch',`${soc} CPM spike diagnosed as competitor auction pressure, not fatigue. P2 told to hold creatives; P5 rebalancing.`);
  },
  outage(){
    const soc = P.ch[idxOf('social')].name;
    think('Orch',[['OBSERVE',`${soc}: impressions dropped to zero and API calls are failing.`],
      ['CHECK','Status page: platform-wide outage confirmed ✓'],
      ['DIAGNOSE','Platform outage, not our ads or our tracking.'],
      ['DECIDE',`Move ${soc}'s budget to the channels that are still live; leave its creatives untouched.`],
      ['ACT',`P5 rebalancing now; ${soc} pacing paused.`]]);
    log('Orch',`${soc} outage confirmed via status page. Budget moving to live channels.`);
  },
  fatigue(){
    think('P2',[['OBSERVE','Frequency rising and CTR falling 2.5× faster than usual on every channel.'],
      ['CHECK','Not tracking (gate green), not auction (CPMs flat), nothing on the calendar.'],
      ['DIAGNOSE','A genuine creative fatigue wave. P3 will become the bottleneck (Amber).'],
      ['DECIDE','Flag ads earlier and give P3 its self-fix playbook.'],
      ['ACT','P3 switched to fast modular variants (swap hook, headline or CTA): 6h per ad instead of 10h.']]);
    S.fastP3 = true;
    log('Orch','Fatigue wave detected. P3 self-fix: fast modular variants (6h instead of 10h).');
  }
};

// P2 Fatigue Sentinel flags ads early; P3 Creative Studio builds replacements
function creativeAgents(env, t){
  const D = S.D;
  if (D.pandCreativeAt!==null && t>=D.pandCreativeAt){
    D.newCreative = true; D.pandCreativeAt = null;
    log('P3','"Safe home delivery" creatives live in Hindi, English and Marathi.');
    think('P3',[['ACT','"Safe home delivery" variants live after brand-kit and ASCI checks.']]);
  }
  for (let c=0;c<N();c++) D.ads[c].forEach((ad,i)=>{
    if (!ad.flagged && ad.due===null && freshness(ad)<0.92){
      ad.flagged=true; ad.flaggedAt=t; S.lagSamples.push(Math.max(1,t-ad.below));
      S.queue.push({ad,c});
      log('P2',`${P.ch[c].name} ad #${i+1}: fatigue score ${(1-freshness(ad)).toFixed(2)}. Root-cause check ruled out tracking, competitor and season. Replacement requested from P3.`);
      think('P2',[['DIAGNOSE',`${P.ch[c].name} ad #${i+1} fatigue ${(1-freshness(ad)).toFixed(2)}; ruled out tracking, competitor, season.`],['ACT','Replacement requested from P3.']], true);
    }
  });
  // up to 2 jobs at once; the most fatigued ad goes first
  S.jobs = S.jobs.filter(j => j.ad.due!==null);
  while (S.jobs.length<2 && S.queue.length){
    S.queue.sort((a,b)=>freshness(a.ad)-freshness(b.ad));
    const job = S.queue.shift(), hrs = S.fastP3 ? 6 : 10; job.ad.due = t+hrs; S.jobs.push(job);
    log('P3',`Brief built from the top winner: Hindi + English variants for ${P.ch[job.c].name} (ready in ${hrs}h). Queue behind it: ${S.queue.length}.`);
    think('P3',[['ACT',`Brief from top winner → Hindi + English variants for ${P.ch[job.c].name}, ready in ${hrs}h.`]], true);
  }
}

// P4 Cohort Optimizer: graduated action on the losing cohort in each channel
function cohortAgent(t){
  const D = S.D;
  for (let c=0;c<N();c++){
    if (t>=6 && D.l[c]>0.02){
      const name = P.ch[c].name, coh = COHORT_BY_TYPE[P.ch[c].type] || 'Low-intent placements';
      if (S.diag[c]===null){ S.diag[c]=t; log('P4',`${name}: cohort "${coh}" earns 0.35x vs ${WIN_FACTOR.toFixed(2)}x elsewhere (below break-even). Starting graduated action.`);
        think('P4',[['DIAGNOSE',`${name}: "${coh}" earns 0.35x (below break-even).`],['ACT','Step 1 of 3: lowering bids (respects the learning phase).']], true); }
      const age = t - S.diag[c];
      const stage = age<12 ? 1 : age<24 ? 2 : 3;
      D.l[c] *= stage===1 ? 0.97 : stage===2 ? 0.92 : 0.80;
      if (age===12){ log('P4',`${name}: lowering bids was not enough, narrowing targeting.`); think('P4',[['ACT',`${name}: step 2 of 3, narrowing targeting.`]], true); }
      if (age===24){ log('P4',`${name}: pausing the cohort inside guardrails. Freed budget goes to above-target cohorts.`); think('P4',[['ACT',`${name}: step 3 of 3, cohort paused; budget redeployed.`]], true); }
      D.l[c] = Math.max(0.01, D.l[c]);
    }
  }
}

// P5 Budget Allocator: move share toward equal marginal returns, at most 4 points per hour
function budgetAgent(env, t){
  const D = S.D;
  const obs = envAt(Math.max(0,t-1)).d;                                    // what P5 measured over the last hour
  const target = P.ch.map((c,i)=> Math.pow(Math.max(1e-4, c.roas*obs[i]), 1/(1-CURVE)) * c.share);
  const tot = sum(target); let tgt = target.map(x=>Math.max(0.05, x/tot)); const tt = sum(tgt); tgt = tgt.map(x=>x/tt);
  D.share = D.share.map((s,i)=> s + clamp(tgt[i]-s, -0.04, 0.04));
  const ss = sum(D.share); D.share = D.share.map(x=>x/ss);
  const diffs = D.share.map((s,i)=>s-S.lastLogShare[i]);
  if (Math.max(...diffs.map(Math.abs))>=0.04){
    const up = diffs.indexOf(Math.max(...diffs)), down = diffs.indexOf(Math.min(...diffs));
    log('P5',`Shifted ${(Math.abs(diffs[down])*100).toFixed(0)}% of budget from ${P.ch[down].name} to ${P.ch[up].name} (higher marginal ROAS). Under the 10% cap, so it ran automatically.`);
    think('P5',[['DECIDE',`Next rupee earns more on ${P.ch[up].name} than ${P.ch[down].name}.`],['ACT',`Shifted ${(Math.abs(diffs[down])*100).toFixed(0)}% of budget (under the 10% cap, auto).`]], true);
    S.lastLogShare = [...D.share];
  }
}

// A quiet heartbeat every few hours so you can see Drishti watching
function routineThoughts(env, t){
  if (t%5!==0) return;
  const D = S.D, pick = (t/5)%3;
  if (pick===0){
    const m = P.ch.map((c,i)=>{ const s0=c.share, s=Math.max(1e-6,D.share[i]*D.spendMult); return `${c.name} ${(CURVE*c.roas*env.d[i]*env.M*Math.pow(s/s0,CURVE-1)).toFixed(2)}`; });
    think('P5',[['OBSERVE',`Marginal ROAS of the next rupee: ${m.join(' · ')}.`]], true);
  } else if (pick===1){
    const all = D.ads.flat(), watch = all.filter(a=>freshness(a)<1 && freshness(a)>=0.92).length, fat = all.filter(a=>freshness(a)<0.92).length;
    think('P2',[['OBSERVE',`Scanned ${all.length} live ads: ${all.length-watch-fat} fresh, ${watch} on watch, ${fat} flagged.`]], true);
  } else {
    think('P1',[['CHECK',`Data fresh (lag 1h). Platform vs store reconciliation gap ${S.trackOn?'38':'2.5'}%. Gate ${S.gateOpen?'open':'CLOSED'}.`]], true);
  }
}

// ---------- The "Drishti is thinking" console ----------
// Thoughts go into a queue and are printed one line at a time, so you can read them.
let thinkQ = [];
function think(agent, steps, routine=false){
  if (!S || S.silent) return;
  if (!routine) thinkQ = thinkQ.filter(x=>!x.routine);                     // important thoughts jump ahead of routine ones
  else if (thinkQ.length>5) return;                                        // too busy: skip routine chatter
  steps.forEach(([tag,text]) => thinkQ.push({agent, tag, text, routine, t:S.t}));
}
function pump(){
  const box = $('console');
  if (!thinkQ.length){ setBusy(null); return; }
  const x = thinkQ.shift();
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const el = document.createElement('div'); el.className = 'ln';
  el.innerHTML = `<span class="dim">${hh(x.t)}</span> <span class="ag">${x.agent}</span> <span class="st ${x.tag}">${x.tag}</span>${esc(x.text)}`;
  box.appendChild(el);
  while (box.children.length>150) box.removeChild(box.firstChild);
  if (nearBottom) box.scrollTop = box.scrollHeight;
  setBusy(x.agent);
}
function setBusy(agent){ document.querySelectorAll('#agentChips .chip').forEach(c=>c.classList.toggle('busy', c.dataset.a===agent)); }
setInterval(pump, 380);

// ---------- Approval inbox ----------
function ask(item){
  item.id = ++askId; S.inbox.push(item);
  if ($('pauseAsk').checked && playing){ playing = false; S.waiting = true; loop(); }
}
function decide(id, ok){
  const it = S.inbox.find(x=>x.id===id); if (!it) return;
  S.inbox = S.inbox.filter(x=>x!==it);
  log('YOU', `${ok?'Approved':'Rejected'}: ${it.title.replace(/^\S+\s/,'')}`);
  ok ? it.approve() : it.fallback('rejected');
  if (S.waiting && !S.inbox.length){ S.waiting = false; playing = true; loop(); }
  render();
}

// ---------- Disruption reports: how much Drishti protected vs the human team ----------
function makeReports(weekOver){
  for (const ev of S.events){
    if (ev.reported || S.t <= ev.from) continue;
    if (S.t < ev.to && !weekOver) continue;
    ev.reported = true;
    const a = ev.from, b = Math.min(ev.to, S.t);
    const slice = arr => sum(arr.slice(a,b));
    const net = slice(S.D.netH) - slice(S.C.netH), rev = slice(S.D.revH) - slice(S.C.revH);
    const acts = S.log.filter(e=>e.t>=a && e.t<b && !['BAU','YOU','World'].includes(e.who)).length;
    S.reports.unshift({ev, net, rev, acts, a, b});
  }
}

// ---------- Agent Health Index (formulas from the master document) ----------
const score = (x,b,t) => 100*clamp((x-b)/(t-b),0,1);   // S = 100*(x-b)/(t-b), capped 0-100
function health(){
  const {C,D,t} = S, w=24;
  const fatD = sum(last(D.fatH,w))/Math.max(1,sum(last(D.spendH,w)))*100;
  const roasD = sum(last(D.revH,w))/Math.max(1,sum(last(D.spendH,w))), roasC = sum(last(C.revH,w))/Math.max(1,sum(last(C.spendH,w)));
  const lift = (roasD/roasC-1)*100;
  const avg = a => a.length ? sum(last(a,5))/Math.min(5,a.length) : null;
  const env = envAt(Math.max(0,t-1));
  const gap = S.trackOn ? 38 : 2.5;
  const pocket = sum(D.l)/N()*100;
  const qdepth = S.queue.length + S.jobs.length;
  const fe = 10 + (env.shock?14:0) + (env.kinds.some(k=>k==='ipl'||k==='diwali')?6:0);
  // each KPI: [label, unit, baseline, target, value, true=measured in the sim / false=example value]
  const K = [
    { name:'P1 Signal Agent',     k:[['Reconciliation gap','%',25,3,gap,true],['Data freshness lag','h',24,1,env.outage>=0?6:1,false],['Spend with fresh calibration','%',0,90,85,false]] },
    { name:'P2 Fatigue Sentinel', k:[['Spend on fatigued ads','%',20,10,fatD,true],['Detection lag','h',72,6,avg(S.lagSamples)??1,true],['Alert precision','%',50,85,84,false]] },
    { name:'P3 Creative Studio',  k:[['Refresh time (flag to live)','h',48,6,avg(S.refreshSamples)??6,true],['Replacement queue','ads',8,0,qdepth,true],['New-ad win rate','%',40,65,62,false]] },
    { name:'P4 Cohort Optimizer', k:[['Spend in losing cohorts','%',20,5,pocket,true],['Time to action','h',72,12,S.gateOpen?8:30,false],['Freed budget redeployed in 24h','%',0,90,S.gateOpen?88:40,false]] },
    { name:'P5 Budget Allocator', k:[['True ROAS lift vs control','%',0,25,lift,true],['Reallocation lag','h',168,1,S.gateOpen?1:6,false],['Forecast error (MAPE)','%',30,8,fe,false]] }
  ];
  const A = K.map(a => { const s = a.k.map(k=>score(k[4],k[2],k[3])); a.s=s; return 0.54*s[0]+0.30*s[1]+0.16*s[2]; });
  const gate = (A[0]>=60 && !S.killed) ? 1 : 0;
  const ahi = gate * Math.pow(Math.max(A[1],1),.30)*Math.pow(Math.max(A[2],1),.20)*Math.pow(Math.max(A[3],1),.25)*Math.pow(Math.max(A[4],1),.25);
  // hysteresis: enter red below 50, leave red only above 55
  A.forEach((a,i)=>{ if (a<50) S.redState[i]=true; else if (a>55) S.redState[i]=false; });
  const reds = S.redState.slice(1,5).filter(Boolean).length;
  let level='Green', label='Green: every agent 70+, normal autonomy';
  if (S.killed){ level='Red'; label='Red 3 Halt: kill switch on, changes frozen'; }
  else if (!gate){ level='Red'; label='Red 3 Halt: Data Trust gate closed, changes frozen'; }
  else if (reds>=2){ level='Red'; label='Red 2 Critical: human approval needed'; }
  else if (reds===1){ level='Red'; label='Red 1 Alert: Orchestrator diagnosing'; }
  else { const low = A.slice(1).map((a,i)=>[a,i+2]).filter(x=>x[0]<70); if (low.length){ level='Amber'; label='Amber: P'+low.map(x=>x[1]).join(', P')+' self-fixing'; } }
  return { K, A, ahi, level, label, lift, roasD, roasC };
}

// ---------- Drawing the playground ----------
function render(){
  const h = health(), {C,D,t} = S, cu = S.cum;
  $('clock').textContent = `${hh(t)} · hour ${t} of ${END_HOUR}`;
  const waste = 100*(1 - cu.fatD/Math.max(1,cu.fatC));
  $('tiles').innerHTML = [
    ['teal', h.roasD.toFixed(2)+'×','Drishti true ROAS (24h)'],
    ['grey', h.roasC.toFixed(2)+'×','Human team true ROAS (24h)'],
    [h.lift>=25?'teal':'', (h.lift>=0?'+':'')+h.lift.toFixed(1)+'%','ROAS lift (goal +25%)'],
    [waste>=50?'teal':'', waste.toFixed(0)+'%','Less spend on tired ads (goal −50%)'],
    ['teal', inr(cu.revD-cu.revC),'Extra revenue so far'],
    [cu.netD-cu.netC>=0?'teal':'', inr(cu.netD-cu.netC),'Extra net return (revenue − spend)']
  ].map(x=>`<div class="card tile"><b class="${x[0]}">${x[1]}</b><span>${x[2]}</span></div>`).join('');

  // AHI
  $('ahi').innerHTML = `<div class="row"><b style="font-size:2rem;font-family:'Space Grotesk'">${Math.round(h.ahi)}</b><span class="pill ${h.level}">${h.label}</span></div>
    <p class="muted tiny" style="margin:6px 0 4px">Scores are lift vs the human half, so a market shock cannot make an agent look bad. Tap an agent for its KPIs ("example" = illustrative value).</p>`;
  $('agentsHealth').innerHTML = h.K.map((a,i)=>{
    const sc = h.A[i], col = sc>=70?'var(--green)':sc>=50?'var(--amber)':'var(--red)';
    return `<details class="agent"><summary><b style="width:160px">${a.name}</b><span class="hbar"><i style="width:${sc}%;background:${col}"></i></span><b style="width:32px;text-align:right">${Math.round(sc)}</b></summary>
      <table>${a.k.map((k,j)=>`<tr><td>${k[0]} <small class="dim">(${k[5]?'measured':'example'})</small></td><td>${k[4].toFixed(1)}${k[1]}</td><td>${Math.round(a.s[j])}</td></tr>`).join('')}</table></details>`;
  }).join('');

  // where the money sits
  const env = envAt(Math.max(0,t-1));
  const bar = (H,title) => `<div class="small muted" style="display:flex;justify-content:space-between"><span>${title}</span><span>spend at ${Math.round(H.spendMult*100)}% of plan</span></div>
    <div class="bars">${H.share.map((s,i)=>`<span style="width:${s*100}%;background:${COL[i]};${env.outage===i?'opacity:.25':''}">${s>0.08?P.ch[i].name+' '+Math.round(s*100)+'%':''}</span>`).join('')}</div>`;
  $('alloc').innerHTML = bar(C,'Human team') + bar(D,'Drishti');

  // banners for special modes
  let bn = '';
  if (S.killed) bn += `<div class="banner halt"><b>Kill switch on.</b> Every Drishti change is frozen and budgets are back to the last known-good plan. Press it again to resume.</div>`;
  else if (!S.gateOpen) bn += `<div class="banner halt"><b>Data Trust gate closed.</b> Tracking is broken, so every automatic action is paused until the data is reconciled.</div>`;
  if (S.storm && !S.killed) bn += `<div class="banner storm"><b>Storm Mode.</b> The shock filter says the market moved, not the agents. Caps are tighter and budget is protected.</div>`;
  if (S.waiting) bn += `<div class="banner wait"><b>Paused: Drishti is waiting for your approval</b> in the inbox below.</div>`;
  $('banners').innerHTML = bn;

  // approval inbox
  $('inbox').innerHTML = S.inbox.length ? S.inbox.map(it=>`<div class="inbox-item"><b>${esc(it.title)}</b> <span class="tiny muted">from ${it.agent}</span>
      <div class="small muted" style="margin-top:4px">${esc(it.detail)}</div>
      <div class="tiny dim">If nobody answers within ${Math.max(0,it.expires-t)} simulated hour(s), Drishti takes the safe default.</div>
      <div class="row"><button class="primary" data-ok="${it.id}">Approve</button><button data-no="${it.id}">Reject</button></div></div>`).join('')
    : `<p class="empty">No big moves waiting. Small moves run on their own inside the caps.</p>`;

  // reports
  if (S.reports.length) $('reports').innerHTML = S.reports.map(r=>{
    const e = EVENTS[r.ev.kind];
    return `<div class="report"><b>${e.icon} ${e.name}</b> <span class="tiny dim">${hh(r.a)} → ${hh(r.b)}</span><br>
      Drishti ${r.net>=0?'protected':'trailed by'} <b class="${r.net>=0?'teal':''}">${inr(Math.abs(r.net))}</b> of net return vs the human team (${inr(r.rev)} revenue difference), with ${r.acts} agent actions.<br>
      <span class="muted">${LESSON[r.ev.kind]}</span></div>`;
  }).join('');

  // decision log
  const who = e => e.who==='BAU'?'Human team':e.who==='YOU'?'You':e.who;
  $('log').innerHTML = S.log.map(e=>`<div class="entry ${e.who}"><time>${hh(e.t)}</time><em>${who(e)}</em>${esc(e.text)}</div>`).join('');

  // inject buttons: disabled while the same disruption is running or the week is over
  document.querySelectorAll('#injectBtns button').forEach(b=>{
    const k = b.dataset.k, active = S.events.some(e=>e.kind===k && S.t<e.to);
    b.classList.toggle('active', active); b.disabled = active || S.t>=END_HOUR;
  });
  $('kill').classList.toggle('on', S.killed);
  $('kill').textContent = S.killed ? '⏻ Resume Drishti' : '⏻ Kill switch';
  $('play').textContent = S.t>=END_HOUR ? 'Week complete' : playing ? '❚❚ Pause' : '▶ Play';
  drawChart();
}

function drawChart(){
  const W=760, H=230, L=40, R=10, T=10, B=24, hs=S.hist.slice(6);           // skip the first hours (window too short)
  const ys = hs.flatMap(p=>[p.rc,p.rd]); const lo=Math.floor((Math.min(...ys,2.5)-0.1)*10)/10, hi=Math.ceil((Math.max(...ys,3.5)+0.1)*10)/10;
  const X = t => L + (t/END_HOUR)*(W-L-R), Y = v => T + (1-(v-lo)/(hi-lo))*(H-T-B);
  let s = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="True ROAS of both halves over the week">`;
  S.events.forEach((e,k)=>{ const x0=X(e.from), x1=X(Math.min(e.to,END_HOUR));
    s+=`<rect x="${x0}" y="${T}" width="${Math.max(2,x1-x0)}" height="${H-T-B}" style="fill:var(--amber)" opacity=".12"/><text x="${x0+4}" y="${T+12+12*(k%3)}">${EVENTS[e.kind].icon} ${EVENTS[e.kind].name}</text>`; });
  for (let i=0;i<=4;i++){ const v=lo+(hi-lo)*i/4; s+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--line)"/><text x="4" y="${Y(v)+4}">${v.toFixed(1)}x</text>`; }
  for (let d=0;d<7;d++) s+=`<text x="${X(d*24)+4}" y="${H-6}">Day ${d+1}</text>`;
  s+=`<line x1="${X(S.t)}" x2="${X(S.t)}" y1="${T}" y2="${H-B}" style="stroke:var(--teal)" stroke-dasharray="3 4" opacity=".6"/>`;
  const line=(k,c)=>`<polyline fill="none" style="stroke:${c}" stroke-width="2.5" points="${hs.map(p=>X(p.t)+','+Y(p[k])).join(' ')}"/>`;
  s += line('rc','var(--grey)') + line('rd','var(--teal)') + `</svg>`;
  $('chart').innerHTML = s;
}

// ---------- Controls ----------
function loop(){
  clearTimeout(timer);
  if (S.t>=END_HOUR){ playing=false; makeReports(true); render(); return; }
  render();
  if (!playing) return;
  timer = setTimeout(()=>{ tick(); loop(); }, +$('speed').value);
}
function inject(kind){
  if (S.t>=END_HOUR || S.events.some(e=>e.kind===kind && S.t<e.to)) return;
  S.events.push({kind, from:S.t, to:S.t+EVENTS[kind].dur, id:Math.random(), seenD:false, reported:false, announced:true, injected:true});
  log('YOU',`Injected: ${EVENTS[kind].icon} ${EVENTS[kind].name}.`);
  if (!playing && !S.waiting){ playing = true; }
  loop();
}
function toggleKill(){
  const D = S.D;
  S.killed = !S.killed;
  if (S.killed){
    D.share = baseShares(); D.cap = 1; D.boost = 1; S.storm = false; S.lastLogShare = baseShares();
    S.inbox = []; if (S.waiting){ S.waiting=false; }
    log('YOU','Kill switch pressed: Red 3 Halt. All Drishti changes frozen and rolled back to the last known-good plan.');
    think('Orch',[['ALERT','Kill switch pressed by Shreya.'],['ACT','All agent changes frozen; budgets rolled back to the last known-good plan.'],['LOG','Pending approvals cancelled.']]);
  } else {
    log('YOU','Drishti resumed.');
    S.events.forEach(e=>{ if (S.t>=e.from && S.t<e.to) e.seenD = false; }); // re-assess anything still running
    think('Orch',[['OBSERVE','Resumed by Shreya. Re-checking everything that changed while frozen.']]);
  }
  render();
}

// Build the buttons and menus once
$('injectBtns').innerHTML = Object.entries(EVENTS).map(([k,v])=>`<button data-k="${k}">${v.icon} ${v.name}<small>${v.sub}</small></button>`).join('');
$('injectBtns').addEventListener('click', e=>{ const b=e.target.closest('button'); if (b) inject(b.dataset.k); });
$('agentChips').innerHTML = AGENTS.map(a=>`<span class="chip" data-a="${a}">${a==='Orch'?'Orchestrator':a}</span>`).join('');
$('preset').innerHTML = Object.entries(PRESETS).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');
$('preset').onchange = e => { presetKey = e.target.value; reset(); playing = true; loop(); };
function fillBrands(){ $('brand').innerHTML = Object.entries(BRANDS).map(([k,v])=>`<option value="${k}" ${k===brandKey?'selected':''}>${esc(v.brand)}, ${inr(v.month)}/month</option>`).join(''); }
fillBrands();
$('brand').onchange = e => { brandKey = e.target.value; reset(); loop(); };
$('play').onclick = () => { if (S.t>=END_HOUR) return; playing = !playing; if (playing) S.waiting = false; loop(); };
$('step').onclick = () => { playing = false; if (S.t<END_HOUR) tick(); loop(); };
$('speed').onchange = loop;
$('reset').onclick = () => { reset(); playing = true; loop(); };
$('kill').onclick = toggleKill;
$('inbox').addEventListener('click', e=>{ const ok=e.target.dataset.ok, no=e.target.dataset.no; if (ok) decide(+ok,true); if (no) decide(+no,false); });

reset();
loop();
// Start playing only when the playground scrolls into view (so the week isn't over before you get there)
new IntersectionObserver((entries, obs)=>{ if (entries[0].isIntersecting){ playing = true; loop(); obs.disconnect(); } }, {threshold:0.25}).observe($('playground'));

// ---------- Used by the "Your data" section ----------
window.DrishtiSim = {
  loadCustom(params){
    BRANDS.custom = params; brandKey = 'custom'; presetKey = 'free'; $('preset').value = 'free';
    fillBrands(); reset(); playing = true; loop();
    document.getElementById('playground').scrollIntoView({behavior:'smooth'});
  },
  inr
};
})();
