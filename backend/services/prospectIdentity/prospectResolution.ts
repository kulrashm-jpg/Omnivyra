/**
 * WS-1 (FR-03) — deterministic canonical PROSPECT resolution.
 *
 * C-2 froze `canonical_leads` as the canonical Prospect foundation. The PI
 * intake path did not produce one: `leadIngestion/**` resolves a person
 * (`unified_persons`), an account (`prospect_accounts`) and provenance
 * (`source_records`), and returns no prospect id at all. So BR-01 — an
 * automatic prospect repository — could not be satisfied by intake, because
 * intake never created the canonical record. This module is that missing step,
 * and deliberately nothing else.
 *
 * ─── IT RESOLVES A PROSPECT. IT RESOLVES NO PERSON AND NO ACCOUNT. ────────
 * `identityResolutionService.resolveUnifiedPerson` remains the sole
 * resolve-or-create path for a person, and `accountResolution` for an account.
 * This module consumes an ALREADY-resolved person id; it never derives one.
 * A second identity engine is exactly what C-2 exists to prevent.
 *
 * ─── THE IDENTITY KEY IS THE SOURCE'S OWN KEY ─────────────────────────────
 * `(company_id, external_lead_key)` is backed by a real partial unique index
 * (`idx_canonical_leads_company_external`, WHERE external_lead_key IS NOT
 * NULL). That index is the idempotency anchor: re-ingesting the same source
 * record converges on one Prospect instead of creating a second.
 *
 * Because the index is PARTIAL, `ON CONFLICT` cannot infer it — PostgREST
 * answers `42P10`, the trap this programme hit in W0.1, W0.2, W3 and LI-3D. So
 * persistence is INSERT → catch `23505` → re-resolve, the same shape
 * `accountResolution` and `upsertSourceRecord` already use. There is no
 * SELECT-then-INSERT: that is a race, not an idempotency mechanism.
 *
 * ─── NO KEY MEANS NO PROSPECT ─────────────────────────────────────────────
 * A record with no `external_lead_key` is NOT given a synthesised one. A
 * fabricated key would be unique by construction, so every re-ingestion would
 * mint another Prospect for the same human — silent duplication that the
 * partial index cannot catch precisely because the key is always new. Such a
 * record resolves `insufficient_evidence` and creates nothing.
 *
 * ─── WHY `canonical_users` IS TOUCHED AT ALL ──────────────────────────────
 * `canonical_leads.user_id` is NOT NULL with an FK to
 * `canonical_users(id, company_id)`, and `canonical_users` is the canonical
 * SUBJECT (session / device / geo / external key), not a platform operator.
 * A CSV row or a CRM record was never tracked, so it has no session and no
 * device.
 *
 * `crmIngestionService` already established how a non-tracked source satisfies
 * that column honestly (crmIngestionService.ts:150-163): `device: 'unknown'`
 * and `user_type: 'known' | 'anonymous'` decided by whether contact detail
 * exists. This module follows that part of the precedent rather than inventing
 * a second convention — and rather than fabricating tracking data the source
 * never produced. Unknown is recorded AS unknown.
 *
 * It deliberately DIVERGES from that precedent in one respect: it does not copy
 * email / name / phone onto the subject. Those are canonical person attributes
 * whose only sanctioned writer is LI-2's ingestionBoundary, and LI-2's own
 * enforcement test flags any other file in this module that writes them. A
 * second copy would be a second unarbitrated truth; the subject reaches them
 * through unified_person_id instead.
 */

import { ownedDbTable } from '../../db/writeOwner';

/** Bumped when resolution rules change, so a row traces to the logic that made it. */
export const PROSPECT_RESOLUTION_VERSION = 'ws1.1';

/** Marks rows this module writes, distinct from W4's `w4_account_activation`. */
export const WS1_SOURCE = 'ws1_prospect_resolution';

export type ProspectOutcome = 'matched' | 'created' | 'insufficient_evidence';

/** Evidence offered for one Prospect, already normalised by the adapter. */
export interface ProspectCandidate {
  /** The source's own immutable key for this record. The identity anchor. */
  externalLeadKey?: string | null;
  /** Provider/system the record came from. Required — the row demands it. */
  source: string;
  /** An already-resolved `unified_persons.id`. NEVER derived here. */
  personId?: string | null;
  /** Contact detail, used ONLY to decide `known` vs `anonymous`. */
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  /** Free-form source detail, preserved as provenance on both rows. */
  metadata?: Record<string, unknown>;
}

