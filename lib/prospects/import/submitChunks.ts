/**
 * PI-LDB — chunked submission to the existing CSV ingestion route.
 *
 * ─── WHY CHUNKING IS NOT OPTIONAL ─────────────────────────────────────────
 * `/api/lead-ingestion/csv` answers 413 for a batch over `MAX_BATCH_SIZE`
 * (1 000). A real vendor export is larger than that, so a single POST is not a
 * simpler design, it is a broken one.
 *
 * ─── WHY SEQUENTIAL, NOT PARALLEL ─────────────────────────────────────────
 * The orchestrator resolves identity: two chunks carrying the same person at
 * the same time is precisely the race worth not inventing for a progress bar
 * that finishes sooner. Chunks go one at a time.
 *
 * ─── ONE RUN ID FOR THE WHOLE IMPORT ──────────────────────────────────────
 * The route dedup-keys its telemetry on `ingestionRunId`
 * (`dedupKey: 'lead.ingestion_batch:' + ingestionRunId`), so sharing one id
 * across chunks makes the import ONE unit of work in the audit trail rather
 * than N unrelated batches. A RETRY deliberately uses a NEW id: it is a new
 * decision by the operator and should be visible as one.
 */

import type { ImportOutcome } from './types';
import { needsAttention } from '@/lib/leadIntelligence/projectionResult';

/**
 * The ceiling the route enforces. Restated so the client never provokes a 413.
 *
 * D4 (owner ruling, 2026-11-07): 100. It MUST equal
 * `backend/services/leadIngestion/orchestrator.ts`'s `MAX_BATCH_SIZE`; this is
 * a client bundle, so it cannot import the server module to find out, and a
 * test pins the equality instead. A larger file is still fully importable: it
 * is submitted as ceil(n/100) sequential chunks under one ingestion run id,
 * which is what makes progress idempotent and recoverable.
 */
export const MAX_BATCH_SIZE = 100;

/** Progress as the submitter knows it. Counts only — never a row payload. */
export interface SubmitProgress {
  chunksTotal: number;
  chunksDone: number;
  recordsTotal: number;
  recordsSent: number;
  succeeded: number;
  failed: number;
}

export interface SubmitArgs {
  companyId: string;
  records: ReadonlyArray<Record<string, unknown>>;
  /** Shared by every chunk of ONE import. */
  ingestionRunId: string;
  chunkSize?: number;
  onProgress?: (progress: SubmitProgress) => void;
  signal?: AbortSignal;
  /** Injected for tests; defaults to the authenticated browser fetch. */
  post?: (
    companyId: string,
    body: { records: ReadonlyArray<Record<string, unknown>>; ingestionRunId: string },
    signal?: AbortSignal,
  ) => Promise<{ ok: boolean; status: number; json: unknown }>;
}

