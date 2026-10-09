import { analyseSepaXml } from './lib/xmlcheck.js';
import { formatIban } from './lib/iban.js';
import { centsToEs } from './lib/parse.js';
import { formatEs } from './lib/dates.js';
import { toCsv } from './lib/csv.js';
import { $, $$, esc, toast, download } from './ui.js';

let result = null, filter = 'all', fileName = '';
const parser = new DOMParser();

async function handle(file) {
  fileName = file.name;
  const text = await file.text();
  result = analyseSepaXml(text, parser);
  render();
}

function render() {
  const r = result;
  $('#result').hidden = false;
  const s = r.summary;
  $('#summary').innerHTML = r.type ? `
    <div class="kpi"><b>${s.count}</b><span>${r.type === 'adeudos' ? 'recibos' : 'transferencias'}</span></div>
    <div class="kpi"><b>${centsToEs(s.totalCents)}</b><span>importe total</span></div>
    <div class="kpi"><b style="color:${s.errors ? 'var(--bad)' : 'var(--ok)'}">${s.errors}</b><span>errores</span></div>
    <div class="kpi"><b style="color:${s.warnings ? 'var(--warn)' : 'var(--ink)'}">${s.warnings}</b><span>avisos</span></div>
    <div class="kpi"><b class="mono" style="font-size:1rem">${esc(r.version || '—')}</b><span>versión</span></div>` : '';
  const verdict = !r.type ? '' : s.errors === 0
    ? `<div class="alert alert-ok"><b>Sin errores</b><span>${esc(fileName)} supera todas las comprobaciones${s.warnings ? ', con algunos avisos que conviene revisar' : ''}.</span></div>`
    : `<div class="alert alert-bad"><b>${s.errors} error(es)</b><span>Corrígelos antes de enviar el fichero. Si lo generaste desde Excel, puedes regenerarlo con el <a href="/generador/">generador</a>, que los evita.</span></div>`;
  $('#issues').innerHTML = verdict + r.issues.map(i => `<div class="alert alert-${i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'info'}"><span>${esc(i.msg)}</span></div>`).join('');
  $('#blocks').innerHTML = r.blocks.length ? `<table class="tbl"><thead><tr><th>Bloque</th><th>Fecha</th><th>Tipo</th><th>Esquema</th><th>${r.type === 'adeudos' ? 'Acreedor' : 'Ordenante'}</th><th>Cuenta</th><th class="amount">Operaciones</th><th class="amount">Total</th><th>Avisos</th></tr></thead><tbody>${r.blocks.map(b => `<tr><td class="num">${b.index}</td><td class="num">${esc(b.date ? formatEs(b.date) : '')}</td><td class="mono small">${esc(b.seqType)}</td><td class="mono small">${esc(b.scheme)}</td><td>${esc(b.partyName)}${b.creditorId ? `<div class="mono small muted">${esc(b.creditorId)}</div>` : ''}</td><td class="iban">${esc(formatIban(b.account))}</td><td class="amount">${b.count}</td><td class="amount">${centsToEs(b.totalCents)}</td><td>${b.issues.length ? `<ul class="issues">${b.issues.map(i => `<li class="${i.level === 'error' ? 'e' : 'w'}">${esc(i.msg)}</li>`).join('')}</ul>` : '<span class="pill pill-ok">OK</span>'}</td></tr>`).join('')}</tbody></table>` : '';
  $('#blocks').hidden = !r.blocks.length;
  const txs = r.transactions.filter(t => filter === 'all' || (filter === 'bad' && t.issues.some(i => i.level === 'error')) || (filter === 'warn' && t.issues.some(i => i.level === 'warning')));
  $('#tx tbody').innerHTML = txs.slice(0, 500).map((t, i) => {
    const bad = t.issues.some(x => x.level === 'error'), warn = t.issues.some(x => x.level === 'warning');
    return `<tr class="${bad ? 'row-bad' : ''}"><td class="num">${r.transactions.indexOf(t) + 1}</td><td>${bad ? '<span class="pill pill-bad">Error</span>' : warn ? '<span class="pill pill-warn">Aviso</span>' : '<span class="pill pill-ok">OK</span>'}</td><td>${esc(t.name)}</td><td class="iban">${esc(formatIban(t.iban))}</td><td class="amount">${t.amountCents !== null ? centsToEs(t.amountCents) : ''}</td><td class="mono small">${esc(t.mandateId)}</td><td class="num small">${esc(t.mandateDate ? formatEs(t.mandateDate) : '')}</td><td class="num small">${esc(t.date ? formatEs(t.date) : '')}</td><td class="small">${esc(t.concept)}${t.issues.length ? `<ul class="issues">${t.issues.map(x => `<li class="${x.level === 'error' ? 'e' : 'w'}">${esc(x.msg)}</li>`).join('')}</ul>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">Nada que mostrar en este filtro.</td></tr>';
  $('#note').textContent = txs.length > 500 ? `Mostrando 500 de ${txs.length}. Exporta a CSV para verlas todas.` : '';
}

$('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) handle(f); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handle(f); });
$$('.filters button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; $$('.filters button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); if (result) render(); }));
$('#export').addEventListener('click', () => {
  if (!result) return;
  const head = ['#', 'Bloque', 'Fecha', 'Tipo', 'Nombre', 'IBAN', 'Importe', 'Referencia mandato', 'Fecha firma', 'EndToEndId', 'Concepto', 'Errores', 'Avisos'];
  const rows = result.transactions.map((t, i) => [i + 1, t.block, t.date, t.seqType, t.name, t.iban, t.amountCents !== null ? (t.amountCents / 100).toFixed(2).replace('.', ',') : '', t.mandateId, t.mandateDate, t.endToEndId, t.concept, t.issues.filter(x => x.level === 'error').map(x => x.msg).join(' | '), t.issues.filter(x => x.level === 'warning').map(x => x.msg).join(' | ')]);
  download(fileName.replace(/\.xml$/i, '') + '.csv', toCsv([head, ...rows]), 'text/csv');
  toast('CSV descargado');
});