export interface ProspectResolution {
  organizationId: string;
  prospectId: string | null;
  subjectId: string | null;
  outcome: ProspectOutcome;
  externalLeadKey: string | null;
  reason: string;
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** Tenant-scoped lookup by the source's own key. */
async function findByExternalKey(organizationId: string, key: string): Promise<string | null> {
  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id')
    .eq('company_id', organizationId)   // tenant boundary — never optional
    .eq('external_lead_key', key)
    .limit(2);
  if (error) throw new Error(`canonical_leads lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string }>;
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Resolve WITHOUT writing. Read-only: safe to run in shadow.
 */
export async function resolveProspectShadow(
  organizationId: string,
  candidate: ProspectCandidate,
): Promise<ProspectResolution> {
  if (!organizationId?.trim()) throw new Error('organizationId is required for prospect resolution');

  const key = clean(candidate.externalLeadKey);
  const base = { organizationId, externalLeadKey: key, subjectId: null };

  if (!key) {
    return { ...base, prospectId: null, outcome: 'insufficient_evidence',
      reason: 'no external_lead_key — a synthesised key would mint a new prospect on every re-ingestion' };
  }

  const found = await findByExternalKey(organizationId, key);
  return found
    ? { ...base, prospectId: found, outcome: 'matched', reason: 'matched an existing prospect by the source key' }
    : { ...base, prospectId: null, outcome: 'insufficient_evidence', reason: 'no existing prospect matches this source key' };
}

/**
 * Resolve the canonical SUBJECT the Prospect row requires.
 *
 * Keyed on `(company_id, external_user_key)` and idempotent for the same
 * reason the Prospect is: re-ingestion must converge, not accumulate.
 */
async function resolveSubject(
  organizationId: string,
  key: string,
  candidate: ProspectCandidate,
  personId: string | null,
): Promise<string> {
  const contactable = Boolean(clean(candidate.email) || clean(candidate.phone));
  const row = {
    company_id: organizationId,
    external_user_key: key,
    // The crmIngestionService convention, followed rather than re-invented.
    user_type: contactable ? 'known' : 'anonymous',
    // Honest sentinel. This subject was never tracked, so there IS no device,
    // and inventing one would fabricate analytics evidence.
    device: 'unknown',
    unified_person_id: personId,
    // NO email / full_name / phone. Those are canonical PERSON attributes and
    // LI-2's boundary is their only sanctioned writer, so RULE A/B/C arbitration
    // applies to them exactly once. A copy here would be a second, unarbitrated
    // truth — and the subject already reaches them via unified_person_id.
    //
    // The candidate's contact detail is still READ, to decide known-vs-anonymous.
    // Reading a value to classify a row is not storing a competing copy of it.
    user_metadata: { source: candidate.source, createdBy: WS1_SOURCE, ...(candidate.metadata ?? {}) },
  };

  const { data, error } = await ownedDbTable('canonical_users').insert(row).select('id').single();
  if (!error && data) return (data as { id: string }).id;

  if (error?.code === '23505') {
    const { data: again, error: againError } = await ownedDbTable('canonical_users')
      .select('id')
      .eq('company_id', organizationId)
      .eq('external_user_key', key)
      .limit(1);
    if (againError) throw new Error(`canonical_users re-resolve failed: ${againError.message}`);
    const rows = (again ?? []) as Array<{ id: string }>;
    if (rows.length === 1) return rows[0].id;
  }
  throw new Error(`canonical_users insert failed: ${error?.message ?? 'unknown error'}`);
}

/**
 * Resolve, creating the Prospect when nothing matches.
 *
 * Idempotent by database constraint. On a race the loser's INSERT violates the
 * partial unique index (`23505`) and we re-resolve rather than retrying
 * blindly, so two workers converge on one Prospect.
 *
 * `qualification_score` is deliberately left to its column default of 0 and is
 * never written here: scoring belongs to WS-6, and a resolver that seeded a
 * score would put a second scoring authority in the identity layer.
 */
export async function resolveOrCreateProspect(
  organizationId: string,
  candidate: ProspectCandidate,
  at: string = new Date().toISOString(),
): Promise<ProspectResolution> {
  const shadow = await resolveProspectShadow(organizationId, candidate);
  if (shadow.outcome !== 'insufficient_evidence' || !shadow.externalLeadKey) {
    return shadow;   // matched, or genuinely no key — never create without one
  }

  const key = shadow.externalLeadKey;
  const source = clean(candidate.source);
  if (!source) {
    return { ...shadow, reason: 'source is required — canonical_leads_source_not_blank refuses an empty source' };
  }

  const personId = clean(candidate.personId);
  const subjectId = await resolveSubject(organizationId, key, candidate, personId);

  const row = {
    company_id: organizationId,
    user_id: subjectId,
    unified_person_id: personId,
    source,
    external_lead_key: key,
    // Status is left NULL: a lifecycle state is derived from evidence (FR-15,
    // WS-4), and stamping one here would be a second journey authority.
    lead_status: null,
    lead_metadata: {
      prospectResolutionVersion: PROSPECT_RESOLUTION_VERSION,
      createdBy: WS1_SOURCE,
      observedAt: at,
      ...(candidate.metadata ?? {}),
    },
  };

  const { data, error } = await ownedDbTable('canonical_leads').insert(row).select('id').single();
  if (!error && data) {
    return { ...shadow, prospectId: (data as { id: string }).id, subjectId, outcome: 'created',
      reason: 'no existing prospect matched this source key; created' };
  }
  if (error?.code === '23505') {
    const again = await resolveProspectShadow(organizationId, candidate);
    return { ...again, subjectId, reason: `${again.reason} (created concurrently by another worker)` };
  }
  throw new Error(`canonical_leads insert failed: ${error?.message ?? 'unknown error'}`);
}

/**
 * Attach an already-resolved person to a Prospect that has none.
 *
 * Mirrors `attachPersonToAccount`: tenant-filtered, and it never silently
 * re-homes a Prospect that is already anchored to a different person. The
 * database enforces tenant agreement independently via
 * `canonical_leads_person_tenant_fk`.
 */
export async function attachPersonToProspect(
  organizationId: string,
  prospectId: string,
  personId: string,
): Promise<{ attached: boolean; reason: string }> {
  if (!organizationId?.trim() || !prospectId || !personId) {
    return { attached: false, reason: 'organizationId, prospectId and personId are all required' };
  }

  const { data, error } = await ownedDbTable('canonical_leads')
    .update({ unified_person_id: personId })
    .eq('id', prospectId)
    .eq('company_id', organizationId)   // tenant boundary
    .is('unified_person_id', null)      // never silently re-anchor
    .select('id');

  if (error) {
    if (error.code === '23503') return { attached: false, reason: 'rejected by tenant integrity constraint' };
    throw new Error(`attachPersonToProspect failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ id: string }>;
  return rows.length === 1
    ? { attached: true, reason: 'person attached to prospect' }
    : { attached: false, reason: 'prospect not found in this tenant, or already anchored to a person' };
}
