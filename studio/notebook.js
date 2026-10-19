// Fills the settings cell of the AI Studio Kaggle notebook (studio/kaggle/wan22_first_video.ipynb).
// Pure functions, shared by the page (studio.js) and tests/studio.test.mjs. The limits mirror
// studio-agent/workflows.py — the model cannot produce anything outside them.

export const LIMITS = {
  sizes: ['auto', '16x9-draft', '9x16-draft', '16x9', '9x16', '1x1', '4x5'],
  frames: [25, 49, 81, 121],
  steps: { min: 8, max: 50 },
  promptMax: 2000,
};

const SEED_MAX = 2n ** 63n - 1n;

/** Returns { ok: true, settings } or { ok: false, errors: { field: message } }. */
export function validateSettings(input, random = Math.random) {
  const errors = {};
  const mode = input.mode === 'image' ? 'image' : 'text';
  const prompt = String(input.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) errors.prompt = 'Describe the shot you want.';
  else if (prompt.length > LIMITS.promptMax) errors.prompt = `Keep the prompt under ${LIMITS.promptMax} characters.`;
  const size = LIMITS.sizes.includes(input.size) ? input.size : null;
  if (!size) errors.size = 'Choose one of the listed sizes.';
  const frames = Number(input.frames);
  if (!LIMITS.frames.includes(frames)) errors.frames = 'Choose one of the listed lengths.';
  const steps = Number(input.steps);
  if (!Number.isInteger(steps) || steps < LIMITS.steps.min || steps > LIMITS.steps.max) errors.steps = `Steps must be ${LIMITS.steps.min}–${LIMITS.steps.max}.`;
  let seed = String(input.seed ?? '').trim();
  if (!seed) seed = String(Math.floor(random() * 2 ** 31));
  else if (!/^\d{1,19}$/.test(seed) || BigInt(seed) > SEED_MAX) errors.seed = 'Seed must be a whole number (or leave it blank).';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, settings: { mode, prompt, size, frames, steps, seed } };
}

// JSON string literals are valid Python string literals for this text (escapes included).
const py = s => JSON.stringify(s);

/** Returns a new notebook object with the settings cell rewritten. Throws if the cell is missing. */
export function applySettings(notebook, s) {
  const nb = structuredClone(notebook);
  const cell = nb.cells.find(c => c.cell_type === 'code' && /^PROMPT = /m.test(text(c)));
  if (!cell) throw new Error('Settings cell not found in the notebook.');
  const replace = (src, name, value) => {
    const re = new RegExp(`^${name} = .*$`, 'm');
    if (!re.test(src)) throw new Error(`Setting ${name} not found in the notebook.`);
    return src.replace(re, () => `${name} = ${value}`);
  };
  let src = text(cell);
  src = replace(src, 'MODE', py(s.mode));
  src = replace(src, 'PROMPT', py(s.prompt));
  src = replace(src, 'SIZE', py(s.size));
  src = replace(src, 'FRAMES', String(s.frames));
  src = replace(src, 'STEPS', String(s.steps));
  src = replace(src, 'SEED', s.seed);
  cell.source = src;
  return nb;
}

function text(cell) {
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

/** "Slow push-in on a black disk" → "blvckdisk-studio-slow-push-in-on-a-black.ipynb" */
export function fileName(prompt) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 6).join('-');
  return `blvckdisk-studio-${slug || 'clip'}.ipynb`;
}
