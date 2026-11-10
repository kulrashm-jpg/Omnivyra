/**
 * "Data sources & usage" (owner, 2026-11-10): every data source a tenant uses,
 * per source, per user, per period and per run, so the tenant can reconcile
 * against the vendor's own usage page and see the value they got.
 *
 * READS the existing ledgers only (no parallel ledger, no backfill):
 *   prospect_enrichment_attempts   vendor enrichment calls (Apollo, ...)
 *   prospect_discovery_attempts    vendor searches (Apollo discovery, ...)
 *   prospect_capture_runs          Sales Navigator capture pushes
 *
 * Tenant-scoped on every read (organization_id). Counts, ids and dates only:
 * no person data leaves this module. Users are named only when they are an
 * ACTIVE member of this tenant; anyone else is reported as a former member.
 *
 * HONEST ABOUT GAPS: before migration 20270209000000 the usage columns do not
 * exist, and a ledger that cannot be read is reported as `unavailable`, never
 * as zero. A window that hits the row cap is reported as `truncated`.
 */
import { ownedDbTable } from '../../db/writeOwner';

export const USAGE_MAX_DAYS = 92;
export const USAGE_ROW_CAP = 5000;

export type UsageKind = 'enrichment' | 'discovery' | 'capture';

/** One ledger row, normalised. */
export interface UsageEvent {
  kind: UsageKind;
  source: string;                    // provider key, e.g. 'apollo', 'linkedin_sales_navigator'
  runId: string;                     // attempt id or capture command id
  at: string;                        // ISO time
  userId: string | null;
  funding: 'tenant' | 'platform' | null;
  vendorUnits: number | null;        // what the VENDOR billed, in its own unit
  creditsCharged: number | null;     // Omnivyra credits confirmed
  outcome: string | null;            // enrichment outcome / discovery status / capture status
  // Value: what the tenant got.
  leadsReceived: number;             // capture: received; discovery: observed
  leadsAdded: number;                // capture: created; discovery: ingested; enrichment: 1 if enriched
  leadsUpdated: number;              // capture: updated
  heldForReview: number;
  skippedDuplicates: number;
}

export interface UsageTotals {
  runs: number;
  vendorUnits: number;
  vendorUnitsUnknownRuns: number;    // runs whose vendor units are not recorded
  creditsCharged: number;
  leadsReceived: number;
  leadsAdded: number;
  leadsUpdated: number;
  heldForReview: number;
  skippedDuplicates: number;
}

export interface UsageReport {
  window: { from: string; to: string };
  ledgers: Record<UsageKind, 'ok' | 'unavailable' | 'truncated'>;
  totals: UsageTotals;
  bySource: Array<{ source: string; kind: UsageKind } & UsageTotals>;
  byUser: Array<{ userId: string | null; label: string } & UsageTotals>;
  byDay: Array<{ day: string } & UsageTotals>;
  runs: UsageEvent[];                // newest first, capped for display
}

const zero = (): UsageTotals => ({
  runs: 0, vendorUnits: 0, vendorUnitsUnknownRuns: 0, creditsCharged: 0,
  leadsReceived: 0, leadsAdded: 0, leadsUpdated: 0, heldForReview: 0, skippedDuplicates: 0,
});

function add(t: UsageTotals, e: UsageEvent): void {
  t.runs += 1;
  if (e.vendorUnits == null) { if (e.kind !== 'capture') t.vendorUnitsUnknownRuns += 1; } else t.vendorUnits += e.vendorUnits;
  t.creditsCharged += e.creditsCharged ?? 0;
  t.leadsReceived += e.leadsReceived;
  t.leadsAdded += e.leadsAdded;
  t.leadsUpdated += e.leadsUpdated;
  t.heldForReview += e.heldForReview;
  t.skippedDuplicates += e.skippedDuplicates;
}

