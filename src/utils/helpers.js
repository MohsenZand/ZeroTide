// Formatting + verdict helpers shared across the UI.

export function money(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toFixed(2);
}

export function formatAsOf(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Verdict presentation (label + which semantic color token).
export const VERDICT_META = {
  buy: { label: 'Buy now', tone: 'good', group: 'ready' },
  close: { label: 'Getting close', tone: 'warn', group: 'watching' },
  wait: { label: 'Wait', tone: 'wait', group: 'watching' },
  watch: { label: 'Watching', tone: 'watch', group: 'watching' },
  snoozed: { label: 'Snoozed', tone: 'watch', group: 'snoozed' },
  bought: { label: 'Bought', tone: 'watch', group: 'snoozed' },
};

export function verdictMeta(v) {
  return VERDICT_META[v] || VERDICT_META.watch;
}

// Turn currentBest.dealFrequency into a short chip label.
export function dipLabel(freq) {
  return {
    weekly: 'dips weekly',
    biweekly: 'dips biweekly',
    monthly: 'dips monthly',
    seasonal: 'dips seasonally',
    rarely: 'dips rarely',
  }[freq] || '';
}

// A reliable "go buy this" link. The AI's own source URL is often a stray
// grounding redirect, so we send the user to a Google search for the exact
// product (optionally scoped to a store) — always lands somewhere relevant.
export function shopUrl(query, store) {
  const q = [query, store].filter(Boolean).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

// ── Provenance ──────────────────────────────────────────────────────────────
// Where a stored price came from. The distinction that matters to the user is
// whether ZeroTide read the number off the seller's own page or is relaying a
// search result it hasn't confirmed yet.
const PROVENANCE_META = {
  'shopify-json': { label: "read from the store's own product data", verified: true },
  'json-ld': { label: 'read from the product page', verified: true },
  opengraph: { label: 'read from the product page', verified: true },
  microdata: { label: 'read from the product page', verified: true },
  'llm-page-read': { label: 'read from the product page', verified: true },
  'http-304': { label: 'page unchanged since the last check', verified: true },
  'grounded-search': { label: "from a web search — not confirmed on the store's page", verified: false },
};

export function provenanceMeta(provenance) {
  if (!provenance || !provenance.method) return null;
  const meta = PROVENANCE_META[provenance.method];
  if (!meta) return null;
  return { ...meta, verified: meta.verified && provenance.verified !== false, readAt: provenance.readAt || null };
}

// How the "usual range" band was arrived at — measured from our own checks, or
// still an estimate. Labelling this keeps the chart honest while history builds.
export function bandSourceLabel(source, observedDays) {
  if (source === 'observed') return `usual range · measured over ${observedDays} days`;
  if (source === 'partial') return `usual range · ${observedDays} days so far`;
  return 'usual range · estimated';
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (isNaN(then)) return '';
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function sumSavings(intentions) {
  return intentions.reduce((acc, it) => {
    const s = it.savings;
    if (s && typeof s.dealSavings === 'number') return acc + Math.max(0, s.dealSavings);
    return acc;
  }, 0);
}
