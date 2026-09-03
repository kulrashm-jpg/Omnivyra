/**
 * WS-3 (C-1) — Prospect Intelligence's READ-ONLY view of Market Pulse.
 *
 * The frozen enrichment decision order is: existing canonical intelligence →
 * existing internal intelligence → **MarketPulse (`market_pulse_*`)** →
 * available configured provider. WS-2's planner already has the third slot —
 * `SourceCoverage.marketPulse` — and until now nobody filled it, so PI would
 * reach for a provider without ever asking what it already knows. This module
 * is that missing answer, and deliberately nothing else.
 *
 * ─── IT READS. IT NEVER WRITES. ───────────────────────────────────────────
 * WS-3 owns read-only consumption of `market_pulse_*` and may not perform any
 * MarketPulse write. There is no insert, update, upsert or delete in this file
 * and a test asserts that, because the rule is only worth anything if it is
 * enforced. `market_pulse_*` stays the canonical MarketPulse model, written
 * only by `marketPulseV2Service*`; the legacy `marketpulse_*` family is
 * compatibility-only and is not touched here. No third store is introduced.
 *
 * ─── WHY THE ATTRIBUTE COVERAGE IS EMPTY, AND WHY THAT IS THE TRUTH ───────
 * MarketPulse is intelligence about the TENANT'S MARKET, not about a specific
 * external company. Every structure in the family is keyed by `company_id` =
 * the tenant:
 *
 *   `market_pulse_runs`      one scan for a tenant
 *   `market_pulse_findings`  a market event: category, regions, impact type
 *   `market_pulse_items_v1`  a topic per region
 *   `market_pulse_memory`    recurrence per `canonical_event_key`
 *
 * Not one of them names an external company. `market_pulse_findings.entities`
 * is written as a literal `[]` on every insert (`marketPulseV2ServiceEngine`),
 * and `buildSignalFromFinding` sets `industries: []` and derives `geography`
 * from the tenant's own scan regions.
 *
 * So MarketPulse can supply ZERO canonical Account or Person attributes, and
 * `marketPulseAttributeCoverage()` says so. Copying a tenant's market region
 * onto a prospect's `prospect_accounts.region` would read as evidence about
 * that company while being evidence about the tenant's scan scope — a
 * fabricated firmographic, which is exactly what an absence of intelligence
 * must never become.
 *
 * ─── WHAT IT CAN LEGITIMATELY OFFER: MARKET CONTEXT ───────────────────────
 * The market-level intelligence is real, and it is reusable across every
 * Account and Prospect in the tenant — not because it is copied to each one,
 * but because it is never copied at all. `readTenantMarketContext` returns a
 * reference to it with provenance intact; nothing is duplicated onto a
 * Prospect and no derived row is created.
 *
 * Binding that context to one Account — filtering by an account's region,
 * rolling it into an account intelligence envelope — is WS-7's aggregation,
 * not WS-3's. This module therefore takes `regions` as an ARGUMENT rather than
 * reading `prospect_accounts` itself, so the account join stays with its owner.
 *
 * ─── DERIVED, NOT OBSERVED ────────────────────────────────────────────────
 * Every finding is an AI market scan. `buildSignalFromFinding` already labels
 * that lineage honestly (`source_type: 'ai_inference'`), and this module keeps
 * the distinction: each item is marked `derived`, carries the confidence the
 * scan recorded, and never presents itself as a source observation.
 */

import { ownedDbTable } from '../../db/writeOwner';

/** Bumped when the consumption contract changes, so a caller traces its answer. */
export const MARKET_PULSE_PI_VERSION = 'ws3.1';

/** Run states MarketPulse itself treats as usable, matching the existing readers. */
const USABLE_RUN_STATES = ['completed', 'completed_with_warnings'] as const;

/**
 * Canonical Account/Person attributes MarketPulse can supply.
 *
 * Empty, and that is a finding rather than a placeholder — see the header. It
 * is exported as a function rather than a constant so the day a finding gains
 * an entity subject, this is the ONE place that changes and every caller
 * follows. WS-2's planner consumes it as `SourceCoverage.marketPulse`.
 */
