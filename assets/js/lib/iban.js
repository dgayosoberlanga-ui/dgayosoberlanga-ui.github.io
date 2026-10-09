// IBAN utilities: normalisation, ISO 13616 mod-97 validation, Spanish CCC control digits,
// CCC -> IBAN conversion and Spanish BIC lookup.
import { ES_BANKS } from './es-banks.js';

export const IBAN_LENGTHS = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22, AL: 28, MD: 24, ME: 22, MK: 19, RS: 22,
};

export const EEA = new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE',
  'IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK','IS','LI','NO']);

export const COUNTRY_NAMES = { ES: 'España', PT: 'Portugal', FR: 'Francia', DE: 'Alemania', IT: 'Italia',
  GB: 'Reino Unido', AD: 'Andorra', CH: 'Suiza', NL: 'Países Bajos', BE: 'Bélgica', IE: 'Irlanda', LU: 'Luxemburgo' };

export function normalizeIban(input) {
  if (input === null || input === undefined) return '';
  return String(input).toUpperCase().replace(/^IBAN/, '').replace(/[^A-Z0-9]/g, '');
}

export function formatIban(iban) {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** Numeric string mod 97 for arbitrary length strings. */
export function mod97(numeric) {
  let rem = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rem = Number(String(rem) + numeric.slice(i, i + 7)) % 97;
  }
  return rem;
}

/** Convert letters to numbers (A=10 ... Z=35). */
export function lettersToDigits(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out += String(c - 55);
    else if (c >= 48 && c <= 57) out += ch;
  }
  return out;
}

export function ibanChecksumOk(iban) {
  const s = normalizeIban(iban);
  if (s.length < 5) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  return mod97(lettersToDigits(rearranged)) === 1;
}

/** Spanish CCC control digits (DC) check. ccc = 20 digits: entidad(4) oficina(4) DC(2) cuenta(10). */
export function cccControlDigits(entity, office, account) {
  const w = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const calc = (digits) => {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(digits[i]) * w[i];
    let r = 11 - (sum % 11);
    if (r === 11) r = 0; else if (r === 10) r = 1;
    return String(r);
  };
  return calc('00' + entity + office) + calc(account);
}

export function cccIsValid(ccc) {
  const s = String(ccc).replace(/\D/g, '');
  if (s.length !== 20) return false;
  return cccControlDigits(s.slice(0, 4), s.slice(4, 8), s.slice(10)) === s.slice(8, 10);
}

/** Build an IBAN from country + BBAN. */
export function ibanFromBban(country, bban) {
  const check = 98 - mod97(lettersToDigits(bban + country + '00'));
  return country + String(check).padStart(2, '0') + bban;
}

/** Accepts a 20-digit Spanish CCC (with or without separators) and returns ES IBAN, or ''. */
export function ibanFromCcc(ccc) {
  const s = String(ccc).replace(/\D/g, '');
  if (s.length !== 20) return '';
  return ibanFromBban('ES', s);
}

/**
 * Full validation. Returns { ok, iban, country, errors:[], warnings:[], fixedFromCcc }
 * Accepts IBAN or 20-digit Spanish CCC.
 */
export function checkIban(input) {
  const res = { ok: false, iban: '', country: '', errors: [], warnings: [], fixedFromCcc: false };
  let s = normalizeIban(input);
  if (!s) { res.errors.push('Falta el IBAN'); return res; }
  if (/^\d{20}$/.test(s)) {
    s = ibanFromCcc(s);
    res.fixedFromCcc = true;
    res.warnings.push('Cuenta en formato CCC (20 dígitos) convertida a IBAN');
  }
  res.iban = s;
  const country = s.slice(0, 2);
  res.country = country;
  if (!/^[A-Z]{2}\d{2}/.test(s)) { res.errors.push('El IBAN debe empezar por el código de país y 2 dígitos de control (p. ej. ES91)'); return res; }
  const len = IBAN_LENGTHS[country];
  if (!len) { res.errors.push(`País ${country} no pertenece a la zona SEPA`); return res; }
  if (s.length !== len) { res.errors.push(`Longitud incorrecta: un IBAN de ${country} tiene ${len} caracteres y este tiene ${s.length}`); return res; }
  if (!ibanChecksumOk(s)) { res.errors.push('Dígitos de control del IBAN incorrectos (probable error al copiar algún número)'); return res; }
  if (country === 'ES' && !cccIsValid(s.slice(4))) {
    res.errors.push('Los dígitos de control internos de la cuenta española (DC) no cuadran');
    return res;
  }
  if (!EEA.has(country)) res.warnings.push(`Cuenta fuera del EEE (${country}): el banco puede exigir BIC y dirección del deudor`);
  res.ok = true;
  return res;
}

export function isValidIban(input) { return checkIban(input).ok; }

/** Spanish bank info from IBAN: { code, bic, name } or null. */
export function spanishBankFromIban(iban) {
  const s = normalizeIban(iban);
  if (!s.startsWith('ES') || s.length < 8) return null;
  const code = s.slice(4, 8);
  const hit = ES_BANKS[code];
  if (!hit) return { code, bic: '', name: '' };
  return { code, bic: hit[0], name: hit[1] };
}

/** BIC (8 or 11) normalised; '' if unknown. */
export function bicForIban(iban) {
  const info = spanishBankFromIban(iban);
  return info && info.bic ? normalizeBic(info.bic) : '';
}

export function normalizeBic(bic) {
  return String(bic || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidBic(bic) {
  const s = normalizeBic(bic);
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s);
}
