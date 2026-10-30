/**
 * IDENTITY ORDERING RECONCILIATION (closure-B) — one verified identity ⇒ ONE
 * canonical prospect per tenant, whichever source saw the person first.
 *
 * THE GAP IT CLOSES. Community evidence by an UNVERIFIED author creates a
 * person-less prospect anchored to the normalised handle
 * (`lead_metadata.sourceIdentity`, bridgeCore rule 4). PI discovery creates a
 * person-anchored prospect keyed by the provider id (`apollo:<id>`), and WS-1
 * never looks up handle prospects. Once the handle is VERIFIED to that person,
 * the tenant would otherwise see TWO prospects for one human.
 *
 * ─── WHEN IT MERGES (never on a guess) ────────────────────────────────────
 * ONLY on verified identity evidence, using the EXISTING rule
 * (`bridge/verifiedIdentity.resolveVerifiedSocialPerson`: exactly one person
 * named by an active, linked `identity_claims` external_id row in THIS tenant).
 * A handle alone, a name, a company, a profile URL or any approximate match
 * never merges anything. The candidate set for verified (handle h → person X):
 *   - every prospect of the tenant anchored to X (`unified_person_id = X`), and
 *   - every prospect of the tenant anchored to h (`lead_metadata.sourceIdentity`)
 *     that has NO person, or has X.
 * A handle prospect anchored to a DIFFERENT person is a conflict: reported,
 * never merged, never re-anchored. Nothing crosses tenants: every read is
 * `company_id` / `organization_id` filtered and the alias table's composite FKs
 * refuse a lead of another tenant.
 *
 * ─── SURVIVOR (deterministic) ─────────────────────────────────────────────
 * Among the candidates that are not already aliases, ordered by:
 *   1. anchored to the verified person X first — attaching X to a person-less
 *      prospect while another prospect already carries X would anchor one
 *      person twice, and an anchored prospect is never re-anchored;
 *   2. already a survivor (has absorbed prospects) first — keeps the alias
 *      graph flat, so a survivor is never demoted;
 *   3. earliest `created_at` (the first canonical record of the person);
 *   4. smallest id (total order).
 * So for "community → discovery → verification" and "discovery → community →
 * verification" the survivor is the DISCOVERY prospect (the only one carrying
 * X); when both already carry X, the earliest wins.
 *
 * ─── WHAT IT WRITES (append-only) ─────────────────────────────────────────
 *   - one `prospect_aliases` row per absorbed prospect → the survivor
 *     (reason `verified_identity`, rule version, evidence: verification rule,
 *     platform — never the handle or the person id, so an append-only alias
 *     can never retain erasable personal data). Existing aliases are never
 *     re-pointed; a replay is a `duplicate`.
 *   - `attachPersonToProspect(survivor, X)` only when the survivor has no
 *     person (WS-1's existing writer; it never re-anchors).
 * It NEVER deletes, moves or rewrites a contribution, a source record, a
 * prospect's key or source. Readers resolve the absorbed prospect onto the
 * survivor (`leadIntelligenceReadService`, `lib/leadIntelligence/query.ts`).
 *
 * ─── ERROR POSTURE ────────────────────────────────────────────────────────
 * Never throws; every outcome is returned. Callers (the community bridge and the
 * PI discovery orchestrator) must not fail an ingestion because reconciliation
 * could not run. A missing alias table (migration unapplied) is `unavailable`
 * and nothing is written.
 */
import { normalizedSocialIdentity, VERIFIED_IDENTITY_RULE_VERSION, type SocialIdentityVerdict } from './bridge/verifiedIdentity';
import {
  aliasIndexOf,
  terminalSurvivorOf,
  type ProspectAlias,
} from '../../../lib/prospectProvenance/prospectAliases';
import type { ProspectAliasInput, ProspectAliasReadResult, ProspectAliasWriteResult } from './prospectAliasStore';

/** Bumped when the reconciliation rule changes; stamped on every alias row. */
export const IDENTITY_RECONCILIATION_RULE = 'cb.reconcile.1';

/** How many prospects per anchor are considered. Far above any legitimate count; a hit is reported. */
export const RECONCILE_CANDIDATE_CAP = 50;

export interface ProspectAnchor {
  id: string;
  personId: string | null;
  createdAt: string | null;
}

