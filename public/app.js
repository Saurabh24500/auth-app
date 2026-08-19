function $id(id) {
  return document.getElementById(id);
}

async function api(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function showMsg(type, text) {
  const el = $id('msg');
  if (!el) return;
  el.className = 'msg show msg-' + type;
  el.textContent = text;
}

function hideMsg() {
  const el = $id('msg');
  if (el) el.className = 'msg';
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>' + btn.dataset.label;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.label;
    btn.disabled = false;
  }
}

function getPasswordChecks(pw) {
  return {
    len: pw.length >= 6,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

const EYE_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function setupEyeToggle(inputId, btnId) {
  const input = $id(inputId);
  const btn = $id(btnId);
  if (!input || !btn) return;
  btn.innerHTML = EYE_OPEN;
  btn.setAttribute('aria-label', 'Show password');
  btn.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    btn.innerHTML = reveal ? EYE_OFF : EYE_OPEN;
    btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });
}

function setupConfirmMatch(pwId, confirmId, feedbackId) {
  const pw = $id(pwId);
  const confirm = $id(confirmId);
  const fb = $id(feedbackId);
  if (!pw || !confirm || !fb) return;
  function update() {
    const v = confirm.value;
    if (!v) {
      fb.textContent = '';
      fb.className = 'match-feedback';
      confirm.classList.remove('input-error');
      return;
    }
    if (v === pw.value) {
      fb.textContent = 'Passwords match';
      fb.className = 'match-feedback ok';
      confirm.classList.remove('input-error');
    } else {
      fb.textContent = 'Passwords do not match';
      fb.className = 'match-feedback bad';
      confirm.classList.add('input-error');
    }
  }
  confirm.addEventListener('input', update);
  pw.addEventListener('input', update);
}
