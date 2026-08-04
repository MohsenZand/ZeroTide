/**
 * Gemini + Google Search grounding client for ZeroTide price/deal lookups.
 *
 * Uses @google/genai (the unified SDK) rather than the older
 * @google/generative-ai package used in the sibling `nomi` app, because Google
 * Search grounding (tools: [{ googleSearch: {} }]) needs the newer SDK/model line.
 *
 * One grounded call per intention checks ALL configured stores at once and asks
 * for shelf price + coupons + cashback + deal context, so we can compute a
 * "true price" (shelf - coupon - cashback) downstream in verdict.js.
 */

// @google/genai is ESM-only; load it via dynamic import() from this CommonJS
// module inside the async call below (a top-level require() would throw).
const logger = require("firebase-functions/logger");

// Full flash (not lite): lite is too weak at the agentic work — reading the right
// page, matching the exact size, and returning a real product URL — which regressed
// price accuracy and links. Grounding (the main cost) is billed per request either
// way; the daily cap bounds spend. Rolling "latest" alias avoids deprecation.
const MODEL = "gemini-flash-latest";

function buildPricePrompt(intention, storeNames, zipCode, todayStr, cashbackSources) {
  const cbList = Array.isArray(cashbackSources) ? cashbackSources.filter(Boolean) : [];
  const cashbackRule = cbList.length
    ? `The user is enrolled ONLY in these cashback programs: ${cbList.join(", ")}. For each
   store, apply the best cashback the user could ACTUALLY get through one of THESE
   programs — look up the current portal rate for that store (Rakuten/TopCashback/etc.),
   or, for a store-specific card or loyalty program named above, apply it only at that
   store. If none of the user's programs offer cashback at a store, return an empty
   cashback array for it. Do NOT report cashback from any program not in this list.`
    : `The user has NO cashback programs enrolled — return an empty cashback array for every
   store (do not credit any cashback).`;
  const brandLine = intention.brand ? ` (brand: ${intention.brand})` : "";
  const sizeLine = intention.size ? `, size/qty: ${intention.size}` : "";
  const notesLine = intention.notes ? `\nUser note: ${intention.notes}` : "";
  const flexible = intention.matchType === "flexible";
  const cap = typeof intention.targetPrice === "number" ? intention.targetPrice : null;
  const priorityLine = storeNames.length
    ? `The user PRIORITIZES these stores — always include them when they carry it: ${storeNames.join(", ")}. But do NOT limit your search to them.`
    : `The user has no preferred stores.`;
  const searchScope = `HOW TO WORK (agentic — accuracy first, but stay reasonably frugal):
- Use Google Search to identify candidate listings and their prices.
- Then OPEN and READ (with your URL tool) the 2-3 most promising product pages to CONFIRM the exact
  size/quantity, the current price, AND the real product URL. You MUST open the page of the store you
  will report as the cheapest/winner, and put ITS canonical product URL (on that store's own domain)
  in "sourceUrl" — never a search link.
- If a read page's size does not match the request exactly, discard it and open the next candidate
  until you find the correct size, or mark it as a different size.

SEARCH SCOPE — find the genuinely lowest reliable price across the whole web, not just big chains:
- Consider Google Shopping plus any legitimate retailer, including smaller/online stores.
- ALWAYS include the product's OFFICIAL manufacturer/brand site (mark it "isOfficial": true) — genuine products, best promos.
- ${priorityLine}
- Return the ${flexible ? "best matching products" : "cheapest reliable sources"} you find — up to 5 — sorted cheapest first.`;

  const task = flexible
    ? `For EACH store, find the BEST PRODUCT that matches this description — the user is NOT
after one specific SKU, they want any product fitting the description, ideally at or
under their price cap${cap ? ` of $${cap.toFixed(2)}` : ""}. Prefer the cheapest good match that clearly fits
(right category, style, and any stated attributes like color/size/gender/material).
1. Name the exact product you picked in "sourceTitle" (e.g. "Cole Haan Modern Essentials
   Cap-Toe Oxford, Black, size 10") and give its CURRENT price in "price".
2. Include any coupons and cashback that apply, same as below.
Also estimate the typical price range for this kind of product and how often such items
go on sale.

Matching rules:
- Honor every stated attribute (size, color, gender, material, "luxury"/budget, etc.).
- It is fine if the best match is slightly over the cap — still report it, but only pick
  products that genuinely fit the description.
- If a store carries nothing fitting the description, set found=false and say why in notes.
- Do NOT fabricate products, prices, codes, or rates. Only report what you find via search.`
    : `For EACH source you find, report:
1. The CURRENT price a shopper would actually pay TODAY for the EXACT product and size
   requested — the lowest currently-available price (sale price if on sale), cross-checked
   against Google Shopping and the seller's own product page (not cached/old prices).
2. Coupons — ONLY report a coupon if BOTH: (a) it has an exact code the shopper can
   enter at checkout, OR it is an automatic discount already shown on the product/cart
   page; AND (b) you found it on the retailer's own site or a reputable current source.
   NEVER invent or estimate a code, and never report vague "up to X% off" claims from
   coupon blogs. If unsure it is currently valid for THIS product, omit it. Set the
   coupon's "confidence" honestly.
3. Cashback — ${cashbackRule}
Also give your sense of this item's typical price range and how often it goes on sale.

SIZE / QUANTITY — this is critical:
- The requested size/quantity is stated in the item name${intention.size ? ` and size field ("${intention.size}")` : ""}. Match it EXACTLY (e.g. if the user asked for 64 tablets, a 24-tablet bottle is NOT a match).
- For every result set "matchedSize" to the actual size of the listing you priced, and "sizeMatch" to one of:
  "exact" (same size), "scaled" (you computed the equivalent price for the requested size from a different pack — show the math in notes), or "different" (a different size you could not scale).
- NEVER report a different-size product's price as if it were the requested size. If you can only find another size, either scale it ("scaled") or mark it "different".
- Report the price for ONE package as sold, unless scaling to the requested quantity.

Do NOT fabricate prices/codes/rates, and do NOT report an old/regular price when a current
lower one exists. If you cannot verify a current price for the requested size, set found=false.`;

  return `You are ZeroTide, a price & deal research assistant with access to Google Search.
Today's date is ${todayStr}. The user is near zip code ${zipCode} and wants the
true, all-in price (including coupons and cashback, not just shelf price) for
${flexible ? "a product matching a description" : "one specific item"} — from wherever on the web it is genuinely cheapest and reliable.

${flexible ? "Looking for" : "Item"}: ${intention.title}${brandLine}${sizeLine}${notesLine}

${searchScope}

${task}

Return ONLY a raw JSON object — no markdown fences, no prose before or after —
in exactly this shape:

{
  "itemQueried": "string - the item as you interpreted it",
  "asOfDate": "YYYY-MM-DD",
  "results": [
    {
      "store": "string - the retailer/source name (e.g. 'iHerb', 'Thorne.com', 'Amazon')",
      "isOfficial": boolean,              // true if this is the manufacturer's/brand's own site
      "found": boolean,
      "price": number or null,            // the standard ONE-TIME (non-subscription) list or sale price for the size below — NEVER the subscription price
      "matchedSize": "string - the actual size/quantity of the listing you priced (e.g. '64 tablets')",
      "sizeMatch": "exact|scaled|different",
      "unit": "string, e.g. 'each', 'per lb', '12 oz'",
      "regularPrice": number or null,     // non-sale price, if on sale
      "onSale": boolean,
      "dealDescription": "string or null",
      "saleEndDate": "YYYY-MM-DD or null",
      "shipping": number or null,               // shipping cost to zip ${zipCode} for buying ONE unit; 0 if free
      "freeShippingThreshold": number or null,  // order subtotal that unlocks free shipping, if any
      "shippingNote": "string or null",         // e.g. 'free over $35', 'free with Prime'
      "coupons": [
        { "code": "string or null (the EXACT code to enter, or null for an automatic store discount)", "description": "string", "savings": number or null, "type": "code|digital|manufacturer|store", "confidence": "high|medium|low", "url": "string or null" }
      ],
      "cashback": [
        { "portal": "string, e.g. Rakuten", "rate": number, "url": "string or null" }
      ],
      "subscription": { "label": "string, e.g. 'Subscribe & Save 5%' or 'iHerb Autoship 5%'", "ratePercent": number or null, "savings": number or null, "url": "string or null" },
      "confidence": "high|medium|low",
      "sourceUrl": "string or null - the canonical product-page URL you actually opened, ON THAT STORE'S OWN DOMAIN (e.g. the manufacturer's own site for an official listing). Never a search page or a different store's domain.",
      "sourceTitle": "string or null",
      "howToGetPrice": "string or null - concise, concrete steps to reproduce the final all-in price (e.g. 'Add to cart, choose Subscribe & Save (-20%), apply code SAVE10 at checkout, start via Rakuten for 5% back'). Note any conditions like 'new customers only'.",
      "notes": "string or null"
    }
  ],
  "priceContext": {
    "typicalLow": number or null,
    "typicalHigh": number or null,
    "fairPrice": number or null,
    "dealFrequency": "weekly|biweekly|monthly|seasonal|rarely|unknown",
    "assessment": "cheap|fair|expensive|unknown",
    "reasoning": "string - one or two sentences on the price cycle and whether now is a good time"
  }
}

Rules:
- One object in "results" per store checked.
- CRITICAL — "price" must be the LOWEST current price actually listed for this exact
  product at that store today. Check the "from $X" figure in Google Shopping and the
  seller's live page; do not report a higher list price when a lower one is shown.
- CRITICAL to avoid double-counting: "price" is the ONE-TIME purchase price. If the page shows a lower
  "Subscribe & Save"/autoship price, put the ONE-TIME price in "price" and express the discount in
  "subscription" — do NOT put the already-discounted subscription price in "price".
  Example: Momentous Creatine 90 servings — "price": 42.99, "subscription": { "label": "Subscribe & Save 25%",
  "ratePercent": 25 } (which yields $32.24). NOT "price": 32.24.
- Capture subscription/auto-delivery discounts in "subscription": Amazon "Subscribe &
  Save", iHerb Autoship, Chewy Autoship, Thorne/manufacturer subscribe pricing, etc.
  Put the percent in "ratePercent" (5% -> 5) or a dollar amount in "savings".
  Subscription orders often include FREE shipping — set "shipping" to 0 if so.
  Use null for the whole object only if there is genuinely no subscription option.
- "savings" on a coupon is the dollar amount off (a $1.50 coupon -> 1.5). Use null if it's a percentage you can't convert.
- "rate" on cashback is the percent as a number (5% -> 5). Only include cashback the user can get per the cashback rule above.
- Empty arrays for coupons/cashback are fine when there are none.
- SHIPPING counts toward the real cost: set "shipping" to what the user would pay to ship ONE unit to zip
  ${zipCode} (0 if free). If shipping is free above a subtotal, set "freeShippingThreshold" and put the
  single-unit shipping cost in "shipping". Note memberships (e.g. 'free with Prime') in "shippingNote".
- LINKS MUST BE REAL: "sourceUrl", each coupon "url", each cashback "url", and subscription "url" must be
  direct pages you actually opened — never a Google search URL. Omit a link you cannot verify.
- The headline price is driven by what's VERIFIABLE ON THE PAGE: the current shelf/sale price and the
  subscription/auto-delivery discount. Report those precisely (e.g. $42.99 list, $32.24 with Subscribe & Save).
- COUPONS: list EVERY currently-working promo code you can find for this product/store — there may be
  several. For each, give "code", "description", "savings" (dollar amount off; if it's a %, convert using the
  list price), and a "url" (a page proving it, e.g. a coupon page or the store's promo page). These are shown
  to the user as optional "maybe" savings, NOT subtracted from the headline price. Never invent a code.
- SHIPPING: ALWAYS fill this in — every store page states it. Set "shipping" to the cost to ship one unit to
  zip ${zipCode} (0 if free), "freeShippingThreshold" to the subtotal that unlocks free shipping if any, and
  "shippingNote" to a short description ("free shipping", "free over $75", "$5.99 flat", "free with Prime").
  Do not leave shipping fields null when the info is available.
- Prices should reflect the local area / zip ${zipCode} where pricing varies.`;
}

