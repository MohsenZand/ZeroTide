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

export function sumSavings(intentions) {
  return intentions.reduce((acc, it) => {
    const s = it.savings;
    if (s && typeof s.dealSavings === 'number') return acc + Math.max(0, s.dealSavings);
    return acc;
  }, 0);
}
