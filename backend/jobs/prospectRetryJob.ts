/**
 * A7 — the cron-runtime wrapper for the enrichment retry consumer.
 *
 * This is the TRIGGER and the production wiring, and nothing else. The decision
 * of what to retry lives in `retryConsumer.ts`; the decision of whether a thing
 * is retryable at all lives in `retryCandidates.ts`; every step of the execution
 * itself already lives behind `executePlannedField`. This file only says WHEN,
 * FOR WHOM, and AS WHOM.
 *
 * ─── INERT BY DEFAULT, AND ON TWO INDEPENDENT SWITCHES ────────────────────
 * Registering a job in `scheduler/cron.ts` makes it run on the next deploy, so
 * the flag is opt-IN rather than opt-out: absent the flag, this returns
 * immediately having read nothing. It then also requires an explicit tenant
 * allow-list. Both must be set, deliberately, for a single provider call to
 * become possible.
 *
 * ─── WHY AN ALLOW-LIST AND NOT TENANT DISCOVERY ───────────────────────────
 * `listDueRetryCandidates` refuses to have an "all tenants" mode on purpose: a
 * cross-tenant read is how one customer's quota ends up answering another's
 * question. Discovering tenants by scanning the attempts table for distinct
 * organizations would reintroduce exactly that read, one layer up, and would
 * make the blast radius of enabling the flag "every tenant at once". Naming the
 * tenants keeps activation a per-tenant act. Broadening this is a deliberate
 * decision with its own evidence, not a default.
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
import { planProspectEnrichment } from '../services/enrichment/service';
import { executePlannedField } from '../services/enrichment/execution';
import { ingestionEnrichmentCoverage } from '../services/leadIngestion/enrichmentCoverage';
import {
  defaultEnrichmentPorts,
  defaultExecuteEnrichmentPorts,
  tenantSourceStatuses,
} from '../apiHandlers/prospects/prospectIntelligenceRead';
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
  readonly executed: number;
  readonly failures: number;
  readonly durationMs: number;
  readonly summaries: readonly RetryCycleSummary[];
}

const IDLE: RetryJobReport = {
  ran: false, tenants: 0, discovered: 0, executed: 0, failures: 0, durationMs: 0, summaries: [],
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

/**
 * Bind the consumer to production.
 *
 * Every port here is an EXISTING production function. The one piece of new
 * reading is `resolveProspect`, because the attempt record is anchored on the
 * canonical entity and a plan is built for a lead — see the port's own
 * documentation for why the choice of lead cannot affect what is enriched.
 */
export function productionRetryPorts(now: () => string): RetryConsumerPorts {
  return {
    listCandidates: (input) => listDueRetryCandidates(input),

    async resolveProspect({ organizationId, subject, entityId }) {
      // A person is reached directly; an account is reached through the people
      // who work there. Ordered by id so the choice is deterministic across
      // workers and across cycles — the entity, not the lead, is then asserted
      // by the consumer before anything is executed.
      let personIds: string[] = [];
      if (subject === 'person') {
        personIds = [entityId];
      } else {
        const people = await ownedDbTable('unified_persons')
          .select('id')
          .eq('company_id', organizationId)        // tenant boundary — never optional
          .eq('account_id', entityId)
          .order('id', { ascending: true })
          .limit(RETRY_BATCH_SIZE);
        if (people.error) throw new Error(`unified_persons read failed: ${people.error.message}`);
        personIds = ((people.data ?? []) as Array<{ id: string }>).map((r) => r.id);
      }
      if (personIds.length === 0) return null;

      const leads = await ownedDbTable('canonical_leads')
        .select('id')
        .eq('company_id', organizationId)          // tenant boundary — never optional
        .in('unified_person_id', personIds)
        .order('id', { ascending: true })
        .limit(1);
      if (leads.error) throw new Error(`canonical_leads read failed: ${leads.error.message}`);
      const row = ((leads.data ?? []) as Array<{ id: string }>)[0];
      return row?.id ?? null;
    },

    plan: (input) => planProspectEnrichment({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      coverage: ingestionEnrichmentCoverage(),
      now: input.now,
    }, defaultEnrichmentPorts()),

    statuses: (organizationId) => tenantSourceStatuses(organizationId),

    // The executor, bound to the real production ports. The consumer never sees
    // them, so it cannot reach a credential, a cost decision or a provider.
    execute: (input) => executePlannedField(input, defaultExecuteEnrichmentPorts()),

    emit: (event, fields) => logger.info(`pi_retry_${event}`, { ...fields, at: now() }),
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
  const ports = deps.ports ?? productionRetryPorts(now);
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
    executed: summaries.reduce((n, s) => n + s.executed, 0),
    failures,
    durationMs: Date.now() - started,
    summaries,
  };
}
