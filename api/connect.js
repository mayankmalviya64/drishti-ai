// api/connect.js
// Real data connectors that the browser cannot call directly (CORS / tokens):
//   POST { type: 'sheet', url }                      → CSV text of a public Google Sheet tab
//   POST { type: 'meta', token, account, days? }    → last N days of Meta ad insights (Marketing API)
// Only these two fixed hosts are ever contacted, so the route can't be abused as a proxy.
import { json, preflight, readBody } from '../lib/http.js';

export const OPTIONS = preflight;

export async function POST(request) {
  let body;
  try { body = await readBody(request, 20000); } catch (e) { return json({ error: e.message }, 400); }
  try {
    if (body.type === 'sheet') return json(await fromSheet(body.url));
    if (body.type === 'meta') return json(await fromMeta(body));
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
