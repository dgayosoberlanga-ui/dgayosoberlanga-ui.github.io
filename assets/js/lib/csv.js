// Minimal RFC-4180-ish CSV/TSV parser with delimiter detection (Spanish Excel uses ';').

export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = { ';': 0, ',': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (const ch of sample) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  // prefer tab (pasted from Excel), then ';', then ','
  if (counts['\t'] > 0 && counts['\t'] >= counts[';'] / 2) return '\t';
  if (counts[';'] >= counts[','] && counts[';'] > 0) return ';';
  if (counts[','] > 0) return ',';
  if (counts['|'] > 0) return '|';
  return ';';
}

export function parseCsv(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQ = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // trim trailing empty rows
  while (rows.length && rows[rows.length - 1].every(c => String(c).trim() === '')) rows.pop();
  return rows.map(r => r.map(c => c.trim()));
}

export function toCsv(rows, delimiter = ';') {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r,\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map(r => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}
