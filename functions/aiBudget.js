/**
 * Budget guard for the one part of ZeroTide that costs money.
 *
 * Only *grounded discovery* is metered here. The daily monitoring path reads
 * pages we already know about and never issues a search, so it is deliberately
 * not gated — throttling it would save nothing and just stale the prices.
 *
 * Two counters, because they answer different questions:
 *   aiCallsToday      — how many discovery runs today (the user-facing cap)
 *   groundedSearches* — how many search queries were actually billed, which is
 *                       the real unit of spend: grounding charges per query the
 *                       model issues, and one discovery run can issue several.
 *
 * Gemini 3.x includes 5,000 free grounded searches per month, so the monthly
 * counter is the number that tells you whether you owe anything at all.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const SETTINGS_PATH = ["settings", "main"];
const DEFAULT_MAX = 60;

// Gemini 3.x free allowance, pooled across 3.x models (verified Sept 2026).
// Overage is $14 per 1,000 searches.
const FREE_SEARCHES_PER_MONTH = 5000;

function todayKey(timezone) {
  // Use the configured timezone so "today" flips at local midnight.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Chicago" }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

function monthKey(timezone) {
  return todayKey(timezone).slice(0, 7); // YYYY-MM
}

/**
 * Reserves one grounded discovery run. Runs inside a Firestore transaction on
 * settings/main. Returns { used, max } after reserving. Throws
 * HttpsError('resource-exhausted') when the cap is reached.
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

/**
 * Record what a completed grounded call actually billed. Called after the fact
 * because the count only exists in the response's groundingMetadata.
 */
async function recordGroundedSearches(db, count) {
  if (!count || count < 1) return;
  const ref = db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]);

  try {
    await db.runTransaction(async (txn) => {
      const snap = await txn.get(ref);
      const data = snap.exists ? snap.data() : {};
      const day = todayKey(data.timezone);
      const month = monthKey(data.timezone);

      const dayCount = (data.groundedSearchesDate === day ? data.groundedSearchesToday || 0 : 0) + count;
      const monthCount = (data.groundedSearchesMonth === month ? data.groundedSearchesMonthCount || 0 : 0) + count;

      txn.set(
        ref,
        {
          groundedSearchesDate: day,
          groundedSearchesToday: dayCount,
          groundedSearchesMonth: month,
          groundedSearchesMonthCount: monthCount,
        },
        { merge: true }
      );

      if (monthCount > FREE_SEARCHES_PER_MONTH) {
        logger.warn("Past the free grounding allowance for this month", {
          monthCount,
          free: FREE_SEARCHES_PER_MONTH,
          estimatedOverageUsd: (((monthCount - FREE_SEARCHES_PER_MONTH) * 14) / 1000).toFixed(2),
        });
      }
    });
  } catch (err) {
    // Never fail a price check over bookkeeping.
    logger.warn("Could not record grounded search usage", { error: err.message });
  }
}

/** Usage summary for the Settings screen. */
function summarizeUsage(settings, timezone) {
  const month = monthKey(timezone);
  const used = settings.groundedSearchesMonth === month ? settings.groundedSearchesMonthCount || 0 : 0;
  const over = Math.max(0, used - FREE_SEARCHES_PER_MONTH);
  return {
    groundedSearchesThisMonth: used,
    freeSearchesPerMonth: FREE_SEARCHES_PER_MONTH,
    estimatedMonthCostUsd: Math.round((over * 14) / 1000 * 100) / 100,
  };
}

module.exports = {
  reserveAiCallBudget,
  recordGroundedSearches,
  summarizeUsage,
  FREE_SEARCHES_PER_MONTH,
};
