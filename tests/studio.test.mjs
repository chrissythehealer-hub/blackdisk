import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySettings, looksLikeMp4, notebookName, summarize, validateConfig } from '../dist/studio/notebook.js';

const notebook = JSON.parse(await readFile(new URL('../dist/studio/blackdisk-ai-studio.ipynb', import.meta.url), 'utf8'));
const settingsCell = nb => nb.cells.find(c => c.cell_type === 'code' && /^MODE\s*=/m.test(c.source)).source;
const base = { mode: 'text', prompt: 'A black disk rolling across warm stone', aspect: '16:9', size: 'draft', frames: '49', quality: 'balanced', seedMode: 'fixed', seed: '7' };
// 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('defaults produce the proven reference settings', () => {
  const r = validateConfig(base);
  assert.equal(r.ok, true);
  assert.deepEqual([r.settings.sizeId, r.settings.frames, r.settings.steps, r.settings.cfg], ['16x9-draft', 49, 20, 5]);
  assert.deepEqual(r.notes, []);
});

test('unsupported combinations are corrected and explained, not silently ignored', () => {
  const square = validateConfig({ ...base, aspect: '1:1', size: 'hd' });
  assert.equal(square.settings.sizeId, '1x1');
  assert.match(square.notes[0], /no HD 720p option/);
  const match = validateConfig({ ...base, aspect: 'match' });
  assert.equal(match.settings.aspect, '16:9');
  assert.match(match.notes[0], /needs an image/);
});

test('invalid input is rejected with a message per field', () => {
  const r = validateConfig({ ...base, prompt: ' ', frames: '50', seed: 'abc', steps: '3', cfg: '20', negative: 'x'.repeat(2001) });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['cfg', 'frames', 'negative', 'prompt', 'seed', 'steps']);
  assert.equal(validateConfig({ ...base, mode: 'image' }).errors.image, 'Add the image you want to animate.');
});

test('quality presets map to real step counts; advanced steps override', () => {
  assert.equal(validateConfig({ ...base, quality: 'fast' }).settings.steps, 12);
  assert.equal(validateConfig({ ...base, quality: 'detailed' }).settings.steps, 30);
  assert.equal(validateConfig({ ...base, quality: 'fast', steps: '25' }).settings.steps, 25);
});

test('applySettings fills every setting; prompt text cannot escape into code', () => {
  const evil = 'x"\nimport os; os.system("rm -rf /")  #';
  const s = validateConfig({ ...base, prompt: evil, negative: 'blur, "text"', aspect: '9:16', size: 'hd', frames: '121', cfg: '6.5' }).settings;
  const src = settingsCell(applySettings(notebook, s));
  const line = name => src.split('\n').find(l => l.startsWith(`${name} = `)).slice(name.length + 3);
  assert.equal(JSON.parse(line('PROMPT')), 'x" import os; os.system("rm -rf /") #');
  assert.equal(JSON.parse(line('NEGATIVE')), 'blur, "text"');
  assert.equal(JSON.parse(line('SIZE')), '9x16');
  assert.equal(line('FRAMES'), '121');
  assert.equal(line('CFG'), '6.5');
  assert.equal(line('SEED'), '7');
  assert.ok(!src.split('\n').some(l => l.startsWith('import os')));
  assert.notEqual(settingsCell(notebook), src); // original untouched
});

test('the filled settings cell runs in Python and writes the embedded image', t => {
  const s = validateConfig({ ...base, mode: 'image', aspect: 'match', size: 'draft', imageData: PNG }).settings;
  const src = settingsCell(applySettings(notebook, s));
  const settingsOnly = src.split('\nfrom PIL import Image')[0]; // PIL may not be installed here; the rest is display only
  return mkdtemp(join(tmpdir(), 'nb-')).then(async dir => {
    let out;
    try {
      out = execFileSync('python3', ['-I', '-c', `import os, urllib.request\nWORK = ${JSON.stringify(dir)}\n${settingsOnly}\nprint(MODE, SIZE, FRAMES, STEPS, CFG, SEED, os.path.basename(IMAGE), os.path.getsize(IMAGE))`], { encoding: 'utf8' });
    } catch (e) {
      if (e.code === 'ENOENT') return t.skip('python3 not available');
      throw e;
    }
    assert.equal(out.trim(), `image auto 49 20 5.0 7 reference.png ${Buffer.from(PNG, 'base64').length}`);
    assert.deepEqual(await readdir(dir), ['reference.png']);
  });
});

test('summary, file name and MP4 sniffing', () => {
  const s = validateConfig(base).settings;
  assert.deepEqual(summarize(s)[0], ['Type', 'Text to video']);
  assert.equal(notebookName(s), 'blvckdisk-a-black-disk-rolling-across-7.ipynb');
  assert.equal(looksLikeMp4(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50])), true);
  assert.equal(looksLikeMp4(new TextEncoder().encode('<html>not a video')), false);
});
