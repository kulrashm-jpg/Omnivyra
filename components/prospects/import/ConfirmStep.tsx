/**
 * Step 3 — confirm, then watch it run.
 *
 * ─── IT SAYS WHAT IT DOES NOT KNOW ────────────────────────────────────────
 * Two honesty obligations are discharged here.
 *
 * Duplicates: there is no pre-import duplicate check in this platform, and
 * inventing a "0 duplicates found" line would be a fabricated capability. So
 * the panel states plainly that duplicates are reported AFTER the import, from
 * the per-record `duplicatesParked` / `duplicatesAlreadyOpen` counts the
 * ingestion contract returns. The honest sentence is cheaper than the
 * convincing one is expensive.
 *
 * Saved mappings: the "remember this" control is offered because it is the
 * tenant's intent, and its failure is reported as "not available yet" rather
 * than as an import failure — because the import is genuinely unaffected.
 *
 * ─── PROGRESS IS THE SHARED PRIMITIVE ─────────────────────────────────────
 * `StepTracker` is the repository's component for any flow over ~5s, driven
 * here in backend-driven mode from the client's own chunk counter. A second
 * progress bar would have been a duplicate of a component that already exists.
 */

import React from 'react';
import { Info, Layers, ShieldCheck, Users } from 'lucide-react';
import StepTracker, { type StepDef } from '@/components/progress/StepTracker';
import type { SubmitProgress } from '@/lib/prospects/import/submitChunks';
import type { AllowedTargetView } from '@/lib/prospects/import/types';

export default function ConfirmStep({
  recordCount,
  mappedTargets,
  allowedTargets,
  notedFields,
  fileName,
  running,
  progress,
  startedAt,
  error,
  rememberMapping,
  onRememberMappingChange,
  onBack,
  onImport,
  onCancel,
}: {
  recordCount: number;
  mappedTargets: readonly string[];
  allowedTargets: readonly AllowedTargetView[];
  notedFields: readonly string[];
  fileName: string;
  running: boolean;
  progress: SubmitProgress | null;
  startedAt: number | null;
  error: string | null;
  rememberMapping: boolean;
  onRememberMappingChange: (remember: boolean) => void;
  onBack: () => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const labelFor = (key: string) =>
    allowedTargets.find((t) => t.key === key)?.label ?? key;

  // Stages describe what the ORCHESTRATOR actually does per record, in the
  // order the contract does it, so the tracker is not a decorative animation.
  const stages: StepDef[] = [
    { key: 'submit', label: `Sending ${recordCount.toLocaleString()} records` },
    { key: 'identity', label: 'Identifying people and employers' },
    { key: 'project', label: 'Adding them to your Lead Database' },
  ];

  const percentage =
    progress && progress.recordsTotal > 0
      ? Math.round((progress.recordsSent / progress.recordsTotal) * 100)
      : 0;

  const stageKey = !progress || progress.recordsSent === 0
    ? 'submit'
    : progress.recordsSent < progress.recordsTotal
      ? 'identity'
      : 'project';

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Ready to import</h2>
        <p className="mt-1 text-sm text-gray-600">
          From <span className="font-medium text-gray-900">{fileName}</span>.
        </p>

        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-gray-50 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Records
            </dt>
            <dd className="mt-1 text-2xl font-bold text-gray-900">
              {recordCount.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              Fields
            </dt>
            <dd className="mt-1 text-2xl font-bold text-gray-900">{mappedTargets.length}</dd>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Destination
            </dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">Lead Database</dd>
          </div>
        </dl>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            What will be stored
          </p>
          <p className="mt-1 text-sm text-gray-700">
            {mappedTargets.map(labelFor).join(', ')}
          </p>
          {notedFields.length > 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              Kept as notes: {notedFields.join(', ')}
            </p>
          ) : null}
        </div>

        {/* The duplicate honesty paragraph. Do not soften this into a claim. */}
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          <p className="text-xs text-gray-600">
            Duplicates are not checked before importing. Each record is matched as it is imported,
            and any duplicates found are reported in the results and parked for review — never
            merged automatically. Importing the same file twice does not create duplicate prospects:
            each row keeps the same identity, so a repeat import updates rather than duplicates.
          </p>
        </div>

        {!running ? (
          <label className="mt-5 flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={rememberMapping}
              onChange={(e) => onRememberMappingChange(e.target.checked)}
            />
            <span>
              Remember this mapping for files with the same columns
              <span className="mt-0.5 block text-xs text-gray-500">
                The next file with the same columns will reuse it. If saving fails, your import
                still goes ahead exactly as shown above.
              </span>
            </span>
          </label>
        ) : null}
      </div>

      {running || progress ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <StepTracker
            stages={stages}
            startedAt={startedAt ?? Date.now()}
            currentStageKey={stageKey}
            progressPercentage={percentage}
            status={error ? 'failed' : running ? 'running' : 'completed'}
            errorMessage={error ?? undefined}
            title="Importing prospects"
            subLabel={
              progress
                ? `${progress.recordsSent.toLocaleString()} of ${progress.recordsTotal.toLocaleString()} sent · ${progress.succeeded.toLocaleString()} imported${
                    progress.failed > 0 ? ` · ${progress.failed.toLocaleString()} failed` : ''
                  }`
                : undefined
            }
            accent="violet"
            variant="card"
          />
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Stop after the current batch
            </button>
          ) : null}
          {running ? (
            <p className="mt-2 text-xs text-gray-500">
              Records already imported stay imported — stopping does not undo them.
            </p>
          ) : null}
        </div>
      ) : null}

      {error && !running ? (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      ) : null}

      {!running ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            ← Change the mapping
          </button>
          <button
            type="button"
            onClick={onImport}
            disabled={recordCount === 0}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Import {recordCount.toLocaleString()} record{recordCount === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
