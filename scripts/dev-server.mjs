// scripts/dev-server.mjs — local preview without Vercel: serves the files and the /api routes.
// Usage: node scripts/dev-server.mjs  → http://localhost:8790
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const mod = await import(join(root, url.pathname + '.js'));
    const body = req.method === 'POST' ? await new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); }) : undefined;
    const out = await mod[req.method](new Request('http://localhost' + req.url, { method: req.method, body }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    for await (const chunk of out.body || []) res.write(chunk);
    return res.end();
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try { res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end('not found'); }
}).listen(8790, () => console.log('http://localhost:8790'));
