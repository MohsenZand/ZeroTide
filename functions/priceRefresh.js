/**
 * Price refresh: the heart of ZeroTide.
 *
 * refreshSingleIntention() is the shared core used by both the daily scheduled
 * batch and the manual "check now" callable. It picks one of two paths:
 *
 *   MONITOR (the default, ~free)
 *     We already know which pages sell this item. Re-read those pages directly
 *     — structured data where the retailer publishes it, otherwise a cheap model
 *     reading the condensed page. No Google Search, so nothing is billed per
 *     query. This is what runs on almost every check.
 *
 *   DISCOVER (rare, billed)
 *     Grounded search across the web for who sells this and at what price. Run
 *     when the item is new, when we have no usable page for it, when monitoring
 *     comes back empty, or on a periodic sweep to catch cheaper sellers we have
 *     never seen. Afterwards every discovered price is re-read from its own page
 *     so the stored number is one we verified, not one the model reported.
 *
 * Either way: write one priceHistory snapshot per store -> derive price context
 * from observed history -> compute true price + verdict -> update the
 * intention's denormalized currentBest.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { callGeminiForIntention } = require("./geminiPriceClient");
const { reserveAiCallBudget, recordGroundedSearches } = require("./aiBudget");
const { readStorePrice } = require("./priceExtract");
const { derivePriceContext } = require("./priceStats");
const { evaluate, computeTruePrice } = require("./verdict");
const { loadSettings } = require("./settings");
const { sendBuyNowDigest, gmailSecrets } = require("./notify");
const { assertOwner } = require("./auth");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const MAX_MONITORED_STORES = 5;
const PAGE_CONCURRENCY = 3; // polite: never hammer several pages of one retailer at once

async function refreshSingleIntention(intentionId, { triggeredBy, runId, mode } = {}) {
  const ref = db.collection("intentions").doc(intentionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Intention ${intentionId} not found`);
  const intention = { id: snap.id, ...snap.data() };

  const settings = await loadSettings();
  const apiKey = geminiApiKey.value();

  const known = knownStorePages(intention);
  const wantsDiscovery =
    mode === "discover" ||
    known.length === 0 ||
    isRediscoveryDue(intention, settings);

  let aiResult = null;
  let usedPath = null;

  // ── MONITOR ──────────────────────────────────────────────────────────────
  if (!wantsDiscovery) {
    const monitored = await monitorKnownPages({ intention, known, settings, apiKey });
    if (monitored.length) {
      aiResult = {
        itemQueried: intention.title,
        asOfDate: new Date().toISOString().split("T")[0],
        results: monitored,
        // Carry the last estimate forward only as a fallback — derivePriceContext
        // prefers measured history and will override it once there is enough.
        priceContext: intention.priceContext || {},
      };
      usedPath = "monitor";
    } else {
      logger.info("Monitoring found no readable page, falling back to discovery", { intentionId });
    }
  }

  // ── DISCOVER ─────────────────────────────────────────────────────────────
  if (!aiResult) {
    await reserveAiCallBudget(db); // reserve BEFORE the billable grounded call

    const globalStores = (settings.preferredStores || []).map((s) => s.name);
    const itemStores = Array.isArray(intention.stores) ? intention.stores : [];
    const storeNames = [...new Set([...itemStores, ...globalStores])].slice(0, MAX_MONITORED_STORES);

    try {
      aiResult = await callGeminiForIntention({
        intention,
        storeNames,
        zipCode: settings.zipCode,
        apiKey,
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

    await recordGroundedSearches(db, aiResult.usage?.searchCount || 0);

    // Confirm each discovered price against the seller's own page. Discovery
    // tells us where to look; the page tells us the number.
    aiResult.results = await confirmDiscoveredPrices({ intention, results: aiResult.results, settings, apiKey });
    usedPath = "discover";
  }

  // Read recent history for the "near historical low" check and for measuring
  // this item's real price band.
  const histSnap = await ref.collection("priceHistory").orderBy("checkedAt", "desc").limit(180).get();
  const history = histSnap.docs.map((d) => d.data());

  // Price context from what we actually observed, not what a model guessed.
  const cheapestNow = aiResult.results
    .map((r) => computeTruePrice(r))
    .filter(Boolean)
    .map((tp) => tp.truePrice)
    .sort((a, b) => a - b)[0];
  aiResult.priceContext = derivePriceContext({
    history,
    aiContext: aiResult.priceContext,
    currentPrice: cheapestNow,
  });

  const { currentBest, verdict, verdictReason, savings, stores } = evaluate({ intention, aiResult, history });

  // Verify links actually resolve (our own fetch — free, no AI cost). Drop only hard
  // 404/410s so a broken slug becomes a search fallback; keep bot-blocked (403) pages.
  await verifyLinks(currentBest, stores);

  // Persist one snapshot per store result.
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
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
      // How this number was obtained, kept per snapshot so the history is
      // auditable after the fact.
      provenanceMethod: r.provenance?.method || null,
      provenanceVerified: Boolean(r.provenance?.verified),
      triggeredBy,
      checkPath: usedPath,
    });
  }

  const update = {
    currentBest,
    verdict,
    verdictReason,
    savings,
    latestStores: stores,
    priceContext: aiResult.priceContext,
    pageCache: collectPageCache(aiResult.results),
    lastCheckPath: usedPath,
    lastError: null,
    lastCheckedAt: now,
    updatedAt: now,
  };
  if (usedPath === "discover") update.lastDiscoveryAt = now;
  if (triggeredBy === "manual") update.lastManualCheckAt = now;
  batch.set(ref, update, { merge: true });
  await batch.commit();

  return { currentBest, verdict, verdictReason, savings, stores, checkPath: usedPath };
}

// ── Path selection ───────────────────────────────────────────────────────────

/**
 * Pages we can re-read without searching: whatever the last check resolved to a
 * real on-domain product URL. `latestStores` already holds these, cheapest first.
 */
