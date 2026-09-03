/**
 * LC-501 (W5.1) — C1 Suppression & Consent Platform (THE ONE suppression engine).
 *
 * Every outbound connector MUST consult `isSuppressed` before dispatch — there is no
 * other suppression logic anywhere. Fail-CLOSED for safety: a lookup error suppresses,
 * and never lets a message through on an error.
 *
 * ─── A3 / CONTRACT 13 — GOVERNANCE CONVERGENCE ────────────────────────────
 * `contact_governance_records` is now the CANONICAL store, and this module reads
 * and writes it first. `suppression_entries` — the table this service used to
 * own outright — is on its way out.
 *
 * WHY CONVERGE HERE RATHER THAN AT THE CALLERS. This module is the only reader
 * of `suppression_entries` in the codebase; `executionBridge` and
 * `pages/api/lead-intelligence/execution.ts` reach it exclusively through these
 * three functions. Migrating the implementation therefore migrates every
 * consumer without touching a single call site, which is both the smallest and
 * the safest change available.
 *
 * WHY THE LEGACY TABLE IS STILL READ AND STILL WRITTEN. Two reasons, neither
 * cosmetic:
 *   1. GLOBAL SCOPE. This service can suppress a target for EVERY tenant via the
 *      `__global__` sentinel. The canonical model has no global scope and no
 *      sentinel — ADR D-1 is explicit that governance is never tenant-less — so
 *      a global suppression is simply not expressible canonically. Dropping the
 *      legacy write would silently delete that capability.
 *   2. Retiring a table requires a proven-zero-consumer sweep, which is out of
 *      this wave's scope. Until then, a row that exists only in the legacy table
 *      must still block a send.
 * Both tables hold ZERO rows in production, so there is no data to merge — the
 * convergence is entirely about which store new writes land in, and both stores
 * are consulted on every read.
 *
 * WHAT REMAINS OWED (reported, not hidden): the `__global__` scope needs a
 * product decision before `suppression_entries` can be dropped, and
 * `outreach_suppressions` still carries task/lead/channel scopes that the
 * canonical person/target model cannot express at all.
 *
 * ─── NOT IN SCOPE ─────────────────────────────────────────────────────────
 * `consent_records` is NOT touched, read, written or referenced by this module.
 * It is an OAuth / platform-capability consent ledger — a different domain from
 * contact governance, and deliberately excluded.
 *
 * Every governance RULE lives in `prospectIdentity/contactGovernance.mayContact`,
 * which is called and never reimplemented. No second governance engine exists here.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { mayContact, type GovernanceType } from '../prospectIdentity/contactGovernance';
import { loadGovernanceRecords, normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';
import { recordContactGovernance, revokeContactGovernance } from '../prospectIdentity/contactGovernanceWriter';
import {
  recordGovernanceFailClosed,
  recordGovernanceGateDecision,
  type GovernanceFailClosedStage,
} from '../prospectIdentity/telemetry';
import { logger } from '../logger';

const T = 'suppression_entries';
const GLOBAL = '__global__';
const norm = (v: string): string => String(v ?? '').trim().toLowerCase();

export type SuppressionReason = 'unsubscribe' | 'consent_withdrawn' | 'dsar' | 'legal_hold' | 'bounce' | 'complaint' | 'manual';

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
  scope?: string;
  /** A3 — which store answered: the canonical table, or the legacy one. */
  store?: 'canonical' | 'legacy';
}

/**
 * Translate this service's reason vocabulary into the ADR's closed governance
 * vocabulary.
 *
 * Two of the reasons have no direct canonical counterpart, and the mapping is a
 * judgement recorded here rather than buried:
 *   dsar       — an erasure request is a standing instruction never to contact
 *   legal_hold — likewise, for a different legal reason
 * Both become a do-not-contact. `manual` is an operator acting without a stated
 * cause, which is also a do-not-contact.
 *
 * CHANNEL DECIDES WHICH DNC. The database refuses `dnc_permanent` on a specific
 * channel (`contact_governance_permanent_is_all_channels`) and refuses
 * `dnc_channel` on `*` (`contact_governance_channel_dnc_is_specific`), because
 * two spellings of one state is exactly what the canonical model exists to
 * prevent. The mapping honours that rather than fighting it.
 */
export function toGovernanceType(reason: SuppressionReason, channel: string): GovernanceType {
  switch (reason) {
    case 'unsubscribe': return 'unsubscribe';
    case 'consent_withdrawn': return 'consent_withdrawn';
    case 'complaint': return 'complaint';
    case 'bounce': return 'bounce_hard';
    case 'dsar':
    case 'legal_hold':
    case 'manual':
    default:
      return channel === '*' ? 'dnc_permanent' : 'dnc_channel';
  }
}

