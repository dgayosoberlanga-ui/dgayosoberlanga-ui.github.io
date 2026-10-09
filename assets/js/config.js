// ─────────────────────────────────────────────────────────────────────────────
// CuotaSEPA configuration. This is the ONLY file the owner needs to edit to
// switch on payments. See docs/OWNER-SETUP.md.
// ─────────────────────────────────────────────────────────────────────────────
export const CONFIG = {
  brand: 'CuotaSEPA',
  supportEmail: 'dgayosoberlanga@gmail.com',

  // Free plan: maximum number of direct debits (recibos) per generated file.
  freeLimit: 25,

  // Polar.sh (merchant of record: handles checkout, EU VAT, invoices, license keys).
  polar: {
    // Polar → Settings → Organization ID (UUID). Empty = payments not yet active.
    organizationId: '',
    // Public license-key validation endpoint (no secret needed).
    validateUrl: 'https://api.polar.sh/v1/customer-portal/license-keys/validate',
    // Optional: Cloudflare Worker proxy URL if the browser call is blocked by CORS (see worker/).
    proxyUrl: '',
    // Polar checkout links, one per product (Polar → Products → Checkout Links).
    checkout: {
      pass30: '',   // "Pase 30 días" one-time 15 €
      yearly: '',   // "Pro anual" 69 €/año
      monthly: '',  // "Pro mensual" 9 €/mes
    },
    customerPortal: 'https://polar.sh/cuotasepa/portal',
  },

  // Public key that verifies offline license keys issued with tools/license-issue.mjs (manual sales, partners).
  // Safe to publish. The matching private key lives in secrets/ and must never be uploaded.
  offlineLicensePublicKey: {"kty":"EC","crv":"P-256","x":"BZxJa7AuFLPvxAKnkuJYRig0O8iw5ZCOkKo1OWch0uI","y":"RhOmWfDrJnKlOMCaBLs7CASHzhQVYssTuXm3F4pKct4"},

  plans: [
    { id: 'pass30', name: 'Pase 30 días', price: '15 €', period: 'pago único', blurb: 'Para quien cobra la cuota una o dos veces al año.', highlight: false },
    { id: 'yearly', name: 'Pro anual', price: '69 €', period: 'al año', blurb: 'Para cobros mensuales o trimestrales. Sale a 5,75 € al mes.', highlight: true },
    { id: 'monthly', name: 'Pro mensual', price: '9 €', period: 'al mes', blurb: 'Sin permanencia. Cancela cuando quieras.', highlight: false },
  ],
};

export function paymentsActive() {
  return !!CONFIG.polar.organizationId;
}

export function checkoutUrl(planId) {
  return CONFIG.polar.checkout[planId] || '';
}
