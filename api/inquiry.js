// RECONSTRUCTED — not the recovered production source.
// The live /api/inquiry could not be read through the Vercel connector, so this file
// re-implements the contract that site.js and the live endpoint expose:
//   POST JSON {name, email, business, services[], project, website, startedAt, submissionId}
//   → 200 {ok:true} | 400 {errors:{field:msg}} | 405 {error:"method_not_allowed"} | 429 | 502
// Replace it with the original before this repo ever deploys to production.
//
// Env: RESEND_API_KEY (required), INQUIRY_TO (default hello@blackdisk.co),
//      INQUIRY_FROM (a sender on a domain verified in Resend).

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const SERVICES = new Set(['Brand', 'Web', 'Commerce', 'Systems', 'Rescue', 'Not sure yet']);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map(); // per-instance only; good enough to slow down a single noisy client

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // Honeypot filled or form submitted implausibly fast: answer like success, send nothing.
  if (b.website || (Number(b.startedAt) && Date.now() - Number(b.startedAt) < 2500)) {
    return res.status(200).json({ ok: true });
  }

  const v = {
    name: clip(b.name, 120),
    email: clip(b.email, 254),
    business: clip(b.business, 160),
    services: (Array.isArray(b.services) ? b.services : []).map(String).filter(s => SERVICES.has(s)),
    project: clip(b.project, 5000),
  };
  const errors = {};
  if (!v.name) errors.name = 'Please enter your name.';
  if (!v.email) errors.email = 'Please enter your email address.';
  else if (!EMAIL.test(v.email)) errors.email = 'Please enter a valid email address, like name@company.com.';
  if (v.project.length < 10) errors.project = 'Please tell us a little about your project.';
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'not_configured' });

  const rows = [
    ['Name', v.name], ['Email', v.email], ['Business', v.business || '—'],
    ['Services', v.services.join(', ') || '—'], ['Project', v.project],
  ];
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const id = clip(b.submissionId, 100);
  if (id) headers['Idempotency-Key'] = `inquiry-${id}`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: process.env.INQUIRY_FROM || 'BLVCKDISK <hello@blackdisk.co>',
        to: [process.env.INQUIRY_TO || 'hello@blackdisk.co'],
        reply_to: v.email,
        subject: `New project inquiry — ${v.name}${v.business ? ` (${v.business})` : ''}`,
        text: rows.map(([k, val]) => `${k}: ${val}`).join('\n\n'),
        html: rows.map(([k, val]) => `<p><strong>${k}</strong><br>${esc(val).replace(/\n/g, '<br>')}</p>`).join(''),
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'send_failed' });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'send_failed' });
  }
}
