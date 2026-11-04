/**
 * PI-LDB — RFC 4180 delimited-text parser.
 *
 * ─── WHY THIS IS HAND-WRITTEN ─────────────────────────────────────────────
 * The approved design (D-1) has the CLIENT parse the file and post canonical
 * records, so no file ever reaches a server route. That normally means
 * `papaparse`, but `npm` cannot be run in this worktree: it is junctioned to a
 * shared `node_modules`, and even `npm install --dry-run` rewrites the shared
 * hidden `.package-lock.json`. A conforming parser is small enough to own, so
 * it is owned: no dependency, no lockfile change, no supply-chain addition.
 *
 * The consequence is recorded honestly — XLSX is NOT supported. A spreadsheet
 * is a ZIP container of XML and is not in scope for a hand-written parser.
 * `.xlsx` is rejected at selection with a message telling the user to export
 * CSV, rather than being half-read and silently producing one row of rubbish.
 *
 * ─── PURE AND ISOMORPHIC ──────────────────────────────────────────────────
 * No `fs`, no `Buffer`, no DOM. It takes a string and returns data, so the
 * same function runs in the import UI, in a unit test and in a worker.
 *
 * ─── WHAT RFC 4180 ACTUALLY REQUIRES ─────────────────────────────────────
 * The part implementations usually get wrong: a quoted field may contain the
 * delimiter, a double quote escaped as `""`, AND a line break. So the number
 * of RECORDS is not the number of LINES, and the parser cannot be a
 * `split('\n').map(split(','))`. This one is a character-state machine for
 * exactly that reason.
 */

/** What separated the fields. Sniffed, never assumed. */
export type CsvDelimiter = ',' | ';' | '\t' | '|';

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t', '|'];

/**
 * Something the parser noticed that a human may need to resolve. Diagnostics
 * are REPORTED, not thrown: a 5,000-row vendor export with three malformed
 * rows should import 4,997 prospects and tell the truth about the other three,
 * because failing the whole file protects nobody.
 */
export interface CsvDiagnostic {
  kind:
    /** A record had fewer fields than the header. Missing values are empty. */
    | 'short_row'
    /** A record had MORE fields than the header. The extras are unreachable. */
    | 'long_row'
    /** Two columns share a heading — the mapping layer cannot tell them apart. */
    | 'duplicate_header'
    /** A heading was blank; its column cannot be named or mapped. */
    | 'empty_header'
    /** A quoted field was never closed. Everything after it is one field. */
    | 'unterminated_quote'
    /** The file exceeded a hard limit and parsing stopped early. */
    | 'truncated';
  /** 1-based record number as a human counts them, excluding the header. */
  row?: number;
  /** 1-based column position. */
  column?: number;
  /** The heading involved, when the diagnostic is about one. */
  header?: string;
  message: string;
}

export interface CsvParseResult {
  /** The header row, verbatim — never normalised, never renamed. */
  headers: string[];
  /** One entry per data record, in file order. Always `headers.length` long. */
  rows: string[][];
  delimiter: CsvDelimiter;
  diagnostics: CsvDiagnostic[];
  /**
   * True when nothing in `diagnostics` prevents an import. A short row is
   * survivable; a duplicate heading is not, because a mapping profile is keyed
   * on the normalised heading and two identical ones cannot be told apart.
   */
  importable: boolean;
}

export interface CsvParseOptions {
  /**
   * Hard caps. These exist because this parser runs in a browser tab on the
   * user's own machine: a 400MB file would freeze it with no way to recover,
   * and a truncation the user is TOLD about is better than a hang.
   */
  maxRows?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_ROWS = 50_000;
/** Roughly 20MB of UTF-16 code units. A CSV this size holds ~200k prospects. */
const DEFAULT_MAX_BYTES = 20_000_000;

/** Diagnostics that must be resolved before any record may be imported. */
const BLOCKING: ReadonlySet<CsvDiagnostic['kind']> = new Set([
  'duplicate_header',
  'empty_header',
  'unterminated_quote',
]);

/**
 * Strips a UTF-8 byte-order mark.
 *
 * Not cosmetic. Excel writes one, and a BOM left in place makes the first
 * heading `﻿Email` rather than `Email` — which matches no synonym, so the
 * first column of every Excel-exported file would arrive `unmapped` while
 * every other column mapped correctly. A confusing bug to find from the UI.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Sniffs the delimiter from the first line.
 *
 * Counts each candidate OUTSIDE quotes, because a single comma inside one
 * quoted heading would otherwise beat four real semicolons. Semicolon files
 * are not an edge case: that is what Excel writes in every locale whose
 * decimal separator is a comma, which is most of Europe and Latin America.
 *
 * Ties and empty lines fall back to a comma, the RFC default.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && text[i + 1] === '"') { i += 1; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === '\n' || ch === '\r') break;
    const d = ch as CsvDelimiter;
    if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  let best: CsvDelimiter = ',';
  let bestCount = 0;
  for (const d of CSV_DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

interface RawParse {
  records: string[][];
  truncated: boolean;
  unterminatedQuote: boolean;
}

/**
 * The state machine. One pass, character by character.
 *
 * Handles the three line endings (CRLF, LF, bare CR — old Mac exports and some
 * database dumps still emit it) and treats a line break inside a quoted field
 * as DATA, which is the whole reason this is not a line-splitting parser: a
 * multi-line postal address in a quoted field is one field, not three records.
 */
function parseRecords(text: string, delimiter: string, maxRows: number): RawParse {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;
  let truncated = false;

  const endField = () => {
    record.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const endRecord = () => {
    endField();
    // A line holding nothing but whitespace is not a record. Trailing newlines
    // are normal and must not produce a phantom row of empty fields, which
    // would otherwise become a prospect with no attributes at all.
    const blank = record.length === 1 && record[0].trim() === '';
    if (!blank) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      // Only an opening quote at the START of a field is a quote per the RFC.
      // A quote mid-field (`5" nails`) is literal data, and treating it as an
      // opener would swallow the rest of the file into one field.
      if (field === '' && !fieldWasQuoted) { inQuotes = true; fieldWasQuoted = true; continue; }
      field += ch;
      continue;
    }

    if (ch === delimiter) { endField(); continue; }

    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      if (records.length >= maxRows) { truncated = true; break; }
      continue;
    }

    if (ch === '\n') {
      endRecord();
      if (records.length >= maxRows) { truncated = true; break; }
      continue;
    }

    field += ch;
  }

