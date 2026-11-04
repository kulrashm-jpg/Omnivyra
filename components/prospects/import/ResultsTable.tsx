/**
 * Step 4 — what actually happened, per record.
 *
 * ─── A SUCCEEDED RECORD IS NOT NECESSARILY A VISIBLE ONE ──────────────────
 * `leadProjection` is fail-open in the orchestrator: the prospect, person,
 * employer and evidence are all durable before the projection runs, so a
 * projection failure must not discard good intake. The consequence is a state
 * that would otherwise be invisible and infuriating — an import that reports
 * success while the Lead Database shows nothing. The contract reports it, so
 * this screen reports it too, as its own callout rather than buried in a row.
 *
 * ─── DUPLICATES ARE REPORTED HERE, AS PROMISED ────────────────────────────
 * This is the "after" half of the confirmation step's honesty: the parked and
 * already-open counts come straight from the outcomes. Nothing is merged.
 *
 * ─── RETRY NEEDS NO RE-UPLOAD ─────────────────────────────────────────────
 * The records are still in the wizard's memory. Retry rebuilds a batch from
 * the ones that did not land and submits under a NEW run id, because a retry
 * is a new decision by the operator and should be auditable as one.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  EyeOff,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { REJECTION_LABELS, type ImportOutcome } from '@/lib/prospects/import/types';
import { needsAttention } from '@/lib/leadIntelligence/projectionResult';

const PAGE_SIZE = 25;

export default function ResultsTable({
  outcomes,
  succeeded,
  failed,
  retryableCount,
  retrying,
  transportError,
  aborted,
  profileSaveNote,
  onRetry,
  onStartOver,
}: {
  outcomes: readonly ImportOutcome[];
  succeeded: number;
  failed: number;
  retryableCount: number;
  retrying: boolean;
  transportError: string | null;
  aborted: boolean;
  /** e.g. "Saving this mapping for reuse is not available yet." */
  profileSaveNote: string | null;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  const [showOnlyFailed, setShowOnlyFailed] = useState(failed > 0);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const duplicates = useMemo(
    () =>
      outcomes.reduce(
        (acc, o) => ({
          parked: acc.parked + (o.duplicatesParked ?? 0),
          open: acc.open + (o.duplicatesAlreadyOpen ?? 0),
        }),
        { parked: 0, open: 0 },
      ),
    [outcomes],
  );

  // The fail-open projection gap: imported, but not in the Lead Database.
  // `needsAttention` is the shared predicate, so the screen and the server
  // cannot drift apart on what counts as a gap — and a legitimate skip is
  // excluded there, not here.
  const notProjected = useMemo(
    () => outcomes.filter((o) => o.ok && o.leadProjection !== undefined && needsAttention(o.leadProjection)),
    [outcomes],
  );

  // Operators need to know WHICH failure this was: an unapplied migration is a
  // deploy problem that retrying cannot fix, where a refused payload is a row
  // to correct. Collapsing them into one amber banner is what made the old
  // message ("retrying will list them") wrong for half the cases it covered.
  const projectionReasons = useMemo(() => {
    const groups = new Map<string, number>();
    for (const o of notProjected) {
      const reason = o.leadProjection?.reason ?? 'write_failed';
      groups.set(reason, (groups.get(reason) ?? 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]);
  }, [notProjected]);

  const byRejection = useMemo(() => {
    const groups = new Map<string, number>();
    for (const o of outcomes) {
      if (o.ok) continue;
      const key = o.rejection ?? 'unknown';
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]);
  }, [outcomes]);

  const visible = useMemo(() => {
    const filtered = showOnlyFailed ? outcomes.filter((o) => !o.ok) : outcomes;
    return filtered.slice(0, limit);
  }, [outcomes, showOnlyFailed, limit]);

  const totalFiltered = showOnlyFailed ? outcomes.filter((o) => !o.ok).length : outcomes.length;

  return (
    <section className="space-y-6">
      {/* Headline counts. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">
          {failed === 0 && notProjected.length === 0 && !transportError && !aborted
            ? 'Import complete'
            : 'Import finished with problems'}
        </h2>

        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Imported
            </dt>
            <dd className="mt-1 text-2xl font-bold text-emerald-800">
              {succeeded.toLocaleString()}
            </dd>
          </div>
          <div className={`rounded-xl p-4 ${failed > 0 ? 'bg-rose-50' : 'bg-gray-50'}`}>
            <dt
              className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${
                failed > 0 ? 'text-rose-700' : 'text-gray-500'
              }`}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Failed
            </dt>
            <dd
              className={`mt-1 text-2xl font-bold ${failed > 0 ? 'text-rose-800' : 'text-gray-900'}`}
            >
              {failed.toLocaleString()}
            </dd>
          </div>
          <div className={`rounded-xl p-4 ${duplicates.parked > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
            <dt
              className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${
                duplicates.parked > 0 ? 'text-amber-700' : 'text-gray-500'
              }`}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Possible duplicates
            </dt>
            <dd
              className={`mt-1 text-2xl font-bold ${
                duplicates.parked > 0 ? 'text-amber-800' : 'text-gray-900'
              }`}
            >
              {duplicates.parked.toLocaleString()}
            </dd>
          </div>
        </dl>

        {duplicates.parked > 0 || duplicates.open > 0 ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
            {duplicates.parked.toLocaleString()} possible duplicate
            {duplicates.parked === 1 ? '' : 's'} were found and parked for review — nothing was
            merged automatically.
            {duplicates.open > 0
              ? ` ${duplicates.open.toLocaleString()} were already waiting for review from a previous import.`
              : ''}
          </p>
        ) : null}

        {aborted ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-700">
            You stopped this import. The records above are imported and stay imported; the rest were
            not sent and can be retried.
          </p>
        ) : null}

        {transportError ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800"
          >
            {transportError} Records already imported are unaffected — retry sends only the
            remainder.
          </p>
        ) : null}

        {profileSaveNote ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
            {profileSaveNote}
          </p>
        ) : null}

        {/* The fail-open projection gap gets its own callout. */}
        {notProjected.length > 0 ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              {notProjected.length.toLocaleString()} imported record
              {notProjected.length === 1 ? '' : 's'} will be missing details in your Lead Database
            </p>
            <p className="mt-1 text-xs text-amber-800">
              The prospect, person and employer were all saved, so nothing was lost. The step that
              records their name and job title for the Lead Database did not complete, so those rows
              will list without a name and cannot be found by searching for one.
            </p>
            {projectionReasons.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                {projectionReasons.map(([reason, count]) => (
                  <li key={reason}>
                    {count.toLocaleString()} ×{' '}
                    {reason === 'schema_not_applied'
                      ? 'the Lead Database is missing a column this release adds — retrying will not help until it is applied'
                      : reason === 'denied'
                        ? 'the database refused the write for this account'
                        : reason === 'invalid'
                          ? 'the record was rejected by a database rule'
                          : reason === 'no_row_returned'
                            ? 'the write was accepted but not confirmed — these may already be listed'
                            : reason === 'unconfirmed_transport'
                              ? 'the connection broke after the write was sent — these may already be listed'
                              : reason === 'not_transmitted'
                                ? 'the Lead Database could not be reached at all, so nothing was written — retrying is safe'
                                : reason === 'not_reached_database'
                                  ? 'the Lead Database refused a connection, so nothing was written — retrying is safe'
                                  : 'the write failed'}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-amber-800">
              Retrying these rows is safe — a row that did land is updated, not duplicated.
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {retryableCount > 0 ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <RotateCcw
                className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {retrying
                ? 'Retrying…'
                : `Retry ${retryableCount.toLocaleString()} record${retryableCount === 1 ? '' : 's'}`}
            </button>
          ) : null}

          <Link
            href="/lead-intelligence?tab=leads"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            View your Lead Database
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          <Link
            href="/prospects"
            className="text-sm font-medium text-purple-600 hover:underline"
          >
            All prospects
          </Link>

          <button
            type="button"
            onClick={onStartOver}
            className="text-sm font-medium text-gray-500 hover:underline"
          >
            Import another file
          </button>
        </div>

        {retryableCount > 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            Retrying is safe: each row keeps the same identity, so a row that did import is updated
            rather than duplicated.
          </p>
        ) : null}
      </div>

      {/* Why things failed. */}
      {byRejection.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
            Why records failed
          </h3>
          <ul className="mt-3 space-y-1 text-sm text-gray-700">
            {byRejection.map(([rejection, count]) => (
              <li key={rejection}>
                <strong>{count.toLocaleString()}</strong> ·{' '}
                {REJECTION_LABELS[rejection] ?? 'The reason was not recognised.'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Per-record detail. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-900">Record detail</h3>
          {failed > 0 ? (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showOnlyFailed}
                onChange={(e) => {
                  setShowOnlyFailed(e.target.checked);
                  setLimit(PAGE_SIZE);
                }}
              />
              Show only failures
            </label>
          ) : null}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Row reference
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Result
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((outcome, index) => (
                <tr key={`${outcome.externalId ?? 'row'}-${index}`} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4">
                    {outcome.externalId ? (
                      <span className="font-mono text-xs text-gray-600">{outcome.externalId}</span>
                    ) : (
                      <span className="text-xs text-gray-400">No reference in this row</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {outcome.ok ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Imported
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-xs text-gray-600">
                    {outcome.ok ? (
                      <>
                        {outcome.prospectId ? (
                          <Link
                            href={`/prospects/${encodeURIComponent(outcome.prospectId)}`}
                            className="font-medium text-purple-600 hover:underline"
                          >
                            Open prospect
                          </Link>
                        ) : (
                          <span className="text-gray-400">
                            Imported without a prospect record — the row had no reference to
                            identify it by.
                          </span>
                        )}
                        {outcome.leadProjection && needsAttention(outcome.leadProjection) ? (
                          <span className="ml-2 text-amber-700">
                            {outcome.leadProjection.status === 'pending_reconciliation'
                              ? 'Listing unconfirmed'
                              : 'Not listed'}
                          </span>
                        ) : null}
                        {outcome.duplicatesParked ? (
                          <span className="ml-2 text-amber-700">
                            {outcome.duplicatesParked} possible duplicate
                            {outcome.duplicatesParked === 1 ? '' : 's'} parked
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="text-rose-700">
                          {REJECTION_LABELS[outcome.rejection ?? ''] ??
                            'The reason was not recognised.'}
                        </span>
                        {outcome.error ? (
                          <span className="ml-1 text-gray-500">{outcome.error}</span>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length < totalFiltered ? (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
            className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Show more ({(totalFiltered - visible.length).toLocaleString()} remaining)
          </button>
        ) : null}

        {totalFiltered === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No records to show. The import did not reach the server, so nothing was attempted.
          </p>
        ) : null}
      </div>
    </section>
  );
}
