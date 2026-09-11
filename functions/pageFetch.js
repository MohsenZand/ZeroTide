/**
 * Free, deterministic page reading — the cheap half of ZeroTide's price lookup.
 *
 * Nothing in this file costs money: no Gemini call, no Search grounding. It
 * fetches a product page the user is already tracking and tries to pull the
 * price straight out of the bytes the retailer served.
 *
 * Why this exists: Google Search grounding is billed per search query the model
 * issues, and re-searching the whole web every morning for an item whose page we
 * already know is pure waste. Once a product URL is known, "what does it cost
 * today" is an HTTP GET, not a research task.
 *
 * Fetch etiquette: we only ever fetch URLs the user is explicitly tracking (one
 * page per store per item per day, at most), we identify ourselves in the
 * User-Agent, we cap response size, and we send conditional requests so an
 * unchanged page costs the retailer a 304 and us nothing.
 */

const logger = require("firebase-functions/logger");

// Identifiable, but browser-shaped: several large retailers serve a JS shell or
// a 403 to obviously-automated agents, and a shell has no price in it.
// Set ZEROTIDE_CONTACT_URL to advertise a contact page for your deployment.
const CONTACT = process.env.ZEROTIDE_CONTACT_URL ? ` (+${process.env.ZEROTIDE_CONTACT_URL})` : "";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Chrome/124.0.0.0 Safari/537.36 ZeroTide/1.0${CONTACT}`;

const FETCH_TIMEOUT_MS = 20000;
const MAX_BYTES = 6 * 1024 * 1024; // Amazon PDPs run ~3MB; anything bigger is not a product page.

/**
 * GET a page politely. Supports conditional requests: pass the etag/lastModified
 * stored from the previous check and a 304 comes back as { notModified: true },
 * which means "price unchanged" for free.
 */
async function fetchPage(url, { etag, lastModified, accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers });

    if (res.status === 304) {
      return { ok: true, status: 304, notModified: true, finalUrl: res.url || url, body: "" };
    }

    const body = (await res.text()).slice(0, MAX_BYTES);
    return {
      ok: res.ok,
      status: res.status,
      notModified: false,
      finalUrl: res.url || url,
      body,
      etag: res.headers.get("etag") || null,
      lastModified: res.headers.get("last-modified") || null,
      contentType: res.headers.get("content-type") || "",
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, finalUrl: url, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

// ── Tier 0: structured data the retailer publishes ──────────────────────────

function num(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.]/g, ""));
    return isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Shopify exposes every product as JSON at <product-url>.js — exact price (in
 * cents), variant titles, availability and SKU/GTIN. Zero ambiguity, so when a
 * store runs Shopify this is the best possible source: a price read this way
 * cannot be hallucinated or size-mismatched.
 */
async function shopifyProduct(url) {
  let base;
  try {
    const u = new URL(url);
    if (!/\/products\/[^/]+/.test(u.pathname)) return null;
    u.search = "";
    u.hash = "";
    base = u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }

  const res = await fetchPage(`${base}.js`, { accept: "application/json" });
  if (!res.ok || res.status !== 200) return null;

  let j;
  try {
    j = JSON.parse(res.body);
  } catch {
    return null; // some non-Shopify sites serve HTML for .js
  }
  if (!j || typeof j.price !== "number" || !j.title) return null;

  return {
    price: j.price / 100,
    currency: null,
    available: j.available !== false,
    title: j.title,
    sku: (j.variants || []).map((v) => v.sku).find(Boolean) || null,
    variants: (j.variants || []).map((v) => ({
      title: v.title,
      price: typeof v.price === "number" ? v.price / 100 : null,
      available: v.available !== false,
      sku: v.sku || null,
    })),
    method: "shopify-json",
    evidenceUrl: `${base}.js`,
    snippet: JSON.stringify({ title: j.title, price: j.price, available: j.available }).slice(0, 400),
  };
}

/** schema.org Product/Offer in <script type="application/ld+json">. */
function jsonLdOffer(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const types = [].concat(node["@type"] || []);
      if (types.includes("Offer") || types.includes("AggregateOffer")) {
        const price = num(node.price ?? node.lowPrice);
        if (price !== null) {
          found.push({
            price,
            currency: node.priceCurrency || null,
            available: node.availability ? !/OutOfStock|SoldOut/i.test(node.availability) : true,
            raw: node,
          });
        }
      }
      Object.values(node).forEach(walk);
    };
    walk(data);
    if (found.length) {
      const best = found.sort((a, b) => a.price - b.price)[0];
      return {
        price: best.price,
        currency: best.currency,
        available: best.available,
        title: null,
        sku: null,
        method: "json-ld",
        snippet: JSON.stringify(best.raw).slice(0, 400),
      };
    }
  }
  return null;
}

/** OpenGraph product tags (`product:price:amount`). */
function ogPrice(html) {
  const amount =
    html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)/i) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i);
  if (!amount) return null;
  const price = num(amount[1]);
  if (price === null) return null;
  const cur = html.match(/property=["']product:price:currency["'][^>]*content=["']([^"']+)/i);
  return {
    price,
    currency: cur ? cur[1] : null,
    available: !/product:availability["'][^>]*content=["']\s*(oos|out ?of ?stock)/i.test(html),
    title: null,
    sku: null,
    method: "opengraph",
    snippet: amount[0].slice(0, 200),
  };
}

/** schema.org microdata (`itemprop="price"`). */
function microdataPrice(html) {
  const m =
    html.match(/itemprop=["']price["'][^>]*content=["']([\d.,]+)["']/i) ||
    html.match(/content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i);
  if (!m) return null;
  const price = num(m[1]);
  if (price === null) return null;
  return { price, currency: null, available: true, title: null, sku: null, method: "microdata", snippet: m[0].slice(0, 200) };
}

/**
 * Try every free structured source, cheapest/most-reliable first.
 * Returns null when the page publishes nothing machine-readable — that's the
 * signal to fall back to Tier 1 (a cheap model reading the condensed page).
 */
async function extractStructuredPrice(url, html) {
  try {
    const shop = await shopifyProduct(url);
    if (shop) return shop;
  } catch (err) {
    logger.debug("shopify probe failed", { url, error: err.message });
  }
  return jsonLdOffer(html) || ogPrice(html) || microdataPrice(html) || null;
}

// ── Tier 1 input: condense the page to just its price-bearing parts ─────────

const CONDENSE_WINDOW = 140; // chars of context kept either side of a price hit
const CONDENSE_MAX_HITS = 120;
const CONDENSE_MAX_CHARS = 24000; // ~6k tokens worst case

/**
 * Strip a product page down to only the fragments that mention money. A 3MB
 * Amazon page condenses to ~10KB (~2.5k tokens), which is what makes the
 * no-grounding extraction path effectively free.
 *
 * Keeping surrounding context matters: it's what distinguishes the one-time
 * price from the Subscribe & Save price, and the requested size from another.
 */
function condensePage(html) {
  const cleaned = html
    .replace(/<script[^>]+src=[^>]*>\s*<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<(noscript|iframe|footer|nav)[\s\S]*?<\/\1>/gi, "");

  const priceHit =
    new RegExp(
      `(.{0,${CONDENSE_WINDOW}})` +
        `(?:[$£€]\\s?\\d{1,5}(?:,\\d{3})*\\.\\d{2}` +
        `|"(?:price|priceAmount|currentPrice|current_price|listPrice|list_price|salePrice|sale_price|displayValue|amount)"\\s*:\\s*"?\\d)` +
        `(.{0,${CONDENSE_WINDOW}})`,
      "gis"
    );

  const seen = new Set();
  let m;
  while ((m = priceHit.exec(cleaned)) && seen.size < CONDENSE_MAX_HITS) {
    const frag = m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (frag.length > 12) seen.add(frag);
  }

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const head = title ? `PAGE TITLE: ${title.replace(/\s+/g, " ").trim()}\n\n` : "";
  return (head + [...seen].join("\n---\n")).slice(0, CONDENSE_MAX_CHARS);
}

