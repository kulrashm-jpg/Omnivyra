/**
 * What will go wrong, before the tenant commits to it.
 *
 * ─── ADVISORY, AND IT SAYS SO ─────────────────────────────────────────────
 * These counts come from `applyMapping` running in the browser. The server
 * validates independently and is the authority, so this panel promises a
 * forecast, not a guarantee, and the copy is written to match. The point is
 * that "412 of 5 000 rows have an unusable email address" is far more useful
 * BEFORE an import than 412 rejections afterwards.
 *
 * ─── A FAILURE KIND IS NEVER A FAILING VALUE ──────────────────────────────
 * Only rule names are shown — `email_shape`, `phone_digits`. Rendering the
 * offending values would put tenant data on screen (and into any screenshot)
 * for no diagnostic gain, which is the same reason the server's own
 * `FieldValidationSummary` carries a `failureKind` and not a sample.
 */

import React from 'react';
import { AlertTriangle, Ban, CheckCircle2, Info } from 'lucide-react';
import type { ColumnOutcome } from '@/lib/prospects/import/applyMapping';
import type { DegradedFieldView } from '@/lib/prospects/import/types';
import type { CsvDiagnostic } from '@/lib/leadIngestion/csvParser';

/** Plain language for the applier's rule names. */
const FAILURE_LABELS: Readonly<Record<string, string>> = {
  email_shape: 'not a usable email address',
  phone_digits: 'not enough digits for a phone number',
  not_an_integer: 'not a number',
  not_a_domain: 'not a website or domain',
  not_transformable: 'could not be read for this destination',
};

/** Plain language for the parser's diagnostics. */
const DIAGNOSTIC_LABELS: Readonly<Record<CsvDiagnostic['kind'], string>> = {
  short_row: 'rows had fewer columns than the header — the missing values are treated as empty',
  long_row: 'rows had extra columns beyond the header — the extras cannot be mapped',
  duplicate_header: 'two columns share a heading, so they cannot be told apart',
  empty_header: 'a column has no heading, so it cannot be mapped',
  unterminated_quote: 'a quoted value was never closed, so the rest of the file ran together',
  truncated: 'the file was larger than the limit and was read only up to it',
};

export default function ValidationSummary({
  columns,
  recordCount,
  emptyRows,
  diagnostics,
  degraded,
  metadataTruncated,
}: {
  columns: readonly ColumnOutcome[];
  recordCount: number;
  emptyRows: number;
  diagnostics: readonly CsvDiagnostic[];
  /** The engine's degraded entries — including an unavailable AI proposer. */
  degraded: readonly DegradedFieldView[];
  metadataTruncated: boolean;
}) {
  const withFailures = columns.filter((c) => c.failed > 0);
  const blocked = columns.filter((c) => c.blockedReason !== null);

  // A blocking diagnostic means the file cannot be imported at all; the parser
  // already decided which kinds those are, so this only groups them.
  const blockingKinds = new Set(['duplicate_header', 'empty_header', 'unterminated_quote']);
  const blocking = diagnostics.filter((d) => blockingKinds.has(d.kind));
  const advisory = diagnostics.filter((d) => !blockingKinds.has(d.kind));

  // The engine records ONE degraded entry for the whole call when the model
  // could not be reached. That is not a per-column problem and must not be
  // presented as one.
  const proposerUnavailable = degraded.some(
    (d) => d.sourceField === '*' || d.cause.startsWith('proposer_unavailable'),
  );
  const degradedColumns = degraded.filter(
    (d) => d.sourceField !== '*' && !d.cause.startsWith('proposer_unavailable'),
  );

  const clean =
    withFailures.length === 0 &&
    blocked.length === 0 &&
    blocking.length === 0 &&
    emptyRows === 0 &&
    advisory.length === 0 &&
    degradedColumns.length === 0;

  return (
    <div className="space-y-3">
      {clean ? (
        <p className="flex items-start gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            All {recordCount.toLocaleString()} record{recordCount === 1 ? '' : 's'} look importable.
            The server checks each one again as it imports.
          </span>
        </p>
      ) : null}

      {blocking.length > 0 ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <Ban className="h-4 w-4" aria-hidden="true" />
            This file cannot be imported as it is
          </p>
          <ul className="mt-2 space-y-1 text-sm text-rose-700">
            {blocking.map((d, i) => (
              <li key={`${d.kind}-${i}`}>
                {d.header ? <strong>{d.header}: </strong> : null}
                {DIAGNOSTIC_LABELS[d.kind]}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-rose-700">
            Fix the headings in your spreadsheet and upload it again — this is the one problem a
            mapping change cannot solve.
          </p>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">
            {blocked.length} column{blocked.length === 1 ? '' : 's'} cannot be imported
          </p>
          <ul className="mt-2 space-y-1 text-sm text-rose-700">
            {blocked.map((c) => (
              <li key={c.sourceField}>
                <strong>{c.sourceField}</strong>: {c.blockedReason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-rose-700">
            Choose another destination, or ignore the column to continue.
          </p>
        </div>
      ) : null}

      {withFailures.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Some values will not be imported
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {withFailures.map((c) => (
              <li key={c.sourceField}>
                <strong>{c.sourceField}</strong>: {c.failed.toLocaleString()} of{' '}
                {c.populated.toLocaleString()} value{c.populated === 1 ? '' : 's'}{' '}
                {FAILURE_LABELS[c.failureKind ?? ''] ?? c.failureKind}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            The rest of each row still imports. A row is only skipped when nothing in it could be
            used.
          </p>
        </div>
      ) : null}

      {emptyRows > 0 ? (
        <p className="flex items-start gap-2 text-sm text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span>
            {emptyRows.toLocaleString()} row{emptyRows === 1 ? '' : 's'} produced no usable field
            and will be skipped rather than sent.
          </span>
        </p>
      ) : null}

      {advisory.length > 0 ? (
        <details className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">
            {advisory.length} note{advisory.length === 1 ? '' : 's'} about the file itself
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-gray-600">
            {advisory.map((d, i) => (
              <li key={`${d.kind}-${i}`}>
                {d.row ? <strong>Row {d.row}: </strong> : null}
                {DIAGNOSTIC_LABELS[d.kind]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {proposerUnavailable ? (
        <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <span>
            These destinations were worked out from your column names and the shape of their values.
            AI assistance was unavailable for this file, so nothing here was AI-assisted.
          </span>
        </p>
      ) : null}

      {degradedColumns.length > 0 ? (
        <p className="text-xs text-gray-500">
          {degradedColumns.length} column{degradedColumns.length === 1 ? '' : 's'} could not be
          analysed fully ({degradedColumns.map((d) => d.sourceField).join(', ')}). You can still set
          their destinations yourself.
        </p>
      ) : null}

      {metadataTruncated ? (
        <p className="text-xs text-amber-700">
          Some notes were too long to keep and were left out. Notes are a short summary field, not a
          place for full text.
        </p>
      ) : null}
    </div>
  );
}
