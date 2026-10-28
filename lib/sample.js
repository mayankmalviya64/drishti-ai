// lib/sample.js
// Builds a realistic 14-day ad export for a sample brand, in the same shape as a
// Meta / Google Ads CSV export plus a Shopify orders export.
// Works in the browser AND on the server (plain ES module, no dependencies).
//
// The numbers are synthetic but follow real patterns:
//  - a visual ad slowly "fatigues": frequency climbs, CTR falls, CPM rises
//  - platforms over-claim sales compared with the brand's own Shopify orders
//  - some city/audience pockets lose money even when the channel average looks fine

// Small seeded random generator, so the sample is the same on every run.
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Format a Date as YYYY-MM-DD in India time, so "yesterday" is right for Indian users.
export function isoDay(d) {
  return new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

// The two sample brands match the personas in the deck.
export const BRANDS = {
  glowveda: {
    name: 'Glowveda',
    who: "Shreya's brand · D2C personal care · ₹1.5 Cr/month",
    category: 'skincare',
    dailySpend: 500000, // ₹5 lakh a day ≈ ₹1.5 Cr a month
    aov: 650,
    channels: {
      // share of spend, base CPM (₹), how much the platform over-claims vs Shopify
      Facebook: { share: 0.22, cpm: 130, overclaim: 1.9 },
      Instagram: { share: 0.33, cpm: 150, overclaim: 1.9 },
      Google: { share: 0.35, cpm: 260, overclaim: 1.45 },
      JioHotstar: { share: 0.10, cpm: 210, overclaim: 1.25 },
    },
    regions: { 'Mumbai': 0.26, 'Delhi NCR': 0.24, 'Bengaluru': 0.18, 'Tamil Nadu': 0.14, 'UP & Bihar': 0.18 },
    ads: [
      // fatigue: how hard the ad wears out over 14 days (0 = never)
      // flatline: revenue drops and then stays flat for the last few days
      { channel: 'Instagram', campaign: 'Vitamin C Serum · Prospecting', ad: 'Glow in 7 days · Video (EN)', share: 0.50, ctr: 0.019, cvr: 0.042, fatigue: 1.0 },
      { channel: 'Instagram', campaign: 'Sunscreen · Prospecting', ad: 'Doctor-tested UGC review (HI)', share: 0.25, ctr: 0.017, cvr: 0.046, fatigue: 0.05 },
      // A long brand film: people watch it but rarely tap through on a phone feed. It suits TV better.
      { channel: 'Instagram', campaign: 'Brand film · Awareness', ad: 'Dadi ka nuskha · 30s film (HI)', share: 0.25, ctr: 0.009, cvr: 0.020, fatigue: 0 },
      { channel: 'Facebook', campaign: 'Night Cream · Retargeting', ad: 'Before–after carousel (EN)', share: 0.50, ctr: 0.021, cvr: 0.050, fatigue: 0.3 },
      { channel: 'Facebook', campaign: 'SPF 50 · Summer Lookalike', ad: 'Summer SPF 50 · Static (EN)', share: 0.50, ctr: 0.016, cvr: 0.045, fatigue: 0, flatline: true },
      { channel: 'Google', campaign: 'Search · Brand', ad: 'Search · Glowveda brand terms', share: 0.30, ctr: 0.085, cvr: 0.050, fatigue: 0 },
      { channel: 'Google', campaign: 'Search · Generic', ad: 'Search · vitamin c serum', share: 0.40, ctr: 0.042, cvr: 0.026, fatigue: 0 },
      { channel: 'Google', campaign: 'YouTube · Awareness', ad: 'Bridal glow routine · YouTube (EN)', share: 0.30, ctr: 0.006, cvr: 0.024, fatigue: 0.25 },
      { channel: 'JioHotstar', campaign: 'CTV · Festive', ad: 'Diwali glow 20s spot (HI)', share: 1.0, ctr: 0.008, cvr: 0.17, fatigue: 0.1 },
    ],
    // pockets that convert worse than average (channel|region → multiplier on conversion rate)
    weakPockets: { 'Instagram|Tamil Nadu': 0.45, 'Google|UP & Bihar': 0.5, 'JioHotstar|Bengaluru': 0.6 },
    strongPockets: { 'Google|Mumbai': 1.35, 'Facebook|UP & Bihar': 1.3 },
    // What rival brands' ads are doing (from the Meta Ad Library / a social-listening tool).
    // engagement = clicks ÷ impressions, comparable with our CTR.
    competitors: [
      { competitor: 'Lumera Skin', channel: 'Instagram', campaign: 'Night Cream · Overnight repair reels', engagement: 0.063 },
      { competitor: 'Lumera Skin', channel: 'Google', campaign: 'Vitamin C · Search', engagement: 0.040 },
      { competitor: 'Dewdrop Naturals', channel: 'Facebook', campaign: 'Sunscreen · Static', engagement: 0.015 },
    ],
  },
  crunchkart: {
    name: 'Crunchkart',
    who: "Aarush's brand · D2C snacks · ₹9 L/month",
    category: 'healthy snacks',
    dailySpend: 30000,
    aov: 420,
    channels: {
      Instagram: { share: 0.4, cpm: 120, overclaim: 2.1 },
      Facebook: { share: 0.3, cpm: 110, overclaim: 2.1 },
      Google: { share: 0.3, cpm: 220, overclaim: 1.4 },
    },
    regions: { 'Pune': 0.35, 'Mumbai': 0.30, 'Hyderabad': 0.20, 'Kolkata': 0.15 },
    ads: [
      { channel: 'Instagram', campaign: 'Makhana · Prospecting', ad: 'Office snack hack · Reel (EN)', share: 1.0, ctr: 0.022, cvr: 0.050, fatigue: 0.9 },
      { channel: 'Facebook', campaign: 'Trail Mix · Prospecting', ad: 'Gym buddy · Static (EN)', share: 1.0, ctr: 0.016, cvr: 0.055, fatigue: 0.2 },
      { channel: 'Google', campaign: 'Search · Generic', ad: 'Search · healthy snacks online', share: 1.0, ctr: 0.05, cvr: 0.035, fatigue: 0 },
    ],
    weakPockets: { 'Instagram|Kolkata': 0.4, 'Instagram|Hyderabad': 0.65 },
    strongPockets: { 'Google|Pune': 1.3 },
    competitors: [
      { competitor: 'Snackora', channel: 'Instagram', campaign: 'Trail Mix · Gym reels', engagement: 0.051 },
    ],
  },
};

// Build the export.
// options.twists: { pixelBreak: true } breaks Google tracking on the last day,
//                 { marketShock: true } adds an account-wide CPM spike on the last 2 days.
export function makeSample(brandKey = 'glowveda', options = {}) {
  const b = BRANDS[brandKey] || BRANDS.glowveda;
  const twists = options.twists || {};
  const rand = seeded(brandKey.length * 7919 + 17);
  const days = 14;
  const end = new Date(Date.now() - 24 * 3600e3); // data runs up to yesterday
  const rows = [];
  const orders = [];
  const competitors = [];

  for (let i = 0; i < days; i++) {
    const date = isoDay(new Date(end.getTime() - (days - 1 - i) * 24 * 3600e3));
    const t = i / (days - 1); // 0 on day 1, 1 on the last day
    const shock = twists.marketShock && i >= days - 2; // auction spike on the last 2 days
    const trueRevByChannel = {};

    for (const ad of b.ads) {
      const ch = b.channels[ad.channel];
      const adDaily = b.dailySpend * ch.share * ad.share;
      // Fatigue curve: CTR decays, CPM and frequency climb, faster near the end.
      const wear = ad.fatigue * Math.pow(t, 1.4);
      const ctrNow = ad.ctr * (1 - 0.55 * wear) * (shock ? 0.8 : 1);
      const cpmNow = ch.cpm * (1 + 0.35 * wear) * (shock ? 1.45 : 1);
      const freq = 1.3 + 3.2 * wear + (ad.fatigue > 0 ? 0.4 * t : 0);

      for (const [region, rShare] of Object.entries(b.regions)) {
        const noise = 0.9 + rand() * 0.2;
        const spend = Math.round(adDaily * rShare * noise);
        const impressions = Math.round((spend / cpmNow) * 1000);
        const clicks = Math.round(impressions * ctrNow * (0.92 + rand() * 0.16));
        const key = ad.channel + '|' + region;
        const pocket = b.weakPockets[key] || b.strongPockets[key] || 1;
        // Flatlined ad: in the last 4 days sales fall to ~35% and stop moving (almost no noise).
        const flat = ad.flatline && i >= days - 4;
        let conversions = Math.round(clicks * ad.cvr * pocket * (flat ? 0.35 : 0.9 + rand() * 0.2));
        const trueRevenue = conversions * b.aov;
        trueRevByChannel[ad.channel] = (trueRevByChannel[ad.channel] || 0) + trueRevenue;
        // Pixel break: Google stops reporting most conversions on the last day,
        // even though real Shopify orders keep coming in.
        if (twists.pixelBreak && ad.channel === 'Google' && i === days - 1) conversions = Math.round(conversions * 0.15);
        const platformRevenue = Math.round(conversions * b.aov * ch.overclaim);
        rows.push({
          date, channel: ad.channel, campaign: ad.campaign, ad: ad.ad, region,
          spend, impressions, reach: Math.round(impressions / freq), clicks,
          conversions: Math.round(conversions * ch.overclaim), platform_revenue: platformRevenue,
        });
      }
    }
    // Competitor ads seen that day (engagement wobbles a little day to day).
    for (const c of b.competitors || []) {
      const impressions = Math.round(180000 + rand() * 60000);
      competitors.push({ date, competitor: c.competitor, channel: c.channel, campaign: c.campaign, impressions,
        engagement_rate: Math.round(c.engagement * (0.93 + rand() * 0.14) * 10000) / 100 });
    }
    // Shopify orders tagged by UTM source = what really sold.
    for (const [channel, revenue] of Object.entries(trueRevByChannel)) {
      orders.push({ date, channel, orders: Math.round(revenue / b.aov), revenue: Math.round(revenue) });
    }
  }
  return { brand: b.name, category: b.category, who: b.who, rows, orders, competitors };
}

// Turn a list of objects into CSV text (used for the downloadable templates).
export function toCSV(list) {
  if (!list.length) return '';
  const cols = Object.keys(list[0]);
  const esc = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
  return [cols.join(','), ...list.map(r => cols.map(c => esc(r[c] ?? '')).join(','))].join('\n');
}
