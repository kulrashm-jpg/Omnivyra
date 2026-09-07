/**
 * A7 — the cron-runtime wrapper for the enrichment retry scheduler.
 *
 * This is the TRIGGER and the production wiring, and nothing else. What to do
 * with a work item is `decideEnrichmentAction`'s; doing it is
 * `consumeEnrichmentWork`'s; the ports are `makeProductionEnrichmentPorts`'s;
 * which items are worth looking at is `listDueRetryCandidates`'s. This file only
 * says WHEN, FOR WHOM, and AS WHOM.
 *
 * ─── INERT BY DEFAULT, AND ON TWO INDEPENDENT SWITCHES ────────────────────
 * Registering a job in `scheduler/cron.ts` makes it run on the next deploy, so
 * the flag is opt-IN rather than opt-out: absent the flag, this returns
 * immediately having read nothing. It then also requires an explicit tenant
 * allow-list. Both must be set, deliberately, for a single provider call to
 * become possible — and both gates return before the production port set is
 * even constructed.
 *
 * ─── WHY AN ALLOW-LIST AND NOT TENANT DISCOVERY ───────────────────────────
 * `listDueRetryCandidates` refuses to have an "all tenants" mode on purpose: a
 * cross-tenant read is how one customer's quota ends up answering another's
 * question. Discovering tenants by scanning the attempts table would
 * reintroduce exactly that read one layer up, and would make the blast radius
 * of enabling the flag "every tenant at once". Naming the tenants keeps
 * activation a per-tenant act. Broadening this is a deliberate decision with
 * its own evidence, not a default.
 *
 * ─── IT NEVER THROWS ──────────────────────────────────────────────────────
 * Cron ticks are shared. A retry failure is reported and the tick continues, in
 * keeping with every other job in this scheduler.
 */

import { logger } from '../services/logger';
import {
  runRetryCycle,
  RETRY_BATCH_SIZE,
  RETRY_LEASE_TTL_MS,
  type RetryConsumerPorts,
  type RetryCycleSummary,
} from '../services/enrichment/retryConsumer';
import { listDueRetryCandidates } from '../services/enrichment/retryCandidates';
import { consumeEnrichmentWork } from '../services/enrichment/consumeEnrichmentWork';
import { makeProductionEnrichmentPorts } from '../services/enrichment/productionPorts';
import { defaultFindRecentObservation } from '../services/enrichment/providers/observations';
import { DEFAULT_FRESHNESS_DAYS } from '../services/enrichment/providers/execute';
import { tenantSourceStatuses } from '../apiHandlers/prospects/prospectIntelligenceRead';
import { ownedDbTable } from '../db/writeOwner';

/** Opt-IN. Absent or anything but `'true'` and this job does nothing at all. */
export const RETRY_SCHEDULER_FLAG = 'PI_RETRY_SCHEDULER_ENABLED';
/** Comma-separated organization ids. Empty means no tenant is in scope. */
export const RETRY_SCHEDULER_TENANTS = 'PI_RETRY_SCHEDULER_ORG_IDS';

/**
 * The worker identity a lease is claimed under.
 *
 * Stable for the life of the process, so a crashed worker's leases are
 * attributable, and distinct per process, so two containers cannot silently
 * share one identity and defeat the claim. Never a credential, never a user.
 */
