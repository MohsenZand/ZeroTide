/**
 * ZeroTide Cloud Functions (Gen 2).
 *
 * Single-user, no-auth app: Firestore is fully locked (see firestore.rules) and
 * every read/write goes through these callables using the Admin SDK. The
 * GEMINI_API_KEY secret powers the Google-Search-grounded price lookups.
 */

const { setGlobalOptions } = require("firebase-functions/v2/options");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
// Never crash a write because an optional field came back undefined — just omit it.
try { admin.firestore().settings({ ignoreUndefinedProperties: true }); } catch { /* already set */ }
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

// ── Settings ──
const settings = require("./settings");
exports.getSettings = settings.getSettings;
exports.updateSettings = settings.updateSettings;

// ── Intentions (watch list) ──
const intentions = require("./intentions");
exports.listIntentions = intentions.listIntentions;
exports.addIntention = intentions.addIntention;
exports.updateIntention = intentions.updateIntention;
exports.deleteIntention = intentions.deleteIntention;
exports.getIntentionHistory = intentions.getIntentionHistory;
exports.markBought = intentions.markBought;
exports.resumeIntention = intentions.resumeIntention;
exports.snoozeIntention = intentions.snoozeIntention;

// ── Price refresh (Gemini) ──
const priceRefresh = require("./priceRefresh");
exports.scheduledPriceRefresh = priceRefresh.scheduledPriceRefresh;
exports.checkIntentionNow = priceRefresh.checkIntentionNow;

// ── Email notifications ──
const notify = require("./notify");
exports.sendTestEmail = notify.sendTestEmail;
