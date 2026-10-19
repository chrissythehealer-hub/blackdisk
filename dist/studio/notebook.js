// AI Studio settings → Kaggle notebook. Pure functions shared by studio.js and tests/studio.test.mjs.
// Every option mirrors what studio-agent/workflows.py (Wan 2.2 TI2V 5B) can really produce.

export const EXAMPLE_PROMPT = 'A small red sports car driving along a coastal road at sunset, cinematic lighting, natural wheel movement, smooth camera tracking, realistic motion.';
export const PROMPT_MAX = 2000;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

// Aspect ratio → the sizes the model supports for it. "match" (image mode) lets the notebook pick
// 16:9 or 9:16 draft from the image's shape.
export const ASPECTS = {
  '16:9': { label: '16:9 · Landscape', sizes: { draft: { id: '16x9-draft', px: '832×480' }, hd: { id: '16x9', px: '1280×704' } } },
  '9:16': { label: '9:16 · Vertical', sizes: { draft: { id: '9x16-draft', px: '480×832' }, hd: { id: '9x16', px: '704×1280' } } },
  '1:1': { label: '1:1 · Square', sizes: { standard: { id: '1x1', px: '960×960' } }, note: 'Square isn’t a native shape for this model, so it has one size and is experimental.' },
  '4:5': { label: '4:5 · Portrait', sizes: { standard: { id: '4x5', px: '832×1024' } }, note: '4:5 isn’t a native shape for this model, so it has one size and is experimental.' },
  match: { label: 'Match my image', sizes: { draft: { id: 'auto', px: 'Draft size, landscape or vertical to match your image' } }, imageOnly: true },
};
export const SIZE_LABELS = { draft: 'Draft · fastest', hd: 'HD 720p · slower', standard: 'Standard · experimental' };
export const DURATIONS = { 25: '1 second', 49: '2 seconds', 81: '3.4 seconds', 121: '5 seconds (longest)' };
export const QUALITY = { fast: { steps: 12, label: 'Fast' }, balanced: { steps: 20, label: 'Balanced' }, detailed: { steps: 30, label: 'Detailed' } };
export const LIMITS = { steps: [8, 50], cfg: [1, 10] };
const SEED_MAX = 2n ** 63n - 1n;

/**
 * Checks raw form values. Unsupported combinations are corrected to the nearest valid option and
 * explained in `notes`; anything that can't be corrected safely is an error.
 * Returns { ok, settings?, notes, errors }.
 */