function stripJsonFences(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

// A usable, direct link — real http(s), not an opaque grounding redirect.
function validUrl(u) {
  if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return null;
  if (u.includes("vertexaisearch.cloud.google.com")) return null;
  return u;
}
function hostOf(u) {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; }
}
function storeTokens(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2);
}

function normalizeCoupons(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && (c.description || c.code))
    .map((c) => ({
      code: c.code || null,
      description: c.description || "",
      savings: num(c.savings),
      type: ["code", "digital", "manufacturer", "store"].includes(c.type) ? c.type : "store",
      confidence: ["high", "medium", "low"].includes(c.confidence) ? c.confidence : "low",
      url: c.url || null,
    }));
}

// A coupon only reduces the true price if the user can actually redeem it: a real
// enterable code, or an automatic store discount — and not low-confidence. Anything
// vaguer is kept for display but treated as $0 toward the price.
function couponIsApplicable(c) {
  if (typeof c.savings !== "number" || c.savings <= 0) return false;
  if (c.confidence === "low") return false;
  return Boolean(c.code) || c.type === "store";
}

function normalizeCashback(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.portal === "string" && num(c.rate) !== null)
    .map((c) => ({ portal: c.portal, rate: num(c.rate), url: c.url || null }));
}

function normalizeSubscription(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ratePercent = num(raw.ratePercent);
  const savings = num(raw.savings);
  if (ratePercent === null && savings === null) return null;
  return { label: raw.label || "Subscription", ratePercent, savings, url: raw.url || null };
}

