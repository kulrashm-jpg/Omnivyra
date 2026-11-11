/**
 * LI-3C — read-only persistence for canonical contact governance.
 *
 * The pure evaluator (`mayContact`) must never touch a database, so something
 * has to load its input. This is that something, and nothing more: it reads
 * tenant-scoped governance records and returns them. It performs no writes, no
 * provider calls, no credit accounting, and contains no evaluation logic —
 * every decision rule lives in `contactGovernance.ts` and is not duplicated here.
 *
 * ─── TENANT SCOPING IS NOT OPTIONAL ───────────────────────────────────────
 * `organization_id` is required and is the FIRST predicate on every query. It
 * is never inferred from a person id, a target string or a channel, because
 * those are all values a caller could hold for the wrong tenant. There is no
 * global scope and no `__global__` sentinel — ADR D-1.
 *
 * ─── FAIL CLOSED ──────────────────────────────────────────────────────────
 * A read failure returns `{ ok: false }`, and the caller is expected to treat
 * that as suppressed. Path B's existing `loadSuppressionMatches` already takes
 * that position for the same reason: reading an unreadable suppression list as
 * "nobody is suppressed" would contact people who asked not to be.
 *
 * ─── THE DECISION INSTANT TRAVELS WITH THE ROWS ─────────────────────────
 * Every select here also asks for `read_at`, the PostgREST computed field
 * `public.read_at(public.contact_governance_records)`, which returns
 * `pg_catalog.transaction_timestamp()`. PostgREST serves ONE transaction per
 * request, so every row of one response carries the IDENTICAL value, and that
 * value IS the instant that response's snapshot was taken at.
 *
 * Why it has to arrive this way rather than from the caller: the stored
 * timestamps are database-stamped, and a caller's `Date` is a DIFFERENT clock.
 * Measured on the development host, Node ran behind Postgres in 1458 of 1485
 * samples, and a `w32time` step moved it 3.135 s mid-run. Comparing a database
 * instant against a host clock is a fail-open on a suppression check.
 *
 * THIS MODULE STILL DECIDES NOTHING. It reports what each request returned —
 * its rows and its own instant — and `contactGovernanceAggregation.ts` hands
 * each set to `mayContact` with the instant it arrived with. No instant is ever
 * carried from one request to another, and none is invented here.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { normalizeEmail, normalizePhone } from '../identityResolutionService';
import { ALL_CHANNELS, type GovernanceChannel, type GovernanceRecord, type GovernanceType } from './contactGovernance';

export interface GovernanceLookup {
  organizationId: string;
  /**
   * Canonical person, when the caller knows it. Path B does not currently carry
   * one — see the note in governanceService — so target matching is the
   * operative path today.
   */
  personId?: string | null;
  /** Raw recipient address or number; normalised here, never by the caller. */
  target?: string | null;
  channel: GovernanceChannel;
}

/**
 * Which anchor ONE PostgREST request was filtered on. `person` and `target` are
 * the two narrow reads of the anchored loader; `tenant` is the single
 * unanchored read of `loadTenantGovernanceRecords`.
 */
export type GovernanceReadAnchor = 'person' | 'target' | 'tenant';

/**
 * ONE PostgREST request, reported as it came back.
 *
 * The point of this type is that `records` and `readAt` are NOT independently
 * sourced: they arrived in the same response, inside the same database
 * transaction, so the instant cannot drift from the rows it describes.
 */
export interface GovernanceRead {
  anchor: GovernanceReadAnchor;
  /** false when the request itself failed. The decision must fail closed. */
  ok: boolean;
  /** This request's rows, tenant-rechecked. Never another request's rows. */
  records: GovernanceRecord[];
  /**
   * This request's database snapshot instant, from its own `read_at`.
   *
   * `null` carries TWO situations the aggregator deliberately distinguishes:
   *   • `records` is EMPTY — no row, so no instant, and none is needed: the
   *     evaluator never reads an instant for an empty record set.
   *   • `records` is NOT empty — the response carried rows but no usable
   *     shared instant. That is INDETERMINATE and must fail closed. It is never
   *     rounded down to "evaluate them against something else".
   */
  readAt: string | null;
  error?: string;
}

export interface GovernanceLoadResult {
  ok: boolean;
  records: GovernanceRecord[];
  /** Present when `ok` is false; the caller must fail closed. */
  error?: string;
  /**
   * The individual requests this call made, each with its OWN instant.
   *
   * OPTIONAL, so that every existing consumer — and every hand-built port
   * double of `OutreachReadinessPorts.loadGovernance` — keeps compiling and
   * keeps behaving exactly as before by reading `records`. The real loaders
   * below always populate it. A consumer that evaluates per read must treat its
   * ABSENCE as indeterminate rather than as "one read with no instant".
   */
  reads?: GovernanceRead[];
}

/**
 * Normalise a recipient the same way the canonical spine does. Reuses the
 * existing normalisers rather than introducing a third spelling of "what is
 * this address, really" — the whole reason W1 exported them.
 */
