// Local preview that behaves like vercel.json: dist/ served statically, trailingSlash redirects,
// and /api/inquiry answered by a stub (no email is sent from a preview).
//   npm run preview  → http://localhost:4173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.ipynb': 'application/x-ipynb+json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = normalize(decodeURIComponent(url.pathname));
  if (path.startsWith('/api/inquiry')) {
    res.writeHead(req.method === 'POST' ? 200 : 405, { 'Content-Type': 'application/json', Allow: 'POST' });
    return res.end(JSON.stringify(req.method === 'POST' ? { ok: true, preview: true } : { error: 'method_not_allowed' }));
  }
  const isFile = await stat(join(ROOT, path)).then(s => s.isFile(), () => false);
  if (!isFile && !path.endsWith('/')) { res.writeHead(308, { Location: path + '/' + url.search }); return res.end(); }
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('The page could not be found'); }
}).listen(PORT, () => console.log(`preview on http://localhost:${PORT}`));
