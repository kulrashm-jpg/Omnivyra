/**
 * Canonical Review Ingestion Orchestrator (BETA-PHASE2)
 * -----------------------------------------------------
 * Runs the credentialed review connectors for a subject and persists their
 * signals through the EXISTING pipeline — `ingestReviewSources` (the canonical
 * normalizer + review store). It adds NO normalizer, NO store, NO scheduler; it
 * is the fetch→persist orchestration the reputation bridge said was missing.
 *
 *   configured connectors → fetch (governed via fetchProduction) → ReviewSourcePayload[]
 *      → ingestReviewSources (consolidate + persist, existing) → sync result
 *
 * Retry/backoff/failure-recording are inherited per-connector from
 * fetchProduction/withRetry (the governed primitive). Incremental sync +
 * checkpoint resume: a fresh persisted snapshot short-circuits a re-fetch, so a
 * partial/periodic run does not re-pull sources already captured this window.
 * Fail-soft throughout — never throws; honest empty when nothing is configured.
 *
 * Scheduling: this is the reviews entry the canonical scheduler
 * (ingestionScheduler.runIngestionForCompany) will call once `'reviews'` is an
 * accepted IngestionSource (blocked on the data_source_status/ingestion_runs
 * CHECK-constraint migration — see phase report). Manual sync = call directly.
 */

import { configuredReviewConnectors, type ReviewSubject } from './reviewConnectors';
import { ingestReviewSources, subjectKeyFor, loadReviewSourceSnapshot } from '../reviewIngestionService';
import { resolveCompanyWebsite } from '../ingestionUtils';
import type { ReviewSourcePayload } from '../reputationProviderBridge';

export interface ReviewIngestionResult {
  subjectId: string | null;
  attempted: string[];   // connector keys attempted
  fetched: string[];     // connector sources that returned a real signal
  persisted: number;     // authenticated per-source records stored
  ok: boolean;
  error: string | null;
  skipped?: string;      // reason when the run short-circuited
}

/** Below one daily cycle: re-fetch is skipped when a fresher snapshot exists. */
const FRESH_WINDOW_MS = 20 * 60 * 60 * 1000;

/**
 * Canonical companyId → ReviewSubject resolver. Derives the subject from existing company data
 * (reuses `resolveCompanyWebsite`); domain is the primary subject key (`subjectKeyFor` prefers it).
 * Deterministic and graceful: a DB error or missing website yields `domain: null` (the orchestrator
 * then honestly returns `error: 'no_subject_key'`). No duplicate subject logic, no new repository.
 */
export async function resolveReviewSubject(companyId: string): Promise<ReviewSubject> {
  let domain: string | null = null;
  try {
    domain = await resolveCompanyWebsite(companyId);
  } catch {
    domain = null;
  }
  return { companyId, domain, brandName: null };
}

/**
 * Ingest the subject's reviews from all configured connectors. `manual`/`force`
 * bypasses the freshness checkpoint. Never throws.
 */
export async function runReviewIngestion(
  subject: ReviewSubject,
  opts?: { force?: boolean; now?: Date },
): Promise<ReviewIngestionResult> {
  const now = opts?.now ?? new Date();
  const subjectId = subjectKeyFor(subject.domain, subject.brandName);
  if (!subjectId) {
    return { subjectId: null, attempted: [], fetched: [], persisted: 0, ok: false, error: 'no_subject_key' };
  }

  const connectors = configuredReviewConnectors();
  if (connectors.length === 0) {
    return { subjectId, attempted: [], fetched: [], persisted: 0, ok: true, error: null, skipped: 'no_configured_connectors' };
  }

  // Incremental / checkpoint resume: a fresh snapshot short-circuits the re-fetch.
  if (!opts?.force) {
    const snap = await loadReviewSourceSnapshot(subjectId);
    if (snap && now.getTime() - new Date(snap.observedAt).getTime() < FRESH_WINDOW_MS) {
      return { subjectId, attempted: [], fetched: [], persisted: snap.sources.length, ok: true, error: null, skipped: 'fresh_snapshot' };
    }
  }

  const attempted = connectors.map((c) => c.key);
  // Each connector is fail-soft; fetchProduction already recorded any failure
  // outcome + telemetry. A connector-level guard keeps one failure from aborting
  // the run (checkpoint: the sources that did resolve are still persisted).
  const settled = await Promise.all(
    connectors.map(async (c) => {
      try {
        return await c.fetch(subject);
      } catch {
        return null;
      }
    }),
  );

  const payloads: ReviewSourcePayload[] = settled.filter((p): p is ReviewSourcePayload => p != null);
  const fetched = payloads.map((p) => p.source);
  if (payloads.length === 0) {
    return { subjectId, attempted, fetched: [], persisted: 0, ok: true, error: null };
  }

  const result = await ingestReviewSources(subjectId, payloads, now.toISOString());
  return { subjectId, attempted, fetched, persisted: result.persisted, ok: result.ok, error: result.error };
}
