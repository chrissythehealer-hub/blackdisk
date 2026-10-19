// AI Studio page: builds a personalised Kaggle notebook in the browser. Nothing is sent anywhere.
import { applySettings, fileName, validateSettings } from '/studio/notebook.js';

const form = document.querySelector('#studio-form');
const result = document.querySelector('#studio-result');
const imageNote = document.querySelector('#image-note');
const errorFields = { prompt: 's-prompt', size: 's-size', frames: 's-frames', steps: 's-steps', seed: 's-seed' };

form.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
  imageNote.hidden = form.elements.mode.value !== 'image';
}));

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const check = validateSettings(data);
  const errors = check.ok ? {} : check.errors;
  let first = null;
  for (const [field, id] of Object.entries(errorFields)) {
    const input = document.getElementById(id);
    const msg = document.getElementById(`${id}-error`);
    if (errors[field]) { input.setAttribute('aria-invalid', 'true'); first ??= input; } else input.removeAttribute('aria-invalid');
    if (msg) { msg.hidden = !errors[field]; msg.textContent = errors[field] || ''; }
  }
  if (!check.ok) {
    result.textContent = Object.values(errors).join(' ');
    if (first) { first.closest('details')?.setAttribute('open', ''); first.focus(); }
    return;
  }
  result.textContent = 'Preparing your notebook…';
  try {
    const res = await fetch('/studio/kaggle/wan22_first_video.ipynb');
    if (!res.ok) throw new Error(`notebook download failed (${res.status})`);
    const nb = applySettings(await res.json(), check.settings);
    const url = URL.createObjectURL(new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName(check.settings.prompt) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    result.textContent = `Downloaded ${a.download} (seed ${check.settings.seed}). Import it into Kaggle and run it as described.`;
  } catch (err) {
    result.textContent = `Couldn’t build the notebook: ${err.message}. Please try again.`;
  }
});
