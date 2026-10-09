// Spanish tax IDs (NIF/DNI, NIE, CIF) and SEPA Creditor Identifier (AT-02 / "identificador de acreedor").
import { mod97, lettersToDigits } from './iban.js';

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function normalizeNif(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Validate a Spanish NIF (DNI, NIE or CIF / NIF de entidad).
 * Returns { ok, type, nif, error }
 */
export function checkNif(input) {
  const nif = normalizeNif(input);
  if (!nif) return { ok: false, type: '', nif, error: 'Falta el NIF' };
  // DNI: 8 digits + letter
  if (/^\d{8}[A-Z]$/.test(nif)) {
    const ok = DNI_LETTERS[Number(nif.slice(0, 8)) % 23] === nif[8];
    return { ok, type: 'DNI', nif, error: ok ? '' : 'La letra del DNI no corresponde al número' };
  }
  // NIE: X/Y/Z + 7 digits + letter
  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) {
    const num = String('XYZ'.indexOf(nif[0])) + nif.slice(1, 8);
    const ok = DNI_LETTERS[Number(num) % 23] === nif[8];
    return { ok, type: 'NIE', nif, error: ok ? '' : 'La letra del NIE no corresponde al número' };
  }
  // NIF especial personas físicas K, L, M + 7 digits + letter
  if (/^[KLM]\d{7}[A-Z]$/.test(nif)) {
    const ok = DNI_LETTERS[Number(nif.slice(1, 8)) % 23] === nif[8];
    return { ok, type: 'NIF especial', nif, error: ok ? '' : 'La letra de control no corresponde' };
  }
  // CIF / NIF de entidad: letter + 7 digits + control (digit or letter)
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) {
    const digits = nif.slice(1, 8);
    let sumEven = 0, sumOdd = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 1) sumEven += d;
      else { const x = d * 2; sumOdd += Math.floor(x / 10) + (x % 10); }
    }
    const control = (10 - ((sumEven + sumOdd) % 10)) % 10;
    const letter = 'JABCDEFGHI'[control];
    const first = nif[0];
    const last = nif[8];
    let ok;
    if ('PQRSNW'.includes(first)) ok = last === letter;
    else if ('ABEH'.includes(first)) ok = last === String(control);
    else ok = last === String(control) || last === letter;
    const types = { A: 'Sociedad anónima', B: 'Sociedad limitada', C: 'Sociedad colectiva', D: 'Sociedad comanditaria',
      E: 'Comunidad de bienes', F: 'Cooperativa', G: 'Asociación o fundación', H: 'Comunidad de propietarios',
      J: 'Sociedad civil', N: 'Entidad extranjera', P: 'Corporación local', Q: 'Organismo público',
      R: 'Congregación religiosa', S: 'Órgano de la Administración', U: 'UTE', V: 'Otro tipo', W: 'Establecimiento permanente' };
    return { ok, type: types[first] || 'Entidad', nif, error: ok ? '' : 'El dígito o letra de control del NIF no es correcto' };
  }
  return { ok: false, type: '', nif, error: 'Formato de NIF no reconocido' };
}

/**
 * SEPA Creditor Identifier (EPC262-08):
 *  CC + check digits (2) + creditor business code / suffix (3) + national identifier.
 *  Check digits = 98 - mod97(national id + CC + "00") with letters converted, business code excluded.
 */
export function computeCreditorId(nationalId, suffix = '000', country = 'ES') {
  const nid = normalizeNif(nationalId);
  let suf = String(suffix ?? '000').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (country === 'ES') suf = suf.padStart(3, '0').slice(0, 3);
  else if (!suf) suf = 'ZZZ';
  const check = 98 - mod97(lettersToDigits(nid + country + '00'));
  return country + String(check).padStart(2, '0') + suf + nid;
}

export function normalizeCreditorId(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Validate a creditor identifier. Returns { ok, id, country, suffix, nationalId, error } */
export function checkCreditorId(input) {
  const id = normalizeCreditorId(input);
  const r = { ok: false, id, country: '', suffix: '', nationalId: '', error: '', warning: '' };
  if (!id) { r.error = 'Falta el identificador de acreedor'; return r; }
  if (id.length > 35 || id.length < 8 || !/^[A-Z]{2}\d{2}[A-Z0-9]{3}[A-Z0-9]+$/.test(id)) {
    r.error = 'Formato no válido: debe ser como ES12000G12345678 (país, 2 dígitos de control, sufijo de 3 y NIF)';
    return r;
  }
  r.country = id.slice(0, 2);
  r.suffix = id.slice(4, 7);
  r.nationalId = id.slice(7);
  const expected = computeCreditorId(r.nationalId, r.suffix, r.country);
  if (expected !== id) {
    r.error = `Dígitos de control incorrectos (deberían ser ${expected.slice(2, 4)}: ${expected})`;
    return r;
  }
  if (r.country === 'ES') {
    const nifRes = checkNif(r.nationalId);
    if (!nifRes.ok) r.warning = 'los dígitos de control cuadran, pero el NIF que contiene parece incorrecto (' + nifRes.error + '). Compruébalo con tu banco.';
  }
  r.ok = true;
  return r;
}
