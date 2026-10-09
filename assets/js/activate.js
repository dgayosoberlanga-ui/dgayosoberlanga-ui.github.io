import { activate, currentLicense, deactivate } from './license.js';
const $ = (s) => document.querySelector(s);
function show() {
  const l = currentLicense();
  const st = $('#status');
  if (l) {
    st.className = 'alert alert-ok';
    st.innerHTML = `<b>Plan Pro activo en este navegador</b><span>Clave ${l.display ? l.display : '…' + l.key.slice(-6)}${l.expiresAt ? ' · válida hasta ' + new Date(l.expiresAt).toLocaleDateString('es-ES') : ''}</span>`;
    $('#remove').hidden = false;
  } else {
    st.className = 'alert alert-info';
    st.innerHTML = '<b>Plan gratuito</b><span>Remesas de hasta 25 recibos. Activa tu clave para quitar el límite.</span>';
    $('#remove').hidden = true;
  }
}
$('#activate').addEventListener('click', async () => {
  $('#msg').textContent = 'Comprobando…';
  const r = await activate($('#key').value);
  $('#msg').textContent = r.message; $('#msg').style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
  show();
});
$('#remove').addEventListener('click', () => { deactivate(); show(); $('#msg').textContent = 'Clave quitada de este navegador.'; });
show();
