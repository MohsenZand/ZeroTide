/**
 * Intention (watch-list) CRUD callables.
 *
 * An "intention" = something the user wants + the price they'd pay. ZeroTide
 * watches it and stores a denormalized `currentBest` + verdict for fast reads.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertOwner } = require("./auth");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const opts = { region: "us-central1", cors: true, invoker: "public" };

exports.listIntentions = onCall(opts, async (request) => {
  assertOwner(request);
  const snap = await db.collection("intentions").orderBy("createdAt", "desc").get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { success: true, intentions: items };
});

exports.addIntention = onCall(opts, async (request) => {
  assertOwner(request);
  const { title, brand, size, notes, targetPrice, kind, matchType, stores } = request.data || {};
  if (!title || typeof title !== "string" || title.trim().length < 2) {
    throw new HttpsError("invalid-argument", "Please give the item a name.");
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  const doc = {
    title: title.trim().slice(0, 120),
    brand: strOrNull(brand),
    size: strOrNull(size),
    notes: strOrNull(notes),
    targetPrice: numOrNull(targetPrice),
    kind: kind === "One-off" ? "One-off" : "Recurring",
    matchType: matchType === "flexible" ? "flexible" : "specific",
    repeatIntervalDays: intOrNull(request.data.repeatIntervalDays),
    userCoupons: normalizeUserCoupons(request.data.userCoupons),
    snoozedUntil: null,
    stores: Array.isArray(stores) ? stores.filter(Boolean).map(String).slice(0, 12) : [],
    active: true,
    currentBest: null,
    verdict: "watch",
    verdictReason: "Just added — ZeroTide will check the price shortly.",
    savings: null,
    lastError: null,
    lastCheckedAt: null,
    lastManualCheckAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await db.collection("intentions").add(doc);
  return { success: true, id: ref.id, intention: { id: ref.id, ...doc } };
});

exports.updateIntention = onCall(opts, async (request) => {
  assertOwner(request);
  const { id, patch } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const allowed = ["title", "brand", "size", "notes", "targetPrice", "kind", "matchType", "repeatIntervalDays", "userCoupons", "stores", "active"];
  const clean = {};
  for (const k of allowed) {
    if (patch && patch[k] !== undefined) clean[k] = patch[k];
  }
  if (clean.targetPrice !== undefined) clean.targetPrice = numOrNull(clean.targetPrice);
  if (clean.repeatIntervalDays !== undefined) clean.repeatIntervalDays = intOrNull(clean.repeatIntervalDays);
  if (clean.userCoupons !== undefined) clean.userCoupons = normalizeUserCoupons(clean.userCoupons);
  if (clean.title !== undefined) clean.title = String(clean.title).trim().slice(0, 120);
  clean.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  const ref = db.collection("intentions").doc(id);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Intention not found.");
  await ref.set(clean, { merge: true });
  const updated = await ref.get();
  return { success: true, intention: { id, ...updated.data() } };
});

exports.deleteIntention = onCall(opts, async (request) => {
  assertOwner(request);
  const { id } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const ref = db.collection("intentions").doc(id);

  // Purge price history subcollection (personal watch list — small, so a single batch is plenty).
  const hist = await ref.collection("priceHistory").limit(400).get();
  const batch = db.batch();
  hist.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();
  return { success: true };
});

exports.getIntentionHistory = onCall(opts, async (request) => {
  assertOwner(request);
  const { id, days } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const limitDays = clampInt(days || 90, 7, 365);
  const since = new Date();
  since.setDate(since.getDate() - limitDays);

  const snap = await db
    .collection("intentions")
    .doc(id)
    .collection("priceHistory")
    .orderBy("checkedAt", "desc")
    .limit(500)
    .get();

  // One best (lowest true) price per calendar day, ascending — feeds the tide chart.
  const byDay = new Map();
  snap.docs.forEach((d) => {
    const h = d.data();
    const ts = h.checkedAt?.toDate ? h.checkedAt.toDate() : new Date(h.checkedAt);
    if (ts < since) return;
    const day = ts.toISOString().split("T")[0];
    const val = typeof h.truePrice === "number" ? h.truePrice : h.price;
    if (typeof val !== "number") return;
    if (!byDay.has(day) || val < byDay.get(day)) byDay.set(day, val);
  });

  const points = [...byDay.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { success: true, points };
});

exports.markBought = onCall(opts, async (request) => {
  assertOwner(request);
  const { id } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const ref = db.collection("intentions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Intention not found.");
  const data = snap.data();
  const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (data.kind === "One-off") {
    patch.active = false;
    patch.verdict = "bought";
    patch.verdictReason = "Marked as bought.";
  } else {
    // Recurring: pause until the next rebuy cycle so it doesn't keep nagging.
    const days = typeof data.repeatIntervalDays === "number" && data.repeatIntervalDays > 0 ? data.repeatIntervalDays : 30;
    const until = new Date(Date.now() + days * 86400000);
    patch.snoozedUntil = admin.firestore.Timestamp.fromDate(until);
    patch.verdict = "snoozed";
    patch.verdictReason = `Bought — paused until ${until.toISOString().split("T")[0]} (~${days}-day rebuy cycle). Resume anytime.`;
    patch.lastBoughtAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await ref.set(patch, { merge: true });
  return { success: true };
});

// Resume a snoozed item early (or un-pause) — clears the snooze and watches again.
exports.resumeIntention = onCall(opts, async (request) => {
  assertOwner(request);
  const { id } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const ref = db.collection("intentions").doc(id);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Intention not found.");
  await ref.set({
    snoozedUntil: null,
    verdict: "watch",
    verdictReason: "Resumed — watching again.",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true };
});

// Manually snooze/pause an item for N days without buying.
exports.snoozeIntention = onCall(opts, async (request) => {
  assertOwner(request);
  const { id, days } = request.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");
  const ref = db.collection("intentions").doc(id);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Intention not found.");
  const n = clampInt(days || 30, 1, 365);
  const until = new Date(Date.now() + n * 86400000);
  await ref.set({
    snoozedUntil: admin.firestore.Timestamp.fromDate(until),
    verdict: "snoozed",
    verdictReason: `Paused until ${until.toISOString().split("T")[0]}. Resume anytime.`,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { success: true };
});

function strOrNull(v) {
  return v && String(v).trim() ? String(v).trim().slice(0, 300) : null;
}
function numOrNull(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function intOrNull(v) {
  const n = Math.round(Number(v));
  return isFinite(n) && n > 0 ? Math.min(n, 365) : null;
}
// User's own promo codes: { code, percent, amount }. percent XOR amount (or neither).
function normalizeUserCoupons(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => c && typeof c.code === "string" && c.code.trim())
    .map((c) => {
      const percent = Number(c.percent);
      const amount = Number(c.amount);
      return {
        code: c.code.trim().slice(0, 40),
        percent: isFinite(percent) && percent > 0 && percent <= 100 ? Math.round(percent * 100) / 100 : null,
        amount: isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
      };
    })
    .slice(0, 10);
}
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
