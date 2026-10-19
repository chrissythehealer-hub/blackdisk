import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applySettings, fileName, validateSettings } from '../studio/notebook.js';

const notebook = JSON.parse(await readFile(new URL('../studio/kaggle/wan22_first_video.ipynb', import.meta.url), 'utf8'));
const settingsCell = nb => nb.cells.find(c => /^PROMPT = /m.test(c.source)).source;
const good = { mode: 'text', prompt: 'A black disk rolling across warm stone', size: '16x9-draft', frames: '49', steps: '20', seed: '7' };

test('valid settings pass and a blank seed becomes a random whole number', () => {
  const r = validateSettings({ ...good, seed: '' }, () => 0.5);
  assert.equal(r.ok, true);
  assert.equal(r.settings.seed, String(2 ** 30));
});

test('settings outside what the model supports are rejected', () => {
  for (const bad of [{ prompt: '  ' }, { size: '4k' }, { frames: '50' }, { frames: '500' }, { steps: '2' }, { steps: '20.5' }, { seed: '-1' }, { seed: '99999999999999999999' }, { prompt: 'x'.repeat(2001) }]) {
    assert.equal(validateSettings({ ...good, ...bad }).ok, false, JSON.stringify(bad));
  }
});

test('applySettings rewrites only the settings and keeps the original intact', () => {
  const prompt = 'Slow push-in, "quoted" light \\ backslash · ünïcode';
  const r = validateSettings({ ...good, mode: 'image', prompt, size: '9x16', frames: '121', steps: '30', seed: '123' });
  const out = applySettings(notebook, r.settings);
  const src = settingsCell(out);
  assert.match(src, /^MODE = "image"$/m);
  assert.match(src, /^SIZE = "9x16"$/m);
  assert.match(src, /^FRAMES = 121$/m);
  assert.match(src, /^STEPS = 30$/m);
  assert.match(src, /^SEED = 123$/m);
  assert.equal(JSON.parse(src.match(/^PROMPT = (.*)$/m)[1]), prompt); // valid Python/JSON string literal
  assert.equal(out.cells.length, notebook.cells.length);
  assert.notEqual(settingsCell(notebook), src); // input notebook not mutated
});

test('prompt text cannot break out of the string into notebook code', () => {
  const r = validateSettings({ ...good, prompt: 'x"\nimport os; os.system("rm -rf /")  #' });
  const src = settingsCell(applySettings(notebook, r.settings));
  const line = src.split('\n').find(l => l.startsWith('PROMPT = '));
  assert.equal(JSON.parse(line.slice('PROMPT = '.length)), 'x" import os; os.system("rm -rf /") #');
  assert.ok(!src.split('\n').some(l => l.startsWith('import os')));
});

test('fileName is short and safe', () => {
  assert.equal(fileName('Slow push-in on a matte black disk, warm light'), 'blvckdisk-studio-slow-push-in-on-a-matte.ipynb');
  assert.equal(fileName('***'), 'blvckdisk-studio-clip.ipynb');
});
