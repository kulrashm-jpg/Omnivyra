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

export interface GovernanceLoadResult {
  ok: boolean;
  records: GovernanceRecord[];
  /** Present when `ok` is false; the caller must fail closed. */
  error?: string;
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
});

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
  if (!personId && !target) return { ok: true, records: [] };

  const base = () => ownedDbTable('contact_governance_records')
    .select('id, organization_id, person_id, target_normalized, channel, governance_type, effective_from, effective_until, revoked_at')
    .eq('organization_id', organizationId)          // TENANT FIRST, always
    .is('revoked_at', null)
    .in('channel', [channel, ALL_CHANNELS]);

  const collected: GovernanceRecord[] = [];
  const seen = new Set<string>();

  // Two narrow reads rather than one `or()` — the person and target indexes are
  // separate partial indexes, and an `or()` would use neither.
  if (personId) {
    const res = await base().eq('person_id', personId);
    if (res.error) return { ok: false, records: [], error: res.error.message };
    for (const r of (res.data ?? []) as Array<Record<string, unknown>>) {
      const rec = asRecord(r);
      if (!seen.has(rec.id)) { seen.add(rec.id); collected.push(rec); }
    }
  }

  if (target) {
    const res = await base().eq('target_normalized', target);
    if (res.error) return { ok: false, records: [], error: res.error.message };
    for (const r of (res.data ?? []) as Array<Record<string, unknown>>) {
      const rec = asRecord(r);
      if (!seen.has(rec.id)) { seen.add(rec.id); collected.push(rec); }
    }
  }

  // Defence in depth: the query already filters by tenant, but a governance
  // record from another tenant must never reach the evaluator even if a future
  // query change slipped.
  const safe = collected.filter((r) => r.organizationId === organizationId);
  return { ok: true, records: safe };
}
