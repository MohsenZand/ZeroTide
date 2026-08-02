/**
 * Daily AI-call budget guard.
 *
 * Google Search grounding is billed per grounded request, so every Gemini call
 * must first reserve budget. reserveAiCallBudget rolls the daily counter over at
 * midnight (America/Chicago-ish, via the stored date string) and throws
 * resource-exhausted once maxDailyAiCalls is hit.
 */

const { HttpsError } = require("firebase-functions/v2/https");

const SETTINGS_PATH = ["settings", "main"];
const DEFAULT_MAX = 60;

function todayKey(timezone) {
  // Use the configured timezone so "today" flips at local midnight.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Chicago" }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

/**
 * Reserves one AI call. Runs inside a Firestore transaction on settings/main.
 * Returns { used, max } after reserving. Throws HttpsError('resource-exhausted')
 * when the cap is reached.
 */
async function reserveAiCallBudget(db) {
  const ref = db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]);

  return db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const data = snap.exists ? snap.data() : {};
    const max = typeof data.maxDailyAiCalls === "number" ? data.maxDailyAiCalls : DEFAULT_MAX;
    const key = todayKey(data.timezone);

    let used = data.aiCallsDate === key ? data.aiCallsToday || 0 : 0;

    if (used >= max) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily price-check budget reached (${max}/day). It resets tomorrow, or raise the limit in Settings.`
      );
    }

    used += 1;
    txn.set(ref, { aiCallsDate: key, aiCallsToday: used }, { merge: true });
    return { used, max };
  });
}

module.exports = { reserveAiCallBudget };
