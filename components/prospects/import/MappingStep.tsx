/**
 * Step 2 — review, question, correct.
 *
 * ─── THE ACCEPTANCE PROPERTY LIVES HERE ───────────────────────────────────
 * Every control on this screen mutates `decisions`, which is plain React state
 * in the wizard above. The parsed rows are retained separately, so a
 * correction triggers a recomputation of the preview and the validation
 * forecast and NOTHING ELSE. There is no code path from this component back to
 * the file input, and no request is made when a destination changes.
 *
 * Re-asking the server is a SEPARATE, explicit action ("Re-check with the
 * answers above"), offered only because answering an ambiguity can legitimately
 * change what the engine would propose for OTHER columns — a competing-fields
 * question being the obvious case. It re-posts the same headings and the same
 * retained samples. It still does not touch the file.
 *
 * ─── IT NEVER CLAIMS AI IT DID NOT USE ────────────────────────────────────
 * The header badge is driven by `aiAssisted` from the proposal response, which
 * is false whenever the gateway was unreachable. The engine degrades silently
 * and completes deterministically by design, so "AI-assisted" has to be
 * reported from evidence rather than assumed from the fact that we asked.
 */

import React, { useMemo } from 'react';
import { RefreshCw, Sparkles, Terminal } from 'lucide-react';
import type { ColumnOutcome } from '@/lib/prospects/import/applyMapping';
import type {
  AllowedTargetView,
  FieldMappingProposalView,
  MappingProposalResponse,
} from '@/lib/prospects/import/types';
import type { CsvDiagnostic } from '@/lib/leadIngestion/csvParser';
import AmbiguityQuestionCard from './AmbiguityQuestionCard';
import MappingPreviewTable from './MappingPreviewTable';
import MappingRow from './MappingRow';
import ValidationSummary from './ValidationSummary';

/** The tenant's effective decision for one column. */
export interface Decision {
  target: string | null;
  /** True once the tenant has touched this column, so "unanswered" is knowable. */
  answered: boolean;
  keepAsNote: boolean;
}

