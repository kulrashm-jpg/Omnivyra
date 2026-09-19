// Minimal RFC 4180 CSV reader/writer. No dependencies.
// Quoted fields may contain commas, quotes ("" escape) and newlines.

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return { header: [], records: [] };
  const [header, ...body] = nonEmpty;
  const records = body.map((r, n) => {
    if (r.length !== header.length) {
      throw new Error(`CSV: row ${n + 2} has ${r.length} fields, header has ${header.length}`);
    }
    return Object.fromEntries(header.map((h, k) => [h, r[k]]));
  });
  return { header, records };
}

const needsQuote = (v) => /[",\r\n]/.test(v);
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header, records) {
  const lines = [header.map(cell).join(',')];
  for (const r of records) lines.push(header.map((h) => cell(r[h])).join(','));
  return lines.join('\n') + '\n';
}
