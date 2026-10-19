// AI Studio: guided Configure → Prepare → Generate → Import wizard plus "My Projects".
// Everything runs in the browser. Generation happens in the visitor's own Kaggle notebook; this page
// never claims a run is going or finished, because it can't see Kaggle. Statuses here are only what
// the visitor did (prepared, started, reported a failure, imported the video).
//
// Live on-site generation is deliberately absent (no always-on GPU at $0). Before it is ever added:
// put Cloudflare Turnstile in front of the endpoint and enforce per-visitor limits server-side.
import { ASPECTS, EXAMPLE_PROMPT, IMAGE_MAX_BYTES, PROMPT_MAX, SIZE_LABELS, applySettings, looksLikeMp4, notebookName, summarize, validateConfig } from '/studio/notebook.js';
import * as lib from '/studio/library.js';

const $ = id => document.getElementById(id);
const form = $('wizard');
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const STATUS = {
  prepared: 'Notebook prepared',
  waiting: 'Waiting for Kaggle',
  failed: 'Generation failed',
  imported: 'Video imported',
};
const state = { step: 1, imageData: '', imageName: '', settings: null, notes: [], project: null, randomSeed: null };
const urls = new Set(); // object URLs to release when the library re-renders
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = msg => { $('wizard-live').textContent = msg; };
const mb = n => (n < 100 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);

/* ------------------------------------------------------------------ steps */
function go(step, { focus = true } = {}) {
  if (step === 2 && !review()) return;
  if (step === 3 && !state.project) return say('Download your notebook first.');
  state.step = step;
  form.querySelectorAll('.wizard-panel').forEach(p => { p.hidden = Number(p.dataset.panel) !== step; });
  document.querySelectorAll('.wizard-steps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('done', n < step);
    if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  if (focus) {
    const h = $(`p${step}-title`);
    document.getElementById('create').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    h.focus({ preventScroll: true });
  }
  say(`Step ${step} of 4: ${['Configure', 'Prepare', 'Generate', 'Import video'][step - 1]}`);
}
form.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) go(Number(b.dataset.go));
});
form.addEventListener('submit', e => e.preventDefault());

/* ------------------------------------------------------------------ step 1: configure */
const prompt = $('w-prompt');
const count = () => { $('w-prompt-count').textContent = `${prompt.value.length} / ${PROMPT_MAX}`; };
prompt.addEventListener('input', () => { count(); fieldError('prompt', ''); });
$('use-example').addEventListener('click', () => { prompt.value = EXAMPLE_PROMPT; count(); fieldError('prompt', ''); prompt.focus(); });

function mode() { return form.elements.mode.value; }
function renderMode() {
  const image = mode() === 'image';
  $('image-field').hidden = !image;
  $('aspect-match').hidden = !image;
  if (!image && form.elements.aspect.value === 'match') form.elements.aspect.value = '16:9';
  if (image && !state.imageData && form.elements.aspect.value === '16:9') form.elements.aspect.value = 'match';
  renderSizes();
}
function renderSizes() {
  const aspect = ASPECTS[form.elements.aspect.value] ?? ASPECTS['16:9'];
  const current = form.elements.size?.value;
  $('size-choices').innerHTML = Object.entries(aspect.sizes).map(([key, s], i) =>
    `<label><input type="radio" name="size" value="${key}"${(current === key || (!(current in aspect.sizes) && i === 0)) ? ' checked' : ''}><span>${esc(SIZE_LABELS[key])}<small>${esc(s.px)}</small></span></label>`).join('');
  $('aspect-note').textContent = aspect.note ?? '';
}
form.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', renderMode));
form.querySelectorAll('input[name=aspect]').forEach(r => r.addEventListener('change', renderSizes));
form.querySelectorAll('input[name=seedMode]').forEach(r => r.addEventListener('change', () => {
  const fixed = form.elements.seedMode.value === 'fixed';
  $('seed-field').hidden = !fixed;
  if (fixed) $('w-seed').focus();
}));

