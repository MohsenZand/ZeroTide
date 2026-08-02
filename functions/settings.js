/**
 * Settings callables. Single-user app: one settings/main document.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { assertOwner } = require("./auth");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Generic starter defaults — every user changes these in the app's Settings.
const DEFAULTS = {
  zipCode: "10001",
  preferredStores: [
    { id: "amazon", name: "Amazon" },
    { id: "walmart", name: "Walmart" },
    { id: "target", name: "Target" },
    { id: "costco", name: "Costco" },
  ],
  manualCheckCooldownMinutes: 20,
  maxDailyAiCalls: 20,
  scheduledRefreshHour: 7,
  timezone: "America/New_York",
  notifyEmail: null,
  notifyEnabled: false,
  // Cashback programs the user is actually enrolled in — only these are counted
  // toward the true price. Free portals by default; user can add/remove.
  cashbackSources: ["Rakuten", "Capital One Shopping"],
};

async function loadSettings() {
  const ref = db.collection("settings").doc("main");
  const snap = await ref.get();
  if (!snap.exists) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({ ...DEFAULTS, aiCallsToday: 0, aiCallsDate: null, createdAt: now, updatedAt: now });
    return { ...DEFAULTS };
  }
  return { ...DEFAULTS, ...snap.data() };
}

const opts = { region: "us-central1", cors: true, invoker: "public" };

exports.getSettings = onCall(opts, async (request) => {
  assertOwner(request);
  const s = await loadSettings();
  return { success: true, settings: publicSettings(s) };
});

exports.updateSettings = onCall(opts, async (request) => {
  assertOwner(request);
  const { zipCode, preferredStores, manualCheckCooldownMinutes, maxDailyAiCalls, scheduledRefreshHour, timezone,
    notifyEmail, notifyEnabled } = request.data || {};
  const patch = {};

  if (notifyEmail !== undefined) {
    const email = String(notifyEmail || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "That doesn't look like a valid email address.");
    }
    patch.notifyEmail = email || null;
  }
  if (notifyEnabled !== undefined) patch.notifyEnabled = Boolean(notifyEnabled);
  if (request.data.cashbackSources !== undefined) {
    const cs = request.data.cashbackSources;
    if (!Array.isArray(cs)) throw new HttpsError("invalid-argument", "cashbackSources must be an array.");
    patch.cashbackSources = cs.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
  }

  if (zipCode !== undefined) {
    if (!/^\d{5}$/.test(String(zipCode))) throw new HttpsError("invalid-argument", "Zip code must be 5 digits.");
    patch.zipCode = String(zipCode);
  }
  if (preferredStores !== undefined) {
    if (!Array.isArray(preferredStores)) throw new HttpsError("invalid-argument", "preferredStores must be an array.");
    patch.preferredStores = preferredStores
      .filter((s) => s && s.name)
      .map((s) => ({ id: s.id || slug(s.name), name: String(s.name).slice(0, 60) }));
  }
  if (manualCheckCooldownMinutes !== undefined) patch.manualCheckCooldownMinutes = clampInt(manualCheckCooldownMinutes, 0, 240);
  if (maxDailyAiCalls !== undefined) patch.maxDailyAiCalls = clampInt(maxDailyAiCalls, 1, 500);
  if (scheduledRefreshHour !== undefined) patch.scheduledRefreshHour = clampInt(scheduledRefreshHour, 0, 23);
  if (timezone !== undefined) patch.timezone = String(timezone).slice(0, 64);

  await loadSettings(); // ensure doc exists
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await db.collection("settings").doc("main").set(patch, { merge: true });

  const s = await loadSettings();
  return { success: true, settings: publicSettings(s) };
});

function publicSettings(s) {
  return {
    zipCode: s.zipCode,
    preferredStores: s.preferredStores,
    manualCheckCooldownMinutes: s.manualCheckCooldownMinutes,
    maxDailyAiCalls: s.maxDailyAiCalls,
    scheduledRefreshHour: s.scheduledRefreshHour,
    timezone: s.timezone,
    notifyEmail: s.notifyEmail || null,
    notifyEnabled: Boolean(s.notifyEnabled),
    cashbackSources: Array.isArray(s.cashbackSources) ? s.cashbackSources : DEFAULTS.cashbackSources,
    aiCallsToday: s.aiCallsToday || 0,
  };
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

module.exports.loadSettings = loadSettings;
