// lib/agent.js
// The Drishti AI Orchestrator: an LLM that coordinates five specialist agents.
//
// How it works (one "run"):
//   1. The maths for every agent is computed once (lib/analyze.js).
//   2. The Orchestrator LLM gets the five agents as TOOLS. It decides the order,
//      reads each result, thinks out loud, and calls the next tool.
//      Rule it must follow: check data trust and the market before acting.
//   3. The Creative Studio tool calls the LLM again to write fresh ad copy in
//      regional languages, then runs a brand/ASCI safety check on it.
//   4. Actions are built with tiered autonomy (small = auto, big = ask a human)
//      and the Agent Health Index is scored before and after.
// Every step is streamed to the browser through emit(), so the jury watches it live.
//
// If no AI key is set, or the AI fails mid-run, a built-in rules engine runs the
// same tools in a fixed order, so the demo never breaks.

import { analyze, buildActions, scoreAgents, EVENTS } from './analyze.js';
import { chat as rawChat, parseJSON, engineLabel, loadBoard, modelBoard } from './llm.js';
import { marketNews } from './news.js';

const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const DAY = 24 * 3600e3;

// ---------------------------------------------------------------------------
// Languages for regional creative, picked from the regions in the data
// ---------------------------------------------------------------------------
const REGION_LANG = [
  [/tamil|chennai|coimbatore|madurai/i, 'Tamil'],
  [/hyderabad|telangana|andhra|vizag/i, 'Telugu'],
  [/bengaluru|bangalore|karnataka|mysuru/i, 'Kannada'],
  [/kolkata|bengal/i, 'Bengali'],
  [/mumbai|pune|maharashtra|nagpur/i, 'Marathi'],
  [/delhi|up |uttar|bihar|lucknow|jaipur|indore|rajasthan|madhya|patna|hindi/i, 'Hindi'],
];
function languagesFor(a, channel) {
  const langOf = region => (REGION_LANG.find(([re]) => re.test(region + ' ')) || [])[1];
  // 1) languages of losing pockets on the same channel as the tired ad come first
  //    (that's where local copy helps most)...
  const langs = [];
  for (const c of a.cohort.losing.filter(x => x.channel === channel)) {
    const l = langOf(c.region); if (l && !langs.includes(l)) langs.push(l);
  }
  // 2) ...then the languages with the most spend overall.
  const spendByLang = {};
  for (const c of a.cohort.cohorts) { const l = langOf(c.region); if (l) spendByLang[l] = (spendByLang[l] || 0) + c.spend7; }
  for (const l of Object.keys(spendByLang).sort((x, y) => spendByLang[y] - spendByLang[x])) if (!langs.includes(l)) langs.push(l);
  return (langs.length ? langs : ['Hindi', 'Tamil']).slice(0, 2);
}

// Fallback copy (used only without an AI key). Native-script lines, brand inserted.
const TEMPLATES = {
  English: b => ({ hook: `Your ${b.category} routine, minus the guesswork`, headline: `${b.brand}: results people actually notice`, cta: 'Shop now' }),
  Hindi: b => ({ hook: 'रोज़ की देखभाल, अब और आसान', headline: `${b.brand} — फ़र्क़ जो दिखे`, cta: 'अभी खरीदें' }),
  Tamil: b => ({ hook: 'உங்கள் தினசரி பராமரிப்புக்கு புதிய தேர்வு', headline: `${b.brand} — வித்தியாசம் தெரியும்`, cta: 'இப்போதே வாங்குங்கள்' }),
  Telugu: b => ({ hook: 'మీ రోజువారీ సంరక్షణకు కొత్త ఎంపిక', headline: `${b.brand} — తేడా కనిపిస్తుంది`, cta: 'ఇప్పుడే కొనండి' }),
  Kannada: b => ({ hook: 'ನಿಮ್ಮ ದಿನನಿತ್ಯದ ಆರೈಕೆಗೆ ಹೊಸ ಆಯ್ಕೆ', headline: `${b.brand} — ವ್ಯತ್ಯಾಸ ಕಾಣುತ್ತದೆ`, cta: 'ಈಗಲೇ ಖರೀದಿಸಿ' }),
  Bengali: b => ({ hook: 'প্রতিদিনের যত্নে নতুন পছন্দ', headline: `${b.brand} — পার্থক্যটা চোখে পড়বে`, cta: 'এখনই কিনুন' }),
  Marathi: b => ({ hook: 'रोजच्या काळजीसाठी नवा पर्याय', headline: `${b.brand} — फरक जाणवेल`, cta: 'आत्ताच खरेदी करा' }),
};

