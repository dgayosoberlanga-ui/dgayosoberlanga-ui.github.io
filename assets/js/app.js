// CuotaSEPA generator page controller.
import { CONFIG } from './config.js';
import { isPro, activate, refresh, currentLicense } from './license.js';
import { $, $$, esc, toast, download, lsGet, lsSet, renderPlans, mandateHtml, printMandates } from './ui.js';
import { checkIban, formatIban, spanishBankFromIban, bicForIban } from './lib/iban.js';
import { checkNif, computeCreditorId, checkCreditorId } from './lib/ids.js';
import { FIELDS, guessMapping, findHeaderRow, looksLikeDataRow } from './lib/mapping.js';
import { buildTransactions, checkCreditor, checkCollectionDate, generatePain008 } from './lib/sepa.js';
import { parseCsv, toCsv } from './lib/csv.js';
import { todayIso, addTargetDays, formatEs, monthNameEs, isTargetDay, nextTargetDay } from './lib/dates.js';
import { centsToEs, normHeader } from './lib/parse.js';
import { SAMPLE } from './sample.js';

const LS_CREDITOR = 'cuotasepa.creditor.v1';
const LS_SETTINGS = 'cuotasepa.settings.v1';
const LS_MAPPINGS = 'cuotasepa.mappings.v1';
const MAX_TABLE_ROWS = 400;

const state = {
  sheets: [],          // [{ name, rows }]
  sheetIndex: 0,
  headerRow: 0,        // 0-based
  dataStart: 1,        // 0-based index in the sheet of the first data row
  noHeader: false,
  guessed: [],
  headers: [],
  rows: [],
  mapping: {},
  sourceName: '',
  built: null,
  filter: 'all',
  conceptTouched: false,
};

// ───────────────────────── creditor ─────────────────────────
const crFields = ['cr-name', 'cr-nif', 'cr-ics', 'cr-iban', 'cr-bic', 'cr-suffix'];

function readCreditorInputs() {
  return {
    name: $('#cr-name').value, nif: $('#cr-nif').value, creditorId: $('#cr-ics').value,
    iban: $('#cr-iban').value, bic: $('#cr-bic').value, suffix: $('#cr-suffix').value || '000',
  };
}

function setStatus(el, text, level) {
  el.textContent = text;
  el.style.color = level === 'bad' ? 'var(--bad)' : level === 'ok' ? 'var(--ok)' : level === 'warn' ? 'var(--warn)' : '';
}

function updateCreditorStatus() {
  const c = readCreditorInputs();
  // NIF
  if (c.nif.trim()) {
    const n = checkNif(c.nif);
    setStatus($('#cr-nif-status'), n.ok ? `✓ NIF válido (${n.type})` : n.error, n.ok ? 'ok' : 'bad');
    $('#cr-nif').setAttribute('aria-invalid', String(!n.ok));
  } else setStatus($('#cr-nif-status'), 'Lo usamos para comprobar o calcular el identificador de acreedor.');
  // ICS
  if (c.creditorId.trim()) {
    const r = checkCreditorId(c.creditorId);
    let msg = r.ok ? '✓ Identificador correcto' : r.error;
    let lvl = r.ok ? 'ok' : 'bad';
    if (r.ok && r.warning) { msg = 'Atención: ' + r.warning; lvl = 'warn'; }
    if (r.ok && c.nif.trim() && r.nationalId !== c.nif.toUpperCase().replace(/[^A-Z0-9]/g, '')) { msg = 'El identificador no contiene el NIF indicado. Revisa ambos.'; lvl = 'warn'; }
    setStatus($('#cr-ics-status'), msg, lvl);
    $('#cr-ics').setAttribute('aria-invalid', String(!r.ok));
  } else setStatus($('#cr-ics-status'), 'Te lo da tu banco al contratar los adeudos. Suele ser ES + 2 dígitos + 000 + NIF.');
  // IBAN
  if (c.iban.trim()) {
    const r = checkIban(c.iban);
    if (r.ok) {
      const bank = spanishBankFromIban(r.iban);
      const bic = bicForIban(r.iban);
      setStatus($('#cr-iban-status'), `✓ IBAN correcto${bank && bank.name ? ' · ' + bank.name : ''}${bic ? ' · BIC ' + bic : ''}`, 'ok');
      if (!$('#cr-bic').value && bic) $('#cr-bic').placeholder = bic + ' (automático)';
    } else setStatus($('#cr-iban-status'), r.errors[0], 'bad');
    $('#cr-iban').setAttribute('aria-invalid', String(!r.ok));
  } else setStatus($('#cr-iban-status'), 'La cuenta de la entidad en la que entrarán los cobros.');
}