/** Pure aggregation. Deterministic ordering for stable output. */
export function aggregateUsage(
  events: UsageEvent[],
  labels: ReadonlyMap<string, string>,
  window: { from: string; to: string },
  ledgers: UsageReport['ledgers'],
  runLimit = 200,
): UsageReport {
  const totals = zero();
  const src = new Map<string, { source: string; kind: UsageKind } & UsageTotals>();
  const usr = new Map<string, { userId: string | null; label: string } & UsageTotals>();
  const day = new Map<string, { day: string } & UsageTotals>();
  for (const e of events) {
    add(totals, e);
    const sk = `${e.kind}:${e.source}`;
    if (!src.has(sk)) src.set(sk, { source: e.source, kind: e.kind, ...zero() });
    add(src.get(sk)!, e);
    const uk = e.userId ?? '';
    if (!usr.has(uk)) {
      usr.set(uk, { userId: e.userId, label: e.userId ? (labels.get(e.userId) ?? 'Former member') : 'Automatic (system)', ...zero() });
    }
    add(usr.get(uk)!, e);
    const dk = e.at.slice(0, 10);
    if (!day.has(dk)) day.set(dk, { day: dk, ...zero() });
    add(day.get(dk)!, e);
  }
  const runs = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.runId.localeCompare(b.runId)));
  return {
    window, ledgers, totals,
    bySource: [...src.values()].sort((a, b) => b.runs - a.runs || a.source.localeCompare(b.source)),
    byUser: [...usr.values()].sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label)),
    byDay: [...day.values()].sort((a, b) => a.day.localeCompare(b.day)),
    runs: runs.slice(0, runLimit),
  };
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const nn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fund = (v: unknown): 'tenant' | 'platform' | null => (v === 'tenant' || v === 'platform' ? v : null);

type Read = { rows: Array<Record<string, unknown>>; state: 'ok' | 'unavailable' | 'truncated' };

export interface UsageDeps {
  read?: (kind: UsageKind, org: string, from: string, to: string) => Promise<Read>;
  memberLabels?: (org: string, userIds: string[]) => Promise<Map<string, string>>;
}

const LEDGER: Record<UsageKind, { table: string; time: string; cols: string }> = {
  enrichment: {
    table: 'prospect_enrichment_attempts', time: 'started_at',
    cols: 'id, provider_key, started_at, outcome, provider_call_state, funding, provider_cost_units, credits_charged, initiated_by',
  },
  discovery: {
    table: 'prospect_discovery_attempts', time: 'started_at',
    cols: 'id, provider_key, started_at, execution_status, provider_cost_units, funding, credits_charged, initiated_by, results_observed, results_ingested, results_skipped_duplicate, results_held_for_review',
  },
  capture: {
    table: 'prospect_capture_runs', time: 'created_at',
    cols: 'command_id, provider, created_at, status, initiated_by, received, created, updated, duplicates_parked',
  },
};

async function defaultRead(kind: UsageKind, org: string, from: string, to: string): Promise<Read> {
  const l = LEDGER[kind];
  try {
    const res = await ownedDbTable(l.table)
      .select(l.cols)
      .eq('organization_id', org)
      .gte(l.time, from)
      .lt(l.time, to)
      .order(l.time, { ascending: false })
      .limit(USAGE_ROW_CAP + 1);
    // A null error is not an answer: only an array is.
    if (res.error || !Array.isArray(res.data)) return { rows: [], state: 'unavailable' };
    const rows = res.data as Array<Record<string, unknown>>;
    return rows.length > USAGE_ROW_CAP ? { rows: rows.slice(0, USAGE_ROW_CAP), state: 'truncated' } : { rows, state: 'ok' };
  } catch {
    return { rows: [], state: 'unavailable' };
  }
}

