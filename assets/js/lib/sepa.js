// SEPA Direct Debit (pain.008) generation: row normalisation, validation and XML output.
import { sepaText, sepaId, isValidSepaId, xmlEscape, joinName } from './text.js';
import { checkIban, bicForIban, normalizeBic, isValidBic, EEA } from './iban.js';
import { checkCreditorId } from './ids.js';
import { parseDate, isTargetDay, targetDayReason, todayIso, targetDaysBetween } from './dates.js';
import { parseAmountCents, centsToStr, normSeqType, amountExtraDecimals } from './parse.js';
import { countryCode } from './countries.js';

export const VERSIONS = {
  '02': { ns: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02', bicTag: 'BIC', label: 'pain.008.001.02 (ISO 2009)' },
  '08': { ns: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08', bicTag: 'BICFI', label: 'pain.008.001.08 (ISO 2019)' },
};

export const MAX_AMOUNT_CENTS = 99999999999; // 999,999,999.99

/**
 * Validate creditor settings. Returns { errors:[], warnings:[], creditor } with normalised values.
 */
export function checkCreditor(c) {
  const errors = [], warnings = [];
  const name = sepaText(c.name, 70);
  if (!name) errors.push('Falta el nombre del acreedor (tu entidad)');
  const cid = checkCreditorId(c.creditorId);
  if (!cid.ok) errors.push('Identificador de acreedor: ' + cid.error);
  if (cid.warning) warnings.push('Identificador de acreedor: ' + cid.warning);
  const ib = checkIban(c.iban);
  if (!ib.ok) errors.push('IBAN de cobro: ' + (ib.errors[0] || 'no válido'));
  let bic = normalizeBic(c.bic);
  if (!bic && ib.ok) bic = bicForIban(ib.iban);
  if (bic && !isValidBic(bic)) { errors.push('BIC del acreedor no válido'); }
  if (!bic && ib.ok) warnings.push('No conocemos el BIC de tu banco: se indicará NOTPROVIDED. Si tu banco lo exige, escríbelo.');
  const addr = normAddress(c.address);
  return {
    errors, warnings,
    creditor: { name, creditorId: cid.id, iban: ib.iban, bic, address: addr },
  };
}

function normAddress(a) {
  if (!a) return null;
  const street = sepaText(a.street, 70), building = sepaText(a.building, 16), postcode = sepaText(a.postcode, 16);
  const town = sepaText(a.town, 35);
  const country = countryCode(a.country);
  if (!street && !postcode && !town) return null;
  return { street, building, postcode, town, country, countryRaw: String(a.country ?? '').trim() };
}

/**
 * Turn mapped spreadsheet rows into validated transactions.
 * rows: array of arrays; mapping: {field: colIndex}; opts: defaults
 *  opts = { defaultAmount, defaultConcept, defaultMandateDate, defaultSeqType, collectionDate, includeDebtorBic, includeAddresses, scheme }
 * Returns { items: [{ rowIndex, tx, errors[], warnings[] }], stats }
 */
export function buildTransactions(rows, mapping, opts = {}) {
  const get = (r, key) => (mapping[key] === undefined || mapping[key] === null || mapping[key] === '' ? undefined : r[mapping[key]]);
  const items = [];
  const seenMandates = new Map();
  const seenE2E = new Set();
  const e2eCounter = new Map();
  const collectionDate = opts.collectionDate;
  rows.forEach((r, rowIndex) => {
    // skip fully empty rows
    if (!r || r.every(v => v === null || v === undefined || String(v).trim() === '')) return;
    const errors = [], warnings = [];
    // A full-name / account-holder column always wins; first name + surname columns are only joined when there is none.
    const rawName = mapping.name !== undefined ? get(r, 'name') : undefined;
    let name = rawName !== undefined && rawName !== null && String(rawName).trim() !== '' ? String(rawName) : (mapping.name === undefined ? joinName(get(r, 'firstName'), get(r, 'lastName')) : '');
    name = sepaText(name, 70);
    if (!name) errors.push({ field: 'name', msg: 'Falta el nombre del titular' });

    const rawIban = get(r, 'iban');
    const ib = checkIban(rawIban);
    if (typeof rawIban === 'number' || /^\d(\.\d+)?e\+?\d+$/i.test(String(rawIban ?? '').trim().replace(',', '.'))) {
      // Excel keeps only 15 significant digits: a 20-digit account stored as a number has lost digits.
      ib.ok = false; ib.errors = ['La cuenta está guardada como número en Excel y ha perdido dígitos. Formatea la columna como texto y vuelve a escribir la cuenta.'];
    } else if (ib.ok && ib.fixedFromCcc && /0{5}$/.test(ib.iban)) {
      ib.ok = false; ib.errors = ['La cuenta termina en 00000: si viene de Excel, probablemente ha perdido los últimos dígitos. Revísala.'];
    }
    if (!ib.ok) errors.push({ field: 'iban', msg: ib.errors[0] || 'IBAN no válido' });
    for (const w of ib.warnings) warnings.push({ field: 'iban', msg: w });

    let amountCents = null;
    const rawAmount = get(r, 'amount');
    if (rawAmount !== undefined && String(rawAmount).trim() !== '') amountCents = parseAmountCents(rawAmount);
    else if (opts.defaultAmount !== undefined && opts.defaultAmount !== '' && opts.defaultAmount !== null) amountCents = parseAmountCents(opts.defaultAmount);
    if (amountCents === null) errors.push({ field: 'amount', msg: rawAmount !== undefined && String(rawAmount).trim() !== '' ? `Importe no reconocido: "${rawAmount}"` : 'Falta el importe' });
    else if (amountCents <= 0) errors.push({ field: 'amount', msg: 'El importe debe ser mayor que 0' });
    else if (amountCents > MAX_AMOUNT_CENTS) errors.push({ field: 'amount', msg: 'Importe demasiado alto' });
    if (amountCents !== null && rawAmount !== undefined && amountExtraDecimals(rawAmount)) warnings.push({ field: 'amount', msg: `Importe con más de 2 decimales ("${rawAmount}"), redondeado a ${centsToStr(amountCents).replace('.', ',')} €` });

    // Mandate reference: column > reference column > NIF
    let mandateRaw = get(r, 'mandateId');
    let mandateSource = 'column';
    if (mandateRaw === undefined || String(mandateRaw).trim() === '') {
      const ref = get(r, 'reference');
      const nif = get(r, 'nif');
      if (ref !== undefined && String(ref).trim() !== '') { mandateRaw = (opts.mandatePrefix || '') + String(ref).trim(); mandateSource = 'reference'; }
      else if (nif !== undefined && String(nif).trim() !== '') { mandateRaw = (opts.mandatePrefix || '') + String(nif).trim(); mandateSource = 'nif'; }
      else mandateSource = 'missing';
    }
    let mandateId = '';
    if (mandateSource === 'missing') {
      errors.push({ field: 'mandateId', msg: 'Falta la referencia del mandato (o un nº de socio/NIF para generarla)' });
    } else {
      const raw = String(mandateRaw).trim();
      mandateId = sepaId(raw, 35);
      if (!mandateId) errors.push({ field: 'mandateId', msg: 'Referencia de mandato no válida' });
      else if (mandateId !== raw && mandateSource === 'column') warnings.push({ field: 'mandateId', msg: `Referencia adaptada al formato SEPA: "${raw}" → "${mandateId}". Usa siempre la misma.` });
      // generated references are flagged once, globally, by the UI
    }

    // Mandate signature date
    let mandateDate = parseDate(get(r, 'mandateDate'));
    if (!mandateDate && get(r, 'mandateDate') !== undefined && String(get(r, 'mandateDate')).trim() !== '') {
      errors.push({ field: 'mandateDate', msg: `Fecha de firma no reconocida: "${get(r, 'mandateDate')}"` });
    } else if (!mandateDate && opts.defaultMandateDate) mandateDate = opts.defaultMandateDate;
    if (!mandateDate) errors.push({ field: 'mandateDate', msg: 'Falta la fecha de firma del mandato (puedes fijar una por defecto)' });
    else if (collectionDate && mandateDate > collectionDate) errors.push({ field: 'mandateDate', msg: 'La fecha de firma del mandato es posterior a la fecha de cobro' });
    else if (mandateDate < '2009-10-31') warnings.push({ field: 'mandateDate', msg: 'Fecha de firma anterior a 31/10/2009: muchos bancos esperan 2009-10-31 para domiciliaciones previas a SEPA' });

    // Sequence type
    let seqType = normSeqType(get(r, 'seqType')) || opts.defaultSeqType || 'RCUR';
    if (seqType === 'INVALID') { errors.push({ field: 'seqType', msg: `Tipo de adeudo no reconocido: "${get(r, 'seqType')}" (usa FRST, RCUR, OOFF o FNAL)` }); seqType = 'RCUR'; }
    else if (seqType === 'FNAL') warnings.push({ field: 'seqType', msg: 'FNAL (último): después de este cobro el mandato no podrá volver a usarse' });
    else if (seqType === 'OOFF') warnings.push({ field: 'seqType', msg: 'OOFF (único): este mandato solo sirve para este cobro' });

    // BIC
    let bic = normalizeBic(get(r, 'bic'));
    if (bic && !isValidBic(bic)) { warnings.push({ field: 'bic', msg: 'BIC no válido: se omitirá' }); bic = ''; }
    if (!bic && opts.includeDebtorBic && ib.ok) bic = bicForIban(ib.iban);
    if (ib.ok && !EEA.has(ib.country) && !bic) errors.push({ field: 'bic', msg: `Cuenta de ${ib.country} (fuera del EEE): el BIC es obligatorio. Añade una columna BIC.` });

    // Address (optional; structured)
    let address = null;
    if (opts.includeAddresses) {
      address = normAddress({ street: get(r, 'street'), postcode: get(r, 'postcode'), town: get(r, 'town'), country: get(r, 'country') || (ib.ok ? ib.country : '') });
      if (address && !address.town) { warnings.push({ field: 'town', msg: 'Dirección sin población: no se incluirá (las normas SEPA exigen población y país en cualquier dirección)' }); address = null; }
      if (address && !address.country) {
        if (address.countryRaw) { warnings.push({ field: 'country', msg: `País no reconocido ("${address.countryRaw}"): la dirección no se incluirá. Usa el código de 2 letras (ES, PT, FR…).` }); address = null; }
        else address.country = ib.country || 'ES';
      }
    }
    if (ib.ok && !EEA.has(ib.country) && !address) warnings.push({ field: 'town', msg: 'Para cuentas fuera del EEE las normas SEPA piden la dirección del deudor: activa «Incluir la dirección» y usa la versión 2019' });

    const rawConcept = get(r, 'concept');
    const concept = sepaText(rawConcept !== undefined && rawConcept !== null && String(rawConcept).trim() !== '' ? rawConcept : (opts.defaultConcept ?? ''), 140);
    if (!concept) warnings.push({ field: 'concept', msg: 'Recibo sin concepto: el socio no sabrá qué se le cobra' });

    // Duplicate checks
    if (mandateId) {
      const key = mandateId;
      if (seenMandates.has(key)) {
        const other = seenMandates.get(key);
        const sameIban = other.iban === ib.iban;
        const fila = other.rowIndex + (opts.rowOffset ?? 2);
        if (sameIban) warnings.push({ field: 'mandateId', msg: `Referencia de mandato repetida (fila ${fila}) con el mismo IBAN: ¿recibo duplicado?` });
        else errors.push({ field: 'mandateId', msg: `Referencia de mandato repetida (fila ${fila}) con otro IBAN: cada mandato necesita una referencia única` });
      } else seenMandates.set(key, { rowIndex, iban: ib.iban });
    }

    // End-to-end id
    let e2e = '';
    // Date first, so the id stays unique per collection even when the mandate reference is 35 characters long.
    const ymd = (collectionDate || todayIso()).replace(/-/g, '');
    const baseE2E = sepaId(`${ymd}-${mandateId || 'R' + (rowIndex + 1)}`, 35);
    e2e = baseE2E;
    if (seenE2E.has(e2e)) {
      let k = e2eCounter.get(baseE2E) || 1;
      do { k++; const suf = '-' + k; e2e = sepaId(baseE2E.slice(0, 35 - suf.length) + suf, 35); } while (seenE2E.has(e2e));
      e2eCounter.set(baseE2E, k);
    }
    seenE2E.add(e2e);

    items.push({
      rowIndex,
      errors, warnings,
      tx: { name, iban: ib.iban, bic, amountCents, mandateId, mandateDate, seqType, concept, endToEndId: e2e, address, country: ib.country },
    });
  });
  const valid = items.filter(i => i.errors.length === 0);
  const totalCents = valid.reduce((s, i) => s + i.tx.amountCents, 0);
  return {
    items,
    stats: {
      rows: items.length, valid: valid.length, withErrors: items.length - valid.length,
      withWarnings: items.filter(i => i.warnings.length).length, totalCents,
    },
  };
}

/** Check the collection date. Returns { errors:[], warnings:[] } */
export function checkCollectionDate(iso, today = todayIso(), minBusinessDays = 2) {
  const errors = [], warnings = [];
  if (!iso) { errors.push('Elige la fecha de cobro'); return { errors, warnings }; }
  if (iso <= today) errors.push('La fecha de cobro debe ser posterior a hoy');
  else {
    if (!isTargetDay(iso)) warnings.push(`La fecha de cobro ${targetDayReason(iso)}: no es día hábil SEPA y el banco la moverá o rechazará`);
    const days = targetDaysBetween(today, iso);
    if (days < minBusinessDays) warnings.push(`Solo hay ${days} día(s) hábil(es) hasta el cobro. Muchos bancos piden presentar la remesa con 2-3 días hábiles de antelación.`);
  }
  if (iso > addMonthsIso(today, 12)) warnings.push('La fecha de cobro está a más de un año vista');
  return { errors, warnings };
}

function addMonthsIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function randId(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const arr = (globalThis.crypto && globalThis.crypto.getRandomValues) ? globalThis.crypto.getRandomValues(new Uint32Array(n)) : Array.from({ length: n }, () => Math.floor(Math.random() * 1e9));
  for (let i = 0; i < n; i++) s += chars[arr[i] % chars.length];
  return s;
}

function nowLocalIsoSeconds(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Generate pain.008 XML.
 * params = { version:'02'|'08', scheme:'CORE'|'B2B', batchBooking:true, collectionDate, creditor (normalised), transactions:[tx], msgId?, createdAt? }
 * Transactions are grouped by (collectionDate, seqType) into PmtInf blocks.
 */
export function generatePain008(params) {
  const v = VERSIONS[params.version || '02'];
  if (!v) throw new Error('Versión no soportada');
  const scheme = params.scheme === 'B2B' ? 'B2B' : 'CORE';
  const cr = params.creditor;
  const txs = params.transactions;
  if (!txs.length) throw new Error('No hay recibos válidos');
  const createdAt = params.createdAt || nowLocalIsoSeconds();
  const msgId = sepaId(params.msgId || `CSEPA-${createdAt.slice(0, 10).replace(/-/g, '')}-${createdAt.slice(11).replace(/:/g, '')}-${randId(6)}`, 35);

  const groups = new Map();
  for (const t of txs) {
    const date = t.collectionDate || params.collectionDate;
    const key = `${date}|${t.seqType}`;
    if (!groups.has(key)) groups.set(key, { date, seqType: t.seqType, txs: [] });
    groups.get(key).txs.push(t);
  }
  const order = { FRST: 0, RCUR: 1, OOFF: 2, FNAL: 3 };
  const blocks = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || order[a.seqType] - order[b.seqType]);

  const total = txs.reduce((s, t) => s + t.amountCents, 0);
  const L = [];
  const ind = (n) => '  '.repeat(n);
  const el = (n, tag, val) => L.push(`${ind(n)}<${tag}>${xmlEscape(val)}</${tag}>`);
  const agent = (n, bic) => {
    L.push(`${ind(n)}<FinInstnId>`);
    if (bic) el(n + 1, v.bicTag, bic);
    else { L.push(`${ind(n + 1)}<Othr>`); el(n + 2, 'Id', 'NOTPROVIDED'); L.push(`${ind(n + 1)}</Othr>`); }
    L.push(`${ind(n)}</FinInstnId>`);
  };
  const address = (n, a) => {
    if (!a || !a.town || !a.country) return;
    if ((params.version || '02') === '02') {
      // EPC implementation guidelines for the 2009 schema allow only Country + max. 2 AddressLine.
      const l1 = sepaText([a.street, a.building].filter(Boolean).join(' '), 70);
      const l2 = sepaText([a.postcode, a.town].filter(Boolean).join(' '), 70);
      L.push(`${ind(n)}<PstlAdr>`);
      el(n + 1, 'Ctry', a.country);
      if (l1) el(n + 1, 'AdrLine', l1);
      if (l2) el(n + 1, 'AdrLine', l2);
      L.push(`${ind(n)}</PstlAdr>`);
      return;
    }
    L.push(`${ind(n)}<PstlAdr>`);
    if (a.street) el(n + 1, 'StrtNm', a.street);
    if (a.building) el(n + 1, 'BldgNb', a.building);
    if (a.postcode) el(n + 1, 'PstCd', a.postcode);
    el(n + 1, 'TwnNm', a.town);
    el(n + 1, 'Ctry', a.country);
    L.push(`${ind(n)}</PstlAdr>`);
  };

  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push(`<Document xmlns="${v.ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`);
  L.push(`${ind(1)}<CstmrDrctDbtInitn>`);
  L.push(`${ind(2)}<GrpHdr>`);
  el(3, 'MsgId', msgId);
  el(3, 'CreDtTm', createdAt);
  el(3, 'NbOfTxs', String(txs.length));
  el(3, 'CtrlSum', centsToStr(total));
  L.push(`${ind(3)}<InitgPty>`);
  el(4, 'Nm', cr.name);
  L.push(`${ind(4)}<Id>`, `${ind(5)}<OrgId>`, `${ind(6)}<Othr>`);
  el(7, 'Id', cr.creditorId);
  L.push(`${ind(6)}</Othr>`, `${ind(5)}</OrgId>`, `${ind(4)}</Id>`);
  L.push(`${ind(3)}</InitgPty>`);
  L.push(`${ind(2)}</GrpHdr>`);

  blocks.forEach((b, bi) => {
    const sum = b.txs.reduce((s, t) => s + t.amountCents, 0);
    L.push(`${ind(2)}<PmtInf>`);
    el(3, 'PmtInfId', sepaId(`${msgId.slice(0, 30)}-${bi + 1}`, 35));
    el(3, 'PmtMtd', 'DD');
    el(3, 'BtchBookg', params.batchBooking === false ? 'false' : 'true');
    el(3, 'NbOfTxs', String(b.txs.length));
    el(3, 'CtrlSum', centsToStr(sum));
    L.push(`${ind(3)}<PmtTpInf>`);
    L.push(`${ind(4)}<SvcLvl>`); el(5, 'Cd', 'SEPA'); L.push(`${ind(4)}</SvcLvl>`);
    L.push(`${ind(4)}<LclInstrm>`); el(5, 'Cd', scheme); L.push(`${ind(4)}</LclInstrm>`);
    el(4, 'SeqTp', b.seqType);
    L.push(`${ind(3)}</PmtTpInf>`);
    el(3, 'ReqdColltnDt', b.date);
    L.push(`${ind(3)}<Cdtr>`);
    el(4, 'Nm', cr.name);
    address(4, cr.address);
    L.push(`${ind(3)}</Cdtr>`);
    L.push(`${ind(3)}<CdtrAcct>`, `${ind(4)}<Id>`); el(5, 'IBAN', cr.iban); L.push(`${ind(4)}</Id>`, `${ind(3)}</CdtrAcct>`);
    L.push(`${ind(3)}<CdtrAgt>`); agent(4, cr.bic); L.push(`${ind(3)}</CdtrAgt>`);
    el(3, 'ChrgBr', 'SLEV');
    L.push(`${ind(3)}<CdtrSchmeId>`, `${ind(4)}<Id>`, `${ind(5)}<PrvtId>`, `${ind(6)}<Othr>`);
    el(7, 'Id', cr.creditorId);
    L.push(`${ind(7)}<SchmeNm>`); el(8, 'Prtry', 'SEPA'); L.push(`${ind(7)}</SchmeNm>`);
    L.push(`${ind(6)}</Othr>`, `${ind(5)}</PrvtId>`, `${ind(4)}</Id>`, `${ind(3)}</CdtrSchmeId>`);
    for (const t of b.txs) {
      L.push(`${ind(3)}<DrctDbtTxInf>`);
      L.push(`${ind(4)}<PmtId>`); el(5, 'EndToEndId', t.endToEndId); L.push(`${ind(4)}</PmtId>`);
      L.push(`${ind(4)}<InstdAmt Ccy="EUR">${centsToStr(t.amountCents)}</InstdAmt>`);
      L.push(`${ind(4)}<DrctDbtTx>`, `${ind(5)}<MndtRltdInf>`);
      el(6, 'MndtId', t.mandateId);
      el(6, 'DtOfSgntr', t.mandateDate);
      L.push(`${ind(5)}</MndtRltdInf>`, `${ind(4)}</DrctDbtTx>`);
      L.push(`${ind(4)}<DbtrAgt>`); agent(5, t.bic); L.push(`${ind(4)}</DbtrAgt>`);
      L.push(`${ind(4)}<Dbtr>`); el(5, 'Nm', t.name); address(5, t.address); L.push(`${ind(4)}</Dbtr>`);
      L.push(`${ind(4)}<DbtrAcct>`, `${ind(5)}<Id>`); el(6, 'IBAN', t.iban); L.push(`${ind(5)}</Id>`, `${ind(4)}</DbtrAcct>`);
      if (t.concept) { L.push(`${ind(4)}<RmtInf>`); el(5, 'Ustrd', t.concept); L.push(`${ind(4)}</RmtInf>`); }
      L.push(`${ind(3)}</DrctDbtTxInf>`);
    }
    L.push(`${ind(2)}</PmtInf>`);
  });
  L.push(`${ind(1)}</CstmrDrctDbtInitn>`);
  L.push('</Document>');
  return { xml: L.join('\n') + '\n', msgId, total, count: txs.length, blocks: blocks.map(b => ({ date: b.date, seqType: b.seqType, count: b.txs.length, totalCents: b.txs.reduce((s, t) => s + t.amountCents, 0) })) };
}

export { isValidSepaId };
