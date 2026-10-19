// Compares this repository with what https://blackdisk.co serves right now.
// Cloudflare rewrites email links on the way out (email obfuscation), so those are
// decoded before comparing; everything else must match byte for byte.
//   node scripts/verify-live.mjs [base-url]
import { readFile } from 'node:fs/promises';

const BASE = (process.argv[2] || 'https://blackdisk.co').replace(/\/$/, '');
const PAGES = ['/', '/about/', '/services/', '/work/', '/start/'];
const ASSETS = ['/style.css', '/site.js', '/favicon.svg', '/brand-study.jpg'];

const decode = hex => {
  const k = parseInt(hex.slice(0, 2), 16);
  let s = '';
  for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
  return s;
};
const unCloudflare = html => html
  .replace(/<a href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"><span class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/span><\/a>/g,
    (_, h, t) => `<a href="mailto:${decode(h)}">${decode(t)}</a>`)
  .replace(/<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/a>/g,
    (_, h) => `<a href="mailto:${decode(h)}">${decode(h)}</a>`)
  .replace('<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>', '');

const local = p => new URL('..' + (p.endsWith('/') ? p + 'index.html' : p), import.meta.url);
let failed = 0;
for (const p of [...PAGES, ...ASSETS]) {
  const res = await fetch(BASE + p);
  const remote = Buffer.from(await res.arrayBuffer());
  const mine = await readFile(local(p));
  const same = PAGES.includes(p) ? unCloudflare(remote.toString()) === mine.toString() : remote.equals(mine);
  if (!same || !res.ok) failed++;
  console.log(`${same && res.ok ? 'MATCH ' : 'DIFFER'} ${res.status} ${p}`);
}
const api = await fetch(BASE + '/api/inquiry/');
const apiOk = api.status === 405 && api.headers.get('allow') === 'POST';
if (!apiOk) failed++;
console.log(`${apiOk ? 'MATCH ' : 'DIFFER'} ${api.status} GET /api/inquiry/ (expects 405, Allow: POST)`);
const slash = await fetch(BASE + '/about', { redirect: 'manual' });
const slashOk = slash.status === 308 && slash.headers.get('location')?.endsWith('/about/');
if (!slashOk) failed++;
console.log(`${slashOk ? 'MATCH ' : 'DIFFER'} ${slash.status} /about → /about/ (trailingSlash)`);
process.exitCode = failed ? 1 : 0;
