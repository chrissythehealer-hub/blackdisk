// Site checks: every page shares the same header/nav, internal links and assets resolve,
// nothing Cloudflare-injected or secret-looking is committed, scripts parse, and tests pass.
//   npm run check
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', '.vercel']);
const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else out.push(p);
  }
  return out;
}
const exists = p => stat(p).then(() => true, () => false);
const files = (await walk(ROOT)).map(f => relative(ROOT, f));
const pages = files.filter(f => f.startsWith('dist/') && f.endsWith('index.html'));

// Public paths a page may link to: the pages themselves plus the serverless function.
const resolveLocal = async href => {
  const path = decodeURI(href.split(/[?#]/)[0]);
  if (path === '/api/inquiry' || path === '/api/inquiry/') return exists(join(ROOT, 'api/inquiry.mjs'));
  return exists(join(ROOT, 'dist', path.endsWith('/') ? path + 'index.html' : path));
};

let navRef;
for (const page of pages) {
  const html = await readFile(join(ROOT, page), 'utf8');
  if (!/^<!doctype html>/i.test(html)) fail(page, 'missing doctype');
  if (!/<html lang="en">/.test(html)) fail(page, 'missing lang');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(page, 'missing title');
  if (!/<meta name="viewport"/.test(html)) fail(page, 'missing viewport');
  if (/cdn-cgi|__cf_email__/.test(html)) fail(page, 'contains Cloudflare-injected markup');
  const nav = html.match(/<nav id="site-nav"[\s\S]*?<\/nav>/)?.[0];
  if (!nav) fail(page, 'missing main navigation');
  else if (navRef === undefined) navRef = nav;
  else if (nav !== navRef) fail(page, 'navigation differs from other pages');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  if (ids.size !== [...html.matchAll(/\sid="/g)].length) fail(page, 'duplicate id');
  for (const [, attr, ref] of html.matchAll(/\s(href|src|poster|data-src)="([^"]*)"/g)) {
    if (ref.startsWith('#')) { if (ref.length > 1 && !ids.has(ref.slice(1))) fail(page, `broken anchor ${ref}`); continue; }
    if (/^(https?:|mailto:|tel:)/.test(ref)) continue;
    if (!ref.startsWith('/')) { fail(page, `relative ${attr} "${ref}" (use root-relative paths)`); continue; }
    if (!(await resolveLocal(ref))) fail(page, `${attr} "${ref}" does not resolve`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) fail(page, 'img without alt');
}

// Secrets: the repository is public.
const SECRET = /(re_[A-Za-z0-9_]{20,}|sk_(live|test)_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY|vercel_[A-Za-z0-9]{20,}|0x4AAAA[A-Za-z0-9_-]{10,})/;
for (const f of files) {
  if (/\.(jpg|png|webp|mp4|webm|ico)$/.test(f)) continue;
  if (/^\.env(?!\.example$)/.test(f)) fail(f, 'environment file must not be committed');
  const text = await readFile(join(ROOT, f), 'utf8');
  if (SECRET.test(text)) fail(f, 'looks like it contains a secret');
  if (f.endsWith('.json') || f.endsWith('.ipynb')) { try { JSON.parse(text); } catch (e) { fail(f, `invalid JSON: ${e.message}`); } }
  if (f.endsWith('.env.example') && /=\S/.test(text.replace(/^#.*$/gm, ''))) fail(f, 'must list names only, no values');
}

for (const f of files.filter(f => /\.(m?js)$/.test(f))) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); } catch (e) { fail(f, e.stderr.toString().split('\n').slice(0, 4).join(' ')); }
}

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s)\n` + problems.map(p => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`✓ ${pages.length} pages, ${files.length} files checked`);
try {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-studio.mjs'), '--check'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', ...files.filter(f => f.endsWith('.test.mjs'))], { cwd: ROOT, stdio: 'inherit' });
} catch { process.exit(1); }