// Image: decoded and scaled down in the browser (longest side 1280 px, JPEG) so it fits inside the
// notebook. The model works at 480–1280 px anyway.
const imageInput = $('w-image');
imageInput.addEventListener('change', () => loadImage(imageInput.files[0]));
$('image-replace').addEventListener('click', () => imageInput.click());
$('image-remove').addEventListener('click', () => { clearImage(); imageInput.value = ''; imageInput.focus(); });
function clearImage() {
  state.imageData = '';
  state.imageName = '';
  $('image-preview').hidden = true;
  $('image-actions').hidden = true;
  $('image-empty').hidden = false;
  imageInput.hidden = false;
}
async function loadImage(file) {
  fieldError('image', '');
  if (!file) return;
  if (!file.type.startsWith('image/')) return fieldError('image', 'That isn’t an image. Choose a JPG, PNG or WebP photo.');
  if (file.size > IMAGE_MAX_BYTES) return fieldError('image', `That image is ${mb(file.size)}. Choose one under 20 MB.`);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
    state.imageData = String(dataUrl).split(',')[1];
    state.imageName = file.name;
    $('image-thumb').src = dataUrl;
    $('image-meta').textContent = `${file.name} · ${canvas.width}×${canvas.height} · ${canvas.width === canvas.height ? 'square' : canvas.width > canvas.height ? 'landscape' : 'vertical'}`;
    $('image-preview').hidden = false;
    $('image-actions').hidden = false;
    $('image-empty').hidden = true;
    imageInput.hidden = true;
    say('Image added.');
  } catch {
    clearImage();
    fieldError('image', 'This image couldn’t be read. Try a JPG or PNG. (Some iPhone HEIC photos need to be exported as JPG first.)');
  }
}