export const WORKER_ID = `pi-retry-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export interface RetryJobReport {
  /** false → the flag is off, or no tenant is in scope. Nothing was read. */
  readonly ran: boolean;
  readonly tenants: number;
  readonly discovered: number;
  readonly handed: number;
  readonly executed: number;
  readonly failures: number;
  readonly durationMs: number;
  readonly summaries: readonly RetryCycleSummary[];
}

const IDLE: RetryJobReport = {
  ran: false, tenants: 0, discovered: 0, handed: 0, executed: 0,
  failures: 0, durationMs: 0, summaries: [],
};

/** Tenants in scope, from the allow-list. Deduplicated, order preserved. */
export function scheduledTenants(raw: string | undefined): readonly string[] {
  return Array.from(new Set(
    (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
  ));
}

export function retrySchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RETRY_SCHEDULER_FLAG] === 'true';
}

/** Whole days between two instants, as `execute.ts` measures freshness. */
const daysBetween = (a: string, b: string): number =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Bind the selector to production.
 *
 * Every capability here is an EXISTING production singleton or seam:
 * `listDueRetryCandidates`, `consumeEnrichmentWork`,
 * `makeProductionEnrichmentPorts`, `defaultFindRecentObservation`,
 * `tenantSourceStatuses`. Nothing is reimplemented, and the enrichment port set is
 * forwarded whole rather than assembled here — A7A owns that composition, and a
 * second one is how suppression gets lost.
 */
export function productionRetryPorts(): RetryConsumerPorts {
  return {
    listCandidates: (input) => listDueRetryCandidates(input),

    async loadEntity({ organizationId, subject, entityId }) {
      // The canonical row the attempt is anchored on. Tenant-scoped on the
      // column each table actually uses for the tenant.
      const table = subject === 'person' ? 'unified_persons' : 'prospect_accounts';
      const tenantColumn = subject === 'person' ? 'company_id' : 'organization_id';
      const res = await ownedDbTable(table)
        .select('*')
        .eq('id', entityId)
        .eq(tenantColumn, organizationId)          // tenant boundary — never optional
        .maybeSingle();
      if (res.error) throw new Error(`${table} read failed: ${res.error.message}`);
      return (res.data ?? null) as Readonly<Record<string, unknown>> | null;
    },

    async freshEvidenceCovers({ organizationId, entityId, providerId, attributes, now }) {
      // A7A's lookup, and A3's freshness window — the same question the executor
      // enforces, asked with the same threshold so the two cannot diverge. This
      // answer only lets the decision refuse EARLY; suppression is still
      // enforced inside the executor regardless of what is reported here.
      const recent = await defaultFindRecentObservation({
        organizationId, entityId, providerId, attributes,
      });
      return Boolean(recent && daysBetween(now, recent.observedAt) < DEFAULT_FRESHNESS_DAYS);
    },

    async sourceReadiness({ organizationId, providerId }) {
      // The EXISTING tenant-aware source read, reused whole. Writing a second
      // credential probe here would re-create the A3V defect it was written to
      // fix — a source reporting `connected` on the strength of Omnivyra's own
      // key rather than the tenant's.
      const statuses = await tenantSourceStatuses(organizationId);
      const status = statuses.find((s) => s.id === providerId) ?? null;
      return {
        // `credential_missing` is the one state that names this specifically;
        // every other unusable state is a different blocker, and A7D reports
        // them differently.
        credentialAvailable: status !== null && status.connectionState !== 'credential_missing',
        // A3C: exactly one state permits an acquisition attempt.
        sourceOperational: Boolean(status?.usable),
      };
    },

    enrichmentPorts: () => makeProductionEnrichmentPorts(),

    consume: (input) => consumeEnrichmentWork(input),

    emit: (event, fields) => logger.info(`pi_retry_${event}`, fields),
  };
}

/**
 * One tick. Returns a report; never throws.
 *
 * Deps are injectable for the tests that prove the flag and the allow-list gate
 * everything; production supplies none.
 */
export async function runProspectRetryJob(deps: {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  ports?: RetryConsumerPorts;
  workerId?: string;
} = {}): Promise<RetryJobReport> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date().toISOString());

  if (!retrySchedulerEnabled(env)) return IDLE;

  const tenants = scheduledTenants(env[RETRY_SCHEDULER_TENANTS]);
  if (tenants.length === 0) {
    logger.info('pi_retry_no_tenants_in_scope', { flag: RETRY_SCHEDULER_FLAG });
    return IDLE;
  }

  const started = Date.now();
  const ports = deps.ports ?? productionRetryPorts();
  const workerId = deps.workerId ?? WORKER_ID;
  const summaries: RetryCycleSummary[] = [];
  let failures = 0;

  for (const organizationId of tenants) {
    try {
      summaries.push(await runRetryCycle({
        organizationId, workerId, now: now(),
        batchSize: RETRY_BATCH_SIZE, leaseTtlMs: RETRY_LEASE_TTL_MS,
      }, ports));
    } catch (error: unknown) {
      // One tenant's failure must not stop the others, and must not be silent.
      failures += 1;
      logger.warn('pi_retry_cycle_failed', {
        organizationId, workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ran: true,
    tenants: tenants.length,
    discovered: summaries.reduce((n, s) => n + s.discovered, 0),
    handed: summaries.reduce((n, s) => n + s.handed, 0),
    executed: summaries.reduce((n, s) => n + s.executed, 0),
    failures,
    durationMs: Date.now() - started,
    summaries,
  };
}