export interface ReconciliationDeps {
  verify(organizationId: string, platform: string, platformUserId: string): Promise<SocialIdentityVerdict>;
  prospectsForPerson(organizationId: string, personId: string): Promise<ProspectAnchor[]>;
  prospectsForHandle(organizationId: string, platform: string, normalizedPlatformUserId: string): Promise<ProspectAnchor[]>;
  readAliases(organizationId: string): Promise<ProspectAliasReadResult>;
  recordAlias(input: ProspectAliasInput): Promise<ProspectAliasWriteResult>;
  attachPerson(organizationId: string, prospectId: string, personId: string): Promise<{ attached: boolean; reason: string }>;
  /** Active, linked external_id claims of a person (platform + normalised value), ≤ 20. */
  verifiedHandlesOfPerson(organizationId: string, personId: string): Promise<Array<{ platform: string; platformUserId: string }>>;
}

export type ReconciliationStatus =
  | 'reconciled'   // at least one alias recorded now
  | 'no_change'    // nothing to merge (≤ 1 effective prospect), or every alias already recorded
  | 'partial'      // some aliases recorded / some refused or failed
  | 'unverified'   // the handle is not verified by the rule — nothing is merged
  | 'unavailable'  // the alias store is missing (migration unapplied) — nothing written
  | 'failed';

export interface ReconciliationOutcome {
  status: ReconciliationStatus;
  /** Machine-readable, safe to log (no identifiers). */
  reason: string;
  personId: string | null;
  survivorId: string | null;
  /** Prospects aliased to the survivor by THIS call. */
  aliased: string[];
  /** Candidates already aliased before this call (resolved, not rewritten). */
  alreadyAliased: string[];
  refused: Array<{ prospectId: string; code: string }>;
  /** Handle prospects anchored to a different person — never merged. */
  conflicts: string[];
  personAttached: boolean;
}

export interface ReconciliationPlan {
  survivor: ProspectAnchor | null;
  absorb: ProspectAnchor[];
  attachPerson: boolean;
  alreadyAliased: string[];
  conflicts: string[];
}

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * PURE: the survivor and the prospects to absorb for one verified identity.
 * See the module header for the rule. Deterministic and order-independent.
 */
