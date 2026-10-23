/**
 * M1 — the tenant spend ceiling for provider execution.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `tenantFundedExecutionPort` authorised every call unconditionally. That is
 * correct for a user-initiated request — a person is present, and one click is
 * one call — and it is the last thing standing between a scheduler and an
 * unbounded vendor bill. The A8 audit named it the single prerequisite for
 * automating enrichment at all.
 *
 * ─── IT ATTACHES WHERE THE SEAM ALREADY IS ────────────────────────────────
 * `cost.ts` already anticipated this: `allow` is documented as the place
 * "capacity, per-tenant rate limits, an operator disabling a source" attach
 * "without reintroducing monetization". So there is no new control plane here
 * and no second cost path — this file supplies the function that seam was
 * built to receive, and `authorizeCost` keeps its position in the executor's
 * order: adapter → credential → suppression → THIS → one call.
 *
 * A refusal therefore produces `cost_denied` and zero transport, through the
 * branch `executeEnrichment` already has.
 *
 * ─── THE LEDGER IS THE ATTEMPT TABLE ──────────────────────────────────────
 * No new table. `prospect_enrichment_attempts` is already the durable,
 * tenant-scoped, provider-scoped, timestamped record of every call the
 * platform has made, and A4Q made it able to say whether transport actually
 * happened. A separate spend ledger would be a second answer to "how many
 * calls did this tenant make", and the two would drift.
 *
 * ─── `unknown` CONSUMES CAPACITY, AND THAT IS THE POINT ───────────────────
 * A4Q writes `provider_call_state = 'unknown'` BEFORE transport, so a row
 * still holding it is a process that did not survive its own provider call —
 * the vendor may well have been billed. Treating that as free capacity would
 * make a crash loop the cheapest way to exceed a ceiling. `not_called` is the
 * opposite: it is proof no egress occurred, so it consumes nothing. A retry is
 * a new attempt row and consumes its own capacity, because it is its own call.
 *
 * ─── THE CEILING IS REQUIRED (OD-A / PI-ADR-007) ──────────────────────────
 * This section used to say that an absent policy meant absent I/O: a global
 * switch was consulted first, and with no ceiling configured the function
 * permitted before reading anything. That is no longer true, and the change is
 * the decision rather than an optimisation regression.
 *
 * The owner decided: REQUIRED — no ceiling, no call. So there is no global
 * switch, and an unconfigured tenant is REFUSED rather than treated as
 * unlimited. A ceiling read now happens on every call that reaches this gate.
 *
 * ─── FAIL CLOSED, FOR EVERYONE ────────────────────────────────────────────
 * Every uncertainty refuses: no ceiling configured, a ceiling that cannot be
 * read, a usage count that cannot be obtained, a count that is not a finite
 * number, and of course a tenant at or over its ceiling. That mirrors
 * suppression, which propagates a read error rather than reading it as
 * "nothing found". Unlike before, it now protects tenants who never opted in,
 * because opting in is no longer what turns the control on.
 *
 * ─── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 * Not a rate limit: this bounds calls per UTC day (the tenant's wallet), not
 * calls per second (the vendor's patience). Not billing: no credits are
 * reserved, because the vendor invoices the tenant directly. And not atomic —
 * see `boundedOvershoot` below, which says so explicitly rather than letting a
 * caller assume otherwise.
 */

import { ownedDbTable } from '../../../db/writeOwner';
import type { TenantFundedPortOptions } from './cost';

/**
 * The tenant-policy flag that carries the ceiling.
 *
 * Reuses `feature_flags` — the same per-tenant surface `resolveLeadIngestionGate`
 * uses — rather than introducing a settings table. Declared once so an
 * operator, this module and a test all name the same string.
 */
export const SPEND_CEILING_FLAG_KEY = 'enrichment_spend_ceiling';

/**
 * THERE IS NO GLOBAL SWITCH ANY MORE (OD-A / PI-ADR-007).
 *
 * `ENABLE_ENRICHMENT_SPEND_CEILING` and `isSpendCeilingEnabled()` stood here.
 * Off or absent meant no ceiling was enforced anywhere, and off was the
 * default — so the control was fully built, correctly wired to the production
 * singleton, and enforced nothing.
 *
 * The owner decided the ceiling is REQUIRED: no ceiling, no call. A switch
 * whose only function is to disable a required control contradicts that, and
 * would make the posture depend on an environment variable being remembered.
 * So enforcement is now unconditional and the switch is gone rather than
 * defaulted the other way.
 */

