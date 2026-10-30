/**
 * Observability for provenance/adoption side effects that must never fail their
 * caller. "Fail-open" here means the CALLER is unaffected — never that the
 * failure is invisible: every non-success is logged and counted.
 *
 * Counters are process-local (a Vercel lambda or a Railway worker); the log line
 * is the durable signal. `getProvenanceIngestionCounters` lets health/debug
 * surfaces and tests read them.
 */
import { logger } from '../../logger';
import { keepAliveAfterResponse } from '../../../../lib/runtime/keepAlive';

export type ProvenancePath =
  | 'lead_adoption'
  | 'inbound_lead'
  | 'legacy_crm'
  | 'pi_ingestion'
  | 'marketpulse';

/** `succeeded`/`inserted`/`duplicate`/`skipped` are healthy; `failed`/`error` are failures. */
export type ProvenanceOutcome =
  | 'succeeded'
  | 'inserted'
  | 'duplicate'
  | 'skipped'
  | 'failed'
  | 'error';

const counters = new Map<string, number>();

export function recordProvenanceOutcome(
  path: ProvenancePath,
  outcome: ProvenanceOutcome,
  detail: Record<string, unknown> = {},
): void {
  const key = `${path}:${outcome}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
  if (outcome === 'failed' || outcome === 'error') {
    try {
      logger.warn('prospect_provenance_side_effect_failed', { path, outcome, ...detail });
    } catch {
      /* logging must never turn a handled failure into a throw */
    }
  }
}

export function getProvenanceIngestionCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function resetProvenanceIngestionCounters(): void {
  counters.clear();
}

/**
 * Run `work` detached so it survives the HTTP response on Vercel (via the
 * repository's canonical `keepAliveAfterResponse`), never rejects, never blocks
 * the caller, and records a `failed` outcome if it throws.
 *
 * Returns the settled promise so long-lived callers and tests can await it; a
 * request handler simply does not.
 */
export function runDetached(
  path: ProvenancePath,
  work: () => Promise<void>,
  detail: Record<string, unknown> = {},
): Promise<void> {
  let settled: Promise<void>;
  try {
    settled = work().then(
      () => undefined,
      (e) => recordProvenanceOutcome(path, 'failed', { ...detail, error: e instanceof Error ? e.message : String(e) }),
    );
  } catch (e) {
    recordProvenanceOutcome(path, 'failed', { ...detail, error: e instanceof Error ? e.message : String(e) });
    settled = Promise.resolve();
  }
  void keepAliveAfterResponse(settled).catch(() => undefined);
  return settled;
}
