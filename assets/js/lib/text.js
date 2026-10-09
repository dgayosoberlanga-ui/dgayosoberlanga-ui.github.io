// Text helpers: SEPA (EPC) Latin character set conversion and XML escaping.
// Allowed by EPC / AEB guides: a-z A-Z 0-9 / - ? : ( ) . , ' + and space.

const SPECIAL = {
  'ñ': 'n', 'Ñ': 'N', 'ç': 'c', 'Ç': 'C', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O',
  'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'þ': 'th', 'Þ': 'TH',
  'º': 'o', 'ª': 'a', '€': 'EUR', '&': 'y', '@': ' ', '_': '-', '·': '.', '–': '-', '—': '-',
  '‘': "'", '’': "'", '´': "'", '`': "'", '“': '', '”': '', '"': '', '«': '', '»': '',
  '¿': '', '¡': '', '!': '.', ';': ',', '[': '(', ']': ')', '{': '(', '}': ')', '\\': '/',
  '#': 'n', '%': ' ', '*': ' ', '=': '-', '<': '(', '>': ')', '|': '/', '~': '-', '^': ' ', '$': ' ',
};

const ALLOWED = /[A-Za-z0-9\/\-?:().,'+ ]/;

/** Convert any string to the SEPA-safe character set. Never throws. */
export function toSepaText(input) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  // Map specials first (before NFD strips things like ñ -> n + combining tilde, which is fine too)
  let out = '';
  for (const ch of s) {
    if (SPECIAL[ch] !== undefined) { out += SPECIAL[ch]; continue; }
    out += ch;
  }
  // Strip diacritics
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let res = '';
  for (const ch of out) {
    if (ALLOWED.test(ch)) res += ch;
    else if (/\s/.test(ch)) res += ' ';
    else res += ' ';
  }
  return res.replace(/\s+/g, ' ').trim();
}

/** SEPA text truncated to max length (after conversion). */
export function sepaText(input, max) {
  const s = toSepaText(input);
  return max ? s.slice(0, max).trim() : s;
}

/**
 * SEPA identifier (MsgId, PmtInfId, EndToEndId, MndtId): no spaces, may not start/end with '/',
 * no '//' anywhere. Max 35.
 */
export function sepaId(input, max = 35) {
  let s = toSepaText(input).replace(/ /g, '-');
  s = s.replace(/\/{2,}/g, '/');
  s = s.slice(0, max);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  s = s.replace(/^-+/, '').replace(/-+$/, '');
  return s;
}

/** True if string already conforms to SEPA identifier rules. */
export function isValidSepaId(s, max = 35) {
  if (!s || s.length > max) return false;
  if (!/^[A-Za-z0-9\/\-?:().,'+]+$/.test(s)) return false;
  if (s.startsWith('/') || s.endsWith('/') || s.includes('//')) return false;
  return true;
}

export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Compact a person's name possibly given as separate columns. */
export function joinName(...parts) {
  return parts.filter(p => p !== undefined && p !== null && String(p).trim() !== '')
    .map(p => String(p).trim()).join(' ');
}