export function marketPulseAttributeCoverage(): string[] {
  return [];
}

/** The scan a context answer came from. Provenance, not decoration. */
export interface MarketPulseRunRef {
  readonly id: string;
  readonly createdAt: string | null;
  readonly completedAt: string | null;
  /** The run's own market-direction verdict, when it recorded one. */
  readonly marketDirection: string | null;
}

/** One market finding, reduced to what a PI consumer may rely on. */
export interface MarketPulseFindingRef {
  readonly id: string;
  readonly runId: string;
  readonly category: string | null;
  readonly title: string | null;
  readonly regions: readonly string[];
  readonly impactType: string | null;
  readonly priorityTier: string | null;
  /** As the scan scored it, 0..100. Null when it recorded none — never zero. */
  readonly confidence: number | null;
  /** When the scan last saw this event, not when we read it. */
  readonly observedAt: string | null;
}

/** A finding as it reaches a consumer: the evidence plus its currency. */
export interface MarketContextItem extends MarketPulseFindingRef {
  /** Always `derived` — a market scan is interpretation, not observation. */
  readonly kind: 'derived';
  /** Whole days between `observedAt` and now. Null when the scan gave no time. */
  readonly ageDays: number | null;
  /**
   * Null means NO STALENESS POLICY WAS SUPPLIED — not "fresh". WS-3 invents no
   * shelf life for market intelligence; the caller states one or gets the age.
   */
  readonly stale: boolean | null;
}

export interface MarketContext {
  readonly version: string;
  readonly organizationId: string;
  /** False when there is nothing to reuse. `reason` says which kind of nothing. */
  readonly available: boolean;
  readonly reason: string;
  readonly run: MarketPulseRunRef | null;
  readonly items: readonly MarketContextItem[];
}

/**
 * Everything WS-3 reads. One port, so exactly one place names a table and
 * exactly one thing needs doubling in a test — the convention WS-2 established.
 */
export interface MarketPulsePorts {
  /** The tenant's most recent usable run, or null when it has never run one. */
  loadLatestRun(organizationId: string): Promise<MarketPulseRunRef | null>;
  /** Findings for that run, in that tenant. Both filters are load-bearing. */
  loadFindings(organizationId: string, runId: string): Promise<readonly MarketPulseFindingRef[]>;
}

export interface MarketContextInput {
  /** TENANT. Explicit, never ambient — a context pointer is not a credential. */
  readonly organizationId: string;
  /**
   * Optional relevance filter. Supplied by the caller (WS-7 knows an account's
   * region; WS-3 does not read `prospect_accounts`). A finding carrying NO
   * region is market-wide and is kept regardless, because dropping it would
   * hide global context behind a regional question.
   */
  readonly regions?: readonly string[];
  /** Caller policy. Absent means currency is reported, never asserted. */
  readonly stalenessDays?: number;
  /** Injected. The only source of "now". */
  readonly now: string;
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

/**
 * `null`, `undefined` and `''` stay null. `Number(null)` is 0, and a confidence
 * the scan never recorded must never arrive as a confident zero — absence is
 * abstention.
 */
const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((r) => text(r)).filter((r): r is string => r !== null) : [];

const daysBetween = (from: string | null, to: string): number | null => {
  if (!from) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
};

/**
 * The default port. The ONLY place in WS-3 that names a table.
 *
 * Tenant scoping is applied to the run AND to the findings, not just the run.
 * Filtering findings by `run_id` alone would trust that every finding row is
 * stamped with the run's tenant; filtering by `company_id` too means a
 * mis-stamped row cannot cross a tenant boundary on the strength of a join.
 */
export const defaultMarketPulsePorts: MarketPulsePorts = {
  async loadLatestRun(organizationId: string): Promise<MarketPulseRunRef | null> {
    const { data, error } = await ownedDbTable('market_pulse_runs')
      .select('id, created_at, completed_at, market_direction, status')
      .eq('company_id', organizationId)             // tenant boundary — never optional
      .in('status', [...USABLE_RUN_STATES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // An unreadable canonical row is reported, never softened into "no data" —
    // a broken read and an empty market are different facts.
    if (error) throw new Error(`market_pulse_runs read failed: ${error.message}`);
    if (!data) return null;

    const row = data as Record<string, unknown>;
    return {
      id: String(row.id),
      createdAt: text(row.created_at),
      completedAt: text(row.completed_at),
      marketDirection: text(row.market_direction),
    };
  },

  async loadFindings(organizationId: string, runId: string): Promise<readonly MarketPulseFindingRef[]> {
    const { data, error } = await ownedDbTable('market_pulse_findings')
      .select('id, run_id, category, title, regions, impact_type, priority_tier, confidence_score, last_seen_at, created_at')
      .eq('company_id', organizationId)             // tenant boundary — never optional
      .eq('run_id', runId)
      .order('relevance_score', { ascending: false });

    if (error) throw new Error(`market_pulse_findings read failed: ${error.message}`);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      runId: String(row.run_id),
      category: text(row.category),
      title: text(row.title),
      regions: stringArray(row.regions),
      impactType: text(row.impact_type),
      priorityTier: text(row.priority_tier),
      confidence: numberOrNull(row.confidence_score),
      // `last_seen_at` is when the scan last observed the event; `created_at`
      // is only when the row was written. Prefer the observation.
      observedAt: text(row.last_seen_at) ?? text(row.created_at),
    }));
  },
};

