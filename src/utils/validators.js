export function isValidZip(zip) {
  return /^\d{5}$/.test(String(zip || '').trim());
}

export function isNonEmptyName(name) {
  return String(name || '').trim().length >= 2;
}

export function parsePrice(raw) {
  const n = parseFloat(String(raw || '').replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
