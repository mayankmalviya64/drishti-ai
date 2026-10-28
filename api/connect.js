// api/connect.js
// Real data connectors that the browser cannot call directly (CORS / tokens):
//   POST { type: 'sheet', url }                      → CSV text of a public Google Sheet tab
//   POST { type: 'meta', token, account, days? }    → last N days of Meta ad insights (Marketing API)
//   POST { type: 'gads', token, devToken, customer, manager? } → last 14 days of Google Ads, per ad
//   POST { type: 'ga4', token, property }           → last 14 days of GA4 purchases by traffic source
//   POST { type: 'shopify', shop, token }           → last 14 days of Shopify orders by UTM source
// Only these fixed hosts are ever contacted (Shopify: only *.myshopify.com), so the
// route can't be abused as a proxy. Tokens are used for this one pull and never stored.
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 20000); } catch (e) { return json({ error: e.message }, 400); }
  try {
    if (body.type === 'sheet') return json(await fromSheet(body.url));
    if (body.type === 'meta') return json(await fromMeta(body));
    if (body.type === 'gads') return json(await fromGoogleAds(body));
    if (body.type === 'ga4') return json(await fromGA4(body));
    if (body.type === 'shopify') return json(await fromShopify(body));
    return json({ error: 'Unknown connector' }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 400);
  }
}

// --- Google Sheets: the sheet must be shared as "Anyone with the link can view" ---
async function fromSheet(url = '') {
  const id = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  if (!id) throw new Error('That does not look like a Google Sheets link.');
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!res.ok || /<html/i.test(text.slice(0, 200))) throw new Error('Could not read the sheet. Share it as "Anyone with the link can view" and try again.');
  return { csv: text };
}

// --- Meta Marketing API: ad-level daily insights with region breakdown ---
// Token: a user/system token with ads_read (Graph API Explorer works for testing).
async function fromMeta({ token, account, days = 14 }) {
  if (!token || !account) throw new Error('Meta needs an access token and an ad account ID.');
  const act = String(account).replace(/^act_/, '').replace(/\D/g, '');
  const params = new URLSearchParams({
    level: 'ad', time_increment: '1', breakdowns: 'region', limit: '500',
    date_preset: days > 14 ? 'last_30d' : 'last_14d',
    fields: 'date_start,campaign_name,ad_name,spend,impressions,reach,clicks,actions,action_values',
    access_token: token,
  });
  let url = `https://graph.facebook.com/v21.0/act_${act}/insights?${params}`;
  const rows = [];
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (data.error) throw new Error('Meta: ' + data.error.message);
    for (const r of data.data || []) {
      const purchase = list => Number((list || []).find(x => /purchase/.test(x.action_type))?.value || 0);
      rows.push({
        date: r.date_start, channel: 'Meta', campaign: r.campaign_name, ad: r.ad_name, region: r.region || 'All',
        spend: Number(r.spend || 0), impressions: Number(r.impressions || 0), reach: Number(r.reach || 0), clicks: Number(r.clicks || 0),
        conversions: purchase(r.actions), platform_revenue: purchase(r.action_values),
      });
    }
    url = data.paging?.next && data.paging.next.startsWith('https://graph.facebook.com/') ? data.paging.next : null;
  }
  if (!rows.length) throw new Error('Meta returned no ad data for the last 14 days on this account.');
  return { rows };
}


// "Last 14 days" as YYYY-MM-DD strings (yesterday back to 14 days ago)
const isoDay = d => d.toISOString().slice(0, 10);
const daysAgo = n => isoDay(new Date(Date.now() - n * 864e5));