async function defaultMemberLabels(org: string, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  try {
    const m = await ownedDbTable('user_company_roles')
      .select('user_id').eq('company_id', org).eq('status', 'active').in('user_id', userIds);
    if (m.error || !Array.isArray(m.data)) return out;
    const members = [...new Set((m.data as Array<{ user_id: string }>).map((r) => r.user_id))];
    if (members.length === 0) return out;
    const u = await ownedDbTable('users').select('id, name, email').in('id', members);
    if (u.error || !Array.isArray(u.data)) return out;
    for (const r of u.data as Array<{ id: string; name?: string | null; email?: string | null }>) {
      out.set(r.id, (r.name && r.name.trim()) || r.email || 'Member');
    }
  } catch { /* unnamed users fall back to "Former member"; never fails the report */ }
  return out;
}

export function toEvent(kind: UsageKind, r: Record<string, unknown>): UsageEvent {
  if (kind === 'capture') {
    return {
      kind, source: String(r.provider ?? 'linkedin_sales_navigator'), runId: String(r.command_id ?? ''),
      at: String(r.created_at ?? ''), userId: (r.initiated_by as string) ?? null,
      funding: null, vendorUnits: null, creditsCharged: 0, outcome: (r.status as string) ?? null,
      leadsReceived: n(r.received), leadsAdded: n(r.created), leadsUpdated: n(r.updated),
      heldForReview: 0, skippedDuplicates: n(r.duplicates_parked),
    };
  }
  if (kind === 'discovery') {
    return {
      kind, source: String(r.provider_key ?? ''), runId: String(r.id ?? ''),
      at: String(r.started_at ?? ''), userId: (r.initiated_by as string) ?? null,
      funding: fund(r.funding), vendorUnits: nn(r.provider_cost_units), creditsCharged: nn(r.credits_charged),
      outcome: (r.execution_status as string) ?? null,
      leadsReceived: n(r.results_observed), leadsAdded: n(r.results_ingested), leadsUpdated: 0,
      heldForReview: n(r.results_held_for_review), skippedDuplicates: n(r.results_skipped_duplicate),
    };
  }
  return {
    kind, source: String(r.provider_key ?? ''), runId: String(r.id ?? ''),
    at: String(r.started_at ?? ''), userId: (r.initiated_by as string) ?? null,
    funding: fund(r.funding), vendorUnits: nn(r.provider_cost_units), creditsCharged: nn(r.credits_charged),
    outcome: (r.outcome as string) ?? null,
    leadsReceived: 0, leadsAdded: r.outcome === 'enriched' ? 1 : 0, leadsUpdated: 0,
    heldForReview: 0, skippedDuplicates: 0,
  };
}

/** Validate and clamp the window: [from, to), at most USAGE_MAX_DAYS. */
export function usageWindow(fromRaw: unknown, toRaw: unknown, now: Date): { from: string; to: string } | null {
  const to = typeof toRaw === 'string' && toRaw ? new Date(toRaw) : now;
  const from = typeof fromRaw === 'string' && fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * 86_400_000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime()) || from >= to) return null;
  if (to.getTime() - from.getTime() > USAGE_MAX_DAYS * 86_400_000) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function buildUsageReport(
  org: string, window: { from: string; to: string }, deps: UsageDeps = {},
): Promise<UsageReport> {
  if (!org?.trim()) throw new Error('organization is required');
  const read = deps.read ?? defaultRead;
  const labelsOf = deps.memberLabels ?? defaultMemberLabels;
  const kinds: UsageKind[] = ['enrichment', 'discovery', 'capture'];
  const reads = await Promise.all(kinds.map((k) => read(k, org, window.from, window.to)));
  const ledgers = {} as UsageReport['ledgers'];
  const events: UsageEvent[] = [];
  kinds.forEach((k, i) => {
    ledgers[k] = reads[i].state;
    for (const r of reads[i].rows) events.push(toEvent(k, r));
  });
  const userIds = [...new Set(events.map((e) => e.userId).filter((u): u is string => !!u))];
  const labels = await labelsOf(org, userIds);
  return aggregateUsage(events, labels, window, ledgers);
}
