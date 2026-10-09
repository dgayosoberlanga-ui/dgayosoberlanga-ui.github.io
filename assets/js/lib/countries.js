// Country names (Spanish/English/local) -> ISO 3166-1 alpha-2, for address columns.
const NAMES = {
  'espana': 'ES', 'spain': 'ES', 'es': 'ES', 'portugal': 'PT', 'francia': 'FR', 'france': 'FR', 'alemania': 'DE', 'germany': 'DE',
  'deutschland': 'DE', 'italia': 'IT', 'italy': 'IT', 'andorra': 'AD', 'suiza': 'CH', 'switzerland': 'CH', 'reino unido': 'GB',
  'united kingdom': 'GB', 'uk': 'GB', 'inglaterra': 'GB', 'gran bretana': 'GB', 'irlanda': 'IE', 'ireland': 'IE', 'belgica': 'BE',
  'belgium': 'BE', 'paises bajos': 'NL', 'holanda': 'NL', 'netherlands': 'NL', 'luxemburgo': 'LU', 'luxembourg': 'LU',
  'austria': 'AT', 'polonia': 'PL', 'poland': 'PL', 'rumania': 'RO', 'rumanía': 'RO', 'romania': 'RO', 'bulgaria': 'BG',
  'grecia': 'GR', 'greece': 'GR', 'suecia': 'SE', 'sweden': 'SE', 'dinamarca': 'DK', 'denmark': 'DK', 'finlandia': 'FI',
  'finland': 'FI', 'noruega': 'NO', 'norway': 'NO', 'islandia': 'IS', 'iceland': 'IS', 'monaco': 'MC', 'san marino': 'SM',
  'liechtenstein': 'LI', 'malta': 'MT', 'chipre': 'CY', 'cyprus': 'CY', 'croacia': 'HR', 'croatia': 'HR', 'eslovenia': 'SI',
  'eslovaquia': 'SK', 'republica checa': 'CZ', 'chequia': 'CZ', 'hungria': 'HU', 'estonia': 'EE', 'letonia': 'LV', 'lituania': 'LT',
  'gibraltar': 'GI', 'vaticano': 'VA', 'albania': 'AL', 'moldavia': 'MD', 'montenegro': 'ME', 'macedonia del norte': 'MK', 'serbia': 'RS',
};
// All ISO codes we accept in addresses (SEPA area + a few common others).
const CODES = new Set(['AD','AT','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB','GI','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV',
  'MC','MT','NL','NO','PL','PT','RO','SE','SI','SK','SM','VA','AL','MD','ME','MK','RS','US','MA','AR','MX','CO','VE','EC','PE','CL','UY','BR','CN']);

/** Returns ISO alpha-2 code or '' if not recognised. */
export function countryCode(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^[A-Za-z]{2}$/.test(s) && CODES.has(s.toUpperCase())) return s.toUpperCase();
  const k = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return NAMES[k] || '';
}