export function normalizeGovernanceTarget(
  channel: GovernanceChannel,
  target?: string | null,
): string | null {
  if (typeof target !== 'string' || !target.trim()) return null;
  if (channel === 'email') return normalizeEmail(target);
  if (channel === 'phone' || channel === 'whatsapp') return normalizePhone(target);
  // An unknown or future channel: fall back to a conservative casefold rather
  // than guessing which normaliser applies.
  return target.trim().toLowerCase() || null;
}

const asRecord = (r: Record<string, unknown>): GovernanceRecord => ({
  id: String(r.id),
  organizationId: String(r.organization_id),
  personId: r.person_id === null || r.person_id === undefined ? null : String(r.person_id),
  targetNormalized: r.target_normalized === null || r.target_normalized === undefined ? null : String(r.target_normalized),
  channel: String(r.channel),
  governanceType: String(r.governance_type) as GovernanceType,
  effectiveFrom: String(r.effective_from),
  effectiveUntil: r.effective_until === null || r.effective_until === undefined ? null : String(r.effective_until),
  revokedAt: r.revoked_at === null || r.revoked_at === undefined ? null : String(r.revoked_at),
  // PG-001. NULL stays NULL rather than becoming the string "null": the
  // evaluator reads absence as "applies to every purpose", and a stringified
  // null would be an unrecognised value that happens to behave the same way by
  // luck. Preserving the distinction keeps the column auditable.
  purposeScope: r.purpose_scope === null || r.purpose_scope === undefined ? null : String(r.purpose_scope),
});

/**
 * The ONE database instant a response's rows were read at.
 *
 * `read_at` is a computed field, so it arrives on every row rather than beside
 * the set. PostgREST runs one transaction per request and the function returns
 * `transaction_timestamp()`, so every row of one response MUST carry the same
 * value. This checks that rather than trusting it, and returns `null` — never
 * a guess — when it does not hold.
 *
 *   zero rows        → null, and that is correct: no row, no instant.
 *   every row agrees → that value.
 *   a row has none   → null. The producer did not supply the computed field.
 *   rows disagree    → null. Two transaction timestamps in one response is a
 *                      contract violation, and picking one of them would be
 *                      choosing a fail-open direction by coin flip.
 *
 * A `null` against a NON-EMPTY record set is what the aggregator fails closed
 * on. Deciding that here would be evaluation, which this module does not do.
 */
/**
 * A request that did not return rows at all.
 *
 * Deliberately NOT `{ ok: true, records: [] }`. "We could not ask" and "nobody
 * is governed" are the same shape and opposite facts, and conflating them is
 * the fail-open this whole module is built against.
 */
const failedRead = (anchor: GovernanceReadAnchor, error: string): GovernanceRead => ({
  anchor, ok: false, records: [], readAt: null, error,
});

function sharedReadInstant(rows: ReadonlyArray<Record<string, unknown>>): string | null {
  let instant: string | null = null;
  for (const r of rows) {
    const raw = r.read_at;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    if (instant === null) instant = raw;
    else if (raw !== instant) return null;
  }
  return instant;
}

/**
 * Load the governance records that could apply to one recipient on one channel.
 *
 * The query deliberately does NOT filter by `effective_from` / `effective_until`
 * — temporal evaluation belongs to `mayContact`, which owns every rule. Pushing
 * it into SQL would split the decision across two places, which is how the two
 * legacy suppression stacks came to disagree with each other.
 *
 * Channel filtering IS applied, because it is a cheap equality that cannot
 * change a verdict: `mayContact` matches `channel IN (requested, '*')` and this
 * fetches exactly that set.
 */
/**
 * W0-B — every non-revoked record for ONE tenant on the given channels.
 *
 * `loadGovernanceRecords` is anchored to a person or a target, which is right
 * for a single decision but would mean one query per row for a bulk egress
 * check. This reads the same rows with the same tenant and revocation filters,
 * unanchored, so a caller can evaluate many subjects in memory with the pure
 * `mayContact`. It adds no table and no column.
 *
 * `ALL_CHANNELS` is always included: a `'*'` record governs every channel.
 */