function saveCreditor() {
  if (!$('#cr-remember').checked) { lsSet(LS_CREDITOR, null); $('#creditor-saved').textContent = ''; return; }
  lsSet(LS_CREDITOR, readCreditorInputs());
  $('#creditor-saved').textContent = 'Guardado en este navegador';
}

function loadCreditor() {
  const c = lsGet(LS_CREDITOR);
  if (!c) return;
  $('#cr-name').value = c.name || ''; $('#cr-nif').value = c.nif || ''; $('#cr-ics').value = c.creditorId || '';
  $('#cr-iban').value = c.iban || ''; $('#cr-bic').value = c.bic || ''; $('#cr-suffix').value = c.suffix || '000';
  $('#creditor-saved').textContent = 'Datos recuperados de este navegador';
}

// ───────────────────────── settings ─────────────────────────
function readSettings() {
  return {
    collectionDate: $('#col-date').value,
    concept: $('#concept').value,
    defaultAmount: $('#def-amount').value,
    defaultMandateDate: $('#def-mdate').value,
    defaultSeqType: ($('input[name="def-seq"]:checked') || {}).value || 'RCUR',
    version: $('#version').value,
    scheme: $('#scheme').value,
    mandatePrefix: $('#mref-prefix').value,
    batchBooking: $('#batch').checked,
    includeDebtorBic: $('#inc-bic').checked,
    includeAddresses: $('#inc-addr').checked,
  };
}

function saveSettings() {
  const s = readSettings();
  lsSet(LS_SETTINGS, { version: s.version, scheme: s.scheme, mandatePrefix: s.mandatePrefix, batchBooking: s.batchBooking,
    includeDebtorBic: s.includeDebtorBic, includeAddresses: s.includeAddresses, defaultMandateDate: s.defaultMandateDate, defaultSeqType: s.defaultSeqType });
}

function loadSettings() {
  const s = lsGet(LS_SETTINGS, {});
  if (s.version) $('#version').value = s.version;
  if (s.scheme) $('#scheme').value = s.scheme;
  if (s.mandatePrefix) $('#mref-prefix').value = s.mandatePrefix;
  if (s.batchBooking === false) $('#batch').checked = false;
  if (s.includeDebtorBic) $('#inc-bic').checked = true;
  if (s.includeAddresses) $('#inc-addr').checked = true;
  if (s.defaultMandateDate) $('#def-mdate').value = s.defaultMandateDate;
  if (s.defaultSeqType) { const r = $(`input[name="def-seq"][value="${s.defaultSeqType}"]`); if (r) r.checked = true; }
  // Default collection date: 5 TARGET business days from today
  $('#col-date').value = addTargetDays(todayIso(), 5);
  $('#col-date').min = todayIso();
  suggestConcept();
}

function suggestConcept() {
  if (state.conceptTouched) return;
  const d = $('#col-date').value;
  if (!d) return;
  $('#concept').value = `Cuota ${monthNameEs(d)} ${d.slice(0, 4)}`;
}

function updateDateStatus() {
  const iso = $('#col-date').value;
  const r = checkCollectionDate(iso);
  const el = $('#col-date-status');
  if (r.errors.length) setStatus(el, r.errors[0], 'bad');
  else if (r.warnings.length) {
    setStatus(el, r.warnings[0], 'warn');
    if (!isTargetDay(iso)) {
      el.innerHTML = esc(r.warnings[0]) + ` <button type="button" class="btn btn-ghost btn-sm" id="fix-date">Usar ${formatEs(nextTargetDay(iso))}</button>`;
      $('#fix-date').addEventListener('click', () => { $('#col-date').value = nextTargetDay(iso); suggestConcept(); updateDateStatus(); recompute(); });
    }
  } else setStatus(el, `✓ Día hábil SEPA · ${formatEs(iso)}`, 'ok');
  return r;
}