/**
 * Calls Gemini with Google Search grounding for a single intention, checking all
 * configured stores in one grounded request. Returns
 * { itemQueried, asOfDate, results[], priceContext }.
 */
async function callGeminiForIntention({ intention, storeNames, zipCode, apiKey, cashbackSources }) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const todayStr = new Date().toISOString().split("T")[0];
  const prompt = buildPricePrompt(intention, storeNames, zipCode, todayStr, cashbackSources);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      // Agentic: googleSearch finds candidates, urlContext lets the model actually
      // OPEN and READ the product pages to verify the exact size + current price
      // (instead of trusting search snippets).
      tools: [{ googleSearch: {} }, { urlContext: {} }],
      // Low temperature for factual, repeatable price extraction. No output cap:
      // this model uses "thinking" tokens, and a low cap truncated the JSON.
      temperature: 0,
    },
  });

  const rawText = response.text;
  if (!rawText) throw new Error("Empty response from Gemini");

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(rawText));
  } catch (err) {
    logger.error("Failed to parse Gemini response as JSON", { rawText, error: err.message });
    throw new Error("Could not parse AI response as JSON");
  }
  if (!Array.isArray(parsed.results)) throw new Error("AI response missing results array");

  // Real product URLs the model actually opened (via urlContext) — use these as
  // the direct links instead of an opaque search.
  const urlMeta = response.candidates?.[0]?.urlContextMetadata?.urlMetadata || [];
  const readUrls = urlMeta
    .filter((m) => /SUCCESS/i.test(m.urlRetrievalStatus || m.url_retrieval_status || ""))
    .map((m) => validUrl(m.retrievedUrl || m.retrieved_url))
    .filter(Boolean);

  const hostMatchesStore = (u, store) => {
    const h = hostOf(u);
    return storeTokens(store).some((t) => h.includes(t) || t.includes(h.split(".")[0]));
  };

  const results = parsed.results
    .filter((r) => r && typeof r.store === "string")
    .map((r) => {
      // Prefer a URL the tool ACTUALLY retrieved for this store (known to resolve)
      // over a slug the model typed (which may 404). Then the model's URL if its
      // domain matches. Else null → the UI offers a search.
      let sourceUrl = readUrls.find((u) => hostMatchesStore(u, r.store)) || null;
      if (!sourceUrl) {
        const claimed = validUrl(r.sourceUrl);
        if (claimed && hostMatchesStore(claimed, r.store)) sourceUrl = claimed;
      }
      const sourceTitle = r.sourceTitle || null;
      return {
        store: r.store,
        isOfficial: Boolean(r.isOfficial),
        found: Boolean(r.found),
        price: num(r.price),
        matchedSize: r.matchedSize || null,
        sizeMatch: ["exact", "scaled", "different"].includes(r.sizeMatch) ? r.sizeMatch : "exact",
        unit: r.unit || null,
        regularPrice: num(r.regularPrice),
        onSale: Boolean(r.onSale),
        dealDescription: r.dealDescription || null,
        saleEndDate: r.saleEndDate || null,
        shipping: num(r.shipping),
        freeShippingThreshold: num(r.freeShippingThreshold),
        shippingNote: r.shippingNote || null,
        coupons: normalizeCoupons(r.coupons),
        cashback: normalizeCashback(r.cashback),
        subscription: normalizeSubscription(r.subscription),
        confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low",
        sourceUrl,
        sourceTitle,
        howToGetPrice: r.howToGetPrice || null,
        notes: r.notes || null,
      };
    });

  const pc = parsed.priceContext || {};
  const priceContext = {
    typicalLow: num(pc.typicalLow),
    typicalHigh: num(pc.typicalHigh),
    fairPrice: num(pc.fairPrice),
    dealFrequency: ["weekly", "biweekly", "monthly", "seasonal", "rarely", "unknown"].includes(pc.dealFrequency)
      ? pc.dealFrequency
      : "unknown",
    assessment: ["cheap", "fair", "expensive", "unknown"].includes(pc.assessment) ? pc.assessment : "unknown",
    reasoning: pc.reasoning || null,
  };

  return {
    itemQueried: parsed.itemQueried || intention.title,
    asOfDate: parsed.asOfDate || todayStr,
    results,
    priceContext,
  };
}

module.exports = { buildPricePrompt, callGeminiForIntention, couponIsApplicable };
