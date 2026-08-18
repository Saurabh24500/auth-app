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