// ───────────────────────── data loading ─────────────────────────
function setSheets(sheets, sourceName) {
  state.sheets = sheets.filter(s => s.rows && s.rows.length);
  if (!state.sheets.length) { toast('El archivo está vacío o no tiene filas legibles'); return; }
  state.sourceName = sourceName;
  state.sheetIndex = 0;
  const sel = $('#sheet');
  sel.innerHTML = state.sheets.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rows.length} filas)</option>`).join('');
  $('#sheet-picker').hidden = false;
  selectSheet(0);
}

function selectSheet(i) {
  state.sheetIndex = i;
  const matrix = state.sheets[i].rows;
  state.headerRow = findHeaderRow(matrix);
  $('#header-row').value = state.headerRow + 1;
  applyHeaderRow();
}

function applyHeaderRow() {
  const matrix = state.sheets[state.sheetIndex].rows;
  const hr = Math.min(Math.max(0, state.headerRow), matrix.length - 1);
  // If the chosen title row actually contains account numbers, the sheet has no title row: keep it as data.
  state.noHeader = looksLikeDataRow(matrix[hr]);
  const width = Math.max(...matrix.slice(0, 50).map(r => (r || []).length), 0);
  state.headers = state.noHeader
    ? Array.from({ length: width }, (_, i) => `Columna ${i + 1}`)
    : (matrix[hr] || []).map((h, i) => (h === null || h === undefined || String(h).trim() === '') ? `Columna ${i + 1}` : String(h).trim());
  state.dataStart = state.noHeader ? hr : hr + 1;
  state.rows = matrix.slice(state.dataStart);
  // remembered mapping for identical headers? (never keyed on data)
  const sig = state.noHeader ? '' : state.headers.map(normHeader).join('|');
  const remembered = sig ? lsGet(LS_MAPPINGS, {})[sig] : null;
  const info0 = {};
  state.mapping = remembered || guessMapping(state.headers, state.rows, info0);
  state.guessed = remembered ? [] : (info0.guessed || []);
  const info = $('#file-info');
  info.hidden = false;
  info.innerHTML = `<b>${esc(state.sourceName)}</b><span>${state.rows.length} filas de datos · ${state.headers.length} columnas${remembered ? ' · columnas recordadas de la última vez' : ''}${state.noHeader ? ' · sin fila de títulos: elige qué es cada columna' : ''}</span>`;
  renderMapping();
  recompute();
}

async function readFile(file) {
  const name = file.name || 'archivo';
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith('.xlsx')) {
      if (typeof window.readXlsxFile !== 'function') throw new Error('Lector de Excel no disponible');
      const res = await window.readXlsxFile(file);
      let sheets;
      if (Array.isArray(res) && res.length && res[0] && !Array.isArray(res[0]) && res[0].data) sheets = res.map(s => ({ name: s.sheet, rows: s.data }));
      else sheets = [{ name: 'Hoja 1', rows: res }];
      setSheets(sheets, name);
    } else if (lower.endsWith('.xls') || lower.endsWith('.ods') || lower.endsWith('.numbers')) {
      toast('Ese formato no se puede leer aquí. Ábrelo y guárdalo como .xlsx o .csv, o copia y pega las celdas.', 6000);
    } else {
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // Excel "CSV" in ANSI
      setSheets([{ name: 'CSV', rows: parseCsv(text) }], name);
    }
  } catch (e) {
    console.error(e);
    toast('No hemos podido leer el archivo. Prueba a guardarlo como .xlsx o .csv, o pega las celdas.', 6000);
  }
}

// ───────────────────────── mapping UI ─────────────────────────
function renderMapping() {
  const wrap = $('#mapping');
  const sampleRow = state.rows.find(r => r && r.some(v => v !== null && v !== '')) || [];
  const opts = (sel) => `<option value="">— No usar —</option>` + state.headers.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const show = FIELDS.filter(f => !['street', 'postcode', 'town', 'country'].includes(f.key) || $('#inc-addr').checked);
  wrap.innerHTML = show.map(f => {
    const col = state.mapping[f.key];
    const sample = col !== undefined && col !== '' ? sampleRow[col] : '';
    const sampleStr = sample instanceof Date ? formatEs(sample.toISOString().slice(0, 10)) : (sample ?? '');
    return `<div class="field">
      <label for="map-${f.key}">${esc(f.label)}${f.required ? ' *' : ''}</label>
      <select id="map-${f.key}" data-field="${f.key}">${opts(col)}</select>
      <span class="sample" title="${esc(sampleStr)}">${sampleStr !== '' ? 'Ej.: ' + esc(sampleStr) : '&nbsp;'}</span>
    </div>`;
  }).join('');
  $('#mapping-wrap').hidden = false;
  $$('select[data-field]', wrap).forEach(sel => sel.addEventListener('change', () => {
    const k = sel.dataset.field;
    if (sel.value === '') delete state.mapping[k]; else state.mapping[k] = Number(sel.value);
    state.guessed = state.guessed.filter(g => g !== k);
    if (!state.noHeader) {
      const sig = state.headers.map(normHeader).join('|');
      const all = lsGet(LS_MAPPINGS, {}); all[sig] = state.mapping; lsSet(LS_MAPPINGS, all);
    }
    renderMapping(); recompute();
  }));
}

// ───────────────────────── recompute & review ─────────────────────────
let recomputeTimer;
function recompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(doRecompute, 120);
}

function doRecompute() {
  updateCreditorStatus();
  const dateRes = updateDateStatus();
  if (!state.rows.length) { $('#review').hidden = true; $('#review-empty').hidden = false; return; }
  const s = readSettings();
  const built = buildTransactions(state.rows, state.mapping, { ...s, defaultConcept: s.concept, rowOffset: state.dataStart + 1 });
  state.built = built;
  const cr = checkCreditor({ name: $('#cr-name').value, creditorId: $('#cr-ics').value, iban: $('#cr-iban').value, bic: $('#cr-bic').value });
  state.creditorCheck = cr;
  state.dateCheck = dateRes;
  renderReview();
}

function renderReview() {
  const { items, stats } = state.built;
  $('#review-empty').hidden = true; $('#review').hidden = false;
  const pro = isPro();
  const over = !pro && stats.valid > CONFIG.freeLimit;
  $('#summary').innerHTML = `
    <div class="kpi"><b>${stats.valid}</b><span>recibos listos</span></div>
    <div class="kpi"><b>${centsToEs(stats.totalCents)}</b><span>importe total</span></div>
    <div class="kpi"><b style="color:${stats.withErrors ? 'var(--bad)' : 'var(--ok)'}">${stats.withErrors}</b><span>con errores (se excluyen)</span></div>
    <div class="kpi"><b style="color:${stats.withWarnings ? 'var(--warn)' : 'var(--ink)'}">${stats.withWarnings}</b><span>con avisos</span></div>`;
  // Global alerts
  const alerts = [];
  const missingRequired = FIELDS.filter(f => f.required && state.mapping[f.key] === undefined && !(f.key === 'name' && (state.mapping.firstName !== undefined || state.mapping.lastName !== undefined)) && !(f.key === 'amount' && $('#def-amount').value));
  if (missingRequired.length) alerts.push(['bad', 'Faltan columnas', `Indica qué columna contiene: ${missingRequired.map(f => f.label.toLowerCase()).join(', ')}.`]);
  if (state.creditorCheck.errors.length) alerts.push(['bad', 'Revisa los datos de tu entidad (paso 1)', '<ul>' + state.creditorCheck.errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>']);
  if (state.creditorCheck.warnings.length) alerts.push(['warn', 'Datos de la entidad', '<ul>' + state.creditorCheck.warnings.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>']);
  if (state.dateCheck.errors.length) alerts.push(['bad', 'Fecha de cobro', esc(state.dateCheck.errors[0])]);
  if (state.mapping.mandateId === undefined && state.mapping.reference === undefined && state.mapping.nif === undefined) alerts.push(['bad', 'Falta la referencia del mandato', 'Elige la columna con la referencia del mandato, o una columna de nº de socio o NIF para generarla.']);
  else if (state.mapping.mandateId === undefined) alerts.push(['warn', 'Referencias de mandato generadas', 'No hay columna de referencia de mandato, así que la generamos desde el nº de socio o NIF. Debe coincidir con la que diste a cada socio y ser la misma todos los meses; si cambia, el banco puede devolver el recibo.']);
  if ($('#inc-addr').checked && $('#version').value === '02') alerts.push(['info', 'Direcciones con la versión 2009', 'Con pain.008.001.02 las normas del EPC solo permiten país y dos líneas de texto (formato no estructurado). Si tu banco pide direcciones estructuradas, elige la versión 2019 en las opciones avanzadas.']);
  if (state.guessed.length) alerts.push(['warn', 'Comprueba estas columnas', `No tenían un título reconocible y las hemos deducido por su contenido: ${state.guessed.map(k => (FIELDS.find(f => f.key === k) || {}).label).join(', ')}. Revisa en el paso 2 que son correctas.`]);
  if (over) alerts.push(['info', `Plan gratuito: hasta ${CONFIG.freeLimit} recibos por fichero`, `Esta remesa tiene ${stats.valid}. Puedes revisarla entera gratis; para descargar el fichero completo necesitas un plan de pago.`]);
  $('#global-alerts').innerHTML = alerts.map(([lvl, title, body]) => `<div class="alert alert-${lvl}"><b>${esc(title)}</b><div>${body}</div></div>`).join('');
  const blocking = state.creditorCheck.errors.length || state.dateCheck.errors.length || stats.valid === 0;
  $('#btn-xml').disabled = !!blocking;
  $('#btn-xml').textContent = stats.valid ? `Descargar fichero XML (${stats.valid})` : 'Descargar fichero XML';
  // Table
  const filtered = items.filter(it => state.filter === 'all' || (state.filter === 'bad' && it.errors.length) || (state.filter === 'warn' && !it.errors.length && it.warnings.length) || (state.filter === 'ok' && !it.errors.length && !it.warnings.length));
  const rowsHtml = filtered.slice(0, MAX_TABLE_ROWS).map(it => {
    const t = it.tx;
    const status = it.errors.length ? '<span class="pill pill-bad">Error</span>' : it.warnings.length ? '<span class="pill pill-warn">Aviso</span>' : '<span class="pill pill-ok">OK</span>';
    const issues = [...it.errors.map(e => `<li class="e">✕ ${esc(e.msg)}</li>`), ...it.warnings.map(w => `<li class="w">! ${esc(w.msg)}</li>`)].join('');
    return `<tr class="${it.errors.length ? 'row-bad' : ''}">
      <td class="num">${it.rowIndex + state.dataStart + 1}</td><td>${status}</td><td>${esc(t.name)}</td>
      <td class="iban">${esc(t.iban ? formatIban(t.iban) : '')}</td>
      <td class="amount">${t.amountCents !== null && t.amountCents !== undefined ? esc(centsToEs(t.amountCents)) : ''}</td>
      <td class="mono small">${esc(t.mandateId)}</td><td class="num small">${t.mandateDate ? esc(formatEs(t.mandateDate)) : ''}</td>
      <td class="mono small">${esc(t.seqType)}</td>
      <td class="small">${esc(t.concept)}${issues ? `<ul class="issues">${issues}</ul>` : ''}</td></tr>`;
  }).join('');
  $('#review-table tbody').innerHTML = rowsHtml || `<tr><td colspan="9" class="muted">No hay recibos en este filtro.</td></tr>`;
  $('#table-note').textContent = filtered.length > MAX_TABLE_ROWS ? `Mostrando ${MAX_TABLE_ROWS} de ${filtered.length}. Descarga el informe CSV para verlos todos.` : '';
  $('#btn-mandates').textContent = pro ? 'Mandatos para firmar' : 'Mandatos para firmar (Pro)';
}

// ───────────────────────── actions ─────────────────────────
function validTxs() { return state.built.items.filter(i => !i.errors.length).map(i => i.tx); }

function doDownloadXml() {
  if (!state.built) return;
  clearTimeout(recomputeTimer); doRecompute(); // never generate from a stale check
  if ($('#btn-xml').disabled) return;
  const txs = validTxs();
  if (!isPro() && txs.length > CONFIG.freeLimit) { openGate(txs.length); return; }
  const s = readSettings();
  const out = generatePain008({ version: s.version, scheme: s.scheme, batchBooking: s.batchBooking, collectionDate: s.collectionDate, creditor: state.creditorCheck.creditor, transactions: txs });
  download(`remesa-sepa-${s.collectionDate}-${txs.length}-recibos.xml`, out.xml);
  $('#xml-text').value = out.xml;
  $('#xml-view').hidden = false;
  if (window.CUOTASEPA_PREVIEW) $('#xml-view').open = true;
  saveCreditor(); saveSettings();
  toast(window.CUOTASEPA_PREVIEW ? 'Vista previa: la descarga directa está desactivada aquí. Copia el XML del recuadro.' : `Fichero generado: ${out.count} recibos, ${centsToEs(out.total)}`, 5000);
}

function doReport() {
  if (!state.built) return;
  const head = ['Fila', 'Estado', 'Titular', 'IBAN', 'Importe', 'Referencia mandato', 'Fecha firma', 'Tipo', 'Concepto', 'Errores', 'Avisos'];
  const rows = state.built.items.map(it => [it.rowIndex + state.dataStart + 1, it.errors.length ? 'ERROR' : it.warnings.length ? 'AVISO' : 'OK', it.tx.name, it.tx.iban,
    it.tx.amountCents !== null ? (it.tx.amountCents / 100).toFixed(2).replace('.', ',') : '', it.tx.mandateId, it.tx.mandateDate ? formatEs(it.tx.mandateDate) : '', it.tx.seqType, it.tx.concept,
    it.errors.map(e => e.msg).join(' | '), it.warnings.map(w => w.msg).join(' | ')]);
  download(`informe-remesa-${$('#col-date').value || todayIso()}.csv`, toCsv([head, ...rows]), 'text/csv');
}

function doMandates() {
  if (!state.built) return;
  if (!isPro()) { openGate(validTxs().length, 'mandates'); return; }
  const cr = state.creditorCheck.creditor;
  const s = readSettings();
  const list = state.built.items.filter(i => i.tx.iban || i.tx.name).map(i => mandateHtml({
    creditorName: cr.name || $('#cr-name').value, creditorId: cr.creditorId || $('#cr-ics').value, mandateId: i.tx.mandateId,
    debtorName: i.tx.name, debtorIban: i.tx.iban, paymentType: i.tx.seqType === 'OOFF' ? 'unico' : 'recurrente', scheme: s.scheme,
  }));
  printMandates(list);
}

function openGate(count, reason = 'xml') {
  $('#gate-count').textContent = String(count);
  $('#gate-text').textContent = reason === 'mandates'
    ? 'Generar los mandatos de todos tus socios en un clic es parte del plan Pro. La versión gratuita incluye un mandato en blanco en «Herramientas gratis».'
    : `La versión gratuita genera ficheros de hasta ${CONFIG.freeLimit} recibos. Para descargar esta remesa completa, elige un plan. Recibes tu clave por email nada más pagar.`;
  renderPlans($('#gate-plans'), { compact: true });
  $('#gate-msg').textContent = '';
  const dlg = $('#gate');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function updatePlanPill() {
  const l = currentLicense();
  if (l) {
    $('#plan-pill').className = 'pill pill-ok';
    $('#plan-pill').textContent = 'Plan Pro activo · recibos ilimitados';
    $('#plan-link').textContent = 'Gestionar clave';
  } else {
    $('#plan-pill').className = 'pill pill-neutral';
    $('#plan-pill').textContent = `Plan gratuito · hasta ${CONFIG.freeLimit} recibos`;
  }
}

// ───────────────────────── wire up ─────────────────────────
function init() {
  loadCreditor(); loadSettings(); updatePlanPill(); updateCreditorStatus(); updateDateStatus();
  refresh().then(updatePlanPill);

  crFields.forEach(id => $('#' + id).addEventListener('input', () => { recompute(); }));
  crFields.forEach(id => $('#' + id).addEventListener('change', () => saveCreditor()));
  $('#cr-remember').addEventListener('change', saveCreditor);
  $('#cr-ics-calc').addEventListener('click', () => {
    const n = checkNif($('#cr-nif').value);
    if (!$('#cr-nif').value.trim()) { toast('Escribe primero el NIF de la entidad'); $('#cr-nif').focus(); return; }
    $('#cr-ics').value = computeCreditorId(n.nif, $('#cr-suffix').value || '000');
    if (!n.ok) toast('Calculado, pero revisa el NIF: ' + n.error, 5000);
    saveCreditor(); recompute();
  });

  ['col-date', 'concept', 'def-amount', 'def-mdate', 'version', 'scheme', 'mref-prefix', 'batch', 'inc-bic', 'inc-addr'].forEach(id => {
    $('#' + id).addEventListener('input', recompute);
    $('#' + id).addEventListener('change', () => { saveSettings(); recompute(); });
  });
  $$('input[name="def-seq"]').forEach(r => r.addEventListener('change', () => { saveSettings(); recompute(); }));
  $('#concept').addEventListener('input', () => { state.conceptTouched = true; });
  $('#col-date').addEventListener('change', () => { suggestConcept(); recompute(); });
  $('#inc-addr').addEventListener('change', () => { if (state.headers.length) renderMapping(); });

  // File input & drag-drop
  $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $('#btn-paste').addEventListener('click', () => { $('#paste-box').hidden = !$('#paste-box').hidden; if (!$('#paste-box').hidden) $('#paste').focus(); });
  $('#btn-paste-use').addEventListener('click', () => {
    const t = $('#paste').value;
    if (!t.trim()) { toast('Pega primero las celdas copiadas de tu hoja'); return; }
    setSheets([{ name: 'Datos pegados', rows: parseCsv(t) }], 'Datos pegados');
  });
  $('#btn-sample').addEventListener('click', () => {
    if (!$('#cr-name').value) { $('#cr-name').value = 'Club Deportivo Los Álamos (ejemplo)'; $('#cr-nif').value = 'G12345674'; $('#cr-ics').value = 'ES37000G12345674'; $('#cr-iban').value = 'ES66 2100 0418 4012 3456 7891'; }
    if (!$('#def-mdate').value) $('#def-mdate').value = '2009-10-31';
    setSheets([{ name: 'Socios (ejemplo ficticio)', rows: SAMPLE.map(r => r.slice()) }], 'Datos de ejemplo ficticios');
    if (!window.CUOTASEPA_PREVIEW) $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#sheet').addEventListener('change', (e) => selectSheet(Number(e.target.value)));
  $('#header-row').addEventListener('change', (e) => { state.headerRow = Math.max(0, Number(e.target.value) - 1); applyHeaderRow(); });

  // Review actions
  $$('.filters button').forEach(b => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $$('.filters button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderReview();
  }));
  $('#btn-xml').addEventListener('click', doDownloadXml);
  $('#btn-report').addEventListener('click', doReport);
  $('#btn-mandates').addEventListener('click', doMandates);
  $('#btn-copy-xml').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#xml-text').value); toast('XML copiado'); }
    catch { $('#xml-text').select(); toast('Pulsa Ctrl+C para copiar'); }
  });

  // Gate dialog
  $$('[data-close]').forEach(b => b.addEventListener('click', () => { const d = b.closest('dialog'); if (d.close) d.close(); else d.removeAttribute('open'); }));
  $('#gate-activate').addEventListener('click', async () => {
    $('#gate-msg').textContent = 'Comprobando…';
    const r = await activate($('#gate-key').value);
    $('#gate-msg').textContent = r.message;
    $('#gate-msg').style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
    if (r.ok) { updatePlanPill(); renderReview(); setTimeout(() => $('#gate').close(), 900); }
  });
}

init();
// Artifact/demo preview: open with the fictitious sample loaded so the first view shows the tool working.
if (window.CUOTASEPA_PREVIEW) setTimeout(() => $('#btn-sample').click(), 0);
