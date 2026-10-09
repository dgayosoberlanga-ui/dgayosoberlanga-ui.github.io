// Read and audit an existing SEPA XML file (pain.008 direct debits; basic support for pain.001 transfers).
import { checkIban, EEA } from './iban.js';
import { checkCreditorId } from './ids.js';
import { isTargetDay, targetDayReason, todayIso } from './dates.js';
// Strict XML decimal: digits with an optional '.' and decimals; returns { cents, decimals } or null.
function xmlAmount(s) {
  const m = /^(\d{1,18})(?:\.(\d+))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const dec = m[2] || '';
  return { cents: Number(m[1]) * 100 + Number((dec + '00').slice(0, 2)), decimals: dec.length };
}
import { isValidSepaId, toSepaText } from './text.js';

// EPC153-22 v2.1 set 15/11/2026 as the end of unstructured addresses; v2.2 (30/09/2026) postponed it
// to "a future still to be set end date". Set a date here once the EPC publishes it.
export const ADDRESS_DEADLINE = '';

const kids = (node, name) => node ? Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === name) : [];
const kid = (node, name) => kids(node, name)[0] || null;
const path = (node, ...names) => { let cur = node; for (const n of names) { cur = kid(cur, n); if (!cur) return null; } return cur; };
const text = (node, ...names) => { const n = path(node, ...names); return n ? n.textContent.trim() : ''; };

function checkAddress(adr, who, date, issues) {
  if (!adr) return;
  const twn = text(adr, 'TwnNm'), ctry = text(adr, 'Ctry');
  const lines = kids(adr, 'AdrLine').length;
  if (!twn || !ctry) {
    const after = !!ADDRESS_DEADLINE && date >= ADDRESS_DEADLINE;
    issues.push({
      level: after ? 'error' : 'warning',
      msg: `Dirección de ${who} sin ${!twn ? 'población (TwnNm)' : 'país (Ctry)'}${lines ? ' (solo AdrLine, formato no estructurado)' : ''}: ${after ? 'el banco rechazará este adeudo' : 'este formato dejará de admitirse cuando el EPC fije la nueva fecha (estaba prevista el 15/11/2026 y se aplazó)'}. Incluye población y país, o elimina la dirección.`,
    });
  }
}

/**
 * Analyse XML text. parser: a DOMParser instance (browser) or compatible.
 * Returns { ok, type, version, header, blocks, transactions, issues, summary }
 */
