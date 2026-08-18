let _auth = null;
let _verifier = null;
let _fbResult = null;

async function fetchFirebaseConfig() {
  const res = await fetch('/api/firebase/config');
  return res.json();
}

async function initFirebase() {
  if (_auth) return _auth;
  if (typeof firebase === 'undefined' || !firebase.auth) return null;
  const cfg = await fetchFirebaseConfig();
  if (!cfg.ok) return null;
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  _auth = firebase.auth();
  return _auth;
}

function makeVerifier(elementId) {
  if (_verifier) {
    _verifier.clear();
    _verifier = null;
  }
  _verifier = new firebase.auth.RecaptchaVerifier(elementId, { size: 'invisible' });
  return _verifier;
}

async function sendFirebaseCode(phone, elementId) {
  const auth = await initFirebase();
  if (!auth) throw new Error('Firebase is not configured.');
  const verifier = makeVerifier(elementId);
  _fbResult = await auth.signInWithPhoneNumber(phone, verifier);
  return _fbResult;
}

async function confirmFirebaseCode(result, code) {
  const cred = await result.confirm(code);
  return cred.user.getIdToken();
}

function getFbResult() {
  return _fbResult;
}