export function validateConfig(input, random = Math.random) {
  const errors = {};
  const notes = [];
  const mode = input.mode === 'image' ? 'image' : 'text';

  const prompt = String(input.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) errors.prompt = 'Describe what you want to see.';
  else if (prompt.length > PROMPT_MAX) errors.prompt = `Keep the description under ${PROMPT_MAX} characters.`;
  const negative = String(input.negative ?? '').replace(/\s+/g, ' ').trim();
  if (negative.length > PROMPT_MAX) errors.negative = `Keep this under ${PROMPT_MAX} characters.`;

  if (mode === 'image' && !input.imageData) errors.image = 'Add the image you want to animate.';

  let aspect = ASPECTS[input.aspect] ? input.aspect : '16:9';
  if (ASPECTS[aspect].imageOnly && mode !== 'image') { aspect = '16:9'; notes.push('“Match my image” needs an image, so 16:9 is used.'); }
  const sizes = ASPECTS[aspect].sizes;
  let size = input.size in sizes ? input.size : null;
  if (!size) {
    size = Object.keys(sizes)[0];
    if (input.size) notes.push(`${ASPECTS[aspect].label.split(' · ')[0]} has no ${SIZE_LABELS[input.size]?.split(' · ')[0] ?? input.size} option, so ${SIZE_LABELS[size].split(' · ')[0]} (${sizes[size].px}) is used.`);
  }

  const frames = Number(input.frames);
  if (!(frames in DURATIONS)) errors.frames = 'Choose one of the listed lengths.';

  let steps = QUALITY[input.quality]?.steps ?? QUALITY.balanced.steps;
  if (String(input.steps ?? '').trim() !== '') {
    const s = Number(input.steps);
    if (!Number.isInteger(s) || s < LIMITS.steps[0] || s > LIMITS.steps[1]) errors.steps = `Use a whole number from ${LIMITS.steps[0]} to ${LIMITS.steps[1]}.`;
    else steps = s;
  }
  let cfg = 5;
  if (String(input.cfg ?? '').trim() !== '') {
    const c = Number(input.cfg);
    if (!Number.isFinite(c) || c < LIMITS.cfg[0] || c > LIMITS.cfg[1]) errors.cfg = `Use a number from ${LIMITS.cfg[0]} to ${LIMITS.cfg[1]}.`;
    else cfg = Math.round(c * 10) / 10;
  }

  let seed;
  if (input.seedMode === 'fixed') {
    seed = String(input.seed ?? '').trim();
    if (!/^\d{1,19}$/.test(seed) || BigInt(seed) > SEED_MAX) errors.seed = 'Use a whole number, e.g. 42.';
  } else {
    seed = String(Math.floor(random() * 2 ** 31));
  }

  if (Object.keys(errors).length) return { ok: false, errors, notes };
  return {
    ok: true,
    notes,
    errors,
    settings: { mode, prompt, negative, imageData: mode === 'image' ? input.imageData : '', aspect, size, sizeId: sizes[size].id, sizePx: sizes[size].px, frames, steps, cfg, seed },
  };
}

/** Human-readable review of validated settings: [label, value] pairs. */
export function summarize(s) {
  return [
    ['Type', s.mode === 'image' ? 'Image to video' : 'Text to video'],
    ['Description', s.prompt],
    ['Shape', ASPECTS[s.aspect].label],
    ['Size', `${SIZE_LABELS[s.size]} · ${s.sizePx}`],
    ['Length', `${DURATIONS[s.frames]} · ${s.frames} frames at 24 fps`],
    ['Quality', `${s.steps} steps · guidance ${s.cfg}`],
    ['Seed', s.seed],
    ...(s.negative ? [['Avoid', s.negative]] : []),
  ];
}

// A JSON string literal is also a valid Python string literal for this text.
const py = s => JSON.stringify(s);

/** Returns a copy of the notebook with its settings cell filled in. Throws if the cell is missing. */
export function applySettings(notebook, s) {
  const nb = structuredClone(notebook);
  const cell = nb.cells.find(c => c.cell_type === 'code' && /^MODE\s*=\s*"/m.test(text(c)));
  if (!cell) throw new Error('settings cell not found');
  let src = text(cell);
  const values = {
    MODE: py(s.mode), IMAGE_URL: py(''), IMAGE_DATA: py(s.imageData || ''), PROMPT: py(s.prompt), SIZE: py(s.sizeId),
    FRAMES: String(s.frames), STEPS: String(s.steps), CFG: s.cfg.toFixed(1), NEGATIVE: py(s.negative), SEED: s.seed,
  };
  for (const [name, value] of Object.entries(values)) {
    const re = new RegExp(`^${name}\\s*=.*$`, 'm');
    if (!re.test(src)) throw new Error(`${name} not found in notebook`);
    src = src.replace(re, () => `${name} = ${value}`);
  }
  cell.source = src;
  return nb;
}

function text(cell) {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

export function notebookName(s) {
  const slug = s.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-') || 'clip';
  return `blvckdisk-${slug}-${s.seed}.ipynb`;
}

/** MP4 import check from the first bytes of the file: an ISO-BMFF container starts with a "ftyp" box. */
export function looksLikeMp4(headBytes) {
  return headBytes.length >= 12 && String.fromCharCode(...headBytes.slice(4, 8)) === 'ftyp';
}
