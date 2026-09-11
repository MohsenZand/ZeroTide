/**
 * Price context derived from what ZeroTide actually observed.
 *
 * `typicalLow`, `typicalHigh`, `fairPrice` and `dealFrequency` used to be the
 * model's opinion — it was asked to estimate an item's price cycle from general
 * knowledge, and the answer went straight onto the tide chart and into the
 * buy/wait verdict. That is the one place where a plausible-sounding guess did
 * real damage: it set the dashed band the whole UI is read against.
 *
 * We already write a priceHistory snapshot on every check, so once there are
 * enough observations the honest answer is simply to measure. Until then we
 * fall back to the model's estimate, clearly labelled as such.
 */

// Below this many distinct observed days, our own percentiles are noisier than
// a sensible estimate; above it, measurement wins outright.
const MIN_DAYS_FOR_OBSERVED = 8;
const MIN_DAYS_FOR_BOUNDS = 3;

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Best (lowest) true price observed on each calendar day, oldest first. */
function dailyBest(history) {
  const byDay = new Map();
  for (const h of history || []) {
    const price = typeof h.truePrice === "number" ? h.truePrice : h.price;
    if (typeof price !== "number" || !isFinite(price) || price <= 0) continue;
    const d = toDate(h.checkedAt);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    const prev = byDay.get(key);
    if (prev === undefined || price < prev) byDay.set(key, price);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, price]) => ({ day, price }));
}

/**
 * What this item costs *at a trough* — the number the tide chart's target line
 * is read against, and the one "near its historical low" fires on.
 *
 * A time-based percentile is the wrong statistic here. An item that sits at
 * $44.99 for 27 days and drops to $29.99 for 3 has a 10th percentile of ~$43 —
 * above every dip it ever had, which would hide exactly the moments ZeroTide
 * exists to catch. So: take the median of the days that actually dipped.
 */
function typicalDipPrice(sortedPrices, median) {
  if (!median) return round2(sortedPrices[0]);
  const dips = sortedPrices.filter((p) => p <= median * 0.95);
  if (dips.length) return round2(percentile(dips, 0.5));
  // Never goes on sale — the low end is just the bottom of its normal noise.
  return round2(percentile(sortedPrices, 0.1));
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * How often this item actually dips. A "dip episode" is a run of consecutive
 * observed days at least 5% below the median; the cadence is the mean gap
 * between the starts of those episodes.
 */
function measureDealFrequency(series, median) {
  if (series.length < MIN_DAYS_FOR_OBSERVED || !median) return "unknown";
  const threshold = median * 0.95;

  const starts = [];
  let inDip = false;
  for (const point of series) {
    const low = point.price <= threshold;
    if (low && !inDip) starts.push(new Date(point.day).getTime());
    inDip = low;
  }
  if (starts.length < 2) {
    const spanDays = (new Date(series[series.length - 1].day) - new Date(series[0].day)) / 86400000;
    if (starts.length === 1 && spanDays <= 45) return "monthly";
    return spanDays >= 60 ? "rarely" : "unknown";
  }

  let total = 0;
  for (let i = 1; i < starts.length; i += 1) total += starts[i] - starts[i - 1];
  const avgGapDays = total / (starts.length - 1) / 86400000;

  if (avgGapDays <= 10) return "weekly";
  if (avgGapDays <= 20) return "biweekly";
  if (avgGapDays <= 45) return "monthly";
  if (avgGapDays <= 120) return "seasonal";
  return "rarely";
}

function assess(current, low, high) {
  if (typeof current !== "number" || low === null || high === null) return "unknown";
  if (high - low < 0.01) return "fair";
  const pos = (current - low) / (high - low);
  if (pos <= 0.25) return "cheap";
  if (pos >= 0.75) return "expensive";
  return "fair";
}

/**
 * Merge measured context over the model's estimate.
 *
 * `source` is carried through to the UI so the tide chart can say whether its
 * band is measured or estimated — the user should never have to guess which
 * numbers are real.
 */
function derivePriceContext({ history, aiContext, currentPrice }) {
  const ai = aiContext || {};
  const series = dailyBest(history);
  const prices = series.map((s) => s.price).sort((a, b) => a - b);
  const days = series.length;

  const estimated = {
    typicalLow: numOrNull(ai.typicalLow),
    typicalHigh: numOrNull(ai.typicalHigh),
    fairPrice: numOrNull(ai.fairPrice),
    dealFrequency: ai.dealFrequency || "unknown",
    assessment: ai.assessment || "unknown",
    reasoning: ai.reasoning || null,
    source: "estimated",
    observedDays: days,
  };

  if (days < MIN_DAYS_FOR_BOUNDS) return estimated;

  const median = round2(percentile(prices, 0.5));
  const observedHigh = round2(percentile(prices, 0.9));
  const observedLow = typicalDipPrice(prices, median);
  const trueMin = round2(prices[0]);

  // Partial data: trust our own observed range (it is real) but keep the
  // model's cadence guess, which needs a longer baseline to measure.
  if (days < MIN_DAYS_FOR_OBSERVED) {
    return {
      typicalLow: observedLow,
      typicalHigh: observedHigh,
      fairPrice: median,
      dealFrequency: estimated.dealFrequency,
      assessment: assess(currentPrice, observedLow, observedHigh),
      reasoning:
        `Range measured from ${days} day${days === 1 ? "" : "s"} of ZeroTide's own checks ` +
        `(low ${money(trueMin)}); dip cadence still estimated.`,
      source: "partial",
      observedDays: days,
    };
  }

  const dealFrequency = measureDealFrequency(series, median);
  return {
    typicalLow: observedLow,
    typicalHigh: observedHigh,
    fairPrice: median,
    dealFrequency,
    assessment: assess(currentPrice, observedLow, observedHigh),
    reasoning:
      `Measured from ${days} days of ZeroTide's own price checks: usually ` +
      `${money(observedLow)}–${money(observedHigh)}, lowest seen ${money(trueMin)}` +
      (dealFrequency !== "unknown" ? `, dips ${cadenceWord(dealFrequency)}.` : "."),
    source: "observed",
    observedDays: days,
  };
}

function cadenceWord(f) {
  return (
    {
      weekly: "roughly weekly",
      biweekly: "every couple of weeks",
      monthly: "about monthly",
      seasonal: "seasonally",
      rarely: "only rarely",
    }[f] || "occasionally"
  );
}

function numOrNull(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function money(n) {
  return "$" + Number(n).toFixed(2);
}

module.exports = { derivePriceContext, dailyBest };
