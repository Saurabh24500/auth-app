require('dotenv').config();
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

function isConfigured() {
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

let app = null;

function init() {
  if (app || !isConfigured()) return;
  app = admin.initializeApp({
    credential: admin.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

async function verifyIdToken(idToken) {
  init();
  if (!app) throw new Error('Firebase is not configured.');
  return getAuth(app).verifyIdToken(idToken);
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