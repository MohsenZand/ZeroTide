/**
 * Price refresh: the heart of ZeroTide.
 *
 * refreshSingleIntention() is the shared core used by both the daily scheduled
 * batch and the manual "check now" callable:
 *   reserve AI budget -> call Gemini (all stores in one grounded request)
 *   -> write one priceHistory snapshot per store -> compute true price + verdict
 *   -> update the intention's denormalized currentBest.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { callGeminiForIntention } = require("./geminiPriceClient");
const { reserveAiCallBudget } = require("./aiBudget");
const { evaluate } = require("./verdict");
const { loadSettings } = require("./settings");
const { sendBuyNowDigest, gmailSecrets } = require("./notify");
const { assertOwner } = require("./auth");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

async function refreshSingleIntention(intentionId, { triggeredBy, runId }) {
  const ref = db.collection("intentions").doc(intentionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Intention ${intentionId} not found`);
  const intention = { id: snap.id, ...snap.data() };

  const settings = await loadSettings();
  // Priority stores = the item's own stores PLUS the global preferred list (union,
  // item's first). These are only priorities — the prompt still searches the whole
  // web, so adding a store augments rather than restricts the search.
  const globalStores = (settings.preferredStores || []).map((s) => s.name);
  const itemStores = Array.isArray(intention.stores) ? intention.stores : [];
  // Fewer priority stores = fewer page reads = lower token cost (search still spans the web).
  const storeNames = [...new Set([...itemStores, ...globalStores])].slice(0, 5);

  // Reserve budget BEFORE the (billable) grounded call.
  await reserveAiCallBudget(db);

  let aiResult;
  try {
    aiResult = await callGeminiForIntention({
      intention,
      storeNames,
      zipCode: settings.zipCode,
      apiKey: geminiApiKey.value(),
      cashbackSources: settings.cashbackSources,
    });
  } catch (err) {
    logger.error("Gemini call failed", { intentionId, error: err.message });
    await ref.set(
      { lastError: err.message, lastCheckedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    throw err;
  }

  // Read recent history for the "near historical low" check.
  const histSnap = await ref
    .collection("priceHistory")
    .orderBy("checkedAt", "desc")
    .limit(60)
    .get();
  const history = histSnap.docs.map((d) => d.data());

  const { currentBest, verdict, verdictReason, savings, stores } = evaluate({ intention, aiResult, history });

  // Verify links actually resolve (our own fetch — free, no AI cost). Drop only hard
  // 404/410s so a broken slug becomes a search fallback; keep bot-blocked (403) pages.
  await verifyLinks(currentBest, stores);

  // Persist one snapshot per store result.
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const { computeTruePrice } = require("./verdict");
  for (const r of aiResult.results) {
    const tp = computeTruePrice(r);
    const histRef = ref.collection("priceHistory").doc();
    batch.set(histRef, {
      checkedAt: now,
      runId: runId || null,
      store: r.store,
      found: r.found,
      price: r.price,
      truePrice: tp ? tp.truePrice : null,
      subscriptionSavings: tp ? tp.subscriptionSavings : 0,
      appliedDiscount: tp ? tp.appliedDiscount : 0,
      cashbackRate: tp ? tp.cashbackRate : 0,
      shipping: tp ? tp.shipping : 0,
      unit: r.unit,
      regularPrice: r.regularPrice,
      onSale: r.onSale,
      dealDescription: r.dealDescription,
      saleEndDate: r.saleEndDate,
      couponCount: (r.coupons || []).length,
      confidence: r.confidence,
      sourceUrl: r.sourceUrl,
      sourceTitle: r.sourceTitle,
      notes: r.notes,
      triggeredBy,
    });
  }

  const update = {
    currentBest,
    verdict,
    verdictReason,
    savings,
    latestStores: stores,
    priceContext: aiResult.priceContext,
    lastError: null,
    lastCheckedAt: now,
    updatedAt: now,
  };
  if (triggeredBy === "manual") update.lastManualCheckAt = now;
  batch.set(ref, update, { merge: true });
  await batch.commit();

  return { currentBest, verdict, verdictReason, savings, stores };
}

// ── Scheduled daily batch ────────────────────────────────────────────────────
exports.scheduledPriceRefresh = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "America/Chicago",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [geminiApiKey, ...gmailSecrets],
  },
  async () => {
    const runRef = db.collection("refreshLogs").doc();
    const runId = runRef.id;
    const startedAt = admin.firestore.FieldValue.serverTimestamp();

    const snap = await db.collection("intentions").where("active", "==", true).get();
    // Skip items snoozed until a future date (e.g. a recurring item just bought).
    const nowMs = Date.now();
    const ids = snap.docs
      .filter((d) => {
        const su = d.data().snoozedUntil;
        const suMs = su?.toDate ? su.toDate().getTime() : (su ? new Date(su).getTime() : 0);
        return !suMs || suMs <= nowMs;
      })
      .map((d) => d.id);
    const errors = [];
    let processed = 0;

    for (const id of ids) {
      try {
        await refreshSingleIntention(id, { triggeredBy: "scheduled", runId });
        processed += 1;
      } catch (err) {
        errors.push({ intentionId: id, message: err.message });
        logger.warn("Scheduled refresh item failed", { id, error: err.message });
      }
      await sleep(500); // light pacing; page-reading already spaces calls out
    }

    // ── Notify: email a digest of items that JUST became buy-now ──────────────
    // De-dupe via lastNotifiedVerdict so an item that stays "buy" day after day
    // is only emailed once (until it leaves buy and returns).
    try {
      const fresh = await db.collection("intentions").where("active", "==", true).get();
      const newlyBuy = [];
      const markBatch = db.batch();
      fresh.docs.forEach((d) => {
        const it = { id: d.id, ...d.data() };
        if (it.verdict === "buy" && it.lastNotifiedVerdict !== "buy") {
          newlyBuy.push(it);
        }
        if (it.lastNotifiedVerdict !== it.verdict) {
          markBatch.set(d.ref, { lastNotifiedVerdict: it.verdict }, { merge: true });
        }
      });
      await markBatch.commit();
      if (newlyBuy.length) {
        await sendBuyNowDigest(newlyBuy);
      }
    } catch (err) {
      logger.warn("Notification digest failed", { error: err.message });
    }

    await runRef.set({
      startedAt,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      triggeredBy: "scheduled",
      itemsProcessed: processed,
      itemsFailed: errors.length,
      itemIds: ids,
      errors,
    });
    logger.info("Scheduled refresh complete", { runId, processed, failed: errors.length });
  }
);

// ── Manual "check now" ───────────────────────────────────────────────────────
exports.checkIntentionNow = onCall(
  { region: "us-central1", cors: true, invoker: "public", secrets: [geminiApiKey], timeoutSeconds: 240, memory: "512MiB" },
  async (request) => {
    assertOwner(request);
    const { id } = request.data || {};
    if (!id) throw new HttpsError("invalid-argument", "Missing intention id.");

    const ref = db.collection("intentions").doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Intention not found.");
    const data = snap.data();

    const settings = await loadSettings();
    const cooldownMin = settings.manualCheckCooldownMinutes ?? 20;
    const last = data.lastManualCheckAt?.toDate ? data.lastManualCheckAt.toDate() : null;
    if (last && cooldownMin > 0) {
      const elapsedMin = (Date.now() - last.getTime()) / 60000;
      if (elapsedMin < cooldownMin) {
        const wait = Math.ceil(cooldownMin - elapsedMin);
        throw new HttpsError("resource-exhausted", `Just checked — try again in ${wait} min.`);
      }
    }

    try {
      const result = await refreshSingleIntention(id, { triggeredBy: "manual" });
      return { success: true, ...result };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError("internal", err.message || "Price check failed.");
    }
  }
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns true unless the URL clearly does not exist (404/410). Network errors,
// timeouts, and bot-blocks (403/405) are treated as "keep" (ambiguous, not proof broken).
async function urlResolves(u) {
  if (!u) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(u, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ZeroTide/1.0)" },
    });
    clearTimeout(timer);
    return !(res.status === 404 || res.status === 410);
  } catch {
    return true; // couldn't check — don't discard a possibly-valid link
  }
}

async function verifyLinks(currentBest, stores) {
  const jobs = [];
  if (currentBest && currentBest.sourceUrl) {
    jobs.push(urlResolves(currentBest.sourceUrl).then((ok) => { if (!ok) currentBest.sourceUrl = null; }));
  }
  for (const s of stores || []) {
    if (s.sourceUrl) {
      jobs.push(urlResolves(s.sourceUrl).then((ok) => { if (!ok) s.sourceUrl = null; }));
    }
  }
  await Promise.all(jobs);
}

module.exports.refreshSingleIntention = refreshSingleIntention;
