// Date helpers. All dates handled as local calendar dates (no time zone shifts): 'YYYY-MM-DD' strings.

export function pad2(n) { return String(n).padStart(2, '0'); }

export function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

export function todayIso() { return toIsoDate(new Date()); }

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** TARGET2 closing days: weekends, 1 Jan, Good Friday, Easter Monday, 1 May, 25 Dec, 26 Dec. */
export function isTargetDay(dateOrIso) {
  const d = typeof dateOrIso === 'string' ? fromIsoDate(dateOrIso) : dateOrIso;
  if (!d) return false;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (['01-01', '05-01', '12-25', '12-26'].includes(md)) return false;
  const easter = easterSunday(d.getFullYear());
  const gf = new Date(easter); gf.setDate(easter.getDate() - 2);
  const em = new Date(easter); em.setDate(easter.getDate() + 1);
  if (toIsoDate(d) === toIsoDate(gf) || toIsoDate(d) === toIsoDate(em)) return false;
  return true;
}

export function targetDayReason(iso) {
  const d = fromIsoDate(iso);
  if (!d) return 'fecha no válida';
  const dow = d.getDay();
  if (dow === 0) return 'es domingo';
  if (dow === 6) return 'es sábado';
  const md = iso.slice(5);
  const names = { '01-01': 'es 1 de enero', '05-01': 'es 1 de mayo', '12-25': 'es Navidad', '12-26': 'es 26 de diciembre' };
  if (names[md]) return names[md] + ' (festivo TARGET2)';
  const easter = easterSunday(d.getFullYear());
  const gf = new Date(easter); gf.setDate(easter.getDate() - 2);
  if (toIsoDate(gf) === iso) return 'es Viernes Santo (festivo TARGET2)';
  return 'es Lunes de Pascua (festivo TARGET2)';
}

export function addDays(iso, n) {
  const d = fromIsoDate(iso); d.setDate(d.getDate() + n); return toIsoDate(d);
}

/** Next TARGET business day on or after iso. */
export function nextTargetDay(iso) {
  let cur = iso;
  for (let i = 0; i < 15 && !isTargetDay(cur); i++) cur = addDays(cur, 1);
  return cur;
}

/** Add n TARGET business days to iso (n >= 0). */
export function addTargetDays(iso, n) {
  let cur = iso, added = 0;
  while (added < n) { cur = addDays(cur, 1); if (isTargetDay(cur)) added++; }
  return cur;
}

/** Number of TARGET business days strictly between from (exclusive) and to (inclusive). */
export function targetDaysBetween(fromIso, toIso) {
  if (toIso <= fromIso) return 0;
  let cur = fromIso, n = 0;
  for (let i = 0; i < 400 && cur < toIso; i++) { cur = addDays(cur, 1); if (isTargetDay(cur)) n++; }
  return n;
}

/** Excel serial date (1900 system) -> ISO. */
export function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!isFinite(n) || n < 1 || n > 2958465) return '';
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Parse a date from spreadsheet input: Date objects, Excel serials, 'dd/mm/yyyy', 'dd-mm-yy',
 * 'yyyy-mm-dd', 'dd.mm.yyyy'. Day-first (Spanish convention). Returns ISO or ''.
 */
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS cellDates gives local-midnight dates; guard against UTC offsets producing 23:59 of the previous day
    const d = new Date(v.getTime() + 12 * 3600000);
    return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  if (typeof v === 'number') return excelSerialToIso(v);
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return valid(y, Number(m[2]), Number(m[1]));
  }
  return '';
}

function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

export function formatEs(iso) {
  const d = fromIsoDate(iso);
  if (!d) return iso || '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
export function monthNameEs(iso) {
  const d = fromIsoDate(iso); return d ? MONTHS[d.getMonth()] : '';
}