// Food brands (spices, snacks) get food copy instead of the personal-care lines above.
const FOOD_TEMPLATES = {
  English: b => ({ hook: 'Ghar ka swaad in every bite', headline: `${b.brand}: taste your family will notice`, cta: 'Order now' }),
  Hindi: b => ({ hook: 'हर खाने में घर का स्वाद', headline: `${b.brand} — स्वाद जो याद रहे`, cta: 'अभी ऑर्डर करें' }),
  Tamil: b => ({ hook: 'ஒவ்வொரு உணவிலும் வீட்டு சுவை', headline: `${b.brand} — நினைவில் நிற்கும் சுவை`, cta: 'இப்போதே ஆர்டர் செய்யுங்கள்' }),
  Telugu: b => ({ hook: 'ప్రతి భోజనంలో ఇంటి రుచి', headline: `${b.brand} — గుర్తుండిపోయే రుచి`, cta: 'ఇప్పుడే ఆర్డర్ చేయండి' }),
  Kannada: b => ({ hook: 'ಪ್ರತಿ ಊಟದಲ್ಲೂ ಮನೆಯ ರುಚಿ', headline: `${b.brand} — ನೆನಪಿನಲ್ಲಿ ಉಳಿಯುವ ರುಚಿ`, cta: 'ಈಗಲೇ ಆರ್ಡರ್ ಮಾಡಿ' }),
  Bengali: b => ({ hook: 'প্রতিটি খাবারে ঘরের স্বাদ', headline: `${b.brand} — মনে রাখার মতো স্বাদ`, cta: 'এখনই অর্ডার করুন' }),
  Marathi: b => ({ hook: 'प्रत्येक घासात घरची चव', headline: `${b.brand} — लक्षात राहणारी चव`, cta: 'आत्ताच ऑर्डर करा' }),
};
const FOOD = /spice|masala|snack|food|tea|oil/i;

