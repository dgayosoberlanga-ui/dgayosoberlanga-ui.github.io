import { checkIban, formatIban, spanishBankFromIban, bicForIban } from './lib/iban.js';
import { toCsv } from './lib/csv.js';
import { $, esc, download } from './ui.js';
let results = [];
$('#run').addEventListener('click', () => {
  const lines = $('#input').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  results = lines.map((line, i) => {
    const r = checkIban(line);
    const bank = r.ok ? spanishBankFromIban(r.iban) : null;
    return { i: i + 1, input: line, ok: r.ok, iban: r.iban, bank: bank ? bank.name : '', bic: r.ok ? bicForIban(r.iban) : '', detail: [...r.errors, ...r.warnings].join(' · ') };
  });
  $('#out').innerHTML = results.map(r => `<tr class="${r.ok ? '' : 'row-bad'}"><td class="num">${r.i}</td><td>${r.ok ? '<span class="pill pill-ok">Válido</span>' : '<span class="pill pill-bad">Error</span>'}</td><td class="mono small">${esc(r.input)}</td><td class="iban">${r.ok ? esc(formatIban(r.iban)) : ''}</td><td class="small">${esc(r.bank)}</td><td class="mono small">${esc(r.bic)}</td><td class="small">${esc(r.detail)}</td></tr>`).join('');
  $('#out-wrap').hidden = !results.length;
  $('#export').disabled = !results.length;
  const bad = results.filter(r => !r.ok).length;
  $('#count').textContent = results.length ? `${results.length} cuentas · ${bad} con error` : 'Pega al menos una cuenta';
});
$('#export').addEventListener('click', () => {
  download('iban-validados.csv', toCsv([['#', 'Estado', 'Entrada', 'IBAN', 'Banco', 'BIC', 'Detalle'], ...results.map(r => [r.i, r.ok ? 'VALIDO' : 'ERROR', r.input, r.iban, r.bank, r.bic, r.detail])]), 'text/csv');
});
