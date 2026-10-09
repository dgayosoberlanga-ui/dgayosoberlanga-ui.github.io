// License handling for the Pro plan. Keys are sold through Polar.sh and validated against
// Polar's public endpoint (no secret in the page). Result cached in localStorage.
import { CONFIG, paymentsActive } from './config.js';

const KEY = 'cuotasepa.license.v1';
const REVALIDATE_MS = 3 * 24 * 3600 * 1000;   // re-check every 3 days
const OFFLINE_GRACE_MS = 21 * 24 * 3600 * 1000; // keep working offline up to 21 days

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(v) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export function currentLicense() {
  const l = load();
  if (!l) return null;
  const now = Date.now();
  if (l.expiresAt && Date.parse(l.expiresAt) < now) return null;
  if (!l.offline && now - (l.validatedAt || 0) > OFFLINE_GRACE_MS) return null;
  return l;
}

// ── Offline keys: "CSEPA1-<base64url payload>.<base64url ECDSA P-256 signature>" ──
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function verifyOfflineKey(key, jwk = CONFIG.offlineLicensePublicKey) {
  const m = /^CSEPA1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || '').trim());
  if (!m || !jwk || !globalThis.crypto?.subtle) return null;
  try {
    const data = b64urlToBytes(m[1]);
    const sig = b64urlToBytes(m[2]);
    const pub = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data);
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(data));
  } catch { return null; }
}

export function isPro() { return !!currentLicense(); }

async function callValidate(key) {
  const url = CONFIG.polar.proxyUrl || CONFIG.polar.validateUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim(), organization_id: CONFIG.polar.organizationId }),
  });
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  if (!res.ok) return { ok: false, reason: 'http_' + res.status };
  const data = await res.json();
  return { ok: data.status === 'granted' || !!data.id, data };
}

/** Activate a license key typed by the user. Returns { ok, message } */
export async function activate(key) {
  if (!key || key.trim().length < 8) return { ok: false, message: 'Escribe la clave completa que recibiste por email tras la compra.' };
  if (key.trim().startsWith('CSEPA1-')) {
    const p = await verifyOfflineKey(key);
    if (!p) return { ok: false, message: 'Esa clave no es válida. Revisa que la has copiado entera, sin espacios.' };
    const expiresAt = p.e ? p.e + 'T23:59:59' : null;
    if (expiresAt && Date.parse(expiresAt) < Date.now()) return { ok: false, message: `Esa clave caducó el ${p.e.split('-').reverse().join('/')}.` };
    save({ key: key.trim(), validatedAt: Date.now(), expiresAt, display: p.n || '', offline: true });
    return { ok: true, message: `Clave activada${p.n ? ' para ' + p.n : ''}. Ya puedes generar remesas sin límite en este navegador.` };
  }
  if (!paymentsActive()) return { ok: false, message: 'Esa clave no es válida. Revisa que la has copiado entera.' };
  try {
    const r = await callValidate(key);
    if (!r.ok) {
      return { ok: false, message: r.reason === 'not_found'
        ? 'Esa clave no existe, ha caducado o se ha desactivado. Revisa que la has copiado entera.'
        : 'No hemos podido comprobar la clave ahora mismo. Inténtalo en unos minutos.' };
    }
    save({ key: key.trim(), validatedAt: Date.now(), expiresAt: r.data.expires_at || null, display: r.data.display_key || '' });
    return { ok: true, message: 'Clave activada. Ya puedes generar remesas sin límite en este navegador.' };
  } catch (e) {
    return { ok: false, message: 'No hay conexión con el servidor de licencias. Comprueba tu conexión e inténtalo de nuevo.' };
  }
}

/** Background re-validation; removes the key if Polar says it is no longer valid. */
export async function refresh() {
  const l = load();
  if (!l || l.offline || !paymentsActive()) return;
  if (Date.now() - (l.validatedAt || 0) < REVALIDATE_MS) return;
  try {
    const r = await callValidate(l.key);
    if (r.ok) save({ ...l, validatedAt: Date.now(), expiresAt: r.data.expires_at || null });
    else if (r.reason === 'not_found') save(null);
  } catch { /* offline: keep grace period */ }
}

export function deactivate() { save(null); }