// ASCI-style safety check: flags claims Indian ad rules don't allow without proof.
const RISKY = /\b(best|no\.? ?1|number one|100 ?%|guarantee|guaranteed|cure|cures|instant|permanent|miracle|clinically proven|doctor recommended|fastest|cheapest)\b/i;
function asciCheck(v) {
  const text = [v.hook, v.headline, v.cta].join(' ');
  const hit = text.match(RISKY);
  return hit ? { pass: false, note: `Needs proof or rewording: "${hit[0]}"` } : { pass: true, note: 'Brand & ASCI check passed' };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
export async function runDrishti(input, emit) {
  const t0 = Date.now();
  const brand = input.brand || 'Your brand';
  const category = input.category || 'consumer products';
  const a = analyze(input.rows || [], input.orders || [], { brand, category, breakevenRoas: Number(input.breakevenRoas) || 2.0,
    competitors: input.competitors || [], flatlineDays: Number(input.flatlineDays) || 2, rules: input.rules });
  // The model picked on the page ("rules" = no AI, only the built-in rules engine).
  // Every AI call in this run asks for that model first, then falls back to the others.
  const prefer = input.model && input.model !== 'rules' ? String(input.model) : null;
  const chat = opts => rawChat({ ...opts, prefer });
  const newsPromise = marketNews(category); // start the live news fetch right away
  await loadBoard(); // past token use per model, so the label names the model that will really go first
  let engine = input.model === 'rules' ? null : engineLabel(prefer); // null → rules engine
  emit({ type: 'start', engine: engine || 'Built-in rules', brand, period: a.period, totals: a.totals });

  const state = { done: {}, variants: [], shock: null, briefing: null };
  // AI tokens used by this run (every chat() call adds to it)
  const ai = { tokens: 0, calls: 0, last: null, byModel: {} };
  // The AI gets ~35 seconds in total. After that the rules engine finishes, so a run never hangs.
  const aiDeadline = Date.now() + 35000;
  const count = usage => {
    if (!usage) return;
    ai.tokens += usage.tokens; ai.calls++; ai.last = usage;
    const m = (ai.byModel[`${usage.provider} · ${usage.model}`] ||= { tokens: 0, calls: 0 }); m.tokens += usage.tokens; m.calls++;
  };
  // A what-if scenario picked on the page (e.g. "COVID-like outbreak"): the shock filter treats it as today's news
  const scenario = input.scenario && input.scenario.headline ? input.scenario : null;
  const agentEvent = (agent, status, text, data) => emit({ type: 'agent', agent, status, text, data });

  // ---------- The tools (one per agent) ----------
  const tools = {
    async signal_check() {
      agentEvent('P1', 'working', 'Joining ad data with Shopify orders, checking tracking…');
      const s = a.signal;
      const line = s.perChannel.map(c => `${c.channel} claims ROAS ${c.platformRoas}, true ${c.trueRoas}`).join(' · ');
      agentEvent('P1', s.gateOpen ? 'done' : 'alert',
        `Data trust ${s.trustScore}/100 (gate ${s.gateOpen ? 'open' : 'SHUT'}). ${line}.${s.issues.length ? ' Issues: ' + s.issues.join('; ') + '.' : ''}`, s);
      state.done.P1 = true;
      return { trustScore: s.trustScore, gateOpen: s.gateOpen, hasOrderData: s.hasOrders, channels: s.perChannel, trackingBreaks: s.trackingBreaks, issues: s.issues };
    },

    async fatigue_scan() {
      agentEvent('P2', 'working', 'Scoring every creative against its own baseline…');
      const f = a.fatigue;
      const top = f.ads.filter(x => x.status !== 'healthy').slice(0, 3);
      agentEvent('P2', f.fatiguedCount ? 'alert' : 'done',
        `${f.fatiguedCount} fatigued, ${f.atRiskCount} at risk. ${f.pctSpendFatigued}% of recent spend is on tired ads. ` +
        top.map(x => `"${x.ad}" ${x.score}/100 (CTR −${x.ctrDropPct}%${x.daysToFatigue ? `, tires in ~${x.daysToFatigue}d` : ''}; cause: ${x.cause})`).join(' · '), f);
      state.done.P2 = true;
      return { pctSpendFatigued: f.pctSpendFatigued, ads: f.ads.slice(0, 6).map(({ channel, ad, score, status, ctrDropPct, frequency, cpmRisePct, daysToFatigue, cause, dailySpend }) => ({ channel, ad, score, status, ctrDropPct, frequency, cpmRisePct, daysToFatigue, cause, dailySpend })) };
    },

    async market_shock_check() {
      agentEvent('ORC', 'working', 'Shock filter: is it us or the world? Reading live news + auction data…');
      const news = await newsPromise;
      const today = new Date();
      const nearEvents = EVENTS.map(e => ({ ...e, d: Math.round((new Date(e.date + 'T00:00:00Z') - today) / DAY) })).filter(e => Math.abs(e.d) <= 3);
      const allDown = a.signal.perChannel.length > 1 && a.auction.rises.every(r => r.risePct > 10);
      const checks = [
        { name: 'Control / breadth', result: allDown ? 'All channels moved together' : 'Channels moved independently' },
        { name: 'Auction', result: a.auction.accountWideSpike ? 'Account-wide CPM spike: ' + a.auction.rises.map(r => `${r.channel} +${r.risePct}%`).join(', ') : 'No account-wide CPM spike' },
        { name: 'Platform status', result: news.shockHeadlines.some(h => /meta|google|instagram|youtube|hotstar/i.test(h.title)) ? 'Platform issue in the news' : 'No platform outage reported' },
        { name: 'Calendar', result: nearEvents.length ? nearEvents.map(e => e.name).join(', ') + ' within 3 days' : 'No major event within 3 days' },
        { name: 'News scan', result: news.ok ? `${news.headlines.length} live headlines read, ${news.shockHeadlines.length} flagged` : 'News feed unreachable; relying on data checks' },
      ];
      if (scenario) checks.unshift({ name: 'Scenario in play', result: `${scenario.headline} (${scenario.external ? 'market-wide shock' : 'tailwind / local event'})` });
      const external = a.auction.accountWideSpike || !!scenario?.external;
      const headlines = scenario ? [{ title: scenario.headline, source: 'What-if scenario' }, ...news.headlines] : news.headlines;
      const shockHeadlines = scenario?.external ? [{ title: scenario.headline, source: 'What-if scenario' }, ...news.shockHeadlines] : news.shockHeadlines;
      state.shock = { external, checks, headlines, shockHeadlines, newsOk: news.ok, scenario };
      agentEvent('ORC', external ? 'alert' : 'done', external
        ? (a.auction.accountWideSpike
          ? 'MARKET SHOCK: CPMs jumped on every channel at once. Storm Mode on: tighter caps, no agent penalised.'
          : `MARKET SHOCK: ${scenario.headline}. Storm Mode on: big spend moves wait for you, no agent penalised.`)
        : scenario ? `In play: ${scenario.headline}. Not a market-wide shock, so agents can act on what the data shows.`
        : `No market shock. ${news.ok ? `Read ${news.headlines.length} live headlines; ` : ''}the problems are inside the account, so agents can act.`, state.shock);
      state.done.SHOCK = true;
      return { external, checks, headlines: headlines.slice(0, 5).map(h => h.title) };
    },

    async creative_refresh() {
      const need = a.creative.adsToReplace.slice(0, 2);
      const langs = languagesFor(a, need[0]?.channel);
      agentEvent('P3', 'working', need.length ? `Writing replacements for ${need.length} tired ad(s) in English, ${langs.join(' and ')}…` : 'No tired ads. Checking regional coverage…');
      for (const ad of need) {
        let variants = null;
        if (engine) {
          try {
            const { message, usage } = await chat({
              json: true, temperature: 0.8, maxTokens: 700, deadline: aiDeadline,
              messages: [
                { role: 'system', content: 'You are the Creative Studio agent of Drishti AI. You write short, punchy ad copy for Indian D2C brands. Follow ASCI rules: no unverifiable superlatives (best, No.1, 100%, guaranteed, instant, permanent, cure, clinically proven). Regional copy must be in native script and sound natural, not translated. Reply with JSON only.' },
                { role: 'user', content: `Brand: ${brand} (${category}). The ad "${ad.ad}" on ${ad.channel} is fatigued: CTR fell ${ad.ctrDropPct}% vs its own baseline. Write 3 replacement variants with a NEW angle each: one in English, one in ${langs[0]}, one in ${langs[1] || 'Hindi'}. JSON: {"variants":[{"language":"","hook":"(max 8 words)","headline":"(max 8 words)","cta":"(2-3 words)","angle":"(why this angle, in English, max 12 words)"}]}` },
              ],
            });
            count(usage);
            variants = parseJSON(message.content)?.variants;
          } catch (e) { /* fall back to templates below */ }
        }
        if (!Array.isArray(variants) || !variants.length) {
          const T = FOOD.test(category) ? FOOD_TEMPLATES : TEMPLATES;
          variants = ['English', ...langs].map(l => ({ language: l, ...(T[l] || T.Hindi)({ brand, category }), angle: l === 'English' ? 'Benefit-led hook to reset attention' : `Native ${l} copy for ${l}-speaking regions` }));
        }
        variants = variants.slice(0, 3).map(v => ({ ...v, check: asciCheck(v) }));
        state.variants.push({ ad: ad.ad, channel: ad.channel, variants });
      }
      const passed = state.variants.flatMap(v => v.variants).filter(v => v.check.pass).length;
      const totalV = state.variants.flatMap(v => v.variants).length;
      agentEvent('P3', 'done', (need.length
        ? `Drafted ${totalV} variants (${['English', ...langs].join(', ')}); ${passed}/${totalV} passed the brand & ASCI check. Ready for A/B launch.`
        : `No replacements needed. ${a.creative.pctRegionalSpendLocalLanguage}% of regional spend already runs local-language creative.`) +
        (a.channelFit.length ? ` Channel fit: ${a.channelFit.map(m => `"${m.ad}" earns ${m.trueRoas} on ${m.channel} vs ${m.tvRoas} on ${m.to} TV, so it should move`).join(' · ')}.` : ''), { variants: state.variants });
      state.done.P3 = true;
      return { channelFit: a.channelFit, drafted: state.variants.map(v => ({ for: v.ad, variants: v.variants.map(x => ({ language: x.language, hook: x.hook, asci: x.check.pass })) })) };
    },

    async cohort_diagnosis() {
      agentEvent('P4', 'working', 'Splitting spend by channel × region, calibrated to true revenue…');
      const c = a.cohort;
      agentEvent('P4', c.losing.length ? 'alert' : 'done',
        `${c.pctSpendLosing}% of spend sits in cohorts below break-even ROAS ${c.breakevenRoas}. ` +
        c.losing.slice(0, 3).map(x => `${x.channel} · ${x.region}: ROAS ${x.trueRoas} → ${x.action}`).join(' · ') +
        (c.winners.length ? ` Winners to scale: ${c.winners.slice(0, 2).map(x => `${x.channel} · ${x.region} (${x.trueRoas})`).join(', ')}.` : '') +
        (a.competition.length ? ` Competitor watch: ${a.competition.map(x => `${x.competitor} engages ${x.times}× better on ${x.theirChannel} than our "${x.ourCampaign}" on ${x.ourChannel}`).join(' · ')}.` : a.competitorsSeen ? ' Competitor watch: no rival is clearly out-engaging us.' : ''), c);
      state.done.P4 = true;
      return { breakeven: c.breakevenRoas, pctSpendLosing: c.pctSpendLosing, losing: c.losing.slice(0, 5), winners: c.winners.slice(0, 3), competitors: a.competition };
    },

    async budget_plan() {
      agentEvent('P5', 'working', 'Comparing marginal true ROAS across channels…');
      const b = a.budget;
      const storm = state.shock?.external;
      const moves = b.shifts.map(s => `${s.channel} ${s.changePct > 0 ? '+' : ''}${s.changePct}% (marginal ROAS ${s.marginalRoas})`).join(' · ');
      agentEvent('P5', 'done', `${moves}. True ROAS ${b.blendedTrueRoas} → ${b.projectedTrueRoas}, +${inr(b.extraRevenuePerDay)}/day on the same spend.` +
        (b.upcomingEvents.length ? ` ${b.upcomingEvents[0].name} in ${b.upcomingEvents[0].inDays} days: pacing reserve proposed.` : '') + (storm ? ' Storm Mode caps applied.' : '') +
        (a.flatline.length ? ` Your ${a.flatlineDays}-day flatline rule fired: ${a.flatline.map(f => `"${f.campaign}" (${f.channel}) flat at ROAS ${f.trueRoasNow}`).join(', ')} → on hold.` : '') +
        (a.ruleHits.length ? ` Your other rules fired ${a.ruleHits.length}×: ${a.ruleHits.slice(0, 3).map(h => h.title).join(' · ')}.` : ''), b);
      state.done.P5 = true;
      return { shifts: b.shifts, blendedTrueRoas: b.blendedTrueRoas, projectedTrueRoas: b.projectedTrueRoas, extraRevenuePerDay: b.extraRevenuePerDay, upcomingEvents: b.upcomingEvents, flatlineRule: { days: a.flatlineDays, campaignsToHold: a.flatline },
        yourRules: a.rules.map(r => r.text), ruleHits: a.ruleHits.map(h => ({ rule: h.ruleText, action: h.title })) };
    },

    async final_briefing(args = {}) {
      state.briefing = { headline: args.headline || '', briefing: args.briefing || '', owner_note: args.owner_note || '' };
      return { ok: true };
    },
  };

  // Tool definitions the LLM sees (OpenAI function-calling format)
  const fn = (name, description, parameters = { type: 'object', properties: {} }) => ({ type: 'function', function: { name, description, parameters } });
  const toolDefs = [
    fn('signal_check', 'P1 Signal Agent. Joins ad-platform numbers with real Shopify orders: true ROAS per channel, over-claiming, broken tracking, data trust score (gate ≥60). Call FIRST.'),
    fn('market_shock_check', 'Orchestrator shock filter: live news + account-wide auction check + calendar. Tells whether a drop is the market or the agents. Call before any spend action.'),
    fn('fatigue_scan', 'P2 Fatigue Sentinel. Fatigue score per creative (CTR vs own baseline, frequency, CPM), days-to-fatigue forecast, root cause.'),
    fn('creative_refresh', 'P3 Creative Studio. Writes replacement ad variants (English + regional languages) for fatigued ads and runs a brand/ASCI check. Call after fatigue_scan.'),
    fn('cohort_diagnosis', 'P4 Cohort Optimizer. Finds channel × region pockets below break-even true ROAS and picks a graduated action (lower bid → narrow → pause).'),
    fn('budget_plan', 'P5 Budget Allocator. Moves daily budget across channels toward the best marginal true ROAS, with caps; festive pacing.'),
    fn('final_briefing', 'Finish the run with a plain-English briefing for the marketing manager and a one-line rupee note for the business owner.', {
      type: 'object', required: ['headline', 'briefing', 'owner_note'],
      properties: {
        headline: { type: 'string', description: 'One sentence, max 16 words, the single most important finding.' },
        briefing: { type: 'string', description: '3-4 short sentences: what is leaking, why (root cause), what Drishti did, what needs approval.' },
        owner_note: { type: 'string', description: 'One sentence in rupees for a non-technical owner.' },
      },
    }),
  ];

  // ---------- LLM loop ----------
  if (engine) {
    const messages = [
      { role: 'system', content:
        `You are the Orchestrator of Drishti AI, a team of five AI agents that watches a D2C brand's ads on Facebook, Instagram, Google and OTT/TV, fixes money leaks, and grades itself on TRUE revenue (Shopify orders), not platform-claimed revenue.\n` +
        `Rules: 1) Always call signal_check first; if the data gate is shut, do not plan spend changes. 2) Run market_shock_check before acting on spend. 3) Diagnose before acting: a drop can be fatigue, tracking, competition or the market. 4) Call each agent tool once. 5) Between tool calls, write ONE short sentence of reasoning (what you learned, what you will check next) as plain text. 6) Mention any of the user's standing rules that fired (flatline hold or the others budget_plan reports), video-to-TV move or competitor-driven shift the tools report. 7) End by calling final_briefing. Use ₹ and Indian number style. Be concrete with numbers from the tools.` },
      { role: 'user', content: `Run the hourly check for ${brand} (${category}). Data: ${a.period.days} days (${a.period.from} to ${a.period.to}), ${a.totals.channels.join(', ')}, total spend ${inr(a.totals.spend)}. Break-even true ROAS: ${a.cohort.breakevenRoas}.` },
    ];
    try {
      for (let turn = 0; turn < 10 && !state.briefing; turn++) {
        const { message, engine: used, usage } = await chat({ messages, tools: toolDefs, temperature: 0.2, deadline: aiDeadline });
        engine = used; count(usage);
        if (message.content && message.content.trim()) emit({ type: 'thought', text: message.content.trim().slice(0, 400) });
        const calls = message.tool_calls || [];
        messages.push({ role: 'assistant', content: message.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
        if (!calls.length) {
          messages.push({ role: 'user', content: 'Continue: call the next agent tool you have not called yet, or final_briefing if all are done.' });
          continue;
        }
        for (const call of calls) {
          const name = call.function?.name;
          let args = {};
          try { args = JSON.parse(call.function?.arguments || '{}'); } catch {}
          const result = tools[name] ? await tools[name](args) : { error: 'unknown tool' };
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 2500) });
        }
      }
    } catch (e) {
      console.error('[drishti] AI loop stopped:', e.message); // visible in Vercel logs
      emit({ type: 'thought', text: 'The AI models are busy right now, so the built-in rules engine finishes the remaining checks (same maths, every number traceable).' });
      engine = engine ? engine + ' + rules' : null;
    }
  }

  // ---------- Rules engine (and safety net for anything the LLM skipped) ----------
  const think = text => emit({ type: 'thought', text });
  if (!state.done.P1) { think('First I check whether the numbers can be trusted. No action runs on bad data.'); await tools.signal_check(); }
  if (!state.done.SHOCK) { think(a.signal.gateOpen ? 'Data gate is open. Before blaming any agent, I check whether the market itself moved.' : 'Data gate is shut, so every spend change will need a human. Still checking the market.'); await tools.market_shock_check(); }
  if (!state.done.P2) { think('Now the biggest leak in most accounts: creatives that have quietly worn out.'); await tools.fatigue_scan(); }
  if (!state.done.P3) { think(a.creative.adsToReplace.length ? 'A tired ad should not be paused without a replacement ready, so Creative Studio drafts one first.' : 'Creatives look healthy; Creative Studio only checks regional coverage.'); await tools.creative_refresh(); }
  if (!state.done.P4) { think('Next: pockets that lose money hide inside good channel averages.'); await tools.cohort_diagnosis(); }
  if (!state.done.P5) { think('Finally, where should tomorrow\'s rupee go? Comparing marginal true ROAS across channels.'); await tools.budget_plan(); }

  // ---------- Actions, scores and impact ----------
  const actions = buildActions(a, state.variants, state.shock || {});
  const ahi = scoreAgents(a, actions, state.variants.length);
  const overclaim = Object.fromEntries(a.signal.perChannel.map(c => [c.channel, c.overclaim || 1]));
  const dailyBudget = a.budget.dailyBudget || 1;
  const blended = a.budget.blendedTrueRoas;
  let freed = 0, redeployGain = 0;
  for (const act of actions) {
    if (act.kind === 'pause') {
      const ad = a.fatigue.ads.find(x => act.title.includes(x.ad));
      const src = ad ? ad.platformRoas / (overclaim[ad.channel] || 1) : 0;
      freed += act.impact; redeployGain += act.impact * Math.max(0, blended - src);
    }
    if (act.kind === 'cohort') {
      const c = a.cohort.losing.find(x => act.title.startsWith(`${x.channel} · ${x.region}`));
      freed += act.impact; redeployGain += act.impact * Math.max(0, blended - (c ? c.trueRoas : blended));
    }
    if (act.kind === 'hold') {
      const f = a.flatline.find(x => act.title.includes(x.campaign));
      freed += act.impact; redeployGain += act.impact * Math.max(0, blended - (f ? f.trueRoasNow : blended));
    }
    // Your other rules: the money they stop goes to the average channel instead
    // (a spend cap has no ROAS of its own, so it only counts as money freed).
    if (act.kind === 'rule') {
      freed += act.impact;
      if (act.trueRoas != null) redeployGain += act.impact * Math.max(0, blended - act.trueRoas);
    }

  }
  const budgetGain = actions.some(x => x.kind === 'budget') ? a.budget.extraRevenuePerDay : 0;
  const impact = {
    trueRoasNow: blended,
    trueRoasProjected: Math.round(((blended * dailyBudget + budgetGain + redeployGain) / dailyBudget) * 100) / 100,
    freedPerDay: Math.round(freed),
    extraRevenuePerDay: Math.round(budgetGain + redeployGain),
    fatiguedPctNow: a.fatigue.pctSpendFatigued,
    platformRoas: Math.round((a.signal.perChannel.reduce((s, c) => s + c.platformRevenue7, 0) / (a.signal.perChannel.reduce((s, c) => s + c.spend7, 0) || 1)) * 100) / 100,
  };

  // ---------- Briefing (AI-written if available) ----------
  if (!state.briefing || !state.briefing.briefing) {
    const topAd = a.fatigue.ads.find(x => x.status === 'fatigued');
    const approvals = actions.filter(x => x.tier === 'approval').length;
    state.briefing = {
      headline: !a.signal.gateOpen ? 'Tracking is broken, so Drishti froze spend changes until the data is fixed.'
        : a.signal.trackingBreaks.length ? `${a.signal.trackingBreaks[0].channel} tracking broke yesterday; Drishti held its budget moves and flagged the fix.`
        : state.shock?.external ? (scenario?.external && !a.auction.accountWideSpike ? `${scenario.label}: Storm Mode is protecting budget until you approve big moves.` : 'A market-wide CPM spike hit every channel; Storm Mode is protecting budget.')
        : topAd ? `"${topAd.ad}" is burning ${inr(topAd.dailySpend)}/day after its CTR fell ${topAd.ctrDropPct}%.`
        : `True ROAS is ${blended}; the biggest gain is moving budget to better channels.`,
      briefing: `Platforms report ROAS ${impact.platformRoas}, but Shopify orders say ${blended}. ${a.fatigue.pctSpendFatigued}% of recent spend went to fatigued ads and ${a.cohort.pctSpendLosing}% to pockets below break-even. ` +
        `Drishti drafted replacement ads, trimmed losing pockets and planned a budget shift worth about ${inr(impact.extraRevenuePerDay)}/day more revenue. ${approvals} bigger move(s) wait for your approval.`,
      owner_note: `About ${inr(impact.freedPerDay)} a day stops going to ads that no longer work, and each rupee should bring back ₹${impact.trueRoasProjected} instead of ₹${blended}.`,
    };
  }

  emit({
    type: 'result', engine: engine || 'Built-in rules', seconds: Math.round((Date.now() - t0) / 100) / 10,
    brand, period: a.period, briefing: state.briefing, actions, ahi, impact, variants: state.variants, shock: state.shock,
    signal: a.signal, fatigue: { ads: a.fatigue.ads, pctSpendFatigued: a.fatigue.pctSpendFatigued },
    cohort: { losing: a.cohort.losing, winners: a.cohort.winners, breakevenRoas: a.cohort.breakevenRoas, pctSpendLosing: a.cohort.pctSpendLosing },
    budget: a.budget, ai: { ...ai, board: input.model === 'rules' ? [] : modelBoard(prefer) }, scenario,
  });
}