export interface SubmitResult {
  outcomes: ImportOutcome[];
  succeeded: number;
  failed: number;
  recordsSent: number;
  /** Set when a chunk failed as a whole rather than per record. */
  transportError: string | null;
  /** True when the operator aborted; partial results are still returned. */
  aborted: boolean;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Submits every chunk in order, accumulating per-record outcomes.
 *
 * A chunk-level failure STOPS the run and returns what already landed. It does
 * not roll back: the records in earlier chunks are durable and pretending
 * otherwise would be a lie about the state of the database. The caller reports
 * what succeeded and offers a retry for the rest.
 */
export async function submitChunks(args: SubmitArgs): Promise<SubmitResult> {
  const chunkSize = Math.max(1, Math.min(args.chunkSize ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE));
  const batches = chunk(args.records, chunkSize);
  const post = args.post ?? defaultPost;

  const outcomes: ImportOutcome[] = [];
  let succeeded = 0;
  let failed = 0;
  let recordsSent = 0;
  let transportError: string | null = null;
  let aborted = false;

  const report = (chunksDone: number) =>
    args.onProgress?.({
      chunksTotal: batches.length,
      chunksDone,
      recordsTotal: args.records.length,
      recordsSent,
      succeeded,
      failed,
    });

  report(0);

  for (let i = 0; i < batches.length; i += 1) {
    if (args.signal?.aborted) {
      aborted = true;
      break;
    }

    const batch = batches[i];
    let response: { ok: boolean; status: number; json: unknown };
    try {
      response = await post(
        args.companyId,
        { records: batch, ingestionRunId: args.ingestionRunId },
        args.signal,
      );
    } catch (error) {
      if (args.signal?.aborted) {
        aborted = true;
        break;
      }
      transportError = error instanceof Error ? error.message : 'the import request failed';
      break;
    }

    const body = (response.json ?? {}) as {
      error?: string;
      code?: string;
      outcomes?: unknown;
      succeeded?: unknown;
      failed?: unknown;
    };

    if (!response.ok) {
      // The gate's own answer is passed through verbatim so the UI can tell
      // "not enabled for this company" apart from a genuine failure.
      transportError = body.code
        ? `${body.error ?? 'the import was refused'} (${body.code})`
        : body.error ?? `the import was refused (HTTP ${response.status})`;
      break;
    }

    const chunkOutcomes = Array.isArray(body.outcomes)
      ? (body.outcomes as ImportOutcome[])
      : [];
    outcomes.push(...chunkOutcomes);
    succeeded += typeof body.succeeded === 'number' ? body.succeeded : 0;
    failed += typeof body.failed === 'number' ? body.failed : 0;
    recordsSent += batch.length;
    report(i + 1);
  }

  return { outcomes, succeeded, failed, recordsSent, transportError, aborted };
}

/**
 * The real transport. Kept out of the loop above so the whole submitter is
 * testable with no network and no Supabase session.
 */
async function defaultPost(
  companyId: string,
  body: { records: ReadonlyArray<Record<string, unknown>>; ingestionRunId: string },
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const { apiFetch } = await import('@/lib/apiFetch');
  const res = await apiFetch(
    `/api/lead-ingestion/csv?company_id=${encodeURIComponent(companyId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Rebuilds a batch for a retry from the ORIGINAL records plus the outcomes.
 *
 * ─── WHY BY POSITION AND NOT BY EXTERNAL ID ───────────────────────────────
 * `externalId` is the obvious key, and it is the wrong one here: it is a
 * digest computed by `csvExternalId` on the SERVER, so the browser cannot
 * derive it for a record it holds, and a record whose row carried no reference
 * has a null id and would silently never be retried.
 *
 * The route returns exactly one outcome per submitted record, in order, and
 * chunks are submitted sequentially and appended in order — so outcome `i`
 * describes record `i`. Position is the key the client can actually compute
 * correctly. `recordsSent` bounds it: records beyond that were never sent, and
 * a chunk-level failure means they have no outcome at all, so they are
 * included in the retry too.
 *
 * Retry needs no re-upload because the records are still in memory, and it is
 * safe because `csvExternalId` is deterministic — re-submitting a row that did
 * land is an idempotent repeat, not a duplicate.
 */
export function recordsForRetry(
  records: ReadonlyArray<Record<string, unknown>>,
  outcomes: readonly ImportOutcome[],
): Array<Record<string, unknown>> {
  const retry: Array<Record<string, unknown>> = [];
  for (let i = 0; i < records.length; i += 1) {
    const outcome = outcomes[i];
    // No outcome => never submitted (an earlier chunk failed, or the operator
    // aborted). Those are exactly as much "not yet imported" as a rejection.
    if (!outcome || outcome.ok !== true) {
      retry.push(records[i]);
      continue;
    }
    // PI-LDB P0. A record that ingested but did not reach the Lead Database
    // has `ok: true`, so it used to be excluded from the retry batch — while
    // the results screen told the operator "retrying those rows is safe and
    // will list them". The advice was unactionable: with `failed === 0` no
    // Retry button was rendered at all. Re-submitting is idempotent on
    // `csvExternalId`, and the projection upsert is keyed on
    // (company_id, dedupe_key), so a row that did land is updated, not doubled.
    if (outcome.leadProjection && needsAttention(outcome.leadProjection)) retry.push(records[i]);
  }
  return retry;
}