  // Whatever is still buffered is the final record: a file need not end in a
  // newline, and discarding the tail would silently drop the last prospect.
  if (field !== '' || record.length > 0) endRecord();

  return { records, truncated, unterminatedQuote: inQuotes };
}

/**
 * Parses delimited text into a header row and padded data rows.
 *
 * Never throws on malformed input. Everything it cannot do is reported in
 * `diagnostics`, and `importable` states whether the result may be used.
 */
export function parseDelimitedText(input: string, options: CsvParseOptions = {}): CsvParseResult {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const diagnostics: CsvDiagnostic[] = [];

  let text = stripBom(input);
  if (text.length > maxBytes) {
    text = text.slice(0, maxBytes);
    diagnostics.push({
      kind: 'truncated',
      message:
        `The file exceeds the ${maxBytes.toLocaleString()} character limit and was cut short. ` +
        'Split it and import the parts separately.',
    });
  }

  const delimiter = sniffDelimiter(text);

  // +1 for the header, so `maxRows` means data rows as a user would count them.
  const { records, truncated, unterminatedQuote } = parseRecords(text, delimiter, maxRows + 1);

  if (truncated) {
    diagnostics.push({
      kind: 'truncated',
      message: `Stopped after ${maxRows.toLocaleString()} rows. Import the remainder as a second file.`,
    });
  }

  if (unterminatedQuote) {
    diagnostics.push({
      kind: 'unterminated_quote',
      message:
        'A quoted value is never closed, so the rest of the file was read as a single value. ' +
        'Check for a stray double quote.',
    });
  }

  if (records.length === 0) {
    return { headers: [], rows: [], delimiter, diagnostics, importable: false };
  }

  const headers = records[0].map((h) => h.trim());
  const dataRecords = records.slice(1);

  // ── Header integrity ────────────────────────────────────────────────────
  // Both of these BLOCK the import, and for the same reason: a mapping profile
  // entry is keyed on the normalised heading, so a blank or repeated heading
  // cannot be given a destination that is distinguishable from its twin's.
  // Guessing — suffixing them `Email_2` — would invent a column the tenant
  // never wrote and then ask them to map it.
  headers.forEach((header, index) => {
    if (header === '') {
      diagnostics.push({
        kind: 'empty_header',
        column: index + 1,
        message: `Column ${index + 1} has no heading. Name it, or remove the column, and import again.`,
      });
    }
  });

  const seen = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header === '') return;
    const key = header.toLowerCase();
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, index); return; }
    diagnostics.push({
      kind: 'duplicate_header',
      column: index + 1,
      header,
      message:
        `Columns ${first + 1} and ${index + 1} are both headed "${header}". ` +
        'Rename one so each column can be mapped to its own field.',
    });
  });

  // ── Row shape ───────────────────────────────────────────────────────────
  // Padded to the header width so every consumer can index by column position
  // without a length check. A short row is reported and kept; a long row is
  // reported and its overflow is dropped, because there is no heading to map
  // it to and inventing one would fabricate a field.
  const width = headers.length;
  const rows: string[][] = dataRecords.map((record, i) => {
    if (record.length < width) {
      diagnostics.push({
        kind: 'short_row',
        row: i + 1,
        message: `Row ${i + 1} has ${record.length} of ${width} values. The missing ones are treated as empty.`,
      });
      return [...record, ...Array<string>(width - record.length).fill('')];
    }
    if (record.length > width) {
      diagnostics.push({
        kind: 'long_row',
        row: i + 1,
        message:
          `Row ${i + 1} has ${record.length} values but there are only ${width} headings. ` +
          `The last ${record.length - width} were dropped — check for an unquoted ${
            delimiter === '\t' ? 'tab' : `"${delimiter}"`
          } inside a value.`,
      });
      return record.slice(0, width);
    }
    return record;
  });

  return {
    headers,
    rows,
    delimiter,
    diagnostics,
    importable: rows.length > 0 && !diagnostics.some((d) => BLOCKING.has(d.kind)),
  };
}

/**
 * Column-wise sample values for the mapping engine.
 *
 * Takes the first non-empty values per column rather than the first N rows,
 * because a sparse column's evidence is in the rows that HAVE a value: five
 * blanks tell the scorer nothing, and would make an optional column look
 * type-incompatible with every destination.
 *
 * The values here are raw and MUST be passed through `redactSamples` before
 * they go anywhere near a model provider.
 */
export function columnSamples(
  result: Pick<CsvParseResult, 'headers' | 'rows'>,
  perColumn = 5,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  result.headers.forEach((header, index) => {
    if (header === '') return;
    const samples: string[] = [];
    for (const row of result.rows) {
      const value = (row[index] ?? '').trim();
      if (value === '') continue;
      samples.push(value);
      if (samples.length >= perColumn) break;
    }
    out[header] = samples;
  });
  return out;
}