/**
 * Read the tenant's existing market intelligence, without copying it anywhere.
 *
 * This is the "existing intelligence first" step of the frozen decision order.
 * It creates no row, derives no attribute and duplicates nothing onto a
 * Prospect: the same context serves every Prospect and every Account in the
 * tenant because it is referenced rather than reproduced.
 *
 * An absent market is reported as absent. There is deliberately no fallback
 * that turns "this tenant has never run a scan" into a confident empty answer,
 * because the two are different findings and a consumer must be able to tell
 * a coverage gap from an outage.
 */
export async function readTenantMarketContext(
  input: MarketContextInput,
  ports: MarketPulsePorts = defaultMarketPulsePorts,
): Promise<MarketContext> {
  if (!input.organizationId?.trim()) {
    throw new Error('organizationId is required to read market context');
  }
  if (!input.now?.trim()) {
    throw new Error('now is required — market context freshness is never derived from ambient time');
  }

  const base = {
    version: MARKET_PULSE_PI_VERSION,
    organizationId: input.organizationId,
  };

  const run = await ports.loadLatestRun(input.organizationId);
  if (!run) {
    return { ...base, available: false, run: null, items: [],
      reason: 'this tenant has no completed Market Pulse run — there is no market intelligence to reuse yet' };
  }

  const findings = await ports.loadFindings(input.organizationId, run.id);
  if (findings.length === 0) {
    // Distinct from the case above on purpose: the scan RAN and found nothing,
    // which is a market fact, not a missing capability.
    return { ...base, available: false, run, items: [],
      reason: `the latest Market Pulse run (${run.id}) produced no findings` };
  }

  const wanted = new Set((input.regions ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean));
  const relevant = wanted.size === 0
    ? findings
    // A finding with no region is market-wide, so a regional question keeps it.
    : findings.filter((f) => f.regions.length === 0
      || f.regions.some((r) => wanted.has(r.trim().toLowerCase())));

  if (relevant.length === 0) {
    return { ...base, available: false, run, items: [],
      reason: `the latest run has findings, but none for the requested region(s): ${[...wanted].join(', ')}` };
  }

  const hasPolicy = typeof input.stalenessDays === 'number' && input.stalenessDays >= 0;
  const items: MarketContextItem[] = relevant.map((f) => {
    const ageDays = daysBetween(f.observedAt, input.now);
    return {
      ...f,
      kind: 'derived' as const,
      ageDays,
      // Unknown age under a real policy is NOT fresh: currency cannot be shown,
      // so it is reported stale. That mirrors WS-2's treatment of a field with
      // no `observedAt`, rather than inventing a second freshness rule.
      stale: hasPolicy ? (ageDays === null || ageDays > (input.stalenessDays as number)) : null,
    };
  });

  return { ...base, available: true, run, items,
    reason: `${items.length} finding(s) from the latest Market Pulse run; derived market intelligence, reused by reference` };
}
