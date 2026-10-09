import { checkNif, computeCreditorId, checkCreditorId } from './lib/ids.js';
import { $, esc, toast } from './ui.js';
function calc() {
  const nif = $('#nif').value.trim();
  if (!nif) { $('#ics-out').textContent = '—'; $('#nif-status').textContent = ''; return; }
  const n = checkNif(nif);
  $('#nif-status').textContent = n.ok ? `✓ NIF válido (${n.type})` : `${n.error}. El cálculo se hace igualmente, pero revisa el NIF.`;
  $('#nif-status').style.color = n.ok ? 'var(--ok)' : 'var(--warn)';
  $('#ics-out').textContent = computeCreditorId(n.nif, $('#suffix').value || '000');
}
function check() {
  const v = $('#check').value.trim();
  const out = $('#check-out');
  if (!v) { out.textContent = ''; return; }
  const r = checkCreditorId(v);
  if (r.ok) {
    out.innerHTML = `<div class="alert alert-${r.warning ? 'warn' : 'ok'}"><b>${r.warning ? 'Formato correcto, con un aviso' : 'Identificador correcto'}</b><span>País ${esc(r.country)} · sufijo ${esc(r.suffix)} · NIF ${esc(r.nationalId)}${r.warning ? '<br>' + esc(r.warning) : ''}</span></div>`;
  } else out.innerHTML = `<div class="alert alert-bad"><b>No es válido</b><span>${esc(r.error)}</span></div>`;
}
['#nif', '#suffix'].forEach(s => $(s).addEventListener('input', calc));
$('#check').addEventListener('input', check);
$('#copy').addEventListener('click', async () => {
  const t = $('#ics-out').textContent;
  if (!t || t === '—') return;
  try { await navigator.clipboard.writeText(t); toast('Copiado: ' + t); } catch { toast('Selecciona el texto y cópialo con Ctrl+C'); }
});
