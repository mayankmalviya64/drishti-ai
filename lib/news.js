// lib/news.js
// Live "is it us or the world?" connector.
// Reads Google News RSS (free, no key) for the last 2 days of Indian headlines that
// could move ad auctions: outages, elections, conflicts, big cricket matches, sales.
// The Orchestrator combines this with the auction check from the ad data itself.

const SHOCK_WORDS = /\b(outage|down for|war|attack|strike|bandh|curfew|election|results|ceasefire|flood|cyclone|earthquake|ipl final|world cup final|ban on|blackout|shutdown|crash)\b/i;

function decode(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function rss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 DrishtiAI' } });
  if (!res.ok) throw new Error('news ' + res.status);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(m => {
    const get = tag => decode((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
    const title = get('title');
    return { title, source: get('source'), link: get('link'), date: get('pubDate'), shock: SHOCK_WORDS.test(title) };
  });
}

// Returns { ok, headlines:[...], shockHeadlines:[...] }. Never throws: if the news
// feed is unreachable the agent simply says so and relies on the data checks.
export async function marketNews(category = 'consumer brands') {
  // In a browser, Google News blocks cross-site reads, so skip straight to "unreachable".
  if (typeof window !== 'undefined') return { ok: false, headlines: [], shockHeadlines: [], error: 'browser' };
  try {
    const [market, platform, category_] = await Promise.all([
      rss('India (outage OR election OR strike OR "IPL" OR war OR bandh OR cyclone) when:2d'),
      rss('("Meta ads" OR "Google Ads" OR Instagram OR YouTube OR JioHotstar) (outage OR down OR glitch OR policy) when:3d'),
      rss(`India ${category} demand OR sales when:7d`),
    ]);
    const headlines = [...market.slice(0, 3), ...platform.slice(0, 2), ...category_.slice(0, 2)];
    return { ok: true, headlines, shockHeadlines: [...market, ...platform].filter(h => h.shock).slice(0, 4) };
  } catch (e) {
    return { ok: false, headlines: [], shockHeadlines: [], error: String(e.message || e) };
  }
}
