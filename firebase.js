require('dotenv').config();
const admin = require('firebase-admin');

function isConfigured() {
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

let initialized = false;

function init() {
  if (initialized || !isConfigured()) return;
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
  initialized = true;
}

async function verifyIdToken(idToken) {
  init();
  if (!initialized) throw new Error('Firebase is not configured.');
  return admin.auth().verifyIdToken(idToken);
}

function webConfig() {
  return {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      `${process.env.FIREBASE_PROJECT_ID || ''}.firebaseapp.com`,
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  };
}

module.exports = { isConfigured, verifyIdToken, webConfig };