export async function loadTenantGovernanceRecords(
  organizationId: string,
  channels: readonly string[],
): Promise<GovernanceLoadResult> {
  if (!organizationId || !String(organizationId).trim()) {
    throw new Error('loadTenantGovernanceRecords: organizationId is required — governance is never read without a tenant');
  }
  const wanted = [...new Set([...channels.filter((c) => c && String(c).trim()), ALL_CHANNELS])];
  // Only the wildcard: no channel asked for, so no request is made. ZERO reads,
  // not one empty read — and the aggregator reads those the same way, because
  // nothing was asked and nothing could have applied. Behaviour unchanged.
  if (wanted.length === 1) return { ok: true, records: [], reads: [] };

  // A THROW is a failure like any other, reported rather than propagated: the
  // caller's contract is to redact when this is not `ok`, and an exception
  // escaping here would turn an egress refusal into a crash.
  let res: { data?: unknown; error?: { message?: string } | null };
  try {
    res = await ownedDbTable('contact_governance_records')
      .select('id, organization_id, person_id, target_normalized, channel, governance_type, effective_from, effective_until, revoked_at, purpose_scope, read_at')
      .eq('organization_id', organizationId)          // TENANT FIRST, always
      .is('revoked_at', null)
      .in('channel', wanted);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, records: [], error, reads: [failedRead('tenant', error)] };
  }
  if (res.error) {
    const error = res.error.message ?? 'governance read failed';
    return { ok: false, records: [], error, reads: [failedRead('tenant', error)] };
  }

  const rows = (res.data ?? []) as Array<Record<string, unknown>>;
  // Same defence in depth as the anchored loader.
  const safe = rows.map(asRecord).filter((r) => r.organizationId === organizationId);
  // The instant is read from the ROWS THAT CAME BACK, before the tenant
  // recheck drops any — a dropped row cannot change a transaction timestamp,
  // and reading it from the filtered set would make the instant disappear
  // whenever the recheck emptied it.
  return { ok: true, records: safe, reads: [{ anchor: 'tenant', ok: true, records: safe, readAt: sharedReadInstant(rows) }] };
}

export async function loadGovernanceRecords(lookup: GovernanceLookup): Promise<GovernanceLoadResult> {
  const { organizationId, channel } = lookup;
  if (!organizationId || !String(organizationId).trim()) {
    throw new Error('loadGovernanceRecords: organizationId is required — governance is never read without a tenant');
  }
  if (!channel || !String(channel).trim()) {
    throw new Error('loadGovernanceRecords: channel is required');
  }

  const personId = lookup.personId ?? null;
  const target = normalizeGovernanceTarget(channel, lookup.target);

  // Anchored to nothing: no record could match, so there is nothing to read.
  // ZERO reads — nothing was asked, so there is no instant to want.
  if (!personId && !target) return { ok: true, records: [], reads: [] };

  const base = () => ownedDbTable('contact_governance_records')
    .select('id, organization_id, person_id, target_normalized, channel, governance_type, effective_from, effective_until, revoked_at, purpose_scope, read_at')
    .eq('organization_id', organizationId)          // TENANT FIRST, always
    .is('revoked_at', null)
    .in('channel', [channel, ALL_CHANNELS]);

  const collected: GovernanceRecord[] = [];
  const seen = new Set<string>();
  const reads: GovernanceRead[] = [];

  // Two narrow reads rather than one `or()` — the person and target indexes are
  // separate partial indexes, and an `or()` would use neither.
  //
  // THEY ARE TWO REQUESTS, SO THEY ARE TWO TRANSACTIONS, so each has its own
  // `transaction_timestamp()`. Each is recorded below with the instant IT came
  // back with; the flat `records` list keeps the pre-existing cross-read dedup
  // for callers that still read it, and is deliberately not what the per-read
  // evaluation uses.
  if (personId) {
    const res = await base().eq('person_id', personId);
    if (res.error) {
      const error = res.error.message ?? 'governance read failed';
      return { ok: false, records: [], error, reads: [...reads, failedRead('person', error)] };
    }
    const rows = (res.data ?? []) as Array<Record<string, unknown>>;
    const own: GovernanceRecord[] = [];
    for (const r of rows) {
      const rec = asRecord(r);
      // Defence in depth, per read: a record from another tenant must never
      // reach the evaluator even if a future query change slipped.
      if (rec.organizationId !== organizationId) continue;
      own.push(rec);
      if (!seen.has(rec.id)) { seen.add(rec.id); collected.push(rec); }
    }
    reads.push({ anchor: 'person', ok: true, records: own, readAt: sharedReadInstant(rows) });
  }

  if (target) {
    const res = await base().eq('target_normalized', target);
    if (res.error) {
      const error = res.error.message ?? 'governance read failed';
      return { ok: false, records: [], error, reads: [...reads, failedRead('target', error)] };
    }
    const rows = (res.data ?? []) as Array<Record<string, unknown>>;
    const own: GovernanceRecord[] = [];
    for (const r of rows) {
      const rec = asRecord(r);
      if (rec.organizationId !== organizationId) continue;
      own.push(rec);
      // A record matching BOTH anchors is reported in both reads and is
      // evaluated twice. That cannot change a verdict: the two evaluations
      // combine in the restrictive direction only.
      if (!seen.has(rec.id)) { seen.add(rec.id); collected.push(rec); }
    }
    reads.push({ anchor: 'target', ok: true, records: own, readAt: sharedReadInstant(rows) });
  }

  // Unchanged for every existing consumer: the flat, cross-read, tenant-checked
  // list. The per-read filter above already applied the same tenant recheck, so
  // this is the same set it always was.
  const safe = collected.filter((r) => r.organizationId === organizationId);
  return { ok: true, records: safe, reads };
}
