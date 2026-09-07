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
 * ─── ABSENT POLICY IS ABSENT I/O ──────────────────────────────────────────
 * The global switch is checked first and costs nothing — the same shape
 * `isLeadIngestionEnabled` uses, and for the same reason. With no ceiling
 * configured this function permits before reading anything, so a platform that
 * has not opted in behaves EXACTLY as it did before, including making no extra
 * database round trip.
 *
 * ─── FAIL CLOSED, BUT ONLY FOR TENANTS WHO OPTED IN ───────────────────────
 * If a ceiling IS configured and usage cannot be counted, we cannot prove we
 * are under it, so the call is refused. That mirrors suppression, which
 * propagates a read error rather than reading it as "nothing found". It cannot
 * affect anyone who has not configured a ceiling, because those callers return
 * above without ever reaching the read.
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

/** The global switch. Off or absent ⇒ no ceiling is enforced anywhere. */
export function isSpendCeilingEnabled(): boolean {
  const raw = String(process.env.ENABLE_ENRICHMENT_SPEND_CEILING ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

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
  return typeof count === 'number' ? count : 0;
};

export interface DailyCallCeilingOptions {
  readonly resolveCeiling?: ResolveCeiling;
  readonly countCallsToday?: CountCallsToday;
  /** Injected so the day boundary is testable; defaults to the real clock. */
  readonly now?: () => string;
  /** Injected so a test need not set an environment variable. */
  readonly enabled?: () => boolean;
}

/**
 * This control is NOT atomic, stated as a value rather than left to be
 * discovered. Two callers can both count `n` before either has written a
 * counted row, so a ceiling can be exceeded by at most the number of
 * executions in flight between `authorizeCost` and the pre-transport marker.
 *
 * Today that window is narrow and the exposure small: the only production
 * caller is the request-scoped route, and the Railway worker runs
 * `numReplicas: 1` with no cron and does not call enrichment at all. Before a
 * multi-replica scheduler drives this, the count and the take must become one
 * statement — an advisory lock keyed on (org, provider, day), or a conditional
 * UPDATE against a counter row, which is the mechanism A4N already uses to
 * arbitrate the attempt claim. Deliberately not built here.
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
  const enabled = options.enabled ?? isSpendCeilingEnabled;
  const resolveCeiling = options.resolveCeiling ?? defaultResolveCeiling;
  const countCallsToday = options.countCallsToday ?? defaultCountCallsToday;
  const now = options.now ?? (() => new Date().toISOString());

  return async ({ organizationId, providerId }) => {
    // Free, leaks nothing, and returns before any I/O — so a platform that has
    // not opted in is byte-identical to the behaviour before this existed.
    if (!enabled()) return null;

    const ceiling = await resolveCeiling({ organizationId, providerId });
    if (ceiling === null) return null;              // configured for others, not for this

    const { startIso, endIso } = utcDayBounds(now());
    const used = await countCallsToday({ organizationId, providerId, startIso, endIso });

    // `>=`: a ceiling of N permits the Nth call and refuses the N+1th.
    if (used >= ceiling) {
      return `daily provider call ceiling reached for '${providerId}': `
        + `${used} of ${ceiling} used since ${startIso}`;
    }
    return null;
  };
}