// --- Google Ads API: ad-level daily cost, clicks, conversions ---
// Needs: an OAuth access token (scope adwords), a developer token from the Google Ads
// API Center, and the 10-digit customer ID. A manager (MCC) ID is needed only when the
// account is reached through a manager account.
const GADS_VERSION = 'v21'; // Google retires old versions about once a year; bump this if Google says it is sunset
async function fromGoogleAds({ token, devToken, customer, manager }) {
  if (!token || !devToken || !customer) throw new Error('Google Ads needs an access token, a developer token and a customer ID.');
  const cid = String(customer).replace(/\D/g, '');
  const headers = { Authorization: `Bearer ${token}`, 'developer-token': devToken, 'Content-Type': 'application/json' };
  if (manager) headers['login-customer-id'] = String(manager).replace(/\D/g, '');
  const query = `SELECT segments.date, campaign.name, ad_group.name, ad_group_ad.ad.name, ad_group_ad.ad.id,
    metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value
    FROM ad_group_ad WHERE segments.date DURING LAST_14_DAYS AND metrics.impressions > 0`;
  const res = await fetch(`https://googleads.googleapis.com/${GADS_VERSION}/customers/${cid}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => null);
  const err = (Array.isArray(data) ? data[0]?.error : data?.error);
  if (!res.ok || err) throw new Error('Google Ads: ' + (err?.message || `error ${res.status}`));
  const rows = [];
  for (const batch of data || []) {
    for (const r of batch.results || []) {
      const m = r.metrics || {};
      rows.push({
        date: r.segments?.date, channel: 'Google', campaign: r.campaign?.name || 'Campaign',
        ad: r.adGroupAd?.ad?.name || r.adGroup?.name || `Ad ${r.adGroupAd?.ad?.id || ''}`.trim(), region: 'All',
        spend: Number(m.costMicros || 0) / 1e6, impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
        conversions: Number(m.conversions || 0), platform_revenue: Number(m.conversionsValue || 0),
      });
    }
  }
  if (!rows.length) throw new Error('Google Ads returned no ad data for the last 14 days on this account.');
  return { rows };
}

// --- GA4 Data API: purchases and revenue per day and traffic source ---
// This is the site's own record of what sold, so it works like Shopify orders:
// it is what Drishti checks the ad platforms' claims against.
// Needs: an OAuth access token (scope analytics.readonly) and the numeric property ID.
async function fromGA4({ token, property }) {
  if (!token || !property) throw new Error('GA4 needs an access token and a property ID.');
  const pid = String(property).replace(/\D/g, '');
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: '14daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'date' }, { name: 'sessionSource' }],
      metrics: [{ name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }],
      limit: 10000,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error('GA4: ' + (data.error?.message || `error ${res.status}`));
  const orders = (data.rows || []).map(r => {
    const d = r.dimensionValues[0].value; // "20261027"
    return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, channel: r.dimensionValues[1].value,
      orders: Number(r.metricValues[0].value || 0), revenue: Number(r.metricValues[1].value || 0) };
  }).filter(o => o.orders > 0 || o.revenue > 0);
  if (!orders.length) throw new Error('GA4 returned no purchases for the last 14 days. Check that e-commerce events are set up on this property.');
  return { orders };
}

// --- Shopify Admin API: real orders, grouped by day and UTM source ---
// Needs: the store's myshopify.com address and an Admin API access token (shpat_…)
// from a custom app with the read_orders permission.
const SHOPIFY_VERSION = '2025-10'; // Shopify answers with its oldest supported version if this one is retired
async function fromShopify({ shop, token }) {
  if (!shop || !token) throw new Error('Shopify needs the store address and an Admin API access token.');
  const host = String(shop).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const domain = host.endsWith('.myshopify.com') ? host : host + '.myshopify.com';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('Use the store\'s myshopify.com address, e.g. glowveda.myshopify.com');
  const params = new URLSearchParams({ status: 'any', limit: '250', created_at_min: daysAgo(14) + 'T00:00:00Z',
    fields: 'created_at,total_price,landing_site,referring_site,source_name,cancelled_at' });
  let url = `https://${domain}/admin/api/${SHOPIFY_VERSION}/orders.json?${params}`;
  const byKey = new Map(); // "date||source" → { orders, revenue }
  for (let page = 0; page < 40 && url; page++) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Shopify: ' + (data.errors ? JSON.stringify(data.errors).slice(0, 160) : `error ${res.status}`));
    for (const o of data.orders || []) {
      if (o.cancelled_at) continue;
      const key = isoDay(new Date(o.created_at)) + '||' + orderSource(o);
      const x = byKey.get(key) || { orders: 0, revenue: 0 };
      x.orders += 1; x.revenue += Number(o.total_price || 0);
      byKey.set(key, x);
    }
    // Next page: Shopify puts it in the Link header (rel="next"), always on the same store
    const next = (res.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    url = next && next[1].startsWith(`https://${domain}/`) ? next[1] : null;
  }
  const orders = [...byKey].map(([k, v]) => { const [date, channel] = k.split('||'); return { date, channel, orders: v.orders, revenue: Math.round(v.revenue) }; });
  if (!orders.length) throw new Error('Shopify returned no orders for the last 14 days.');
  return { orders };
}

// Where an order came from: utm_source on the landing page, else the referring site, else "Direct"
function orderSource(o) {
  try {
    const utm = new URL(o.landing_site || '/', 'https://x.invalid').searchParams.get('utm_source');
    if (utm) return utm;
  } catch {}
  try { if (o.referring_site) return new URL(o.referring_site).hostname.replace(/^www\.|^m\.|^l\./, ''); } catch {}
  return 'Direct';
}
