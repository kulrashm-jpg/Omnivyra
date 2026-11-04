/**
 * The import wizard — owner of the retained parse.
 *
 * ─── THE ONE DESIGN DECISION THAT MATTERS ─────────────────────────────────
 * `parsedRef` holds the parse result for the whole session. It is a `useRef`,
 * not state, for two reasons: a 50 000-row array has no business participating
 * in reconciliation, and nothing should be able to re-render the wizard by
 * replacing it.
 *
 * Everything downstream is derived from that ref plus `decisions`, which is
 * ordinary state. So changing a destination recomputes the records, the
 * preview and the validation forecast — and touches nothing else. There is no
 * code path from a mapping correction back to the file input, and no request
 * is made. That is the acceptance property: a tenant can correct an ambiguous
 * field, repeatedly, and go back and forth between the mapping and the
 * confirmation screens, without re-uploading.
 *
 * The file object itself is deliberately NOT retained. Once parsed it is of no
 * further use, and keeping it would invite exactly the re-read this design
 * exists to avoid.
 *
 * ─── IT NEVER INVENTS A TENANT ────────────────────────────────────────────
 * `companyId` is passed in from `CompanyContext` by the page and forwarded
 * explicitly, exactly as the prospect list and detail panel do. It is not
 * authorization — every route re-validates it against live membership.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { AlertCircle } from 'lucide-react';
import type { CsvParseResult } from '@/lib/leadIngestion/csvParser';
import { columnSamples } from '@/lib/leadIngestion/csvParser';
import {
  applyMapping,
  type ResolvedColumn,
  type TransformationName,
  type CanonicalDataType,
} from '@/lib/prospects/import/applyMapping';
import { recordsForRetry, submitChunks, type SubmitProgress } from '@/lib/prospects/import/submitChunks';
import type { ImportOutcome, MappingProposalResponse } from '@/lib/prospects/import/types';
import { invalidateLeadIntelligenceReads } from '@/components/lead-intelligence/leadIntelligenceClient';
import {
  approveMappingProfile,
  ImportApiError,
  mappingApprovalKey,
  newRunId,
  requestMappingProposal,
} from './importClient';
import ConfirmStep from './ConfirmStep';
import FileDropStep, { type ParsedFile } from './FileDropStep';
import MappingStep, { type Decision } from './MappingStep';
import ResultsTable from './ResultsTable';

const SOURCE = 'csv';

type Phase = 'choose' | 'map' | 'confirm' | 'results';

export default function ImportWizard({ companyId }: { companyId: string }) {
  const { mutate } = useSWRConfig();

  /** The retained parse. The reason a correction costs nothing. */
  const parsedRef = useRef<CsvParseResult | null>(null);
  /** The records most recently submitted, kept so a retry needs no re-upload. */
  const submittedRef = useRef<Array<Record<string, unknown>>>([]);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>('choose');
  const [fileName, setFileName] = useState('');
  const [samples, setSamples] = useState<Record<string, string[]>>({});
  const [proposal, setProposal] = useState<MappingProposalResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [proposing, setProposing] = useState(false);
  const [reproposing, setReproposing] = useState(false);
  const [gateClosed, setGateClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rememberMapping, setRememberMapping] = useState(false);
  const [profileSaveNote, setProfileSaveNote] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState<SubmitProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [aborted, setAborted] = useState(false);

  /** Seeds one decision per column from the engine's verdict. */
  const seedDecisions = useCallback((response: MappingProposalResponse): Record<string, Decision> => {
    const seeded: Record<string, Decision> = {};
    for (const p of response.proposals) {
      // A column the engine will not decide starts UNANSWERED and ignored, so
      // nothing is silently applied on the tenant's behalf. A confident
      // suggestion is pre-selected but still fully editable.
      const autoApplied =
        p.status === 'approved_profile_match' || p.status === 'high_confidence_suggestion';
      seeded[p.sourceField] = {
        target: autoApplied && p.candidate ? p.candidate.target : null,
        answered: autoApplied,
        keepAsNote: false,
      };
    }
    return seeded;
  }, []);

  const propose = useCallback(
    async (headers: readonly string[], columnSamplesForCall: Record<string, string[]>, isRepropose: boolean) => {
      const setBusy = isRepropose ? setReproposing : setProposing;
      setBusy(true);
      setError(null);
      try {
        const response = await requestMappingProposal({
          companyId,
          source: SOURCE,
          headers,
          samples: columnSamplesForCall,
        });
        setProposal(response);
        setDecisions((previous) => {
          const seeded = seedDecisions(response);
          if (!isRepropose) return seeded;
          // A re-check must never discard an answer the tenant already gave —
          // that is the whole point of asking. Their decisions win.
          for (const [field, decision] of Object.entries(previous)) {
            if (decision.answered && seeded[field]) seeded[field] = decision;
          }
          return seeded;
        });
        setPhase('map');
      } catch (e) {
        if (e instanceof ImportApiError && e.isGateClosed) {
          setGateClosed(true);
          return;
        }
        setError(
          e instanceof Error
            ? e.message
            : 'The column mapping could not be worked out. Nothing has been imported.',
        );
      } finally {
        setBusy(false);
      }
    },
    [companyId, seedDecisions],
  );

  const handleParsed = useCallback(
    (result: ParsedFile) => {
      parsedRef.current = result.parsed;
      setFileName(result.fileName);
      setSamples(result.samples);
      setOutcomes([]);
      setTransportError(null);
      setAborted(false);
      setProfileSaveNote(null);
      void propose(result.parsed.headers, result.samples, false);
    },
    [propose],
  );

  /** Re-ask the server. Recomputes samples FROM THE RETAINED ROWS, never the file. */
  const handleRepropose = useCallback(() => {
    const parsed = parsedRef.current;
    if (!parsed) return;
    void propose(parsed.headers, columnSamples(parsed), true);
  }, [propose]);

  const setDecision = useCallback((sourceField: string, target: string | null) => {
    setDecisions((d) => ({
      ...d,
      [sourceField]: {
        target,
        answered: true,
        // Choosing a destination makes "keep as a note" meaningless.
        keepAsNote: target === null ? (d[sourceField]?.keepAsNote ?? false) : false,
      },
    }));
  }, []);

  const setKeepAsNote = useCallback((sourceField: string, keep: boolean) => {
    setDecisions((d) => ({
      ...d,
      [sourceField]: {
        target: d[sourceField]?.target ?? null,
        answered: d[sourceField]?.answered ?? true,
        keepAsNote: keep,
      },
    }));
  }, []);

  /**
   * The derived import. Recomputed whenever a decision changes — which is
   * exactly why correcting a mapping needs no upload.
   */
  const applied = useMemo(() => {
    const parsed = parsedRef.current;
    if (!parsed || !proposal) return null;

    const byKey = new Map(proposal.allowedTargets.map((t) => [t.key, t]));
    const columns: ResolvedColumn[] = proposal.proposals.map((p) => {
      const decision = decisions[p.sourceField];
      const target = decision?.target ?? null;
      // The engine's transformation for the CHOSEN target, falling back to the
      // lossless `trim` when the tenant picked a destination the engine did
      // not propose. Never guessed at beyond that.
      const transformation: TransformationName =
        target !== null && p.candidate?.target === target
          ? (p.candidate.transformation as TransformationName)
          : target !== null
            ? ((p.alternatives.find((a) => a.target === target)?.transformation ??
                'trim') as TransformationName)
            : 'none';
      return {
        sourceField: p.sourceField,
        target,
        transformation,
        dataType: target !== null
          ? ((byKey.get(target)?.dataType ?? null) as CanonicalDataType | null)
          : null,
        keepAsNote: decision?.keepAsNote ?? false,
      };
    });

    return applyMapping(parsed, { columns });
    // `decisions` and `proposal` are the only inputs that change; the parse is
    // held in a ref precisely so it is not a dependency.
  }, [decisions, proposal]);

  const blockedByColumn = useMemo(() => {
    const map: Record<string, string> = {};
    for (const column of applied?.columns ?? []) {
      if (column.blockedReason) map[column.sourceField] = column.blockedReason;
    }
    return map;
  }, [applied]);

  const unansweredCount = useMemo(
    () =>
      (proposal?.proposals ?? []).filter(
        (p) => p.ambiguity !== null && decisions[p.sourceField]?.answered !== true,
      ).length,
    [proposal, decisions],
  );

  const parsed = parsedRef.current;
  const fileIsImportable = parsed?.importable ?? false;
  const mappedTargets = useMemo(
    () =>
      Object.values(decisions)
        .map((d) => d.target)
        .filter((t): t is string => t !== null),
    [decisions],
  );

  const canContinue =
    fileIsImportable &&
    unansweredCount === 0 &&
    Object.keys(blockedByColumn).length === 0 &&
    mappedTargets.length > 0 &&
    (applied?.records.length ?? 0) > 0;

  /** Saving the profile is best-effort and never blocks or fails the import. */
  const saveProfileIfAsked = useCallback(async () => {
    if (!rememberMapping || !proposal || !parsedRef.current) return;
    try {
      const entries = proposal.proposals.map((p) => {
        const decision = decisions[p.sourceField];
        const target = decision?.target ?? null;
        const fromProfile = p.status === 'approved_profile_match';
        return {
          sourceField: p.sourceField,
          target,
          transformation:
            target !== null && p.candidate?.target === target
              ? p.candidate.transformation
              : target !== null
                ? (p.alternatives.find((a) => a.target === target)?.transformation ?? 'trim')
                : 'none',
          decision: (target === null ? 'ignored' : 'approved') as 'approved' | 'ignored',
          mappingMethod: fromProfile
            ? ('approved_profile_match' as const)
            : p.candidate?.target === target
              ? ('tenant_confirmed' as const)
              : ('tenant_override' as const),
        };
      });

      const saved = await approveMappingProfile({
        companyId,
        source: SOURCE,
        schemaFingerprint: proposal.sourceSchemaFingerprint,
        headers: parsedRef.current.headers,
        entries,
        // Keyed on the DECISION, not just the schema, so changing one column
        // and re-approving the same file layout becomes the next version
        // rather than an IDEMPOTENCY_CONFLICT.
        idempotencyKey: mappingApprovalKey(
          companyId,
          proposal.sourceSchemaFingerprint,
          entries,
        ),
      });
      setProfileSaveNote(`This mapping was saved as version ${saved.version} and will be reused.`);
    } catch (e) {
      // The expected path today. It is a missing feature, not an import
      // failure, and the copy says so.
      setProfileSaveNote(
        e instanceof ImportApiError && e.isProfileStoreUnavailable
          ? 'Saving this mapping for reuse is not available yet, so you will be asked to confirm the columns again next time. Your import was not affected.'
          : 'This mapping could not be saved for reuse. Your import was not affected.',
      );
    }
  }, [rememberMapping, proposal, decisions, companyId]);

  const run = useCallback(
    async (records: Array<Record<string, unknown>>, isRetry: boolean) => {
      if (records.length === 0) return;

      const controller = new AbortController();
      abortRef.current = controller;
      submittedRef.current = records;

      if (isRetry) setRetrying(true);
      setRunning(true);
      setTransportError(null);
      setAborted(false);
      setError(null);
      setStartedAt(Date.now());
      setPhase('confirm');

      // A retry is a NEW decision by the operator, so it gets a new run id and
      // is visible as its own unit of work in the audit trail.
      const result = await submitChunks({
        companyId,
        records,
        ingestionRunId: newRunId(),
        onProgress: setProgress,
        signal: controller.signal,
      });

      setOutcomes(result.outcomes);
      setSucceeded(result.succeeded);
      setFailed(result.failed);
      setTransportError(result.transportError);
      setAborted(result.aborted);
      setRunning(false);
      setRetrying(false);
      abortRef.current = null;

      if (result.succeeded > 0) {
        // The Lead Database reads a different store from `/api/prospects`, and
        // the shared invalidator covers only the former — so the prospect list
        // key is invalidated explicitly rather than left stale.
        void invalidateLeadIntelligenceReads(mutate, companyId);
        void mutate(
          (key: unknown) =>
            typeof key === 'string' && key.startsWith('/api/prospects?companyId='),
        );
      }

      if (!isRetry) await saveProfileIfAsked();
      setPhase('results');
    },
    [companyId, mutate, saveProfileIfAsked],
  );

  const handleImport = useCallback(() => {
    if (!applied) return;
    void run([...applied.records], false);
  }, [applied, run]);

  const handleRetry = useCallback(() => {
    const retryRecords = recordsForRetry(submittedRef.current, outcomes);
    void run(retryRecords, true);
  }, [outcomes, run]);

  const retryableCount = useMemo(
    () => recordsForRetry(submittedRef.current, outcomes).length,
    [outcomes],
  );

  const handleStartOver = useCallback(() => {
    parsedRef.current = null;
    submittedRef.current = [];
    setPhase('choose');
    setFileName('');
    setSamples({});
    setProposal(null);
    setDecisions({});
    setOutcomes([]);
    setSucceeded(0);
    setFailed(0);
    setProgress(null);
    setStartedAt(null);
    setTransportError(null);
    setAborted(false);
    setProfileSaveNote(null);
    setRememberMapping(false);
    setError(null);
  }, []);

  // ── The gate's own answer, rendered as a state rather than an error ──────
  if (gateClosed) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Importing is not enabled for this company</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
          Prospect importing has not been switched on for this company yet. Nothing is wrong with
          your file and nothing has been changed — the feature simply is not available here. Ask
          your administrator to enable prospect importing.
        </p>
        <Link
          href="/prospects"
          className="mt-4 inline-block text-sm font-medium text-purple-600 hover:underline"
        >
          ← Back to prospects
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {phase === 'choose' ? (
        <>
          <FileDropStep onParsed={handleParsed} disabled={proposing} />
          {proposing ? (
            <p className="text-sm text-gray-500">Working out what your columns mean…</p>
          ) : null}
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-rose-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : null}
        </>
      ) : null}

      {phase === 'map' && proposal && applied ? (
        <MappingStep
          proposal={proposal}
          decisions={decisions}
          samples={samples}
          columnOutcomes={applied.columns}
          previewRecords={applied.records}
          recordCount={applied.records.length}
          emptyRows={applied.emptyRows}
          diagnostics={parsed?.diagnostics ?? []}
          metadataTruncated={applied.metadataTruncated}
          blockedByColumn={blockedByColumn}
          unansweredCount={unansweredCount}
          canContinue={canContinue}
          reproposing={reproposing}
          onDecision={setDecision}
          onKeepAsNote={setKeepAsNote}
          onRepropose={handleRepropose}
          onBack={handleStartOver}
          onContinue={() => setPhase('confirm')}
        />
      ) : null}

      {phase === 'confirm' && proposal && applied ? (
        <ConfirmStep
          recordCount={applied.records.length}
          mappedTargets={mappedTargets}
          allowedTargets={proposal.allowedTargets}
          notedFields={applied.notedFields}
          fileName={fileName}
          running={running}
          progress={progress}
          startedAt={startedAt}
          error={error ?? transportError}
          rememberMapping={rememberMapping}
          onRememberMappingChange={setRememberMapping}
          onBack={() => setPhase('map')}
          onImport={handleImport}
          onCancel={() => abortRef.current?.abort()}
        />
      ) : null}

      {phase === 'results' ? (
        <ResultsTable
          outcomes={outcomes}
          succeeded={succeeded}
          failed={failed}
          retryableCount={retryableCount}
          retrying={retrying}
          transportError={transportError}
          aborted={aborted}
          profileSaveNote={profileSaveNote}
          onRetry={handleRetry}
          onStartOver={handleStartOver}
        />
      ) : null}
    </div>
  );
}
