import { mandateHtml, printMandates, $, $$, lsGet } from './ui.js';
import { checkIban } from './lib/iban.js';
import { checkCreditorId } from './lib/ids.js';
const saved = lsGet('cuotasepa.creditor.v1');
if (saved) { $('#m-cname').value = saved.name || ''; $('#m-cid').value = saved.creditorId || ''; }
function data() {
  return { creditorName: $('#m-cname').value, creditorId: $('#m-cid').value.toUpperCase().replace(/\s/g, ''), creditorAddress: $('#m-caddr').value,
    mandateId: $('#m-ref').value, debtorName: $('#m-dname').value, debtorAddress: $('#m-daddr').value,
    debtorIban: checkIban($('#m-iban').value).ok ? checkIban($('#m-iban').value).iban : '', paymentType: $('#m-type').value, scheme: $('#m-scheme').value };
}
function update() {
  $('#preview').innerHTML = mandateHtml(data());
  const cid = $('#m-cid').value.trim();
  $('#m-cid-status').textContent = cid ? (checkCreditorId(cid).ok ? '✓ Correcto' : checkCreditorId(cid).error) : '';
  const ib = $('#m-iban').value.trim();
  $('#m-iban-status').textContent = ib ? (checkIban(ib).ok ? '✓ IBAN correcto' : checkIban(ib).errors[0]) : '';
}
$$('#form input, #form select').forEach(el => el.addEventListener('input', update));
$('#print').addEventListener('click', () => printMandates([mandateHtml(data())]));
update();