export function analyseSepaXml(xmlText, parser, today = todayIso()) {
  const result = { ok: false, type: '', version: '', header: {}, blocks: [], transactions: [], issues: [], summary: {} };
  let doc;
  try { doc = parser.parseFromString(xmlText, 'application/xml'); } catch (e) { result.issues.push({ level: 'error', msg: 'El fichero no es XML válido' }); return result; }
  const perr = doc.getElementsByTagName('parsererror');
  if (perr && perr.length) { result.issues.push({ level: 'error', msg: 'El fichero no es XML válido (está dañado o incompleto)' }); return result; }
  const root = doc.documentElement;
  const ns = root.namespaceURI || root.getAttribute('xmlns') || '';
  const m = /(pain\.\d{3}\.\d{3}\.\d{2})/.exec(ns);
  result.version = m ? m[1] : '';
  if (!m) result.issues.push({ level: 'error', msg: 'El fichero no declara el espacio de nombres ISO 20022 (xmlns="urn:iso:std:iso:20022:tech:xsd:pain…"): el banco lo rechazará' });
  const dd = kid(root, 'CstmrDrctDbtInitn');
  const ct = kid(root, 'CstmrCdtTrfInitn');
  if (!dd && !ct) { result.issues.push({ level: 'error', msg: 'No parece un fichero SEPA (pain.008 adeudos o pain.001 transferencias)' }); return result; }
  const isDD = !!dd;
  result.type = isDD ? 'adeudos' : 'transferencias';
  const body = dd || ct;
  const gh = kid(body, 'GrpHdr');
  result.header = {
    msgId: text(gh, 'MsgId'), created: text(gh, 'CreDtTm'), nbOfTxs: text(gh, 'NbOfTxs'), ctrlSum: text(gh, 'CtrlSum'),
    initiator: text(gh, 'InitgPty', 'Nm'),
  };
  const seenE2E = new Map();
  let total = 0, count = 0;
  const pmtInfs = kids(body, 'PmtInf');
  pmtInfs.forEach((pi, bi) => {
    const blockIssues = [];
    const date = isDD ? text(pi, 'ReqdColltnDt') : (text(pi, 'ReqdExctnDt', 'Dt') || text(pi, 'ReqdExctnDt'));
    const seq = text(pi, 'PmtTpInf', 'SeqTp');
    const scheme = text(pi, 'PmtTpInf', 'LclInstrm', 'Cd');
    const party = isDD ? kid(pi, 'Cdtr') : kid(pi, 'Dbtr');
    const partyName = text(party, 'Nm');
    const acct = isDD ? text(pi, 'CdtrAcct', 'Id', 'IBAN') : text(pi, 'DbtrAcct', 'Id', 'IBAN');
    const schemeId = isDD ? (text(pi, 'CdtrSchmeId', 'Id', 'PrvtId', 'Othr', 'Id')) : '';
    if (!date) blockIssues.push({ level: 'error', msg: 'Falta la fecha de cobro/ejecución' });
    else {
      if (date <= today) blockIssues.push({ level: 'error', msg: date < today ? `La fecha ${date} ya ha pasado` : `La fecha ${date} es hoy: el banco necesita recibir la remesa antes` });
      if (!isTargetDay(date)) blockIssues.push({ level: 'warning', msg: `La fecha ${date} ${targetDayReason(date)}` });
    }
    if (isDD && !['FRST', 'RCUR', 'OOFF', 'FNAL'].includes(seq)) blockIssues.push({ level: 'error', msg: `Tipo de secuencia no válido: "${seq || 'vacío'}"` });
    if (isDD && scheme && !['CORE', 'B2B', 'COR1'].includes(scheme)) blockIssues.push({ level: 'error', msg: `Esquema no válido: ${scheme}` });
    if (isDD && scheme === 'COR1') blockIssues.push({ level: 'warning', msg: 'COR1 está obsoleto desde 2017: usa CORE' });
    const ib = checkIban(acct);
    if (!ib.ok) blockIssues.push({ level: 'error', msg: `Cuenta del ${isDD ? 'acreedor' : 'ordenante'} no válida: ${ib.errors[0] || ''}` });
    if (isDD) {
      const cid = checkCreditorId(schemeId);
      if (!cid.ok) blockIssues.push({ level: 'error', msg: 'Identificador de acreedor: ' + cid.error });
    }
    checkAddress(path(party, 'PstlAdr'), isDD ? 'el acreedor' : 'el ordenante', date || today, blockIssues);
    const txNodes = kids(pi, isDD ? 'DrctDbtTxInf' : 'CdtTrfTxInf');
    let blockSum = 0;
    txNodes.forEach((tx) => {
      const issues = [];
      const e2e = text(tx, 'PmtId', 'EndToEndId');
      const amtStr = isDD ? text(tx, 'InstdAmt') : text(tx, 'Amt', 'InstdAmt');
      const amt = xmlAmount(amtStr);
      const cents = amt ? amt.cents : null;
      if (amt && amt.decimals > 2) issues.push({ level: 'error', msg: `Importe con más de 2 decimales: "${amtStr}"` });
      const cp = isDD ? kid(tx, 'Dbtr') : kid(tx, 'Cdtr');
      const name = text(cp, 'Nm');
      const iban = isDD ? text(tx, 'DbtrAcct', 'Id', 'IBAN') : text(tx, 'CdtrAcct', 'Id', 'IBAN');
      const mndtId = isDD ? text(tx, 'DrctDbtTx', 'MndtRltdInf', 'MndtId') : '';
      const mndtDate = isDD ? text(tx, 'DrctDbtTx', 'MndtRltdInf', 'DtOfSgntr') : '';
      const ustrd = text(tx, 'RmtInf', 'Ustrd');
      if (cents === null || cents <= 0) issues.push({ level: 'error', msg: `Importe no válido: "${amtStr}"` });
      else { blockSum += cents; }
      if (!name) issues.push({ level: 'error', msg: 'Falta el nombre' });
      else if (toSepaText(name) !== name) issues.push({ level: 'warning', msg: 'El nombre contiene caracteres no admitidos en SEPA (tildes, ñ, &...)' });
      if (ustrd && toSepaText(ustrd) !== ustrd) issues.push({ level: 'warning', msg: 'El concepto contiene caracteres no admitidos en SEPA' });
      const ib2 = checkIban(iban);
      if (!ib2.ok) issues.push({ level: 'error', msg: 'IBAN: ' + (ib2.errors[0] || 'no válido') });
      else if (!EEA.has(ib2.country)) {
        const agent = isDD ? kid(tx, 'DbtrAgt') : kid(tx, 'CdtrAgt');
        const bicTx = text(agent, 'FinInstnId', 'BIC') || text(agent, 'FinInstnId', 'BICFI');
        if (!bicTx) issues.push({ level: 'error', msg: `Cuenta de ${ib2.country} (fuera del EEE) sin BIC: es obligatorio` });
        if (!path(cp, 'PstlAdr')) issues.push({ level: 'warning', msg: `Cuenta de ${ib2.country} (fuera del EEE) sin dirección: las normas SEPA la piden` });
      }
      if (!e2e) issues.push({ level: 'error', msg: 'Falta EndToEndId' });
      else if (seenE2E.has(e2e)) issues.push({ level: 'warning', msg: `EndToEndId repetido (${e2e})` });
      seenE2E.set(e2e, true);
      if (isDD) {
        if (!mndtId) issues.push({ level: 'error', msg: 'Falta la referencia del mandato' });
        else if (!isValidSepaId(mndtId)) issues.push({ level: 'warning', msg: 'Referencia de mandato con caracteres o formato no recomendados' });
        if (!mndtDate) issues.push({ level: 'error', msg: 'Falta la fecha de firma del mandato' });
        else if (date && mndtDate > date) issues.push({ level: 'error', msg: 'Mandato firmado después de la fecha de cobro' });
      }
      checkAddress(path(cp, 'PstlAdr'), isDD ? 'el deudor' : 'el beneficiario', date || today, issues);
      count++;
      result.transactions.push({ block: bi + 1, date, seqType: seq, endToEndId: e2e, name, iban, amountCents: cents, mandateId: mndtId, mandateDate: mndtDate, concept: ustrd, issues });
    });
    total += blockSum;
    const nb = text(pi, 'NbOfTxs'), cs = text(pi, 'CtrlSum');
    if (nb && Number(nb) !== txNodes.length) blockIssues.push({ level: 'error', msg: `NbOfTxs del bloque (${nb}) no coincide con los recibos (${txNodes.length})` });
    if (cs && (xmlAmount(cs) || {}).cents !== blockSum) blockIssues.push({ level: 'error', msg: `CtrlSum del bloque (${cs}) no coincide con la suma (${(blockSum / 100).toFixed(2)})` });
    result.blocks.push({ index: bi + 1, id: text(pi, 'PmtInfId'), date, seqType: seq, scheme, partyName, account: acct, creditorId: schemeId, count: txNodes.length, totalCents: blockSum, issues: blockIssues });
  });
  if (result.header.nbOfTxs && Number(result.header.nbOfTxs) !== count) result.issues.push({ level: 'error', msg: `La cabecera dice ${result.header.nbOfTxs} operaciones y el fichero tiene ${count}` });
  if (result.header.ctrlSum && (xmlAmount(result.header.ctrlSum) || {}).cents !== total) result.issues.push({ level: 'error', msg: `La suma de control de la cabecera (${result.header.ctrlSum}) no coincide con el total (${(total / 100).toFixed(2)})` });
  if (!result.header.msgId) result.issues.push({ level: 'error', msg: 'Falta MsgId en la cabecera' });
  if (result.version === 'pain.008.001.02' || result.version === 'pain.001.001.03') result.issues.push({ level: 'info', msg: `Versión ${result.version} (ISO 2009). Si tu banco solo admite la versión 2019, genera el fichero en ${isDD ? 'pain.008.001.08' : 'pain.001.001.09'}.` });
  const all = [...result.issues, ...result.blocks.flatMap(b => b.issues), ...result.transactions.flatMap(t => t.issues)];
  result.summary = {
    count, totalCents: total, blocks: result.blocks.length,
    errors: all.filter(i => i.level === 'error').length,
    warnings: all.filter(i => i.level === 'warning').length,
    txWithErrors: result.transactions.filter(t => t.issues.some(i => i.level === 'error')).length,
  };
  result.ok = result.summary.errors === 0;
  return result;
}
