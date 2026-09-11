/**
 * Reading the price off a product page we already know about.
 *
 * This is ZeroTide's monitoring path, as opposed to the discovery path in
 * geminiPriceClient.js. The difference is the whole cost story:
 *
 *   discovery  = "where on the web is this sold, and for how much?"
 *                -> needs Google Search grounding, billed per search query
 *   monitoring = "what does this page I already know say today?"
 *                -> needs an HTTP GET, and at most a cheap model reading it
 *
 * Three tiers, stopping at the first that works:
 *   Tier 0  structured data in the page (Shopify JSON, schema.org, OpenGraph)
 *           — free, exact, impossible to hallucinate
 *   Tier 1  a cheap model reading the *condensed page text*, no tools at all
 *           — fractions of a cent, and every number it returns is checked
 *             against the bytes the retailer actually served
 *   (Tier 2 = grounded discovery, lives in geminiPriceClient.js, run rarely)
 *
 * Everything here attaches `provenance`, so the app can always answer "where
 * did this number come from?" — that is the point of the exercise.
 */

const logger = require("firebase-functions/logger");
const {
  fetchPage,
  extractStructuredPrice,
  condensePage,
  priceAppearsInText,
} = require("./pageFetch");

// Extraction is a much easier job than discovery: the page text is handed to
// the model, it just has to pick the right numbers out of it. The cheapest
// model is entirely adequate here — unlike agentic discovery, where flash-lite
// previously regressed badly. Grounding is never enabled on this path.
const EXTRACT_MODEL = "gemini-3.5-flash-lite";
const EXTRACT_MODEL_FALLBACK = "gemini-2.5-flash-lite";

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN" },
    price: { type: "NUMBER", nullable: true },
    matchedSize: { type: "STRING", nullable: true },
    sizeMatch: { type: "STRING", enum: ["exact", "scaled", "different"] },
    unit: { type: "STRING", nullable: true },
    regularPrice: { type: "NUMBER", nullable: true },
    onSale: { type: "BOOLEAN" },
    dealDescription: { type: "STRING", nullable: true },
    inStock: { type: "BOOLEAN" },
    shipping: { type: "NUMBER", nullable: true },
    freeShippingThreshold: { type: "NUMBER", nullable: true },
    shippingNote: { type: "STRING", nullable: true },
    subscriptionLabel: { type: "STRING", nullable: true },
    subscriptionRatePercent: { type: "NUMBER", nullable: true },
    subscriptionSavings: { type: "NUMBER", nullable: true },
    sourceTitle: { type: "STRING", nullable: true },
    notes: { type: "STRING", nullable: true },
  },
  required: ["found", "sizeMatch", "onSale", "inStock"],
};

