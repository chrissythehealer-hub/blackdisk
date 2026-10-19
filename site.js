// Mobile menu: a disk button whose lines fold into a close mark.
const header = document.querySelector('header');
const menu = document.querySelector('.menu');
function setMenu(open) {
  header.classList.toggle('open', open);
  menu?.setAttribute('aria-expanded', String(open));
  menu?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
menu?.addEventListener('click', () => {
  const open = !header.classList.contains('open');
  setMenu(open);
  if (open) document.querySelector('#site-nav a')?.focus();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && header.classList.contains('open')) {
    setMenu(false);
    menu?.focus();
  }
});
document.querySelectorAll('#site-nav a').forEach(a => a.addEventListener('click', () => setMenu(false)));
matchMedia('(min-width: 561px)').addEventListener('change', e => { if (e.matches) setMenu(false); });

document.querySelectorAll('nav a').forEach(a => { if (a.pathname === location.pathname) a.setAttribute('aria-current', 'page'); });
const selected = new URLSearchParams(location.search).get('service');
document.querySelectorAll('input[name=service]').forEach(i => { if (i.value === selected) i.checked = true; });

// Project inquiry: validated here and again on the server, then emailed to
// hello@blackdisk.co by /api/inquiry. Success only after the provider accepts.
const form = document.querySelector('#brief');
if (form) {
  const startedAt = Date.now();
  const button = form.querySelector('button[type=submit]');
  const status = document.querySelector('#form-status');
  const alertBox = document.querySelector('#form-error');
  const fieldIds = { name: 'f-name', email: 'f-email', business: 'f-business', services: 'f-service', project: 'f-project' };
  const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
  let sending = false;
  let submissionId = null;

  // Any edit makes this a new submission; an unedited retry reuses its id so
  // the provider can drop a duplicate if the first attempt actually went out.
  form.addEventListener('input', () => { submissionId = null; });

  const values = () => {
    const d = new FormData(form);
    return {
      name: String(d.get('name') || '').trim(),
      email: String(d.get('email') || '').trim(),
      business: String(d.get('business') || '').trim(),
      services: d.getAll('service').map(String),
      project: String(d.get('project') || '').trim(),
      website: String(d.get('website') || ''),
    };
  };

  const validate = v => {
    const errors = {};
    if (!v.name) errors.name = 'Please enter your name.';
    if (!v.email) errors.email = 'Please enter your email address.';
    else if (!EMAIL.test(v.email)) errors.email = 'Please enter a valid email address, like name@company.com.';
    if (v.project.length < 10) errors.project = 'Please tell us a little about your project.';
    return errors;
  };

  const showErrors = errors => {
    let first = null;
    for (const [field, id] of Object.entries(fieldIds)) {
      const msg = document.getElementById(`${id}-error`);
      const input = document.getElementById(id);
      const text = errors[field];
      msg.hidden = !text;
      msg.textContent = text || '';
      if (input) { if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
      if (text && !first) first = input || form.querySelector('input[name=service]');
    }
    return first;
  };

  const fail = message => {
    alertBox.innerHTML = '';
    const p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = message + ' You can also email ';
    const a = document.createElement('a');
    a.href = 'mailto:hello@blackdisk.co';
    a.textContent = 'hello@blackdisk.co';
    p.append(a, ' or call ');
    const t = document.createElement('a');
    t.href = 'tel:+12022225564';
    t.textContent = '202-222-5564';
    p.append(t, '.');
    alertBox.append(p);
    alertBox.hidden = false;
    alertBox.focus();
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;
    alertBox.hidden = true;
    const v = values();
    const first = showErrors(validate(v));
    if (first) { first.focus(); return; }

    sending = true;
    submissionId ||= (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = 'Sending your inquiry…';
    form.setAttribute('aria-busy', 'true');

    try {
      const res = await fetch('/api/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, startedAt, submissionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        document.querySelector('#sent-email').textContent = v.email;
        form.hidden = true;
        const sent = document.querySelector('#inquiry-sent');
        sent.hidden = false;
        sent.focus();
        return;
      }
      if (body.errors) { const f = showErrors(body.errors); f?.focus(); }
      fail(res.status === 429
        ? 'Too many attempts in a short time. Please wait a few minutes and try again.'
        : 'We couldn’t send your inquiry just now. Your details are still here, so please try again.');
    } catch {
      fail('We couldn’t send your inquiry just now. Your details are still here, so please try again.');
    } finally {
      sending = false;
      button.disabled = false;
      button.textContent = 'Send project inquiry';
      status.textContent = 'Your inquiry goes straight to hello@blackdisk.co.';
      form.removeAttribute('aria-busy');
    }
  });
}