export function planIdentityReconciliation(input: {
  personId: string;
  personProspects: readonly ProspectAnchor[];
  handleProspects: readonly ProspectAnchor[];
  aliasIndex: ReadonlyMap<string, string>;
}): ReconciliationPlan {
  const person = norm(input.personId);
  const conflicts: string[] = [];
  const candidates = new Map<string, ProspectAnchor>();
  for (const p of input.personProspects) {
    if (p && norm(p.personId) === person && norm(p.id)) candidates.set(norm(p.id), p);
  }
  for (const p of input.handleProspects) {
    if (!p || !norm(p.id)) continue;
    if (p.personId && norm(p.personId) !== person) { conflicts.push(p.id); continue; }
    candidates.set(norm(p.id), p);
  }

  const survivorsWithAliases = new Set<string>();
  for (const [from] of input.aliasIndex) {
    const t = terminalSurvivorOf(input.aliasIndex, from);
    if (t !== from) survivorsWithAliases.add(t);
  }

  const effective: ProspectAnchor[] = [];
  const alreadyAliased: string[] = [];
  for (const [key, p] of candidates) {
    const t = terminalSurvivorOf(input.aliasIndex, key);
    if (t !== key) {
      alreadyAliased.push(p.id);
      // Absorbed into a prospect OUTSIDE this identity's candidates: leave it, report it.
      if (!candidates.has(t)) conflicts.push(p.id);
    } else {
      effective.push(p);
    }
  }
  if (effective.length === 0) return { survivor: null, absorb: [], attachPerson: false, alreadyAliased: alreadyAliased.sort(), conflicts: conflicts.sort() };

  const rank = (p: ProspectAnchor) => ({
    anchored: norm(p.personId) === person ? 0 : 1,
    hasAliases: survivorsWithAliases.has(norm(p.id)) ? 0 : 1,
    created: p.createdAt ? Date.parse(p.createdAt) : Number.POSITIVE_INFINITY,
    id: norm(p.id),
  });
  const sorted = [...effective].sort((a, b) => {
    const x = rank(a), y = rank(b);
    if (x.anchored !== y.anchored) return x.anchored - y.anchored;
    if (x.hasAliases !== y.hasAliases) return x.hasAliases - y.hasAliases;
    const xc = Number.isNaN(x.created) ? Number.POSITIVE_INFINITY : x.created;
    const yc = Number.isNaN(y.created) ? Number.POSITIVE_INFINITY : y.created;
    if (xc !== yc) return xc < yc ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  const survivor = sorted[0];
  return {
    survivor,
    absorb: sorted.slice(1),
    attachPerson: !survivor.personId,
    alreadyAliased: alreadyAliased.sort(),
    conflicts: conflicts.sort(),
  };
}

/* ── default (production) dependencies — lazy, existing services ────────── */

let cachedDeps: ReconciliationDeps | null = null;

export function defaultReconciliationDeps(): ReconciliationDeps {
  if (cachedDeps) return cachedDeps;
  const anchors = (rows: unknown): ProspectAnchor[] =>
    ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      personId: (r.unified_person_id as string | null) ?? null,
      createdAt: r.created_at == null ? null : String(r.created_at),
    }));
  cachedDeps = {
    verify: async (organizationId, platform, platformUserId) => {
      const { resolveVerifiedSocialPerson } = await import('./bridge/verifiedIdentity');
      return resolveVerifiedSocialPerson(organizationId, [{ platform, platformUserId }]);
    },
    prospectsForPerson: async (organizationId, personId) => {
      const { ownedDbTable } = await import('../../db/writeOwner');
      const { data, error } = await ownedDbTable('canonical_leads')
        .select('id,unified_person_id,created_at')
        .eq('company_id', organizationId)       // tenant boundary — never optional
        .eq('unified_person_id', personId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(RECONCILE_CANDIDATE_CAP);
      if (error) throw new Error(`canonical_leads person lookup failed: ${error.message}`);
      return anchors(data);
    },
    prospectsForHandle: async (organizationId, platform, normalizedPlatformUserId) => {
      const { ownedDbTable } = await import('../../db/writeOwner');
      const { data, error } = await ownedDbTable('canonical_leads')
        .select('id,unified_person_id,created_at')
        .eq('company_id', organizationId)       // tenant boundary — never optional
        .contains('lead_metadata', { sourceIdentity: { platform, platformUserId: normalizedPlatformUserId } })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(RECONCILE_CANDIDATE_CAP);
      if (error) throw new Error(`canonical_leads handle lookup failed: ${error.message}`);
      return anchors(data);
    },
    readAliases: async (organizationId) => {
      const { readProspectAliases } = await import('./prospectAliasStore');
      return readProspectAliases(organizationId);
    },
    recordAlias: async (input) => {
      const { recordProspectAlias } = await import('./prospectAliasStore');
      return recordProspectAlias(input);
    },
    attachPerson: async (organizationId, prospectId, personId) => {
      const { attachPersonToProspect } = await import('../prospectIdentity/prospectResolution');
      return attachPersonToProspect(organizationId, prospectId, personId);
    },
    verifiedHandlesOfPerson: async (organizationId, personId) => {
      const { ownedDbTable } = await import('../../db/writeOwner');
      const { data, error } = await ownedDbTable('identity_claims')
        .select('platform,normalized_value')
        .eq('organization_id', organizationId)  // tenant boundary — never optional
        .eq('person_id', personId)
        .eq('claim_type', 'external_id')
        .is('revoked_at', null)
        .order('normalized_value', { ascending: true })
        .limit(20);
      if (error) throw new Error(`identity_claims lookup failed: ${error.message}`);
      return ((data ?? []) as Array<{ platform: string | null; normalized_value: string | null }>)
        .filter((r) => r.platform && r.normalized_value)
        .map((r) => ({ platform: String(r.platform), platformUserId: String(r.normalized_value) }));
    },
  };
  return cachedDeps;
}

/* ── observability ──────────────────────────────────────────────────────── */

const reported = new Set<string>();
function observe(o: ReconciliationOutcome): ReconciliationOutcome {
  if (o.status === 'failed' || o.status === 'partial' || o.status === 'unavailable' || o.conflicts.length > 0) {
    const key = `${o.status}|${o.reason}|${o.conflicts.length > 0}`;
    if (!reported.has(key)) {
      reported.add(key);
      console.warn('[identityReconciliation]', o.status, o.reason,
        `aliased=${o.aliased.length} refused=${o.refused.length} conflicts=${o.conflicts.length}`);
    }
  }
  return o;
}

/** Test seam. */
export function resetIdentityReconciliationReportsForTests(): void {
  reported.clear();
}

const empty = (status: ReconciliationStatus, reason: string, personId: string | null = null): ReconciliationOutcome =>
  ({ status, reason, personId, survivorId: null, aliased: [], alreadyAliased: [], refused: [], conflicts: [], personAttached: false });

/**
 * Reconcile every prospect of ONE verified social identity in ONE tenant.
 * Idempotent: a replay records nothing new (`no_change`). Never throws.
 */
