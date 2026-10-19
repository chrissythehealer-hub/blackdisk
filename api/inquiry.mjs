// RECOVERY STATUS: lines up to "end of recovered original" are verbatim from production
// deployment dpl_2fXy8awdkr7zkwRGyYM8Za1PTcCm (src/api/inquiry.mjs, sha1 a387dfdd…).
// The rest could not be downloaded (the connector truncates the file) and is a
// reconstruction. Replace this whole file with the original before it reaches production.

// Project inquiry endpoint. Validates on the server and emails the inquiry to
// hello@blackdisk.co through Resend, with Reply-To set to the visitor.
// Server-only environment: RESEND_API_KEY, INQUIRY_FROM_EMAIL (a sender on a
// domain verified in Resend, e.g. "BLACKDISK Website <inquiries@blackdisk.co>").

const RECIPIENT = 'hello@blackdisk.co'; // fixed; never taken from the request
const SERVICES = ['Brand', 'Web', 'Commerce', 'Systems', 'Rescue', 'Not sure yet'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const IDEMPOTENCY = /^[A-Za-z0-9-]{16,64}$/;

// Spam protection: honeypot, minimum fill time and a per-IP limit. The limit
// is per function instance, enough to blunt casual abuse without a datastore.
const MIN_FILL_MS = 3000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

const oneLine = v => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim() : '');
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// ---- end of recovered original; everything below is reconstructed ----

export function validate(body) {
  const data = {
    name: oneLine(body.name).slice(0, 120),
    email: oneLine(body.email).toLowerCase().slice(0, 254),
    business: oneLine(body.business).slice(0, 160),
    services: (Array.isArray(body.services) ? body.services : []).filter(s => SERVICES.includes(s)),
    project: (typeof body.project === 'string' ? body.project.trim() : '').slice(0, 5000),
  };
  const errors = {};
  if (!data.name) errors.name = 'Please enter your name.';
  if (!data.email) errors.email = 'Please enter your email address.';
  else if (!EMAIL.test(data.email)) errors.email = 'Please enter a valid email address, like name@company.com.';
  if (data.project.length < 10) errors.project = 'Please tell us a little about your project.';
  return { data, errors };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Honeypot filled or submitted implausibly fast: answer like success, send nothing.
  if (body.website || (Number(body.startedAt) && Date.now() - Number(body.startedAt) < MIN_FILL_MS)) {
    return res.status(200).json({ ok: true });
  }

  const { data, errors } = validate(body);
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const key = process.env.RESEND_API_KEY;
  const from = process.env.INQUIRY_FROM_EMAIL;
  if (!key || !from) return res.status(500).json({ error: 'not_configured' });

  const rows = [
    ['Name', data.name], ['Email', data.email], ['Business', data.business || '—'],
    ['Services', data.services.join(', ') || '—'], ['Project', data.project],
  ];
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (IDEMPOTENCY.test(String(body.submissionId || ''))) headers['Idempotency-Key'] = `inquiry-${body.submissionId}`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: [RECIPIENT],
        reply_to: data.email,
        subject: `New project inquiry — ${data.name}${data.business ? ` (${data.business})` : ''}`,
        text: rows.map(([k, v]) => `${k}: ${v}`).join('\n\n'),
        html: rows.map(([k, v]) => `<p><strong>${k}</strong><br>${escapeHtml(v).replace(/\n/g, '<br>')}</p>`).join(''),
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'send_failed' });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'send_failed' });
  }
}