/**
 * Consult the CANONICAL store. Returns null when it has nothing to say.
 *
 * Fails closed by THROWING, so the caller's catch turns any unreadable
 * governance table into a suppression. Reading an unreadable do-not-contact list
 * as "nobody is suppressed" would contact people who asked not to be — the one
 * failure mode this layer exists to prevent.
 *
 * No person anchor is supplied: this seam is reached with a raw recipient and no
 * identity. Target matching is therefore what applies here, exactly as before.
 */
async function canonicalVerdict(companyId: string, channel: string, target: string): Promise<SuppressionResult | null> {
  const loaded = await loadGovernanceRecords({ organizationId: companyId, target, channel });
  if (!loaded.ok) throw new Error(loaded.error ?? 'canonical governance read failed');

  const verdict = mayContact({
    organizationId: companyId,
    targetNormalized: normalizeGovernanceTarget(channel, target),
    channel,
    now: new Date().toISOString(),
    records: loaded.records,
  });

  // `deferred` is temporal backpressure — "not now" — which at this boolean seam
  // is still "do not send". Collapsing it to allowed would send during exactly
  // the window the recipient asked us not to.
  if (verdict.decision === 'allowed') return null;
  return {
    suppressed: true,
    reason: verdict.governanceType ?? verdict.reason,
    scope: verdict.matchedBy === 'person' ? 'person' : 'target',
    store: 'canonical',
  };
}

/**
 * W06 — record a suppression that happened because governance could not be
 * ASKED, distinct from one the rules actually asserted.
 *
 * The counter is a platform aggregate with no tenant label; the log line
 * carries the tenant, and the logger attaches request_id / correlation_id /
 * org_id from the existing request context, so an operator can join a specific
 * fail-closed suppression back to the request that caused it.
 *
 * The target is NEVER logged. It is an email or a phone number — precisely the
 * personal data the suppression exists to protect. Channel and stage are enough
 * to diagnose, and neither identifies a person.
 *
 * Returns the result it was given so a caller can `return observeFailClosed(...)`
 * in one expression and cannot accidentally observe without returning, or
 * return without observing.
 */
function observeFailClosed<T extends SuppressionResult>(
  stage: GovernanceFailClosedStage,
  companyId: string,
  channel: string,
  result: T,
): T {
  try {
    recordGovernanceFailClosed(stage);
    recordGovernanceGateDecision('suppressed', result.store ?? 'none');
    logger.warn('contact_governance_failclosed', {
      companyId: companyId || null,
      channel,
      stage,
      reason: result.reason ?? null,
      store: result.store ?? null,
    });
  } catch {
    /* observation must never break the gate */
  }
  return result;
}

/** Is this target suppressed for this channel? Canonical first, then legacy. Fail-closed. */
export async function isSuppressed(companyId: string, channel: string, target: string): Promise<SuppressionResult> {
  const t = norm(target);
  // DELIBERATELY UNOBSERVED. An empty target is not a governance decision:
  // governance was never consulted, and there is no contact to govern. Counting
  // it would inflate the `allowed` series with non-events, which is the same
  // reason LI-5E counts "only genuine resolutions" — a counter that includes
  // non-events cannot be read as a rate.
  if (!t) return { suppressed: false };

  // A governance question without a tenant cannot be answered — `mayContact`
  // itself refuses one for the same reason — so it is refused rather than
  // guessed.
  if (!companyId || !String(companyId).trim()) {
    return observeFailClosed('no_tenant', companyId, channel, { suppressed: true, reason: 'suppression_no_tenant_failclosed' });
  }

  try {
    const canonical = await canonicalVerdict(companyId, channel, target);
    if (canonical) {
      // A REAL suppression: the rules answered. Counted separately from the
      // fail-closed exits above so a governance outage can never hide inside
      // the compliance signal.
      recordGovernanceGateDecision('suppressed', 'canonical');
      return canonical;
    }
  } catch {
    return observeFailClosed('canonical_read', companyId, channel, { suppressed: true, reason: 'governance_lookup_failed_failclosed', store: 'canonical' });
  }

  // LEGACY — still authoritative for anything the canonical model cannot hold,
  // notably the `__global__` scope. It can add a suppression; it can never
  // remove one the canonical store asserted, because that path already returned.
  try {
    const { data, error } = await ownedDbTable(T)
      .select('reason, scope, company_id, channel')
      .eq('target', t)
      .eq('active', true)
      .in('channel', ['*', channel])
      .in('company_id', [GLOBAL, companyId])
      .limit(1);
    if (error) return observeFailClosed('legacy_read', companyId, channel, { suppressed: true, reason: 'suppression_lookup_error_failclosed', store: 'legacy' }); // fail-closed
    const row = Array.isArray(data) && data[0] ? (data[0] as Record<string, unknown>) : null;
    if (row) {
      recordGovernanceGateDecision('suppressed', 'legacy');
      return { suppressed: true, reason: String(row.reason), scope: String(row.scope), store: 'legacy' };
    }
    // Allowed by ABSENCE — both stores were read and neither had anything to
    // say. Counted so that "nobody is suppressed" and "we never checked" stop
    // being the same observation.
    recordGovernanceGateDecision('allowed', 'none');
    return { suppressed: false };
  } catch {
    return observeFailClosed('legacy_exception', companyId, channel, { suppressed: true, reason: 'suppression_exception_failclosed', store: 'legacy' });
  }
}

