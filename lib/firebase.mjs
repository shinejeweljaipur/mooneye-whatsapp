// Firebase Realtime Database (server side, via firebase-admin).
// Needs: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL
// If these are not set, every function here quietly does nothing.
import admin from "firebase-admin";

let db = null;
function getDb() {
  if (db) return db;
  const e = process.env;
  if (!e.FIREBASE_PROJECT_ID || !e.FIREBASE_CLIENT_EMAIL || !e.FIREBASE_PRIVATE_KEY || !e.FIREBASE_DATABASE_URL) return null;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: e.FIREBASE_PROJECT_ID,
        clientEmail: e.FIREBASE_CLIENT_EMAIL,
        privateKey: e.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      databaseURL: e.FIREBASE_DATABASE_URL,
    });
  }
  db = admin.database();
  return db;
}

const clean = (obj) => JSON.parse(JSON.stringify(obj ?? null)); // drops undefined values

// Create/overwrite the main fields of an order (keeps history and other children)
export async function fbSaveOrder(orderId, data) {
  try {
    const d = getDb(); if (!d) return;
    await d.ref(`orders/${orderId}`).update(clean({ ...data, updatedAt: Date.now() }));
  } catch (err) { console.error("Firebase saveOrder failed:", err.message); }
}

// Set the order's current status and add an entry to its history
export async function fbSetStatus(orderId, status, extra = {}) {
  try {
    const d = getDb(); if (!d) return;
    const now = Date.now();
    await d.ref(`orders/${orderId}`).update(clean({ status, updatedAt: now, ...extra }));
    await d.ref(`orders/${orderId}/history`).push(clean({ status, at: now, ...extra }));
  } catch (err) { console.error("Firebase setStatus failed:", err.message); }
}

// One row per WhatsApp message sent (or failed)
export async function fbLogMessage(entry) {
  try {
    const d = getDb(); if (!d) return;
    await d.ref("whatsapp_logs").push(clean({ ...entry, at: Date.now() }));
  } catch (err) { console.error("Firebase logMessage failed:", err.message); }
}
