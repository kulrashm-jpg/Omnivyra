/**
 * Step 1 — choose a file and parse it in the browser.
 *
 * ─── THE FILE NEVER LEAVES THE TAB ────────────────────────────────────────
 * By the approved design (`pages/api/lead-ingestion/csv.ts`) there is no
 * upload endpoint, no multipart handler and no storage bucket on this path.
 * This component reads the text with `file.text()` and hands the parse result
 * to the wizard, which retains it. That retention is what makes every later
 * correction free of a re-upload.
 *
 * ─── IT TELLS THE TRUTH ABOUT WHAT IT CANNOT DO ───────────────────────────
 * The parser is RFC 4180 for delimited text and has no spreadsheet support, so
 * `.xlsx` is refused with an explanation rather than accepted and failed
 * confusingly later. Its row and byte caps are stated up front for the same
 * reason: a truncation a tenant was warned about is very different from one
 * they discover in a record count.
 */

import React, { useCallback, useRef, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import {
  columnSamples,
  parseDelimitedText,
  type CsvParseResult,
} from '@/lib/leadIngestion/csvParser';

/** Mirrors the parser's own defaults so the copy cannot drift from behaviour. */
const MAX_ROWS = 50_000;
const MAX_BYTES = 20_000_000;

const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt'];

export interface ParsedFile {
  fileName: string;
  parsed: CsvParseResult;
  samples: Record<string, string[]>;
}

/** A spreadsheet the parser genuinely cannot read, named so the user knows why. */
function spreadsheetRefusal(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
    return 'Excel workbooks are not supported yet. In Excel choose File → Save As → CSV, then upload that file.';
  }
  if (lower.endsWith('.json')) {
    return 'JSON files are not supported. This importer reads delimited text (CSV, TSV).';
  }
  return null;
}

export default function FileDropStep({
  onParsed,
  disabled,
}: {
  onParsed: (result: ParsedFile) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      const refusal = spreadsheetRefusal(file.name);
      if (refusal) {
        setError(refusal);
        return;
      }

      setParsing(true);
      try {
        const text = await file.text();
        const parsed = parseDelimitedText(text, { maxRows: MAX_ROWS, maxBytes: MAX_BYTES });

        if (parsed.headers.length === 0) {
          setError('That file has no header row, so there are no columns to map.');
          return;
        }

        onParsed({
          fileName: file.name,
          parsed,
          // Computed once here and recomputed from retained rows on any
          // re-proposal — never re-read from the file.
          samples: columnSamples(parsed),
        });
      } catch {
        // A read failure is the browser's, not the server's. Say so plainly
        // rather than reporting a network error that did not happen.
        setError('That file could not be read. If it is open in another program, close it and try again.');
      } finally {
        setParsing(false);
      }
    },
    [onParsed],
  );

  const busy = Boolean(disabled) || parsing;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Choose a file</h2>
      <p className="mt-1 text-sm text-gray-600">
        A CSV or tab-separated export from your CRM, sales tool or spreadsheet. The file is read in
        your browser and never uploaded — only the records you confirm are sent.
      </p>

      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label="Choose a file to import"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (busy) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          busy
            ? 'cursor-not-allowed border-gray-200 bg-gray-50'
            : dragging
              ? 'cursor-pointer border-purple-400 bg-purple-50'
              : 'cursor-pointer border-gray-300 bg-gray-50 hover:border-purple-300 hover:bg-purple-50/40'
        }`}
      >
        {parsing ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-gray-700">Reading your file…</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-purple-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-gray-800">
              Drop a file here, or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {ACCEPTED_EXTENSIONS.join(', ')} · up to {MAX_ROWS.toLocaleString()} rows
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so choosing the same file twice still fires a change.
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-rose-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="mt-5 flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
        <p className="text-xs text-gray-500">
          Excel workbooks (.xlsx) are not supported yet — save as CSV first. Very large files are
          read up to {MAX_ROWS.toLocaleString()} rows or{' '}
          {Math.round(MAX_BYTES / 1_000_000)} MB, and you will be told if anything was left out.
        </p>
      </div>
    </section>
  );
}