export async function reconcileVerifiedSocialIdentity(
  organizationId: string,
  handle: { platform: string | null | undefined; platformUserId: string | null | undefined },
  deps: ReconciliationDeps = defaultReconciliationDeps(),
): Promise<ReconciliationOutcome> {
  const org = typeof organizationId === 'string' ? organizationId.trim() : '';
  if (!org) return empty('failed', 'organization_required');
  const h = normalizedSocialIdentity(handle.platform ?? null, handle.platformUserId ?? null);
  if (!h) return empty('unverified', 'unusable_identity');

  try {
    const verdict = await deps.verify(org, h.platform, h.platformUserId);
    if (verdict.status !== 'verified' || !verdict.personId) return empty('unverified', `identity_${verdict.reason}`);
    const personId = verdict.personId;

    const [personProspects, handleProspects, aliasRead] = [
      await deps.prospectsForPerson(org, personId),
      await deps.prospectsForHandle(org, h.platform, h.platformUserId),
      await deps.readAliases(org),
    ];
    if (aliasRead.status !== 'ok') {
      return observe(empty(aliasRead.status === 'table_missing' ? 'unavailable' : 'failed', `alias_store_${aliasRead.status}`, personId));
    }
    const plan = planIdentityReconciliation({
      personId,
      personProspects,
      handleProspects,
      aliasIndex: aliasIndexOf(org, aliasRead.aliases as ProspectAlias[]),
    });
    const out: ReconciliationOutcome = {
      status: 'no_change',
      reason: plan.survivor ? (plan.absorb.length ? 'pending' : 'single_prospect') : 'no_prospect',
      personId,
      survivorId: plan.survivor?.id ?? null,
      aliased: [],
      alreadyAliased: plan.alreadyAliased,
      refused: [],
      conflicts: plan.conflicts,
      personAttached: false,
    };
    if (!plan.survivor) return observe(out);

    if (plan.attachPerson) {
      const r = await deps.attachPerson(org, plan.survivor.id, personId);
      out.personAttached = r.attached;
    }

    for (const p of plan.absorb) {
      const w = await deps.recordAlias({
        organizationId: org,
        aliasLeadId: p.id,
        survivorLeadId: plan.survivor.id,
        reason: 'verified_identity',
        ruleVersion: IDENTITY_RECONCILIATION_RULE,
        evidence: {
          rule: IDENTITY_RECONCILIATION_RULE,
          verificationRule: VERIFIED_IDENTITY_RULE_VERSION,
          verification: verdict.reason,
          platform: h.platform,
          // No handle and no person id: alias rows are append-only (UPDATE is
          // refused), so anything personal stored here could never be erased.
          // The verifying claim and the person are erased by the provenance
          // erasure path; the alias only records that a verified merge happened.
          survivorSelection: 'person_anchored>has_aliases>earliest_created>id',
        },
      });
      if (w.status === 'inserted') out.aliased.push(p.id);
      else if (w.status === 'duplicate') out.alreadyAliased.push(p.id);
      else if (w.status === 'table_missing') return observe({ ...out, status: 'unavailable', reason: 'alias_store_table_missing' });
      else out.refused.push({ prospectId: p.id, code: `${w.status}:${w.code ?? 'unknown'}` });
    }
    out.alreadyAliased.sort();
    if (out.refused.length > 0) return observe({ ...out, status: out.aliased.length ? 'partial' : 'failed', reason: 'alias_refused' });
    if (out.aliased.length > 0) return observe({ ...out, status: 'reconciled', reason: 'aliased_to_survivor' });
    return observe({ ...out, reason: plan.absorb.length ? 'already_reconciled' : out.reason });
  } catch (e) {
    return observe(empty('failed', `unexpected:${e instanceof Error ? e.message : String(e)}`));
  }
}

/**
 * Reconcile every VERIFIED social identity of a person (the PI discovery hook:
 * a discovery that creates or resolves a person checks whether that person has
 * verified handles whose person-less prospects must fold into one). Each
 * handle is re-verified by the rule (exactly one person) — a claim of this
 * person that is ambiguous in the tenant merges nothing. Never throws.
 */
export async function reconcileVerifiedPersonIdentities(
  organizationId: string,
  personId: string,
  deps: ReconciliationDeps = defaultReconciliationDeps(),
): Promise<ReconciliationOutcome[]> {
  if (!organizationId || !personId) return [];
  let handles: Array<{ platform: string; platformUserId: string }>;
  try {
    handles = await deps.verifiedHandlesOfPerson(organizationId, personId);
  } catch (e) {
    return [observe(empty('failed', `claims_read_failed:${e instanceof Error ? e.message : String(e)}`, personId))];
  }
  const seen = new Set<string>();
  const out: ReconciliationOutcome[] = [];
  for (const h of handles) {
    const n = normalizedSocialIdentity(h.platform, h.platformUserId);
    if (!n) continue;
    const k = `${n.platform}|${n.platformUserId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = await reconcileVerifiedSocialIdentity(organizationId, n, deps);
    // A claim of this person that verifies someone else (or nobody) merges nothing.
    if (r.personId && r.personId !== personId) continue;
    out.push(r);
  }
  return out;
}
