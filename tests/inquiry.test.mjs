// Exercises api/inquiry.js against the contract site.js relies on. No network: fetch is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/inquiry.js';

const call = async (method, body, env = { RESEND_API_KEY: 'test' }) => {
  Object.assign(process.env, env);
  const out = { status: 0, headers: {}, body: null };
  const res = {
    setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
  };
  await handler({ method, body, headers: { 'x-forwarded-for': `10.0.0.${Math.random() * 250 | 0}` } }, res);
  return out;
};
const valid = { name: 'Ada', email: 'ada@example.com', business: 'X', services: ['Web'], project: 'A new website please', website: '', startedAt: Date.now() - 60000, submissionId: 'abc' };

test('GET is 405 with Allow: POST', async () => {
  const r = await call('GET');
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'POST');
  assert.deepEqual(r.body, { error: 'method_not_allowed' });
});

test('invalid input returns field errors', async () => {
  const r = await call('POST', { ...valid, email: 'nope', project: 'short' });
  assert.equal(r.status, 400);
  assert.ok(r.body.errors.email && r.body.errors.project);
});

test('honeypot looks like success but sends nothing', async () => {
  let sent = false;
  globalThis.fetch = async () => { sent = true; return { ok: true }; };
  const r = await call('POST', { ...valid, website: 'spam.example' });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(sent, false);
});

test('valid inquiry is sent with an idempotency key', async () => {
  let req;
  globalThis.fetch = async (url, init) => { req = { url, init }; return { ok: true }; };
  const r = await call('POST', valid);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(req.url, 'https://api.resend.com/emails');
  assert.equal(req.init.headers['Idempotency-Key'], 'inquiry-abc');
  assert.equal(JSON.parse(req.init.body).reply_to, 'ada@example.com');
});

test('provider failure is reported, not hidden', async () => {
  globalThis.fetch = async () => ({ ok: false });
  const r = await call('POST', valid);
  assert.equal(r.status, 502);
});
