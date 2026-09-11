/**
 * ZeroTide verdict engine.
 *
 * Turns a Gemini result set + the item's own price history + the user's target
 * price into:
 *   - a "true price" per store  (shelf - best coupon - best cashback)
 *   - the single best store to buy from right now
 *   - a verdict: buy | close | wait | watch  (+ a human reason)
 *   - savings numbers for the regret/savings meter
 *
 * The AI provides the raw prices/coupons/context; this file is the deterministic
 * decision logic so behaviour is predictable and testable.
 */

const { couponIsApplicable } = require("./geminiPriceClient");

// Stacking order: shelf -> minus coupon (dollar) -> minus subscription (Subscribe &
// Save / autoship) -> minus cashback (%). Matches how these actually combine at checkout.
// Only *redeemable* coupons (real code or automatic store discount, not low-confidence)
// reduce the price — vague/unverifiable coupons are ignored so we don't overstate savings.
function computeTruePrice(result) {
  if (!result.found || typeof result.price !== "number") return null;

  const bestCashbackRate = (result.cashback || [])
    .map((c) => (typeof c.rate === "number" ? c.rate : 0))
    .reduce((m, r) => Math.max(m, r), 0);

  // Subscription discount is verifiable on the product page, so it drives the price.
  const sub = result.subscription;
  let subSavings = 0;
  if (sub) {
    if (typeof sub.savings === "number") subSavings = sub.savings;
    else if (typeof sub.ratePercent === "number") subSavings = (result.price * sub.ratePercent) / 100;
  }
  subSavings = round2(subSavings);

  const afterDiscount = Math.max(0, result.price - subSavings);
  const shipping = typeof result.shipping === "number" && result.shipping > 0 ? result.shipping : 0;
  const truePrice = afterDiscount * (1 - bestCashbackRate / 100) + shipping;

  // Promo codes are NOT baked into the headline (absolute) price — too unverifiable.
  // Instead every code with a discount becomes a "maybe" price the user can try.
  // maybePrice = coupon path (list − code) + cashback + shipping (codes rarely stack
  // with subscription, so we don't assume it).
  const couponSuggestions = (result.coupons || [])
    .filter((c) => c && c.code && typeof c.savings === "number" && c.savings > 0)
    .map((c) => ({
      code: c.code,
      description: c.description || null,
      savings: round2(c.savings),
      url: c.url || null,
      maybePrice: round2(Math.max(0, result.price - c.savings) * (1 - bestCashbackRate / 100) + shipping),
    }))
    .sort((a, b) => a.maybePrice - b.maybePrice)
    .slice(0, 4);

  return {
    shelfPrice: result.price,
    subscriptionSavings: subSavings,
    subscriptionLabel: sub ? sub.label : null,
    appliedDiscount: subSavings,
    discountVia: subSavings > 0 ? "subscription" : null,
    couponSuggestions,                  // "maybe" prices — verify; never in the absolute price
    cashbackRate: bestCashbackRate,
    shipping: round2(shipping),
    freeShippingThreshold: typeof result.freeShippingThreshold === "number" ? result.freeShippingThreshold : null,
    shippingNote: result.shippingNote || null,
    truePrice: round2(truePrice),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Pull the historical low true-price from prior snapshots (best truePrice seen).
 * history is an array of snapshot docs, newest first, each may carry truePrice.
 */
function historicalLow(history) {
  const vals = (history || [])
    .map((h) => (typeof h.truePrice === "number" ? h.truePrice : h.price))
    .filter((v) => typeof v === "number");
  return vals.length ? Math.min(...vals) : null;
}

/**
 * Main entry. Returns the object stored on the intention's `currentBest` plus a
 * verdict block.
 */
function evaluate({ intention, aiResult, history }) {
  const target = typeof intention.targetPrice === "number" ? intention.targetPrice : null;

  // Attach true price to each found result.
  const allPriced = (aiResult.results || [])
    .map((r) => ({ result: r, tp: computeTruePrice(r) }))
    .filter((x) => x.tp !== null);

  // Only same-size ("exact"/"scaled") results are comparable for the best-price
  // verdict — a different-size listing must never win. Wrong-size ones still show
  // in the breakdown, flagged, so nothing is silently hidden.
  const comparable = allPriced.filter((x) => x.result.sizeMatch !== "different");

  if (comparable.length === 0) {
    return {
      currentBest: null,
      verdict: "watch",
      verdictReason: allPriced.length
        ? "Only different-size listings found so far — ZeroTide will keep looking for the exact size."
        : "No live price found yet — ZeroTide will keep looking.",
      savings: null,
      stores: buildStoreList(allPriced, aiResult.results || []),
    };
  }

  comparable.sort((a, b) => {
    if (a.tp.truePrice !== b.tp.truePrice) return a.tp.truePrice - b.tp.truePrice;
    // tie-break toward higher confidence
    return confRank(b.result.confidence) - confRank(a.result.confidence);
  });

  const winner = comparable[0];
  const r = winner.result;
  const tp = winner.tp;
  const ctx = aiResult.priceContext || {};

  const currentBest = {
    store: r.store,
    isOfficial: Boolean(r.isOfficial),
    matchedSize: r.matchedSize || null,
    sizeMatch: r.sizeMatch || "exact",
    shelfPrice: tp.shelfPrice,
    truePrice: tp.truePrice,
    cashbackRate: tp.cashbackRate,
    subscriptionSavings: tp.subscriptionSavings,
    subscriptionLabel: tp.subscriptionLabel,
    appliedDiscount: tp.appliedDiscount,
    discountVia: tp.discountVia,
    shipping: tp.shipping,
    freeShippingThreshold: tp.freeShippingThreshold,
    shippingNote: tp.shippingNote,
    couponSuggestions: tp.couponSuggestions,
    bestCashback: (r.cashback || [])[0] || null,
    subscription: r.subscription || null,
    unit: r.unit,
    onSale: r.onSale,
    dealDescription: r.dealDescription,
    saleEndDate: r.saleEndDate,
    confidence: r.confidence,
    sourceUrl: r.sourceUrl,
    sourceTitle: r.sourceTitle,
    howToGetPrice: r.howToGetPrice || null,
    asOfDate: aiResult.asOfDate,
    typicalLow: ctx.typicalLow,
    typicalHigh: ctx.typicalHigh,
    dealFrequency: ctx.dealFrequency,
    // Where the number came from, so the UI never has to present a read price
    // and an estimated one as if they were equally solid.
    provenance: r.provenance || null,
    contextSource: ctx.source || "estimated",
    observedDays: ctx.observedDays || 0,
  };

  // ── Verdict ──────────────────────────────────────────────────────────────
  const price = tp.truePrice;
  const histLow = historicalLow(history);
  const nearLow =
    (typeof ctx.typicalLow === "number" && price <= ctx.typicalLow * 1.03) ||
    (typeof histLow === "number" && price <= histLow * 1.03);

  let verdict;
  let reason;

  if (target !== null && price <= target) {
    verdict = "buy";
    const bits = [`True price ${money(price)} is at or below your ${money(target)}`];
    if (nearLow) bits.push("and near its historical low");
    if (tp.appliedDiscount > 0 || tp.cashbackRate > 0 || tp.shipping > 0) bits.push(dealBits(tp));
    reason = bits.join(", ") + ".";
  } else if (target !== null && price <= target * 1.05) {
    verdict = "close";
    reason = `True price ${money(price)} is just above your ${money(target)}${dealHint(ctx)}.`;
  } else if (nearLow && target === null) {
    // no target set, but it's a genuinely good moment
    verdict = "buy";
    reason = `True price ${money(price)} is near its typical low${dealBits(tp) ? ", " + dealBits(tp) : ""}.`;
  } else {
    // Not there yet — is a dip likely soon?
    const soon = ["weekly", "biweekly", "monthly"].includes(ctx.dealFrequency);
    verdict = soon ? "wait" : "watch";
    reason = buildWaitReason(ctx, target, price);
  }

  const savings = buildSavings({ tp, winner: r, target });
  const stores = buildStoreList(allPriced, aiResult.results || []);

  return { currentBest, verdict, verdictReason: reason, savings, stores };
}

// Full per-store breakdown for the card's "compare stores" view: found stores
// first (cheapest true price first), then any not-found ones.
function buildStoreList(priced, allResults) {
  const found = priced.map(({ result, tp }) => ({
    store: result.store,
    isOfficial: Boolean(result.isOfficial),
    found: true,
    matchedSize: result.matchedSize || null,
    sizeMatch: result.sizeMatch || "exact",
    shelfPrice: tp.shelfPrice,
    truePrice: tp.truePrice,
    cashbackRate: tp.cashbackRate,
    subscriptionSavings: tp.subscriptionSavings,
    subscriptionLabel: tp.subscriptionLabel,
    appliedDiscount: tp.appliedDiscount,
    discountVia: tp.discountVia,
    shipping: tp.shipping,
    freeShippingThreshold: tp.freeShippingThreshold,
    shippingNote: tp.shippingNote,
    couponSuggestions: tp.couponSuggestions,
    cashback: (result.cashback || [])[0] || null,
    subscription: result.subscription || null,
    unit: result.unit,
    onSale: result.onSale,
    dealDescription: result.dealDescription,
    confidence: result.confidence,
    sourceUrl: result.sourceUrl,
    sourceTitle: result.sourceTitle,
    howToGetPrice: result.howToGetPrice || null,
    notes: result.notes,
    provenance: result.provenance || null,
  }));
  // Comparable (right size) first, cheapest first; wrong-size found ones next; not-found last.
  found.sort((a, b) => {
    const ad = a.sizeMatch === "different" ? 1 : 0;
    const bd = b.sizeMatch === "different" ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return a.truePrice - b.truePrice;
  });
  const pricedResults = new Set(priced.map((p) => p.result));
  const missing = allResults
    .filter((r) => !pricedResults.has(r))
    .map((r) => ({ store: r.store, found: false, notes: r.notes || null, sourceUrl: r.sourceUrl || null }));
  return [...found, ...missing];
}

function buildWaitReason(ctx, target, price) {
  const parts = [];
  if (typeof ctx.typicalLow === "number") {
    parts.push(`usually dips to about ${money(ctx.typicalLow)}`);
  }
  const freq = {
    weekly: "roughly weekly",
    biweekly: "every couple of weeks",
    monthly: "about monthly",
    seasonal: "seasonally",
    rarely: "only rarely",
  }[ctx.dealFrequency];
  if (freq) parts.push(freq);
  if (ctx.reasoning) parts.push(ctx.reasoning);
  const head = target !== null ? `True price ${money(price)} is above your ${money(target)}. ` : "";
  return head + (parts.length ? capitalize(parts.join("; ")) + "." : "ZeroTide will watch for a better moment.");
}

function buildSavings({ tp, winner, target }) {
  // Deal value excludes shipping (shipping is a cost, not a saving).
  const itemTrue = round2(tp.truePrice - tp.shipping);
  const dealSavings = round2(tp.shelfPrice - itemTrue);
  const vsRegular =
    typeof winner.regularPrice === "number" ? round2(winner.regularPrice - tp.truePrice) : null;
  const vsTarget = typeof target === "number" ? round2(target - tp.truePrice) : null;
  return { dealSavings, vsRegular, vsTarget };
}

function dealBits(tp) {
  const bits = [];
  if (tp.discountVia === "coupon") bits.push(`${money(tp.appliedDiscount)} coupon`);
  else if (tp.discountVia === "subscription") bits.push(`${money(tp.appliedDiscount)} subscribe & save`);
  if (tp.cashbackRate > 0) bits.push(`${tp.cashbackRate}% cashback`);
  if (tp.shipping > 0) bits.push(`${money(tp.shipping)} shipping`);
  return bits.length ? "incl. " + bits.join(" + ") : "";
}

function dealHint(ctx) {
  if (ctx.dealFrequency === "weekly" || ctx.dealFrequency === "biweekly") return " — dips are frequent, a small wait may do it";
  return "";
}

function confRank(c) {
  return { high: 3, medium: 2, low: 1 }[c] || 0;
}
function money(n) {
  return "$" + Number(n).toFixed(2);
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { evaluate, computeTruePrice };