export interface AddSuppressionResult {
  /** Legacy row id, preserved so existing callers keep working unchanged. */
  id: string | null;
  /** Canonical `contact_governance_records.id`, or null for a global suppression. */
  canonicalId: string | null;
}

/**
 * Record a do-not-contact instruction.
 *
 * CANONICAL FIRST, AND IT MAY THROW. If the canonical write fails this function
 * propagates the error rather than reporting success, deliberately: telling a
 * caller a suppression was recorded when the authoritative store holds nothing
 * is worse than an error, because the next send would go out believing it was
 * cleared. This is a new failure mode on the DB-error path only; the success
 * path is unchanged.
 *
 * The legacy row is still written, so a reader that has not yet migrated — and
 * the `__global__` scope, which is not canonically expressible — keep working
 * until `suppression_entries` is formally retired.
 */
export async function addSuppression(input: { companyId: string | null; channel?: string; target: string; reason: SuppressionReason; actor?: string | null; metadata?: Record<string, unknown> }): Promise<AddSuppressionResult> {
  const channel = input.channel ?? '*';
  let canonicalId: string | null = null;

  // A global suppression has no tenant, and canonical governance is never
  // tenant-less (ADR D-1). It stays legacy-only, and that is the documented
  // residual blocking `suppression_entries`' retirement.
  if (input.companyId) {
    const written = await recordContactGovernance({
      organizationId: input.companyId,
      governanceType: toGovernanceType(input.reason, channel),
      channel,
      target: input.target,
      source: 'suppression_service',
      // SUMMARY ONLY — the writer rejects evidence carrying content. The
      // original reason word is kept because the canonical vocabulary is
      // coarser than this service's and the distinction (dsar vs legal_hold vs
      // manual) is worth preserving for an operator.
      evidence: { legacyReason: input.reason, actor: input.actor ?? null },
    });
    canonicalId = written.id;
  }

  const { data } = await ownedDbTable(T).upsert({
    company_id: input.companyId ?? GLOBAL, scope: input.companyId ? 'tenant' : 'global', channel,
    target: norm(input.target), reason: input.reason, created_by: input.actor ?? null, metadata: input.metadata ?? {}, active: true, released_at: null,
  }, { onConflict: 'company_id,channel,target' }).select('id').maybeSingle();

  return { id: data ? String((data as { id: unknown }).id) : null, canonicalId };
}

export interface ReleaseSuppressionResult {
  /** How many canonical records were revoked. */
  canonicalRevoked: number;
}

/**
 * Release (un-suppress) a target on a channel.
 *
 * Canonical records are REVOKED, never deleted: ADR §16 keeps the original
 * instruction, its provenance and its effective period readable, which is what
 * makes the history defensible to a regulator. The legacy row is deactivated the
 * way it always was.
 *
 * Only records naming this EXACT channel are revoked. A `*` record is a
 * broader instruction than the one being released, and silently narrowing it
 * would lift a suppression the operator did not ask to lift.
 */
export async function releaseSuppression(companyId: string | null, channel: string, target: string): Promise<ReleaseSuppressionResult> {
  let canonicalRevoked = 0;

  if (companyId) {
    const loaded = await loadGovernanceRecords({ organizationId: companyId, target, channel });
    if (!loaded.ok) throw new Error(loaded.error ?? 'canonical governance read failed');
    for (const record of loaded.records) {
      if (record.channel !== channel) continue;
      const { revoked } = await revokeContactGovernance({
        organizationId: companyId,
        id: record.id,
        reason: 'released_via_suppression_service',
      });
      if (revoked) canonicalRevoked += 1;
    }
  }

  await ownedDbTable(T).update({ active: false, released_at: new Date().toISOString() })
    .eq('target', norm(target)).eq('channel', channel).eq('active', true)
    .eq('company_id', companyId ?? GLOBAL);

  return { canonicalRevoked };
}

/** Convenience: record an unsubscribe (the most common consumer-facing path). */
export const unsubscribe = (companyId: string, target: string, channel = '*', actor?: string) =>
  addSuppression({ companyId, channel, target, reason: 'unsubscribe', actor });