function knownStorePages(intention) {
  const seen = new Set();
  const out = [];

  const push = (store, sourceUrl, previous) => {
    if (!store || !sourceUrl || seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    out.push({ store, url: sourceUrl, previous: previous || null });
  };

  for (const s of intention.latestStores || []) {
    if (s.found && s.sourceUrl) push(s.store, s.sourceUrl, s);
  }
  if (intention.currentBest?.sourceUrl) {
    push(intention.currentBest.store, intention.currentBest.sourceUrl, intention.currentBest);
  }
  return out.slice(0, MAX_MONITORED_STORES);
}

/**
 * Monitoring only ever re-checks sellers we already found. A periodic grounded
 * sweep is what catches a cheaper seller that appeared since — without it the
 * app would quietly lock onto whoever won on day one.
 */
function isRediscoveryDue(intention, settings) {
  const everyDays = typeof settings.rediscoverEveryDays === "number" ? settings.rediscoverEveryDays : 30;
  if (everyDays <= 0) return false;
  const last = intention.lastDiscoveryAt?.toDate
    ? intention.lastDiscoveryAt.toDate()
    : intention.lastDiscoveryAt
      ? new Date(intention.lastDiscoveryAt)
      : null;
  if (!last) return true;
  return (Date.now() - last.getTime()) / 86400000 >= everyDays;
}

// ── The two paths ────────────────────────────────────────────────────────────

async function monitorKnownPages({ intention, known, settings, apiKey }) {
  const cache = Array.isArray(intention.pageCache) ? intention.pageCache : [];
  const cacheFor = (url) => cache.find((c) => c.url === url) || null;

  const results = await mapLimit(known, PAGE_CONCURRENCY, async ({ store, url, previous }) => {
    try {
      return await readStorePrice({
        intention,
        store,
        url,
        zipCode: settings.zipCode,
        apiKey,
        previous,
        cache: cacheFor(url),
      });
    } catch (err) {
      logger.warn("Page monitor failed for store", { store, url, error: err.message });
      return null;
    }
  });

  return results.filter(Boolean);
}

/**
 * Re-read every discovered listing from its own page. Where the page and the
 * model disagree, the page wins — that is the whole point. Results we cannot
 * re-read keep the discovered figures, still flagged unverified.
 */
async function confirmDiscoveredPrices({ intention, results, settings, apiKey }) {
  return mapLimit(results || [], PAGE_CONCURRENCY, async (r) => {
    if (!r.found || !r.sourceUrl || typeof r.price !== "number") return r;
    try {
      const confirmed = await readStorePrice({
        intention,
        store: r.store,
        url: r.sourceUrl,
        zipCode: settings.zipCode,
        apiKey,
        previous: r,
      });
      if (!confirmed || typeof confirmed.price !== "number") return r;

      if (Math.abs(confirmed.price - r.price) > 0.01) {
        logger.info("Page read disagreed with discovery; trusting the page", {
          store: r.store,
          discovered: r.price,
          onPage: confirmed.price,
        });
      }
      // `confirmed` is already the right merge: readStorePrice was handed this
      // discovery result as `previous`, so it keeps discovery's coupons,
      // cashback and how-to steps (facts that aren't printed on the page) while
      // its hard numbers come from the page itself.
      return { ...confirmed, notes: confirmed.notes || r.notes || null };
    } catch (err) {
      logger.warn("Could not confirm discovered price", { store: r.store, error: err.message });
      return r;
    }
  });
}

/** Per-URL ETag/Last-Modified so tomorrow's check can ask for a cheap 304. */
function collectPageCache(results) {
  return (results || [])
    .filter((r) => r.cache && r.sourceUrl && (r.cache.etag || r.cache.lastModified))
    .map((r) => ({ url: r.sourceUrl, etag: r.cache.etag || null, lastModified: r.cache.lastModified || null }))
    .slice(0, MAX_MONITORED_STORES);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
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
    const paths = { monitor: 0, discover: 0 };

    for (const id of ids) {
      try {
        const res = await refreshSingleIntention(id, { triggeredBy: "scheduled", runId });
        processed += 1;
        if (res.checkPath) paths[res.checkPath] = (paths[res.checkPath] || 0) + 1;
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
      itemsMonitored: paths.monitor || 0,
      itemsDiscovered: paths.discover || 0,
      itemIds: ids,
      errors,
    });
    logger.info("Scheduled refresh complete", {
      runId,
      processed,
      failed: errors.length,
      monitored: paths.monitor || 0,
      discovered: paths.discover || 0,
    });
  }
);

// ── Manual "check now" ───────────────────────────────────────────────────────
exports.checkIntentionNow = onCall(
  { region: "us-central1", cors: true, invoker: "public", secrets: [geminiApiKey], timeoutSeconds: 240, memory: "512MiB" },
  async (request) => {
    assertOwner(request);
    const { id, rediscover } = request.data || {};
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
      const result = await refreshSingleIntention(id, {
        triggeredBy: "manual",
        // "Search again" explicitly asks for a fresh grounded sweep; a plain
        // "Check now" just re-reads the pages we know, which costs nothing.
        mode: rediscover ? "discover" : undefined,
      });
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