export default function MappingStep({
  proposal,
  decisions,
  samples,
  columnOutcomes,
  previewRecords,
  recordCount,
  emptyRows,
  diagnostics,
  metadataTruncated,
  blockedByColumn,
  unansweredCount,
  canContinue,
  reproposing,
  onDecision,
  onKeepAsNote,
  onRepropose,
  onBack,
  onContinue,
}: {
  proposal: MappingProposalResponse;
  decisions: Readonly<Record<string, Decision>>;
  samples: Readonly<Record<string, string[]>>;
  columnOutcomes: readonly ColumnOutcome[];
  previewRecords: ReadonlyArray<Record<string, unknown>>;
  recordCount: number;
  emptyRows: number;
  diagnostics: readonly CsvDiagnostic[];
  metadataTruncated: boolean;
  blockedByColumn: Readonly<Record<string, string>>;
  unansweredCount: number;
  canContinue: boolean;
  reproposing: boolean;
  onDecision: (sourceField: string, target: string | null) => void;
  onKeepAsNote: (sourceField: string, keep: boolean) => void;
  onRepropose: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const needsReview = useMemo(
    () => proposal.proposals.filter((p) => p.ambiguity !== null),
    [proposal.proposals],
  );

  const mappedCount = Object.values(decisions).filter((d) => d.target !== null).length;
  const targetsByKey = useMemo(() => {
    const map = new Map<string, AllowedTargetView>();
    for (const t of proposal.allowedTargets) map.set(t.key, t);
    return map;
  }, [proposal.allowedTargets]);

  // Two columns pointing at one destination is not refused — the orchestrator
  // takes the record as given — but it is almost always a mistake, and it is
  // cheap to say so here rather than let one column silently win.
  const collisions = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const [sourceField, decision] of Object.entries(decisions)) {
      if (decision.target === null) continue;
      counts.set(decision.target, [...(counts.get(decision.target) ?? []), sourceField]);
    }
    return [...counts.entries()].filter(([, fields]) => fields.length > 1);
  }, [decisions]);

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Check the destinations</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {mappedCount} of {proposal.proposals.length} columns will be imported. Change any
              destination below — the preview updates immediately and your file does not need to be
              uploaded again.
            </p>
          </div>

          {proposal.aiAssisted ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              AI-assisted mapping
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600"
              title="The AI mapping service was not reached for this file, so these suggestions come from column names and value shapes alone."
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              Mapped from column names only
            </span>
          )}
        </div>

        {/* Saved-mapping state. `null` is the honest answer today: the profile
            store is not delivered, so nothing was consulted and nothing is
            claimed. */}
        {proposal.profile === null ? (
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-2 text-xs text-gray-600">
            No saved mapping was used. Saving a mapping for reuse is not available yet, so you will
            be asked to confirm these destinations each time for now.
          </p>
        ) : proposal.profile.state === 'drifted' ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Your saved mapping (version {proposal.profile.version}) was not applied because this
            file&apos;s columns have changed.
            {proposal.profile.addedHeaders.length > 0
              ? ` New: ${proposal.profile.addedHeaders.join(', ')}.`
              : ''}
            {proposal.profile.removedHeaders.length > 0
              ? ` Missing: ${proposal.profile.removedHeaders.join(', ')}.`
              : ''}
          </p>
        ) : proposal.profile.state === 'applied' ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
            Reusing the mapping you approved for this file layout (version {proposal.profile.version}
            ).
          </p>
        ) : null}
      </div>

      {/* Questions the engine refused to guess. */}
      {needsReview.length > 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">
            {needsReview.length} question{needsReview.length === 1 ? '' : 's'} for you
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            These columns could mean more than one thing. We would rather ask than guess.
          </p>
          <div className="mt-4 space-y-3">
            {needsReview.map((p: FieldMappingProposalView) => {
              const decision = decisions[p.sourceField];
              return (
                <div key={p.sourceField}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {p.sourceField}
                  </p>
                  <AmbiguityQuestionCard
                    question={p.ambiguity!}
                    selected={decision?.answered ? decision.target : undefined}
                    onAnswer={(target) => onDecision(p.sourceField, target)}
                  />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onRepropose}
            disabled={reproposing}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${reproposing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {reproposing ? 'Re-checking…' : 'Re-check the other columns with these answers'}
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Optional. Your file is not uploaded again — only the column names and a few sample
            values are sent.
          </p>
        </div>
      ) : null}

      {/* Every column, correctable. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">All columns</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Column in your file
                </th>
                <th scope="col" className="w-64 py-2 pr-4 font-medium">
                  Destination
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  How we decided
                </th>
              </tr>
            </thead>
            <tbody>
              {proposal.proposals.map((p) => {
                const decision = decisions[p.sourceField];
                return (
                  <MappingRow
                    key={p.sourceField}
                    proposal={p}
                    allowedTargets={proposal.allowedTargets}
                    selected={decision?.target ?? null}
                    samples={samples[p.sourceField] ?? []}
                    blockedReason={blockedByColumn[p.sourceField] ?? null}
                    keepAsNote={decision?.keepAsNote ?? false}
                    onChange={(target) => onDecision(p.sourceField, target)}
                    onKeepAsNoteChange={(keep) => onKeepAsNote(p.sourceField, keep)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {collisions.length > 0 ? (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
            {collisions.map(([target, fields]) => (
              <p key={target}>
                <strong>{fields.join(' and ')}</strong> both point at{' '}
                {targetsByKey.get(target)?.label ?? target}. Only one value per row can be stored
                there — ignore one, or pick a different destination.
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* Forecast. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">What will happen</h3>
        <div className="mt-3">
          <ValidationSummary
            columns={columnOutcomes}
            recordCount={recordCount}
            emptyRows={emptyRows}
            diagnostics={diagnostics}
            degraded={proposal.degraded}
            metadataTruncated={metadataTruncated}
          />
        </div>
      </div>

      {/* Preview. */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">Preview</h3>
        <div className="mt-3">
          <MappingPreviewTable
            records={previewRecords}
            allowedTargets={proposal.allowedTargets}
            totalRecords={recordCount}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          ← Choose a different file
        </button>

        <div className="flex items-center gap-3">
          {unansweredCount > 0 ? (
            <span className="text-xs font-medium text-amber-700">
              {unansweredCount} question{unansweredCount === 1 ? '' : 's'} still to answer
            </span>
          ) : null}
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Continue
          </button>
        </div>
      </div>
    </section>
  );
}
