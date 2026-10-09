// Parsing helpers for spreadsheet values.

/**
 * Parse an amount into integer cents. Accepts numbers and strings in Spanish or English formats:
 * "50", "50,5", "1.234,56", "1,234.56", "50 €", "EUR 12.30". Returns null if not parseable.
 */
export function parseAmountCents(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    return Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9));
  }
  let s = String(v).trim().replace(/(euros?|eur|€)/gi, '').replace(/[\s\u00a0']/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let intPart, decPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    const [a, b] = s.split(decSep);
    if (s.split(decSep).length !== 2) return null;
    intPart = a.split(thouSep).join(''); decPart = b;
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    if (parts.length === 2) { intPart = parts[0]; decPart = parts[1]; }
    else if (parts.slice(1).every(p => p.length === 3)) intPart = parts.join('');
    else return null;
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')) {
      // Spanish thousands separator: 1.234 / 1.234.567
      if (!parts.slice(1).every(p => p.length === 3)) return null;
      intPart = parts.join('');
    } else { intPart = parts[0]; decPart = parts[1] || ''; }
  } else intPart = s;
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || (decPart && !/^\d+$/.test(decPart))) return null;
  // round half up on the third decimal
  let cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  if (decPart.length > 2 && Number(decPart[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

/** True when a textual amount has more than 2 decimal digits (it will be rounded). */
export function amountExtraDecimals(v) {
  if (typeof v === 'number') return Math.abs(Math.round(v * 100) - v * 100) > 1e-6;
  const s = String(v ?? '').trim().replace(/(euros?|eur|€)/gi, '').replace(/[\s\u00a0']/g, '');
  const m = /[.,](\d+)$/.exec(s);
  if (!m) return false;
  // "1.234" (Spanish thousands) is not a decimal
  if (m[1].length === 3 && /^\d{1,3}([.]\d{3})+$/.test(s)) return false;
  return m[1].length > 2;
}

export function centsToStr(c) {
  const neg = c < 0; const a = Math.abs(c);
  return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
}

export function centsToEs(c) {
  const neg = c < 0; const a = Math.abs(c);
  const int = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + int + ',' + String(a % 100).padStart(2, '0') + ' €';
}

/** Normalise header text for matching. */
export function normHeader(h) {
  return String(h ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[º°ª]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normSeqType(v) {
  const s = String(v ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z]/g, '');
  if (!s) return '';
  if (['FRST', 'FIRST', 'PRIMERO', 'PRIMER'].includes(s)) return 'FRST';
  if (['RCUR', 'RECURRENTE', 'RECUR', 'RECURRING'].includes(s)) return 'RCUR';
  if (['OOFF', 'UNICO', 'PUNTUAL', 'ONEOFF'].includes(s)) return 'OOFF';
  if (['FNAL', 'FINAL', 'ULTIMO'].includes(s)) return 'FNAL';
  return 'INVALID';
}
