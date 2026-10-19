// Renders studio/gallery.json into studio/index.html (between the gallery markers) and
// publishes the Kaggle notebook next to it. The page stays plain HTML: no runtime fetch.
//   npm run build:studio          write
//   node scripts/build-studio.mjs --check   fail if anything is out of date
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = p => fileURLToPath(new URL('../' + p, import.meta.url));
const check = process.argv.includes('--check');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const exists = p => stat(root(p.replace(/^\//, ''))).then(() => true, () => false);
const REQUIRED = ['id', 'title', 'date', 'video', 'mode', 'prompt', 'width', 'height', 'frames', 'fps', 'steps', 'cfg', 'seed', 'gpu', 'seconds'];

const { clips } = JSON.parse(await readFile(root('studio/gallery.json'), 'utf8'));
const problems = [];
const cards = [];
for (const [i, c] of clips.entries()) {
  for (const k of REQUIRED) if (c[k] === undefined || c[k] === '') problems.push(`clip ${i}: missing ${k}`);
  if (!/^\/studio\/videos\/[a-z0-9-]+\.(mp4|webm)$/.test(c.video)) problems.push(`clip ${c.id}: video must live in /studio/videos/`);
  // Only real files are shown as playable. A clip whose file hasn't been added yet is
  // listed honestly as "video file not yet published" instead of a broken player.
  const ready = await exists(c.video);
  const secs = (c.frames / c.fps).toFixed(1);
  const media = ready
    ? `<video controls muted loop playsinline preload="metadata" width="${c.width}" height="${c.height}" src="${esc(c.video)}" aria-label="${esc(c.title)}: generated video"></video>`
    : `<div class="clip-pending" style="aspect-ratio:${c.width}/${c.height}"><span class="dot" aria-hidden="true"></span><span>Video file not yet published</span></div>`;
  cards.push(`<article class="clip" id="clip-${esc(c.id)}"><div class="clip-media">${media}</div><div class="clip-body"><p class="eyebrow">${esc(c.mode)} · ${esc(c.date)}</p><h3>${esc(c.title)}</h3><p class="clip-prompt">“${esc(c.prompt)}”</p><dl class="clip-specs"><div><dt>Model</dt><dd>Wan 2.2 TI2V 5B</dd></div><div><dt>Size</dt><dd>${c.width}×${c.height}</dd></div><div><dt>Length</dt><dd>${c.frames} frames · ${c.fps} fps · ${secs} s</dd></div><div><dt>Steps / CFG</dt><dd>${c.steps} / ${c.cfg}</dd></div><div><dt>Seed</dt><dd>${esc(c.seed)}</dd></div><div><dt>Rendered on</dt><dd>Kaggle ${esc(c.gpu)} · ${c.seconds} s</dd></div></dl></div></article>`);
}
const block = `<!-- gallery:start (generated from studio/gallery.json by scripts/build-studio.mjs) -->${cards.join('') || '<p class="body-copy">The first clips are rendering.</p>'}<!-- gallery:end -->`;

const pagePath = root('studio/index.html');
const page = await readFile(pagePath, 'utf8');
const next = page.replace(/<!-- gallery:start[\s\S]*?<!-- gallery:end -->/, block);
if (next === page && !page.includes(block)) problems.push('studio/index.html: gallery markers not found');

const nb = await readFile(root('studio-agent/kaggle/wan22_first_video.ipynb'));
const nbPath = root('studio/blackdisk-ai-studio.ipynb');
const published = await readFile(nbPath).catch(() => Buffer.alloc(0));
const nbJson = JSON.parse(nb);
if (!nbJson.cells.some(c => c.cell_type === 'code' && /^MODE\s*=\s*"/m.test(c.source))) problems.push('notebook: settings cell (MODE = ...) not found');

if (problems.length) { console.error(problems.map(p => '✗ ' + p).join('\n')); process.exit(1); }
if (check) {
  const stale = [next !== page && 'studio/index.html gallery', !nb.equals(published) && 'studio/blackdisk-ai-studio.ipynb'].filter(Boolean);
  if (stale.length) { console.error(`✗ out of date: ${stale.join(', ')} — run npm run build:studio`); process.exit(1); }
  console.log(`✓ studio up to date (${clips.length} clip(s), ${cards.filter(c => c.includes('<video')).length} with video)`);
} else {
  await writeFile(pagePath, next);
  await writeFile(nbPath, nb);
  console.log(`wrote studio/index.html (${clips.length} clip(s)) and studio/blackdisk-ai-studio.ipynb`);
}