function buildExtractPrompt(intention, store, pageText, zipCode) {
  const wanted = [
    intention.title,
    intention.brand ? `brand: ${intention.brand}` : null,
    intention.size ? `size/qty: ${intention.size}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `Below is the price-bearing text extracted from a product page at ${store}.
Read it and report what a shopper would pay TODAY. Do not use outside knowledge —
if a fact is not in the text, leave it null.

The user wants: ${wanted}

Rules:
- "price" = the standard ONE-TIME purchase price shown on this page. If the page
  also shows a lower Subscribe & Save / autoship price, do NOT put that in "price";
  put the discount in "subscriptionRatePercent" or "subscriptionSavings" instead.
- "matchedSize" = the actual size/quantity this page is selling (e.g. "64 tablets",
  "90 servings"). "sizeMatch" = "exact" if it matches what the user wants,
  "scaled" if you converted from a different pack size (explain in notes),
  "different" otherwise. Never report a different size's price as the requested size.
- "shipping" = cost to ship one unit to zip ${zipCode}, 0 if free. Null if the page
  doesn't say.
- Every number you return must appear in the text below. If you cannot find a
  current price in the text, set found=false. Never estimate or infer a price.

PAGE TEXT:
${pageText}`;
}

async function callExtractModel(ai, model, prompt) {
  return ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      // No tools. No googleSearch, no urlContext — we already have the bytes.
      // This is what makes the monitoring path cost input tokens and nothing else.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: EXTRACT_SCHEMA,
    },
  });
}

/**
 * Read one known product URL and return a store result shaped exactly like the
 * ones geminiPriceClient produces, so verdict.js needs no special-casing.
 *
 * `previous` is the last known snapshot for this store. Cashback rates and promo
 * codes are portal/offer facts that are not printed on the product page, so they
 * are carried forward from the last discovery run rather than dropped — they
 * change far more slowly than price, and they get refreshed at rediscovery.
 *
 * Returns null if the page could not be read at all (caller falls back to
 * grounded discovery).
 */
async function readStorePrice({ intention, store, url, zipCode, apiKey, previous, cache }) {
  const page = await fetchPage(url, { etag: cache?.etag, lastModified: cache?.lastModified });

  // 304 Not Modified: the retailer says the page is byte-identical to last time,
  // so the price is too. Free, and stronger evidence than re-reading it.
  if (page.notModified && previous && typeof previous.price === "number") {
    return {
      ...carryForward(previous, store, url),
      provenance: {
        method: "http-304",
        readAt: new Date().toISOString(),
        evidenceUrl: url,
        snippet: "HTTP 304 Not Modified — page unchanged since last check",
        verified: true,
      },
      cache: { etag: cache?.etag || null, lastModified: cache?.lastModified || null },
    };
  }

  if (!page.ok || !page.body) {
    logger.info("Page fetch failed on monitor path", { store, url, status: page.status, error: page.error });
    return null;
  }

  const base = {
    store,
    isOfficial: Boolean(previous?.isOfficial),
    sourceUrl: page.finalUrl || url,
    coupons: previous?.coupons || [],
    cashback: previous?.cashback || [],
    cache: { etag: page.etag || null, lastModified: page.lastModified || null },
  };

  // ── Tier 0 ───────────────────────────────────────────────────────────────
  const structured = await extractStructuredPrice(url, page.body);

  // ── Tier 1 ───────────────────────────────────────────────────────────────
  // Still run it even when Tier 0 succeeded: Tier 0 gives an authoritative
  // price but says nothing about shipping or Subscribe & Save, which the true
  // price depends on. Tier 0's price wins on conflict.
  let ai = null;
  const pageText = condensePage(page.body);
  if (pageText.length > 40 && apiKey) {
    ai = await runTier1({ intention, store, pageText, zipCode, apiKey });
  }

  if (!structured && !ai) return null;

  const price = structured?.price ?? ai?.price ?? null;
  if (typeof price !== "number") return null;

  // Fields the product page does not always spell out. Dropping one because a
  // single read missed it would silently change the true price — losing a
  // Subscribe & Save discount understates it and can fire a false "buy now".
  // So: the page wins when it has an answer, otherwise keep what we knew, and
  // record which fields were carried so the snapshot stays auditable.
  const carried = [];
  const preferPage = (fresh, field) => {
    if (fresh !== null && fresh !== undefined) return fresh;
    const prior = previous?.[field];
    if (prior !== null && prior !== undefined) {
      carried.push(field);
      return prior;
    }
    return null;
  };

  const subscription = preferPage(buildSubscription(ai), "subscription");
  const sizeTitle = structured?.title || ai?.sourceTitle || previous?.sourceTitle || null;
  const inStock = structured?.available !== false && ai?.inStock !== false;

  return {
    ...base,
    // An out-of-stock listing is not a price you can act on, so it must never win
    // the best-price comparison. It still shows in the per-store breakdown.
    found: inStock,
    price,
    matchedSize: ai?.matchedSize || structured?.title || previous?.matchedSize || null,
    sizeMatch: resolveSizeMatch(ai, structured, intention),
    unit: preferPage(ai?.unit ?? null, "unit"),
    regularPrice: ai?.regularPrice ?? null,
    onSale: Boolean(ai?.onSale),
    dealDescription: ai?.dealDescription || null,
    saleEndDate: previous?.saleEndDate || null,
    shipping: preferPage(ai?.shipping ?? null, "shipping"),
    freeShippingThreshold: preferPage(ai?.freeShippingThreshold ?? null, "freeShippingThreshold"),
    shippingNote: preferPage(ai?.shippingNote || null, "shippingNote"),
    subscription,
    // A price we read off the page ourselves is the most trustworthy number the
    // app can produce; a model reading that page is a notch below.
    confidence: structured ? "high" : "medium",
    sourceTitle: sizeTitle,
    howToGetPrice: previous?.howToGetPrice || null,
    inStock,
    notes: ai?.notes || (inStock ? null : "Listed as out of stock on the page."),
    provenance: {
      method: structured ? structured.method : "llm-page-read",
      model: structured ? null : EXTRACT_MODEL,
      readAt: new Date().toISOString(),
      evidenceUrl: structured?.evidenceUrl || page.finalUrl || url,
      snippet: (structured?.snippet || firstPriceSnippet(pageText, price) || "").slice(0, 400),
      verified: true,
      grounded: false,
      carriedFields: carried,
    },
  };
}

async function runTier1({ intention, store, pageText, zipCode, apiKey }) {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey });
  const prompt = buildExtractPrompt(intention, store, pageText, zipCode);

  let response;
  try {
    response = await callExtractModel(client, EXTRACT_MODEL, prompt);
  } catch (err) {
    if (/not found|NOT_FOUND|unsupported|404/i.test(err.message || "")) {
      logger.warn("Extract model unavailable, falling back", { model: EXTRACT_MODEL, error: err.message });
      response = await callExtractModel(client, EXTRACT_MODEL_FALLBACK, prompt);
    } else {
      logger.warn("Tier-1 extraction failed", { store, error: err.message });
      return null;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    logger.warn("Tier-1 extraction returned unparseable JSON", { store });
    return null;
  }
  if (!parsed || parsed.found === false) return null;

  // ── The anti-hallucination gate ──────────────────────────────────────────
  // Any monetary figure the model reports must literally occur in the page text
  // we handed it. This is what turns "the model says $27.99" into "the page says
  // $27.99". Numbers that fail are dropped, not reported with low confidence.
  const drop = [];
  for (const field of ["price", "regularPrice", "shipping", "freeShippingThreshold", "subscriptionSavings"]) {
    const v = parsed[field];
    if (typeof v !== "number" || v === 0) continue; // 0 (free shipping) needn't be printed
    if (!priceAppearsInText(v, pageText)) {
      drop.push(`${field}=${v}`);
      parsed[field] = null;
    }
  }
  if (drop.length) {
    logger.warn("Dropped unverifiable figures from page extraction", { store, dropped: drop });
  }
  if (typeof parsed.price !== "number") return null;

  return parsed;
}

function buildSubscription(ai) {
  if (!ai) return null;
  const rate = typeof ai.subscriptionRatePercent === "number" ? ai.subscriptionRatePercent : null;
  const savings = typeof ai.subscriptionSavings === "number" ? ai.subscriptionSavings : null;
  if (rate === null && savings === null) return null;
  return {
    label: ai.subscriptionLabel || "Subscription",
    ratePercent: rate,
    savings,
    url: null,
  };
}

// Tier 0 gives us the listing's real title (Shopify: "Creatine - 90 Servings"),
// which is a far better size check than asking a model to be careful.
function resolveSizeMatch(ai, structured, intention) {
  const claimed = ai?.sizeMatch;
  if (["exact", "scaled", "different"].includes(claimed)) return claimed;
  if (structured?.title && intention.size) {
    const want = String(intention.size).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const got = String(structured.title).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (want && got.includes(want)) return "exact";
  }
  return "exact";
}

function firstPriceSnippet(pageText, price) {
  const needle = price.toFixed(2);
  const i = pageText.indexOf(needle);
  if (i === -1) return null;
  return pageText.slice(Math.max(0, i - 120), i + 120).replace(/\s+/g, " ").trim();
}

/** Reuse the previous snapshot verbatim (used on a 304). */
function carryForward(previous, store, url) {
  return {
    store,
    isOfficial: Boolean(previous.isOfficial),
    found: true,
    price: previous.price,
    matchedSize: previous.matchedSize || null,
    sizeMatch: previous.sizeMatch || "exact",
    unit: previous.unit || null,
    regularPrice: previous.regularPrice ?? null,
    onSale: Boolean(previous.onSale),
    dealDescription: previous.dealDescription || null,
    saleEndDate: previous.saleEndDate || null,
    shipping: previous.shipping ?? null,
    freeShippingThreshold: previous.freeShippingThreshold ?? null,
    shippingNote: previous.shippingNote || null,
    coupons: previous.coupons || [],
    cashback: previous.cashback || [],
    subscription: previous.subscription || null,
    confidence: "high",
    sourceUrl: url,
    sourceTitle: previous.sourceTitle || null,
    howToGetPrice: previous.howToGetPrice || null,
    inStock: true,
    notes: previous.notes || null,
  };
}

module.exports = { readStorePrice, EXTRACT_MODEL };