const FIELDS = { prompt: 'w-prompt', image: 'w-image', seed: 'w-seed', negative: 'w-negative', steps: 'w-steps', cfg: 'w-cfg' };
function fieldError(field, msg) {
  const el = $(`${FIELDS[field]}-error`);
  el.hidden = !msg;
  el.textContent = msg;
  const input = $(FIELDS[field]);
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

/* ------------------------------------------------------------------ step 2: review + prepare */
function review() {
  const data = Object.fromEntries(new FormData(form));
  // "Surprise me" draws one seed per video and keeps it, so stepping back doesn't change the result.
  if (data.seedMode !== 'fixed') {
    state.randomSeed ??= String(crypto.getRandomValues(new Uint32Array(1))[0] >>> 1);
    Object.assign(data, { seedMode: 'fixed', seed: state.randomSeed });
  }
  const check = validateConfig({ ...data, imageData: state.imageData });
  for (const f of Object.keys(FIELDS)) fieldError(f, check.errors[f] ?? '');
  if (!check.ok) {
    const first = Object.keys(FIELDS).find(f => check.errors[f]);
    const el = first === 'image' ? $('image-drop') : $(FIELDS[first]);
    if (['negative', 'steps', 'cfg'].includes(first)) form.querySelector('.advanced').open = true;
    if (first === 'seed') $('seed-field').hidden = false;
    el.scrollIntoView({ block: 'center' });
    (first === 'image' ? imageInput : el).focus?.({ preventScroll: true });
    say(`Please fix: ${check.errors[first]}`);
    return false;
  }
  const changed = !state.settings || JSON.stringify(check.settings) !== JSON.stringify(state.settings);
  state.settings = check.settings;
  state.notes = check.notes;
  if (changed) { state.project = null; $('to-generate').disabled = true; $('prepare-status').textContent = ''; }
  $('review').innerHTML = summarize(check.settings).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')
    + (check.settings.mode === 'image' ? `<div><dt>Image</dt><dd>${esc(state.imageName)} (included in the notebook)</dd></div>` : '');
  $('review-notes').hidden = !check.notes.length;
  $('review-notes').innerHTML = check.notes.map(n => `<li>${esc(n)}</li>`).join('');
  return true;
}

$('download-notebook').addEventListener('click', async () => {
  const status = $('prepare-status');
  status.textContent = 'Preparing your notebook…';
  try {
    const res = await fetch('/studio/blackdisk-ai-studio.ipynb', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const nb = applySettings(await res.json(), state.settings);
    const name = notebookName(state.settings);
    const url = URL.createObjectURL(new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    const { imageData, ...settings } = state.settings; // the image stays inside the notebook file only
    state.project = await lib.saveProject({
      id: state.project?.id ?? lib.newId(), created: state.project?.created ?? Date.now(), source: 'studio',
      title: settings.prompt.slice(0, 80), settings, notebook: name, status: 'prepared',
    }).catch(() => ({ id: lib.newId(), settings, notebook: name, status: 'prepared', created: Date.now(), source: 'studio' }));
    lib.requestPersistence();
    status.textContent = `Downloaded ${name}. Next: open Kaggle and import it.`;
    $('to-generate').disabled = false;
    renderLibrary();
  } catch (err) {
    status.textContent = `The notebook couldn’t be prepared (${err.message}). Check your connection and try again.`;
  }
});

/* ------------------------------------------------------------------ step 3: generate (on Kaggle) */
async function setStatus(status, message) {
  if (!state.project) return;
  state.project = await lib.saveProject({ ...state.project, status }).catch(() => ({ ...state.project, status }));
  $('generate-status').textContent = message;
  renderLibrary();
}
$('mark-started').addEventListener('click', () => setStatus('waiting', 'Saved as “Waiting for Kaggle”. Check the Versions list on Kaggle for the real status; come back here when the check mark appears.'));
$('mark-failed').addEventListener('click', () => {
  setStatus('failed', 'Saved as “Generation failed”. The fixes below cover the common causes. You can go back, adjust settings and prepare a new notebook.');
  $('troubleshoot').querySelector('details').open = true;
  $('troubleshoot').scrollIntoView({ block: 'start' });
});

/* ------------------------------------------------------------------ step 4 + library: importing MP4s */
async function importVideo(file, { project, onProgress }) {
  if (!file) throw new Error('No file chosen.');
  if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') throw new Error('Choose an MP4 file (Kaggle’s first_video.mp4).');
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`That file is ${mb(file.size)}. The limit is 500 MB.`);
  if (file.size < 1024) throw new Error('That file is empty or incomplete. Download it from Kaggle again.');
  if (!looksLikeMp4(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) throw new Error('That file isn’t a valid MP4. Download first_video.mp4 from Kaggle’s Output again.');
  // Read in chunks to report real progress while copying into browser storage.
  const reader = file.stream().getReader();
  const chunks = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    chunks.push(value);
    done += value.byteLength;
    onProgress?.(Math.round((done / file.size) * 90));
  }
  const blob = new Blob(chunks, { type: 'video/mp4' });
  const record = await lib.saveProject({
    ...(project ?? { id: lib.newId(), created: Date.now(), source: 'upload', title: file.name.replace(/\.mp4$/i, '') }),
    status: 'imported', video: { name: file.name, size: file.size, imported: Date.now() },
  });
  await lib.saveVideo(record.id, blob);
  lib.requestPersistence();
  onProgress?.(100);
  return { record, blob };
}

$('w-video').addEventListener('change', async e => {
  const file = e.target.files[0];
  const err = $('w-video-error');
  const bar = $('video-progress');
  err.hidden = true;
  $('import-preview').hidden = true;
  if (!file) return;
  bar.hidden = false;
  bar.value = 0;
  try {
    const { record, blob } = await importVideo(file, { project: state.project, onProgress: v => { bar.value = v; } });
    state.project = record;
    const url = URL.createObjectURL(blob);
    urls.add(url);
    $('import-video').src = url;
    $('import-preview').hidden = false;
    $('import-status').textContent = `✓ Imported ${file.name} (${mb(file.size)}). It’s saved in My Projects in this browser.`;
    say('Video imported.');
    renderLibrary();
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  } finally {
    bar.hidden = true;
    e.target.value = '';
  }
});
$('import-video').addEventListener('error', () => {
  $('import-status').textContent += ' This browser can’t play it here, but the file is saved. Use Download in My Projects to watch it.';
});

$('new-video').addEventListener('click', () => {
  state.project = null;
  state.settings = null;
  state.randomSeed = null;
  $('to-generate').disabled = true;
  $('prepare-status').textContent = '';
  $('generate-status').textContent = '';
  $('import-preview').hidden = true;
  go(1);
});

$('lib-import').addEventListener('change', async e => {
  const err = $('lib-error');
  err.hidden = true;
  try {
    await importVideo(e.target.files[0], {});
    renderLibrary();
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  } finally {
    e.target.value = '';
  }
});

/* ------------------------------------------------------------------ My Projects */
document.querySelectorAll('input[name=filter]').forEach(r => r.addEventListener('change', renderLibrary));

async function renderLibrary() {
  const box = $('library');
  let projects;
  try {
    projects = await lib.listProjects();
  } catch {
    box.innerHTML = '<p class="empty">This browser can’t save projects (private browsing or storage turned off). You can still prepare notebooks and download videos.</p>';
    return;
  }
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
  const filter = document.querySelector('input[name=filter]:checked')?.value ?? 'all';
  const shown = projects.filter(p => filter === 'all' || (filter === 'generated' ? p.source === 'studio' && p.video : p.source === 'upload'));
  if (!shown.length) {
    box.innerHTML = `<p class="empty">${projects.length ? 'Nothing here yet in this view.' : 'No projects yet. Prepare a notebook above and it will appear here.'}</p>`;
  } else {
    box.innerHTML = shown.map(p => {
      const s = p.settings;
      const details = s ? summarize(s).filter(([k]) => k !== 'Description').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') : '';
      return `<article class="project" data-id="${esc(p.id)}">
<div class="project-media">${p.video ? '<video controls playsinline muted preload="metadata"></video>' : `<div class="clip-pending"><span class="dot" aria-hidden="true"></span><span>${p.status === 'failed' ? 'No video · run failed' : 'No video yet'}</span></div>`}</div>
<div class="project-body"><p class="eyebrow">${p.source === 'upload' ? 'Imported video' : 'Studio project'} · ${new Date(p.created).toLocaleDateString()}</p>
<span class="tag tag-${esc(p.status)}">${esc(STATUS[p.status] ?? p.status)}</span>
<h3>${esc(s?.prompt ?? p.title)}</h3>
${details ? `<dl class="clip-specs">${details}</dl>` : ''}
${p.video ? `<p class="form-note">${esc(p.video.name)} · ${mb(p.video.size)}</p>` : ''}
<div class="inline-actions">${p.video ? '<button type="button" class="pill-button" data-act="download">Download</button>' : '<button type="button" class="pill-button" data-act="continue">Continue</button>'}<button type="button" class="pill-button danger" data-act="delete">Delete</button></div></div></article>`;
    }).join('');
    for (const el of box.querySelectorAll('.project')) {
      const p = shown.find(x => x.id === el.dataset.id);
      if (!p.video) continue;
      lib.getVideo(p.id).then(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        urls.add(url);
        el.querySelector('video').src = url;
      });
    }
  }
  const est = await lib.usage();
  if (est?.usage != null) $('storage-usage').textContent = `${projects.length} PROJECT${projects.length === 1 ? '' : 'S'} · ${mb(est.usage)} USED IN THIS BROWSER`;
}

$('library').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('.project').dataset.id;
  const p = await lib.getProject(id);
  if (!p) return renderLibrary();
  if (b.dataset.act === 'delete') {
    if (!confirm(`Delete “${(p.settings?.prompt ?? p.title).slice(0, 60)}”${p.video ? ' and its video' : ''} from this browser? This can’t be undone.`)) return;
    await lib.deleteProject(id);
    if (state.project?.id === id) state.project = null;
    renderLibrary();
  } else if (b.dataset.act === 'download') {
    const blob = await lib.getVideo(id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: p.video.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } else if (b.dataset.act === 'continue') {
    state.project = p;
    state.settings = p.settings;
    $('to-generate').disabled = false;
    $('generate-status').textContent = `Continuing “${p.settings.prompt.slice(0, 60)}”. Status: ${STATUS[p.status]}. To change settings, start a new video.`;
    go(3);
  }
});

/* ------------------------------------------------------------------ start */
count();
renderMode();
go(1, { focus: false });
renderLibrary();