/**
 * Does this number actually appear in what the page served? The anti-
 * hallucination backstop: a price we cannot point at in the bytes is not a
 * price, it's a guess, and we'd rather report nothing than a plausible number.
 */
function priceAppearsInText(price, text) {
  if (typeof price !== "number" || !isFinite(price) || price < 0 || !text) return false;
  const haystack = text.replace(/,/g, "");

  // Must be a standalone number, not a fragment of a longer one: a page listing
  // $1999.99 must NOT validate a claim of $999.99, and $27.99 must not validate
  // $7.99. Plain substring matching gets this wrong and quietly defeats the gate.
  const decimal = price.toFixed(2).replace(".", "\\.");
  if (new RegExp(`(?<![\\d.])${decimal}(?![\\d])`).test(haystack)) return true;

  // Whole-dollar prices are often printed without cents ("$30").
  if (Number.isInteger(price) && new RegExp(`(?<![\\d.])${price}(?![\\d.])`).test(haystack)) return true;

  // Some stores serialize cents as an integer ("price":1077 = $10.77). Accept that
  // only directly behind a price-shaped key — a bare digit run anywhere on the page
  // is an ID as often as it is a price.
  const cents = String(Math.round(price * 100));
  const centsKey = new RegExp(
    `"(?:price|amount|value|sale_?price|list_?price|current_?price|priceAmount)"\\s*:\\s*"?${cents}(?![\\d])`,
    "i"
  );
  return centsKey.test(haystack);
}

module.exports = {
  fetchPage,
  shopifyProduct,
  extractStructuredPrice,
  condensePage,
  priceAppearsInText,
  USER_AGENT,
};