/**
 * The UTC calendar day a timestamp falls in, as `YYYY-MM-DD`.
 *
 * UTC and not the tenant's local zone: the attempt rows are stored in UTC, and
 * a ceiling that reset at a per-tenant midnight would need a timezone the
 * platform does not hold. Stated here so the boundary is one decision rather
 * than an accident of whichever clock a caller passed.
 */
export function utcDayBounds(nowIso: string): { readonly startIso: string; readonly endIso: string } {
  const t = Date.parse(nowIso);
  if (!Number.isFinite(t)) throw new Error('a usable timestamp is required to bound the spend day');
  const d = new Date(t);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * The ceiling for one tenant and provider, or null when none is configured.
 *
 * `metadata.daily_provider_call_ceiling` is the tenant-wide value;
 * `metadata.providers[providerId]` overrides it for one provider, so a tenant
 * can hold an expensive source tighter than a cheap one without a second flag.
 */
export type ResolveCeiling = (input: {
  organizationId: string;
  providerId: string;
}) => Promise<number | null>;

/** Calls that have consumed capacity today. */
export type CountCallsToday = (input: {
  organizationId: string;
  providerId: string;
  startIso: string;
  endIso: string;
}) => Promise<number>;

const positiveInt = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/**
 * Read the ceiling from the tenant's own flag row.
 *
 * A disabled flag is not a zero ceiling — it is an absent one, and absent
 * means unlimited exactly as it does today. Reading it otherwise would turn
 * "an operator switched this off" into "this tenant may make no calls".
 */
export const defaultResolveCeiling: ResolveCeiling = async ({ organizationId, providerId }) => {
  const { data, error } = await ownedDbTable('feature_flags')
    .select('enabled, metadata')
    .eq('organization_id', organizationId)          // tenant — never optional
    .eq('flag_key', SPEND_CEILING_FLAG_KEY)
    .maybeSingle();
  if (error) throw new Error(`enrichment spend ceiling read failed: ${error.message}`);

  const row = data as { enabled?: boolean; metadata?: Record<string, unknown> } | null;
  if (!row || row.enabled !== true) return null;

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const perProvider = (meta.providers ?? {}) as Record<string, unknown>;
  return positiveInt(perProvider[providerId]) ?? positiveInt(meta.daily_provider_call_ceiling);
};

/**
 * Count the calls this tenant has already made to this provider today.
 *
 * `provider_call_state` and NOT `provider_called`: the boolean is written at
 * completion and a row that never completed has no truthful boolean, whereas
 * the call state carries `unknown` from before transport. That is precisely
 * the row a spend ceiling must not ignore.
 */
export const defaultCountCallsToday: CountCallsToday = async (
  { organizationId, providerId, startIso, endIso },
) => {
  const { count, error } = await ownedDbTable('prospect_enrichment_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)          // tenant — never optional
    .eq('provider_key', providerId)                 // one provider's budget is its own
    .in('provider_call_state', ['called', 'unknown'])
    .gte('started_at', startIso)
    .lt('started_at', endIso);
  if (error) throw new Error(`enrichment spend ledger read failed: ${error.message}`);
  // A missing `count` is NOT zero usage. `head: true` asks for the count and
  // nothing else, so a response that carries neither an error nor a number is a
  // read that did not answer — and reading it as 0 would make `0 >= ceiling`
  // false and permit the billable call. Same fact as the error above, so it
  // fails the same way rather than through a second mechanism.
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new Error('enrichment spend ledger read returned no count');
  }
  return count;
};

export interface DailyCallCeilingOptions {
  readonly resolveCeiling?: ResolveCeiling;
  readonly countCallsToday?: CountCallsToday;
  /** Injected so the day boundary is testable; defaults to the real clock. */
  readonly now?: () => string;
}

/**
 * This control is NOT atomic, stated as a value rather than left to be
 * discovered. Two callers can both count `n` before either has written a
 * counted row, so a ceiling can be exceeded by at most the number of
 * executions in flight between `authorizeCost` and the pre-transport marker.
 *
 * This paragraph used to justify that by asserting the request-scoped route was
 * the only production caller and that the Railway worker "has no cron and does
 * not call enrichment at all". Both halves are now false, and since the
 * argument is load-bearing they are corrected rather than left: the worker
 * starts `scheduler/cron.ts`, which runs `runProspectRetryJob` every 5 minutes
 * and reaches this gate through `consumeEnrichmentWork`.
 *
 * The exposure is still small, but for different and weaker reasons, all of
 * which must hold for that to stay true:
 *
 *   • the retry job is flag-dark — inert unless `PI_RETRY_SCHEDULER_ENABLED` is
 *     `'true'` AND a tenant allow-list names the tenant;
 *   • `railway.json` sets `numReplicas: 1`, so there is one cron process;
 *   • `RETRY_CONCURRENCY = 1` and one bounded batch per tenant per tick, so a
 *     cycle's calls are sequential — each counts the previous one's row;
 *   • A4N's claim admits one worker per work item, so a duplicate work item
 *     cannot become a second concurrent count.
 *
 * What remains genuinely concurrent is a cycle running alongside a user request
 * for the same tenant and provider, bounded as stated above. Before a
 * multi-replica scheduler drives this — or before the concurrency constant
 * rises — the count and the take must become one statement: an advisory lock
 * keyed on (org, provider, day), or a conditional UPDATE against a counter row,
 * which is the mechanism A4N already uses to arbitrate the attempt claim.
 * Deliberately not built here.
 */
export const boundedOvershoot = {
  atomic: false,
  reason: 'count-then-allow: concurrent callers may each observe the same count',
  boundedBy: 'executions in flight between authorizeCost and the pre-transport marker',
} as const;

/**
 * Build the `allow` function `makeTenantFundedExecutionPort` accepts.
 *
 * Returns null to permit and a reason to refuse — the seam's existing contract,
 * unchanged.
 */
export function makeDailyCallCeilingAllow(
  options: DailyCallCeilingOptions = {},
): NonNullable<TenantFundedPortOptions['allow']> {
  const resolveCeiling = options.resolveCeiling ?? defaultResolveCeiling;
  const countCallsToday = options.countCallsToday ?? defaultCountCallsToday;
  const now = options.now ?? (() => new Date().toISOString());

  return async ({ organizationId, providerId }) => {
    const ceiling = await resolveCeiling({ organizationId, providerId });

    // REQUIRED, not optional (OD-A / PI-ADR-007). This line used to read
    // `if (ceiling === null) return null` — an unconfigured tenant was treated
    // as unlimited. "Not configured" is not "unlimited": it is the absence of
    // the one fact that bounds the bill, so it refuses.
    //
    // The operational consequence is deliberate and was accepted with the
    // decision: a tenant with no `enrichment_spend_ceiling` flag row cannot
    // enrich until an operator provisions one.
    if (ceiling === null) {
      return `no daily provider call ceiling is configured for '${providerId}': `
        + 'enrichment requires one and will not proceed without it';
    }

    const { startIso, endIso } = utcDayBounds(now());
    const used = await countCallsToday({ organizationId, providerId, startIso, endIso });

    // FAIL CLOSED, as the header states: a ceiling is in force here, and a
    // count we do not hold is not a count of zero. Every comparison against a
    // non-number is false, so letting one through would silently permit the
    // billable call for the tenants who asked hardest not to be billed.
    //
    // Guarded here as well as in `defaultCountCallsToday` because `used` is
    // whatever the injected port returned: the root tsconfig sets
    // `strict: false`, so a null crosses `Promise<number>` unchallenged, and
    // this is the money path.
    //
    // A refusal and not a throw: the seam's contract is reason-or-null, and a
    // reason produces `cost_denied` with zero transport through the branch
    // `executeEnrichment` already has.
    if (typeof used !== 'number' || !Number.isFinite(used)) {
      return `daily provider call ceiling of ${ceiling} for '${providerId}' cannot be verified: `
        + `usage since ${startIso} could not be counted`;
    }

    // `>=`: a ceiling of N permits the Nth call and refuses the N+1th.
    if (used >= ceiling) {
      return `daily provider call ceiling reached for '${providerId}': `
        + `${used} of ${ceiling} used since ${startIso}`;
    }
    return null;
  };
}
