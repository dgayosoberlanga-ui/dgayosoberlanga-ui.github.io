// Automatic column mapping for member/customer spreadsheets.
import { normHeader, parseAmountCents } from './parse.js';
import { normalizeIban } from './iban.js';

export const FIELDS = [
  { key: 'name', label: 'Titular / nombre del deudor', required: true },
  { key: 'firstName', label: 'Nombre (si los apellidos van aparte)' },
  { key: 'lastName', label: 'Apellidos (columna aparte)' },
  { key: 'iban', label: 'IBAN o cuenta (CCC)', required: true },
  { key: 'amount', label: 'Importe', required: true },
  { key: 'mandateId', label: 'Referencia del mandato' },
  { key: 'mandateDate', label: 'Fecha de firma del mandato' },
  { key: 'concept', label: 'Concepto' },
  { key: 'reference', label: 'Nº de socio / referencia' },
  { key: 'nif', label: 'NIF / DNI del deudor' },
  { key: 'seqType', label: 'Tipo de adeudo (FRST/RCUR/OOFF/FNAL)' },
  { key: 'bic', label: 'BIC' },
  { key: 'street', label: 'Dirección (calle y nº)' },
  { key: 'postcode', label: 'Código postal' },
  { key: 'town', label: 'Población' },
  { key: 'country', label: 'País (código ES, PT...)' },
];

// Patterns ordered from most to least specific. Each: [regex on normalised header, score]
const PATTERNS = {
  mandateId: [[/^(ref|referencia)( de)?( del)? mandato$/, 100], [/(referencia|ref|id|identificador|codigo).*mandato/, 95], [/^mandato( sepa)?$/, 90], [/^rum$|referencia unica/, 90], [/mandate (id|ref|reference)|^mandate$/, 90]],
  mandateDate: [[/fecha.*(firma|mandato)|(firma|mandato).*fecha/, 100], [/^fecha (de )?alta$|^alta$|fecha.*(alta|inscripcion)/, 80], [/mandate.*date|date.*signature|signature date/, 95]],
  seqType: [[/^(tipo )?(de )?secuencia|^seq ?tp$|^sequence|frst|rcur/, 100], [/^tipo (de )?(adeudo|recibo|cobro|secuencia)$/, 60]],
  bic: [[/^(bic|swift|bic swift|codigo bic|bic code)$/, 100], [/\bbic\b|\bswift\b/, 80]],
  iban: [[/^iban$/, 100], [/\biban\b/, 95], [/^(n |num |numero )?(de )?cuenta( bancaria| corriente)?$|^ccc$|^cuenta$/, 90], [/cuenta|account|ccc/, 70]],
  amount: [[/^(importe|cuota|cantidad|precio|total|amount|mensualidad|euros|eur)$/, 100], [/importe|cuota|cantidad|precio|amount|mensualidad|tarifa|a cobrar/, 80], [/total/, 50]],
  concept: [[/^(concepto|descripcion|concept|remittance|detalle)$/, 100], [/concepto|descripcion|motivo/, 80]],
  name: [[/^(titular|titular de la cuenta|titular cuenta|nombre del titular|deudor|nombre y apellidos|apellidos y nombre|nombre completo|razon social|pagador|debtor|debtor name|full name)$/, 100], [/titular|deudor|nombre y apellidos|apellidos y nombre|nombre completo|razon social|pagador/, 90], [/^(nombre|socio|alumno|cliente|name)$/, 70], [/nombre|socio|alumno|cliente/, 50]],
  firstName: [[/^nombre$|^first name$/, 60]],
  lastName: [[/^apellidos?$|^(primer )?apellido|^last name$|^surname$/, 100]],
  reference: [[/^(n|num|numero|codigo|cod|id) (de )?(socio|alumno|cliente|recibo|asociado|familia)$/, 100], [/\b(n|num|numero|codigo|cod|id) (de )?(socio|alumno|cliente|recibo|asociado|familia)\b/, 90], [/^(referencia|ref|codigo|cod|id)$/, 80]],
  nif: [[/^(nif|dni|nie|cif|nif dni|dni nif|documento)$/, 100], [/\b(nif|dni|nie|cif)\b/, 80]],
  street: [[/^(direccion|domicilio|calle|address|street)$/, 100], [/direccion|domicilio|calle/, 70]],
  postcode: [[/^(cp|c p|codigo postal|postal code|zip)$/, 100], [/postal|^cp\b/, 80]],
  town: [[/^(poblacion|localidad|municipio|ciudad|town|city)$/, 100], [/poblacion|localidad|municipio|ciudad/, 80]],
  country: [[/^(pais|country|cod pais|codigo pais)$/, 100]],
};

