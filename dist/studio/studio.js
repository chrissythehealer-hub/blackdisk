// AI Studio Create panel: turns the chosen settings into the Kaggle notebook's step-5 cell
// and hands back a ready-to-import notebook. Everything happens in the browser.
//
// Live on-site generation is deliberately absent (no always-on GPU at $0). Before it is ever
// added: put Cloudflare Turnstile in front of the endpoint and enforce per-visitor limits
// server-side. See README → "Live generation".
const studioForm = document.querySelector('#studio-create');
if (studioForm) {
  const form = studioForm;
  const $ = id => document.getElementById(id);
  const out = $('settings-out');
  const status = $('studio-status');
  const sizeSelect = $('s-size');
  const sizeAuto = $('size-auto');
  const LIMITS = { promptMax: 2000, steps: [8, 50], seedMax: 2n ** 63n - 1n };
  const py = s => JSON.stringify(s); // a JSON string is also a valid Python string literal

  const read = () => {
    const d = new FormData(form);
    return {
      mode: d.get('mode'),
      prompt: String(d.get('prompt') || '').trim(),
      image: String(d.get('image') || '').trim(),
      size: d.get('size'),
      frames: Number(d.get('frames')),
      steps: String(d.get('steps') || '').trim(),
      seed: String(d.get('seed') || '').trim(),
    };
  };

  const validate = v => {
    const errors = {};
    if (!v.prompt) errors.prompt = 'Describe the scene or motion you want.';
    else if (v.prompt.length > LIMITS.promptMax) errors.prompt = `Keep the prompt under ${LIMITS.promptMax} characters.`;
    if (v.mode === 'image' && v.image && !/^https:\/\/\S+$/i.test(v.image)) errors.image = 'Use a public https:// image link, or leave it empty.';
    const steps = Number(v.steps);
    if (!/^\d+$/.test(v.steps) || steps < LIMITS.steps[0] || steps > LIMITS.steps[1]) errors.steps = `Steps must be a whole number from ${LIMITS.steps[0]} to ${LIMITS.steps[1]}.`;
    if (!/^\d+$/.test(v.seed) || BigInt(v.seed) > LIMITS.seedMax) errors.seed = 'Seed must be a whole number of 0 or more.';
    return errors;
  };

  const show = errors => {
    let first = null;
    for (const [field, id] of [['prompt', 's-prompt'], ['image', 's-image'], ['steps', 's-steps'], ['seed', 's-seed']]) {
      const msg = $(`${id}-error`);
      msg.hidden = !errors[field];
      msg.textContent = errors[field] || '';
      if (errors[field]) { $(id).setAttribute('aria-invalid', 'true'); first ||= $(id); } else $(id).removeAttribute('aria-invalid');
    }
    return first;
  };

  // The same assignments the notebook's settings cell uses, in the same order.
  const settings = v => [
    ['MODE', py(v.mode)],
    ['IMAGE_URL', py(v.mode === 'image' ? v.image : '')],
    ['PROMPT', py(v.prompt)],
    ['SIZE', py(v.size)],
    ['FRAMES', String(v.frames)],
    ['STEPS', String(Number(v.steps))],
    ['SEED', String(BigInt(v.seed))],
  ];

  const render = () => {
    const v = read();
    const image = v.mode === 'image';
    $('image-fields').hidden = !image;
    sizeAuto.hidden = sizeAuto.disabled = !image;
    if (!image && sizeSelect.value === 'auto') sizeSelect.value = '16x9-draft';
    const errors = validate(v);
    out.textContent = Object.keys(errors).length
      ? '# Fix the highlighted settings to continue.'
      : settings(v).map(([k, val]) => `${k} = ${val}`).join('\n');
    return { v, errors };
  };

  form.addEventListener('input', () => { show({}); render(); });
  form.addEventListener('change', render);
  form.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
    if (r.checked && r.value === 'image') sizeSelect.value = 'auto';
    render();
  }));
  $('seed-random').addEventListener('click', () => {
    const a = crypto.getRandomValues(new Uint32Array(2));
    $('s-seed').value = String(((BigInt(a[0]) << 32n) | BigInt(a[1])) & ((1n << 53n) - 1n));
    render();
  });

  $('copy-settings').addEventListener('click', async () => {
    const { errors } = render();
    if (show(errors)?.focus()) return;
    if (Object.keys(errors).length) return;
    try {
      await navigator.clipboard.writeText(out.textContent);
      status.textContent = 'Settings copied. Paste them over the settings in the notebook’s step 5.';
    } catch {
      getSelection().selectAllChildren(out);
      status.textContent = 'Select-all is on the settings block. Copy it with Ctrl+C / ⌘C.';
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const { v, errors } = render();
    const first = show(errors);
    if (first) { first.focus(); return; }
    status.textContent = 'Preparing your notebook…';
    try {
      const res = await fetch('/studio/blackdisk-ai-studio.ipynb', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const nb = await res.json();
      const cell = nb.cells.find(c => c.cell_type === 'code' && /^MODE\s*=\s*"/m.test([].concat(c.source).join('')));
      if (!cell) throw new Error('settings cell not found');
      let src = [].concat(cell.source).join('');
      for (const [k, val] of settings(v)) {
        const re = new RegExp(`^(${k}\\s*=\\s*)(".*?(?<!\\\\)"|\\d+)`, 'm');
        if (!re.test(src)) throw new Error(`${k} not found in notebook`);
        src = src.replace(re, (_, lhs) => lhs + val);
      }
      cell.source = src;
      const blob = new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `blackdisk-studio-${v.mode}-${v.seed}.ipynb` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status.textContent = 'Notebook downloaded. Import it on kaggle.com/code and choose Run All.';
    } catch {
      status.textContent = 'The notebook couldn’t be prepared just now. Copy the settings instead and paste them into step 5.';
    }
  });

  render();
}
