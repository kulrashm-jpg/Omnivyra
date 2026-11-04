/**
 * What the first few rows will look like AFTER the mapping is applied.
 *
 * ─── IT SHOWS THE RESULT, NOT THE FILE ────────────────────────────────────
 * A preview of the raw file tells a tenant nothing they did not already know.
 * The useful question is "what will actually be stored", so these are the
 * transformed values from `applyMapping` — the lower-cased email, the digits-
 * only phone, the domain extracted from a URL — under their destination
 * labels. If a transformation is wrong, this is where it becomes obvious, and
 * correcting it is a dropdown change away.
 *
 * Ignored columns are absent by construction: they produce no field, so there
 * is nothing to show. That is the honest rendering of "ignored".
 */

import React from 'react';
import type { AllowedTargetView } from '@/lib/prospects/import/types';

const PREVIEW_ROWS = 5;

export default function MappingPreviewTable({
  records,
  allowedTargets,
  totalRecords,
}: {
  /** The output of `applyMapping`, already transformed. */
  records: ReadonlyArray<Record<string, unknown>>;
  allowedTargets: readonly AllowedTargetView[];
  totalRecords: number;
}) {
  const rows = records.slice(0, PREVIEW_ROWS);

  // Columns are the destinations actually populated in the preview window,
  // ordered as the registry orders them so person fields lead.
  const populated = new Set<string>();
  for (const record of rows) {
    for (const key of Object.keys(record)) {
      if (key !== 'metadata') populated.add(key);
    }
  }
  const columns = allowedTargets.filter((t) => populated.has(t.key));
  const hasNotes = rows.some((r) => r.metadata != null);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center">
        <p className="text-sm font-medium text-gray-900">Nothing to preview yet</p>
        <p className="mt-1 text-sm text-gray-500">
          Once at least one column has a destination, the first rows will appear here as they will
          be stored.
        </p>
      </div>
    );
  }

  const cell = (value: unknown): React.ReactNode => {
    if (value === undefined || value === null || value === '') {
      return <span className="text-gray-300">—</span>;
    }
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="py-2 pr-4 font-medium">
                  {column.label}
                  <span className="ml-1 font-normal normal-case text-gray-400">
                    {column.entity === 'company' ? '(employer)' : '(person)'}
                  </span>
                </th>
              ))}
              {hasNotes ? (
                <th scope="col" className="py-2 pr-4 font-medium">
                  Notes
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((record, index) => (
              // Index is a stable key here: these are positional previews of
              // an immutable array, not reorderable entities.
              <tr key={index} className="border-b border-gray-100 last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className="max-w-[16rem] truncate py-2 pr-4 text-gray-700">
                    {cell(record[column.key])}
                  </td>
                ))}
                {hasNotes ? (
                  <td className="max-w-[16rem] truncate py-2 pr-4 text-xs text-gray-500">
                    {record.metadata
                      ? Object.entries(record.metadata as Record<string, string>)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')
                      : <span className="text-gray-300">—</span>}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Showing the first {rows.length} of {totalRecords.toLocaleString()} record
        {totalRecords === 1 ? '' : 's'} as they will be stored, after any cleanup such as
        lower-casing an email or reducing a phone number to digits.
      </p>
    </div>
  );
}