/**
 * Guess mapping {fieldKey: columnIndex} from headers and sample rows.
 * rows: array of arrays (data rows, without header)
 */
export function guessMapping(headers, rows = [], info = {}) {
  info.guessed = [];
  const norm = headers.map(normHeader);
  const candidates = [];
  for (const [field, pats] of Object.entries(PATTERNS)) {
    norm.forEach((h, col) => {
      if (!h) return;
      for (const [re, score] of pats) {
        if (re.test(h)) { candidates.push({ field, col, score }); break; }
      }
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const mapping = {}; const usedCols = new Set();
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col; usedCols.add(c.col);
  }
  // nombre + apellidos split: if we have lastName but 'name' is a plain "nombre" column, treat as firstName
  if (mapping.lastName !== undefined && mapping.name !== undefined && /^nombre$|^first name$/.test(norm[mapping.name])) {
    mapping.firstName = mapping.name; delete mapping.name;
  }
  if (mapping.firstName !== undefined && mapping.lastName === undefined && mapping.name === undefined) {
    mapping.name = mapping.firstName; delete mapping.firstName;
  }
  // Content-based detection for missing key fields
  const sample = rows.slice(0, 50);
  const colCount = Math.max(headers.length, ...sample.map(r => r.length), 0);
  const ratio = (col, pred) => {
    let n = 0, hit = 0;
    for (const r of sample) { const v = r[col]; if (v === undefined || v === null || String(v).trim() === '') continue; n++; if (pred(v)) hit++; }
    return n ? hit / n : 0;
  };
  if (mapping.iban === undefined) {
    for (let col = 0; col < colCount; col++) {
      if (usedCols.has(col)) continue;
      if (ratio(col, v => { const s = normalizeIban(v); return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) || /^\d{20}$/.test(s); }) >= 0.8) {
        mapping.iban = col; usedCols.add(col); info.guessed.push('iban'); break;
      }
    }
  }
  const notAmount = /^(n|num|numero|id|cod|codigo)\b|edad|\bano\b|year|\bcp\b|postal|telefono|movil|dni|nif|curso|grupo|nivel/;
  if (mapping.amount === undefined) {
    for (let col = 0; col < colCount; col++) {
      if (usedCols.has(col) || notAmount.test(norm[col] || '')) continue;
      if (ratio(col, v => { const c = parseAmountCents(v); return c !== null && c > 0 && c < 10000000 && !(typeof v === 'number' && v > 30000); }) >= 0.9) {
        mapping.amount = col; usedCols.add(col); info.guessed.push('amount'); break;
      }
    }
  }
  return mapping;
}

/** Find the header row: first row (within first 10) that has >= 2 recognisable headers. */
/** True if a row looks like data (contains an IBAN/CCC-like value), i.e. there is no header row. */
export function looksLikeDataRow(row) {
  return (row || []).some(v => { const s = normalizeIban(v); return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) || /^\d{20}$/.test(s); });
}

export function findHeaderRow(matrix) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const row = matrix[i] || [];
    let score = 0;
    for (const cell of row) {
      const h = normHeader(cell);
      if (!h) continue;
      for (const pats of Object.values(PATTERNS)) { if (pats.some(([re]) => re.test(h))) { score++; break; } }
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 2 ? best : 0;
}
