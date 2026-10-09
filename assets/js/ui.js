// Shared UI helpers.
import { CONFIG, paymentsActive, checkoutUrl } from './config.js';
import { formatIban } from './lib/iban.js';
import { formatEs } from './lib/dates.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function download(filename, content, mime = 'application/xml') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function lsSet(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* blocked */ }
}

/** Plan cards (used in the upgrade dialog and the pricing page). */
export function renderPlans(container, { compact = false } = {}) {
  const active = paymentsActive();
  container.innerHTML = CONFIG.plans.map(p => {
    const url = checkoutUrl(p.id);
    const btn = active && url
      ? `<a class="btn ${p.highlight ? 'btn-primary' : 'btn-secondary'}" href="${esc(url)}" rel="noopener" target="_blank">Elegir ${esc(p.name)}</a>`
      : `<a class="btn btn-secondary" href="mailto:${esc(CONFIG.supportEmail)}?subject=${encodeURIComponent('Quiero ' + p.name)}">Pedir ${esc(p.name)} por email</a>`;
    return `<div class="plan${p.highlight ? ' is-featured' : ''}">
      ${p.highlight ? '<span class="pill pill-neutral tag">Recomendado</span>' : '<span></span>'}
      <div><div class="price">${esc(p.price)} <small>${esc(p.period)}</small></div><h3 style="margin-top:6px">${esc(p.name)}</h3></div>
      <p class="muted small">${esc(p.blurb)}${compact ? '' : ' Recibos ilimitados y mandatos para firmar en lote.'}</p>
      ${btn}
    </div>`;
  }).join('');
}

/** Spanish SEPA direct debit mandate (orden de domiciliación) as printable HTML. */
export function mandateHtml({ creditorName, creditorId, creditorAddress = '', mandateId = '', debtorName = '', debtorIban = '', debtorBic = '', debtorAddress = '', paymentType = 'recurrente', scheme = 'CORE' }) {
  const ibanFmt = debtorIban ? formatIban(debtorIban) : '';
  const blank = (v, w = '100%') => v ? esc(v) : `<span style="display:inline-block;width:${w};border-bottom:1px solid #000">&nbsp;</span>`;
  const b2b = scheme === 'B2B';
  return `<article class="mandate">
    <h2>Orden de domiciliación de adeudo directo SEPA${b2b ? ' B2B' : ''}</h2>
    <p style="text-align:center;font-size:9pt;margin-bottom:8px">SEPA Direct Debit Mandate${b2b ? ' — B2B' : ''}</p>
    <div class="row"><span>Referencia de la orden de domiciliación</span><span><b>${blank(mandateId)}</b></span></div>
    <div class="row"><span>Identificador del acreedor</span><span>${blank(creditorId)}</span></div>
    <div class="row"><span>Nombre del acreedor</span><span>${blank(creditorName)}</span></div>
    <div class="row"><span>Dirección del acreedor</span><span>${blank(creditorAddress)}</span></div>
    <div class="legal">${b2b
      ? 'Mediante la firma de esta orden de domiciliación, el deudor autoriza (A) al acreedor a enviar instrucciones a la entidad del deudor para adeudar su cuenta y (B) a la entidad para efectuar los adeudos en su cuenta siguiendo las instrucciones del acreedor. Esta orden de domiciliación está prevista para operaciones exclusivamente entre empresas y/o autónomos. El deudor no tiene derecho a que su entidad le reembolse una vez que se haya realizado el cargo en cuenta, pero puede solicitar a su entidad que no efectúe el adeudo en la cuenta hasta la fecha debida de su cargo. Podrá obtener información detallada del procedimiento en su entidad financiera.'
      : 'Mediante la firma de esta orden de domiciliación, el deudor autoriza (A) al acreedor a enviar instrucciones a la entidad del deudor para adeudar su cuenta y (B) a la entidad para efectuar los adeudos en su cuenta siguiendo las instrucciones del acreedor. Como parte de sus derechos, el deudor está legitimado al reembolso por su entidad en los términos y condiciones del contrato suscrito con la misma. La solicitud de reembolso deberá efectuarse dentro de las ocho semanas que siguen a la fecha de adeudo en cuenta. Puede obtener información adicional sobre sus derechos en su entidad financiera.'}</div>
    <div class="row"><span>Nombre del deudor / titular de la cuenta</span><span>${blank(debtorName)}</span></div>
    <div class="row"><span>Dirección del deudor</span><span>${blank(debtorAddress)}</span></div>
    <div class="row"><span>Número de cuenta (IBAN)</span><span class="iban-boxes">${ibanFmt ? esc(ibanFmt) : blank('')}</span></div>
    <div class="row"><span>Swift BIC (puede contener 8 u 11 posiciones)</span><span>${blank(debtorBic, '40%')}</span></div>
    <div class="row"><span>Tipo de pago</span><span>${paymentType === 'unico' ? '☐ Pago recurrente &nbsp; ☒ Pago único' : paymentType === 'recurrente' ? '☒ Pago recurrente &nbsp; ☐ Pago único' : '☐ Pago recurrente &nbsp; ☐ Pago único'}</span></div>
    <div class="row"><span>Fecha – Localidad</span><span>${blank('')}</span></div>
    <div class="row" style="border-bottom:0"><span>Firma del deudor</span><span><div class="box"></div></span></div>
    <p style="font-size:8pt;margin-top:8px">TODOS LOS CAMPOS HAN DE SER CUMPLIMENTADOS OBLIGATORIAMENTE. UNA VEZ FIRMADA ESTA ORDEN DE DOMICILIACIÓN DEBE SER ENVIADA AL ACREEDOR PARA SU CUSTODIA.</p>
  </article>`;
}

export function printMandates(htmlList) {
  const area = document.getElementById('print-area');
  area.innerHTML = htmlList.join('');
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

export { formatEs };
